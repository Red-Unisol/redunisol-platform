"""API de solo lectura de la cartera (préstamos, cuotas y cobros) de los proveedores configurados.

Seguridad:
- Bearer token obligatorio (CARTERA_API_TOKEN).
- Lista de IPs opcional (CARTERA_IPS_PERMITIDAS, separadas por coma). Vacía = apagada.
- Límite de consultas por minuto por IP (CARTERA_LIMITE_POR_MINUTO).
- Cada consulta queda en el log con su IP; la primera vez que aparece una IP se loguea
  `ip_nueva` con nivel WARNING, para que la alerte el monitoreo (Loki).
"""

from __future__ import annotations

import base64
import hmac
import ipaddress
import json
import logging
import os
import sqlite3
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request

from .db import connect
from .sync import AR

log = logging.getLogger("cartera_api")
if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

PAGINA_DEFECTO = 500
PAGINA_MAXIMA = 2000


# ---------- configuración ----------

def _db_path() -> str:
    return os.getenv("CARTERA_DB_PATH", "/data/cartera/cartera.sqlite")


def _token() -> str:
    token = os.getenv("CARTERA_API_TOKEN", "").strip()
    if len(token) < 32:
        raise RuntimeError("CARTERA_API_TOKEN falta o es demasiado corto (mínimo 32 caracteres).")
    return token


def _ips_permitidas() -> list[ipaddress._BaseNetwork]:
    raw = os.getenv("CARTERA_IPS_PERMITIDAS", "").strip()
    return [ipaddress.ip_network(p.strip(), strict=False) for p in raw.split(",") if p.strip()]


def _proxies_confiables() -> list[ipaddress._BaseNetwork]:
    # Por defecto: loopback y redes privadas (Apache en el host / red de Docker).
    raw = os.getenv("CARTERA_PROXIES_CONFIABLES", "127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16")
    return [ipaddress.ip_network(p.strip(), strict=False) for p in raw.split(",") if p.strip()]


def _limite_por_minuto() -> int:
    return int(os.getenv("CARTERA_LIMITE_POR_MINUTO", "120"))


# ---------- seguridad ----------

def ip_cliente(request: Request) -> str:
    """IP real del cliente.

    Los encabezados solo se creen si la conexión viene de un proxy confiable (Apache en la VPS).
    Detrás de Cloudflare, la IP real llega en CF-Connecting-IP; Apache solo acepta conexiones de
    Cloudflare para este sitio, así que ese encabezado no se puede falsificar desde afuera.
    Sin Cloudflare (pruebas locales), se usa el último valor de X-Forwarded-For, que agrega Apache.
    """
    directa = request.client.host if request.client else ""
    try:
        directa_ip = ipaddress.ip_address(directa)
    except ValueError:
        return directa
    if any(directa_ip in red for red in _proxies_confiables()):
        cf = request.headers.get("cf-connecting-ip", "").strip()
        if cf:
            return cf
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            return xff.split(",")[-1].strip()  # Apache agrega la IP del cliente al final
    return directa


class Limitador:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def permitir(self, clave: str, limite: int) -> bool:
        ahora = time.monotonic()
        with self._lock:
            cola = self._hits[clave]
            while cola and ahora - cola[0] > 60:
                cola.popleft()
            if len(cola) >= limite:
                return False
            cola.append(ahora)
            return True


limitador = Limitador()


def _registrar_ip(ip: str) -> None:
    ahora = datetime.now(AR).isoformat(timespec="seconds")
    conn = connect(_db_path())
    try:
        with conn:
            nueva = conn.execute("SELECT 1 FROM ips_vistas WHERE ip = ?", [ip]).fetchone() is None
            conn.execute(
                "INSERT INTO ips_vistas (ip, primera_vez, ultima_vez, consultas) VALUES (?, ?, ?, 1) "
                "ON CONFLICT(ip) DO UPDATE SET ultima_vez = excluded.ultima_vez, consultas = consultas + 1",
                [ip, ahora, ahora])
    finally:
        conn.close()
    if nueva:
        log.warning("ip_nueva ip=%s", ip)


