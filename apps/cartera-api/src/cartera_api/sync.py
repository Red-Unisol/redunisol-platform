"""Copia diaria de la cartera desde Vimarx a la base local.

Lee préstamos, cuotas y cobros de los proveedores configurados, los transforma al
formato de la API y los guarda. Una fila solo cambia su `actualizado_en` cuando
cambia su contenido; las filas que dejan de venir de Vimarx quedan `eliminado`.
Todo se escribe en una sola transacción: si algo falla, la base queda como estaba.

Uso: python -m cartera_api.sync
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from .config import Settings, load_settings, participacion_para
from .db import connect
from .vimarx import VimarxClient, filtro_proveedores

log = logging.getLogger("cartera_api.sync")

AR = timezone(timedelta(hours=-3))  # Argentina no tiene horario de verano

T_PRESTAMO = "F.Module.Cuentas.Prestamos.Prestamo"
T_CUOTA = "F.Module.Cuentas.Prestamos.CuotaPrestamo"
T_MOVIMIENTO = "F.Module.Cuentas.Prestamos.MovimientoPrestamo"

CAMPOS_PRESTAMO = [
    "ID", "NroCuenta",
    "SocioTitular.Socio.NroSocio", "SocioTitular.Socio.NroDoc", "SocioTitular.Socio.CUIT",
    "Proveedor.Nombre", "LineaPrestamo.Codigo", "LineaPrestamo.Descripcion",
    "FechaEmision", "Capital", "MontoADesembolsar", "MontoPrestamo",
    "TNA", "TEM", "TEA", "Cuotas", "SaldoPrestamo", "Estado", "EstadoPrestamo",
]
CAMPOS_CUOTA = [
    "Prestamo.ID", "NroCuota", "Fecha", "Capital", "Interes", "Otros", "MontoTotal",
    "CapitalPago", "InteresPago", "TotalPago", "FechaCobro", "SaldoCuota",
]
CAMPOS_MOVIMIENTO = [
    "TransaccionAjuste.ID", "TransaccionPrestamo.Prestamo.ID", "TransaccionPrestamo.NroCuota",
    "Fecha", "Monto", "Tipo.Descripcion",
]

# Texto de Prestamo.Estado (Vimarx lo devuelve como número). Se completa a medida que se confirma
# contra la columna Estado de la pantalla de Vimarx.
ESTADOS_PRESTAMO = {
    3: "anulado",  # confirmado 20/11/2026: sin cuotas, saldo 0
}

MAX_PRESTAMOS = 50_000
MAX_CUOTAS_LOTE = 20_000
MAX_MOVIMIENTOS_LOTE = 50_000
# Si Vimarx devuelve menos de esta fracción de los préstamos que ya tenemos, no se aplica nada.
MINIMO_RELATIVO = 0.5


# ---------- transformación ----------

def _num(valor: Any, decimales: int | None = 2) -> float | None:
    if valor is None:
        return None
    x = float(valor)
    if decimales is not None:
        x = round(x, decimales)
    return x + 0.0  # evita -0.0


def _pos(valor: Any) -> float:
    """Vimarx guarda lo pagado en negativo; la API lo expone en positivo."""
    return _num(-(float(valor or 0))) or 0.0


def _fecha(valor: Any) -> str | None:
    if not valor:
        return None
    return str(valor)[:10]


def _texto(valor: Any) -> str | None:
    if valor is None:
        return None
    s = str(valor).strip()
    return s or None


def _entero(valor: Any) -> int | None:
    return None if valor is None else int(valor)


def transformar_prestamo(fila: dict[str, Any], reglas_participacion: dict[str, float]) -> dict[str, Any]:
    proveedor = _texto(fila["Proveedor.Nombre"])
    return {
        "prestamo_id": int(fila["ID"]),
        "nro_cuenta": _entero(fila["NroCuenta"]),
        "socio": {
            "nro_socio": _entero(fila["SocioTitular.Socio.NroSocio"]),
            "dni": _texto(fila["SocioTitular.Socio.NroDoc"]),
            "cuit": _texto(fila["SocioTitular.Socio.CUIT"]),
        },
        "proveedor": proveedor,
        "linea": {
            "codigo": _texto(fila["LineaPrestamo.Codigo"]),
            "descripcion": _texto(fila["LineaPrestamo.Descripcion"]),
        },
        "fecha_emision": _fecha(fila["FechaEmision"]),
        "capital_otorgado": _num(fila["Capital"]),
        "monto_desembolsado": _num(fila["MontoADesembolsar"]),
        "total_a_devolver": _num(fila["MontoPrestamo"]),
        "tna": _num(fila["TNA"], None),
        "tem": _num(fila["TEM"], None),
        "tea": _num(fila["TEA"], None),
        "cantidad_cuotas": _entero(fila["Cuotas"]),
        "saldo": _num(fila["SaldoPrestamo"]),
        "estado": _entero(fila["Estado"]),
        "estado_texto": ESTADOS_PRESTAMO.get(_entero(fila["Estado"])),
        "estado_prestamo": _entero(fila["EstadoPrestamo"]),
        "participacion_mutual": participacion_para(proveedor, reglas_participacion),
    }


def estado_cuota(saldo: float, pagado_total: float) -> str:
    if saldo <= 0.005:
        return "pagada"
    if pagado_total <= 0.005:
        return "impaga"
    return "pago_parcial"


def transformar_cuota(fila: dict[str, Any]) -> dict[str, Any]:
    saldo = _num(fila["SaldoCuota"]) or 0.0
    pagado_total = _pos(fila["TotalPago"])
    return {
        "prestamo_id": int(fila["Prestamo.ID"]),
        "nro_cuota": int(fila["NroCuota"]),
        "vencimiento": _fecha(fila["Fecha"]),
        "capital": _num(fila["Capital"]),
        "interes": _num(fila["Interes"]),
        "gastos": _num(fila["Otros"]),
        "total": _num(fila["MontoTotal"]),
        "pagado_capital": _pos(fila["CapitalPago"]),
        "pagado_interes": _pos(fila["InteresPago"]),
        "pagado_total": pagado_total,
        "fecha_pago": _fecha(fila["FechaCobro"]),
        "saldo": saldo,
        "estado": estado_cuota(saldo, pagado_total),
    }


def agrupar_cobros(movimientos: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Un cobro por (cobro de Vimarx, préstamo, cuota), con capital, interés y otros."""
    grupos: dict[tuple[int, int, int], dict[str, Any]] = defaultdict(
        lambda: {"capital": 0.0, "interes": 0.0, "otros": 0.0, "fecha": None}
    )
    for m in movimientos:
        clave = (int(m["TransaccionAjuste.ID"]), int(m["TransaccionPrestamo.Prestamo.ID"]),
                 int(m["TransaccionPrestamo.NroCuota"]))
        g = grupos[clave]
        tipo = (m["Tipo.Descripcion"] or "").strip().lower()
        concepto = "capital" if tipo == "capital" else "interes" if tipo == "interes" else "otros"
        g[concepto] += -float(m["Monto"] or 0)
        fecha = _fecha(m["Fecha"])
        if fecha and (g["fecha"] is None or fecha > g["fecha"]):
            g["fecha"] = fecha
    cobros = []
    for (cobro_id, prestamo_id, nro_cuota), g in grupos.items():
        capital, interes, otros = (_num(g["capital"]), _num(g["interes"]), _num(g["otros"]))
        cobros.append({
            "cobro_id": cobro_id,
            "fecha": g["fecha"],
            "prestamo_id": prestamo_id,
            "nro_cuota": nro_cuota,
            "capital": capital,
            "interes": interes,
            "otros": otros,
            "total": _num(capital + interes + otros),
        })
    return cobros