def autorizar(request: Request) -> str:
    ip = ip_cliente(request)
    permitidas = _ips_permitidas()
    if permitidas:
        try:
            ok = any(ipaddress.ip_address(ip) in red for red in permitidas)
        except ValueError:
            ok = False
        if not ok:
            log.warning("rechazo motivo=ip ip=%s ruta=%s", ip, request.url.path)
            raise HTTPException(status_code=403, detail="IP no permitida.")
    auth = request.headers.get("authorization", "")
    recibido = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not recibido or not hmac.compare_digest(recibido, _token()):
        log.warning("rechazo motivo=token ip=%s ruta=%s", ip, request.url.path)
        raise HTTPException(status_code=401, detail="Token inválido.")
    if not limitador.permitir(ip, _limite_por_minuto()):
        log.warning("rechazo motivo=limite ip=%s ruta=%s", ip, request.url.path)
        raise HTTPException(status_code=429, detail="Demasiadas consultas; reintentar en un minuto.")
    _registrar_ip(ip)
    log.info("consulta ip=%s ruta=%s query=%s", ip, request.url.path, request.url.query)
    return ip


# ---------- copia diaria programada ----------

def _hilo_sync(parar: threading.Event) -> None:
    from .config import load_settings
    from .sync import sincronizar

    hora = os.getenv("CARTERA_SYNC_HORA", "05:00")
    hh, mm = (int(x) for x in hora.split(":"))
    while not parar.is_set():
        ahora = datetime.now(AR)
        proxima = ahora.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if proxima <= ahora:
            proxima += timedelta(days=1)
        if parar.wait((proxima - ahora).total_seconds()):
            return
        try:
            log.info("sync inicio")
            log.info("sync fin %s", sincronizar(load_settings()))
        except Exception:
            log.exception("sync_error")


@asynccontextmanager
async def lifespan(_: FastAPI):
    _token()  # falla al arrancar si no hay token
    parar = threading.Event()
    if os.getenv("CARTERA_SYNC_ACTIVA", "1") == "1":
        threading.Thread(target=_hilo_sync, args=(parar,), daemon=True, name="sync").start()
    yield
    parar.set()