# ---------- lectura de Vimarx ----------

def leer_vimarx(cliente: VimarxClient, settings: Settings) -> tuple[list, list, list]:
    filtro = filtro_proveedores(settings.proveedores)
    filas = cliente.evaluate_list(T_PRESTAMO, filtro, CAMPOS_PRESTAMO, MAX_PRESTAMOS)
    prestamos = [transformar_prestamo(f, settings.participacion) for f in filas]
    log.info("préstamos: %d", len(prestamos))

    ids = sorted(p["prestamo_id"] for p in prestamos)
    cuotas: list[dict[str, Any]] = []
    movimientos: list[dict[str, Any]] = []
    for i in range(0, len(ids), settings.lote_prestamos):
        lote = ",".join(str(x) for x in ids[i:i + settings.lote_prestamos])
        cuotas += [transformar_cuota(f) for f in cliente.evaluate_list(
            # IsExactType deja afuera las filas de cobro ("PG <ID> <fecha>", subtipo CuotaPrestamoCobro),
            # que Vimarx numera a continuación de la última cuota.
            T_CUOTA, f"[Prestamo.ID] In ({lote}) AND [NroCuota] > 0 AND IsExactType(This, '{T_CUOTA}')",
            CAMPOS_CUOTA, MAX_CUOTAS_LOTE)]
        movimientos += cliente.evaluate_list(
            T_MOVIMIENTO,
            f"[TransaccionPrestamo.Prestamo.ID] In ({lote}) AND [Pago] = True"
            " AND [TransaccionAjuste] Is Not Null AND [TransaccionPrestamo.NroCuota] > 0",
            CAMPOS_MOVIMIENTO, MAX_MOVIMIENTOS_LOTE)
        log.info("lote %d/%d: %d cuotas, %d movimientos acumulados",
                 i // settings.lote_prestamos + 1, -(-len(ids) // settings.lote_prestamos),
                 len(cuotas), len(movimientos))
    cobros = agrupar_cobros(movimientos)
    log.info("cuotas: %d, cobros: %d", len(cuotas), len(cobros))
    return prestamos, cuotas, cobros