app = FastAPI(title="Cartera API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def no_guardar_en_cache(request: Request, call_next):
    """Las respuestas traen DNI/CUIT: ni Cloudflare ni ningún intermediario las puede guardar."""
    respuesta = await call_next(request)
    respuesta.headers["Cache-Control"] = "no-store"
    respuesta.headers["X-Content-Type-Options"] = "nosniff"
    return respuesta


# ---------- consultas ----------

def _cursor_decode(cursor: str | None) -> tuple[str, list] | None:
    if not cursor:
        return None
    try:
        valor = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        return str(valor[0]), list(valor[1])
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Cursor inválido.") from exc


def _cursor_encode(actualizado_en: str, clave: list) -> str:
    return base64.urlsafe_b64encode(json.dumps([actualizado_en, clave]).encode()).decode()


def _fecha_hora(valor: str | None, campo: str) -> str | None:
    if not valor:
        return None
    try:
        dt = datetime.fromisoformat(valor)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{campo}: usar formato ISO (2026-11-20 o 2026-11-20T05:00:00-03:00).") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=AR)
    return dt.astimezone(AR).isoformat(timespec="seconds")


def _paginar(tabla: str, claves: list[str], filtros: list[tuple[str, Any]], cursor: str | None,
             limite: int) -> dict[str, Any]:
    where = [sql for sql, _ in filtros]
    params = [v for _, v in filtros]
    pos = _cursor_decode(cursor)
    orden = ["actualizado_en", *claves]
    if pos:
        # (actualizado_en, claves...) > (cursor) — comparación de tuplas en SQLite
        where.append(f"({', '.join(orden)}) > ({', '.join('?' for _ in orden)})")
        params += [pos[0], *pos[1]]
    sql = f"SELECT datos, eliminado, actualizado_en, {', '.join(claves)} FROM {tabla}"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += f" ORDER BY {', '.join(orden)} LIMIT ?"
    params.append(limite + 1)
    conn = connect(_db_path())
    try:
        filas = conn.execute(sql, params).fetchall()
    finally:
        conn.close()
    hay_mas = len(filas) > limite
    filas = filas[:limite]
    items = []
    for f in filas:
        d = json.loads(f["datos"])
        d["eliminado"] = bool(f["eliminado"])
        d["actualizado_en"] = f["actualizado_en"]
        items.append(d)
    siguiente = None
    if hay_mas and filas:
        u = filas[-1]
        siguiente = _cursor_encode(u["actualizado_en"], [u[c] for c in claves])
    return {"items": items, "siguiente": siguiente}


@app.get("/v1/prestamos")
def prestamos(
    _: str = Depends(autorizar),
    proveedor: str | None = None,
    modificados_desde: str | None = None,
    cursor: str | None = None,
    limite: int = Query(PAGINA_DEFECTO, ge=1, le=PAGINA_MAXIMA),
):
    filtros: list[tuple[str, Any]] = []
    if proveedor:
        filtros.append(("proveedor = ?", proveedor))
    if (desde := _fecha_hora(modificados_desde, "modificados_desde")):
        filtros.append(("actualizado_en >= ?", desde))
    return _paginar("prestamos", ["prestamo_id"], filtros, cursor, limite)


@app.get("/v1/cuotas")
def cuotas(
    _: str = Depends(autorizar),
    prestamo_id: int | None = None,
    modificados_desde: str | None = None,
    cursor: str | None = None,
    limite: int = Query(PAGINA_DEFECTO, ge=1, le=PAGINA_MAXIMA),
):
    filtros: list[tuple[str, Any]] = []
    if prestamo_id is not None:
        filtros.append(("prestamo_id = ?", prestamo_id))
    if (desde := _fecha_hora(modificados_desde, "modificados_desde")):
        filtros.append(("actualizado_en >= ?", desde))
    return _paginar("cuotas", ["prestamo_id", "nro_cuota"], filtros, cursor, limite)


@app.get("/v1/cobros")
def cobros(
    _: str = Depends(autorizar),
    prestamo_id: int | None = None,
    desde: str | None = Query(None, description="Fecha del cobro, desde (YYYY-MM-DD)"),
    hasta: str | None = Query(None, description="Fecha del cobro, hasta inclusive (YYYY-MM-DD)"),
    modificados_desde: str | None = None,
    cursor: str | None = None,
    limite: int = Query(PAGINA_DEFECTO, ge=1, le=PAGINA_MAXIMA),
):
    filtros: list[tuple[str, Any]] = []
    if prestamo_id is not None:
        filtros.append(("prestamo_id = ?", prestamo_id))
    if desde:
        filtros.append(("fecha >= ?", desde[:10]))
    if hasta:
        filtros.append(("fecha <= ?", hasta[:10]))
    if (mod := _fecha_hora(modificados_desde, "modificados_desde")):
        filtros.append(("actualizado_en >= ?", mod))
    return _paginar("cobros", ["cobro_id", "prestamo_id", "nro_cuota"], filtros, cursor, limite)


@app.get("/v1/estado")
def estado(_: str = Depends(autorizar)):
    return _estado()


@app.get("/health")
def health():
    """Sin token, para el monitoreo: solo dice si la última copia salió bien y cuándo."""
    e = _estado()
    return {"ok": e["ultima_sincronizacion_ok"] is not None, "ultima_sincronizacion_ok": e["ultima_sincronizacion_ok"]}


def _estado() -> dict[str, Any]:
    conn = connect(_db_path())
    try:
        ok = conn.execute(
            "SELECT fin, prestamos, cuotas, cobros FROM sincronizaciones WHERE estado = 'ok' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        ultima = conn.execute("SELECT inicio, estado FROM sincronizaciones ORDER BY id DESC LIMIT 1").fetchone()
    finally:
        conn.close()
    return {
        "ultima_sincronizacion_ok": ok["fin"] if ok else None,
        "filas": {"prestamos": ok["prestamos"], "cuotas": ok["cuotas"], "cobros": ok["cobros"]} if ok else None,
        "ultimo_intento": {"inicio": ultima["inicio"], "estado": ultima["estado"]} if ultima else None,
    }