# ---------- escritura ----------

def _hash(datos: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(datos, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _aplicar(conn: sqlite3.Connection, tabla: str, claves: list[str], filas: list[dict[str, Any]],
             extras: list[str], ahora: str) -> int:
    """Upsert por hash y baja lógica de lo que no vino. Devuelve la cantidad de filas cambiadas."""
    where = " AND ".join(f"{c} = ?" for c in claves)
    existentes = {
        tuple(r[c] for c in claves): (r["hash"], r["eliminado"])
        for r in conn.execute(f"SELECT {', '.join(claves)}, hash, eliminado FROM {tabla}")
    }
    cambios = 0
    vistos = set()
    columnas = claves + extras + ["datos", "hash", "eliminado", "actualizado_en"]
    insert = (f"INSERT OR REPLACE INTO {tabla} ({', '.join(columnas)}) "
              f"VALUES ({', '.join('?' for _ in columnas)})")
    for datos in filas:
        clave = tuple(datos[c] for c in claves)
        vistos.add(clave)
        h = _hash(datos)
        if existentes.get(clave) == (h, 0):
            continue
        conn.execute(insert, [*clave, *(datos[e] for e in extras),
                              json.dumps(datos, ensure_ascii=False), h, 0, ahora])
        cambios += 1
    for clave, (_, eliminado) in existentes.items():
        if clave not in vistos and not eliminado:
            conn.execute(f"UPDATE {tabla} SET eliminado = 1, actualizado_en = ? WHERE {where}", [ahora, *clave])
            cambios += 1
    return cambios


def guardar(conn: sqlite3.Connection, prestamos: list, cuotas: list, cobros: list, ahora: str) -> int:
    with conn:
        cambios = _aplicar(conn, "prestamos", ["prestamo_id"], prestamos, ["proveedor"], ahora)
        cambios += _aplicar(conn, "cuotas", ["prestamo_id", "nro_cuota"], cuotas, [], ahora)
        cambios += _aplicar(conn, "cobros", ["cobro_id", "prestamo_id", "nro_cuota"], cobros, ["fecha"], ahora)
    return cambios


def sincronizar(settings: Settings, cliente: VimarxClient | None = None) -> dict[str, Any]:
    cliente = cliente or VimarxClient(settings.vimarx_base_url, settings.timeout_segundos)
    conn = connect(settings.db_path)
    inicio = datetime.now(AR).isoformat(timespec="seconds")
    run_id = conn.execute("INSERT INTO sincronizaciones (inicio, estado) VALUES (?, 'en_curso')", [inicio]).lastrowid
    conn.commit()
    try:
        prestamos, cuotas, cobros = leer_vimarx(cliente, settings)
        previos = conn.execute("SELECT COUNT(*) FROM prestamos WHERE eliminado = 0").fetchone()[0]
        if not prestamos or (previos and len(prestamos) < previos * MINIMO_RELATIVO):
            raise RuntimeError(f"Vimarx devolvió {len(prestamos)} préstamos y había {previos}: no se aplica")
        ahora = datetime.now(AR).isoformat(timespec="seconds")
        cambios = guardar(conn, prestamos, cuotas, cobros, ahora)
        resultado = {"estado": "ok", "prestamos": len(prestamos), "cuotas": len(cuotas),
                     "cobros": len(cobros), "cambios": cambios}
        conn.execute(
            "UPDATE sincronizaciones SET fin = ?, estado = 'ok', prestamos = ?, cuotas = ?, cobros = ?, cambios = ? "
            "WHERE id = ?", [ahora, len(prestamos), len(cuotas), len(cobros), cambios, run_id])
        conn.commit()
        return resultado
    except Exception as exc:
        conn.execute("UPDATE sincronizaciones SET fin = ?, estado = 'error', error = ? WHERE id = ?",
                     [datetime.now(AR).isoformat(timespec="seconds"), str(exc)[:1000], run_id])
        conn.commit()
        raise
    finally:
        conn.close()


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    resultado = sincronizar(load_settings())
    log.info("listo: %s", resultado)
    return 0


if __name__ == "__main__":
    sys.exit(main())
