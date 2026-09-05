"""Sesion contra CIDI + Caja de Jubilaciones y consulta de un CUIL.

Unico modulo que habla por red con los organismos. El resto del paquete no
sabe como se autentica ni como viaja el pedido.

Diferencia central con el flow `tope_descuento_caja` de Kestra, que atiende una
consulta por ejecucion y descarta la sesion: aca la sesion se abre una vez y se
reusa durante toda la tanda. Renovarla en cada CUIL duplicaria los pedidos, y
todos contra los endpoints de autenticacion.

La logica de autenticacion esta portada de ese flow, no importada. Es
duplicacion deliberada: el flow atiende consultas del panel en produccion y no
debe quedar atado a los cambios que necesite esta app.

Para probar una consulta suelta:

    python -m tope_caja_masivo.caja 20359661305
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List

import requests

from . import config

TIMEOUT_POR_DEFECTO = 30.0
# Renovacion proactiva de la sesion. Es mas barato reautenticar de mas que
# descubrir el vencimiento a mitad de una consulta.
EDAD_MAXIMA_SESION = 900.0

RUTA_LOGIN_CIDI = "/api/cidi/ciudadano/login/oauth/v1"
RUTA_LOGIN_CAJA = "/api/security/login"
RUTA_PERMISOS_CAJA = "/api/security/permissions"
RUTA_DATOS_PERSONA = "/api/utilidades/obtener-datos-persona"
RUTA_HABER_DISPONIBLE = "/api/transaccion/obtener-haber-disponible"

SCOPE_CIDI = (
    "cidi.api.login cidi.api.actividad.cuenta cidi.api.buscador "
    "cidi.api.buscador.ciudadano cidi.api.ciudadano "
    "cidi.api.ciudadano.alta cidi.api.ciudadano.misdatos "
    "cidi.api.ciudadano.relaciones cidi.api.comunicaciones "
    "cidi.api.documentacion offline_access cidi.api.credenciales "
    "cidi.api.chatbot"
)


class CuilInvalidoError(ValueError):
    """El CUIL no tiene 11 digitos."""


class SesionVencidaError(RuntimeError):
    """Caja rechazo la sesion. Hay que volver a autenticar."""


class PersonaNoEncontradaError(ValueError):
    """El CUIL no esta en el padron de Caja.

    Es un resultado de negocio definitivo: no se reintenta.
    """


class ErrorTecnicoError(RuntimeError):
    """Falla recuperable. Se puede reintentar mas tarde."""


class RitmoExcedidoError(ErrorTecnicoError):
    """Caja pidio explicitamente que bajemos el ritmo (HTTP 429).

    Se distingue del resto de los errores tecnicos porque no amerita reintentar:
    amerita frenar la corrida entera.
    """


@dataclass
class Medicion:
    etiqueta: str
    ms: float


@dataclass
class Resultado:
    cuil: str
    nombre: str = ""
    apellido: str = ""
    disponible: float = 0.0
    tope_descuento: float = 0.0
    mediciones: List[Medicion] = field(default_factory=list)

    @property
    def ms_total(self) -> float:
        return sum(m.ms for m in self.mediciones)


class SesionCaja:
    """Mantiene viva una sesion CIDI + Caja para muchas consultas seguidas."""

    def __init__(
        self,
        credenciales: config.Credenciales | None = None,
        timeout: float = TIMEOUT_POR_DEFECTO,
        edad_maxima: float = EDAD_MAXIMA_SESION,
    ) -> None:
        self.cred = credenciales or config.cargar()
        self.timeout = timeout
        self.edad_maxima = edad_maxima
        self._http = requests.Session()
        self._cookie_cidi = ""
        self._token_caja = ""
        self._abierta_en = 0.0
        self.aperturas = 0
        self.mediciones_login: List[Medicion] = []

    @property
    def abierta(self) -> bool:
        return bool(self._cookie_cidi and self._token_caja)

    @property
    def edad_segundos(self) -> float:
        return time.monotonic() - self._abierta_en if self.abierta else 0.0

    def abrir(self) -> None:
        self.mediciones_login = []
        hash_sesion = self._login_cidi()
        self._cookie_cidi = f"CiDi={hash_sesion}"
        semilla = self._token_semilla()
        self._token_caja = self._canjear_permisos(semilla)
        self._abierta_en = time.monotonic()
        self.aperturas += 1

    def asegurar_vigente(self) -> None:
        if not self.abierta or self.edad_segundos >= self.edad_maxima:
            self.abrir()

    def consultar(self, cuil: str) -> Resultado:
        """Consulta un CUIL. Reautentica y reintenta una vez si la sesion cayo."""
        self.asegurar_vigente()
        try:
            return self._consultar_una_vez(cuil)
        except SesionVencidaError:
            self.abrir()
            return self._consultar_una_vez(cuil)

    def _consultar_una_vez(self, cuil: str) -> Resultado:
        mediciones: List[Medicion] = []
        persona = self._post_cifrado(RUTA_DATOS_PERSONA, {"cuil": cuil}, "datos_persona", mediciones)
        cupo = self._post_cifrado(RUTA_HABER_DISPONIBLE, {"cuil": cuil}, "haber_disponible", mediciones)
        return Resultado(
            cuil=cuil,
            nombre=str(persona.get("nombre") or ""),
            apellido=str(persona.get("apellido") or ""),
            disponible=a_float(cupo.get("balance")),
            tope_descuento=a_float(cupo.get("discountLimit")),
            mediciones=mediciones,
        )

    # -- autenticacion ----------------------------------------------------

    def _login_cidi(self) -> str:
        datos = {
            "grant_type": "password",
            "client_id": self.cred.get("CIDI_CLIENT_ID", "cidi"),
            "client_secret": self.cred.get("CIDI_CLIENT_SECRET"),
            "username": self.cred["CIDI_USER"],
            "password": self.cred["CIDI_PASS"],
            "scope": SCOPE_CIDI,
        }
        url = unir(self.cred["CIDI_BASE_URL"], RUTA_LOGIN_CIDI)
        inicio = time.perf_counter()
        try:
            respuesta = self._http.post(
                url,
                data=datos,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise ErrorTecnicoError(f"Fallo de red en login CIDI: {exc}") from exc
        finally:
            self.mediciones_login.append(
                Medicion("login_cidi", (time.perf_counter() - inicio) * 1000)
            )

        if respuesta.status_code >= 400:
            raise ErrorTecnicoError(
                f"CIDI rechazo el login (HTTP {respuesta.status_code}): {recortar(respuesta.text)}"
            )

        cuerpo = respuesta.json()
        token = cuerpo.get("access_token", "")
        del_token = decodificar_jwt(token) if token else {}
        hash_sesion = (
            cuerpo.get("resultado", {}).get("datos", {}).get("hashSesion")
            or del_token.get("session_hash")
            or ""
        )
        if not hash_sesion:
            raise ErrorTecnicoError("CIDI no devolvio hashSesion")
        return hash_sesion

    def _token_semilla(self) -> str:
        base = self.cred["CAJA_BASE_URL"]
        origin, referer = origin_referer(base, "/login")
        inicio = time.perf_counter()
        try:
            respuesta = self._http.get(
                unir(base, RUTA_LOGIN_CAJA),
                headers={
                    "Accept": "application/json, text/plain, */*",
                    "Cookie": self._cookie_cidi,
                    "Origin": origin,
                    "Referer": referer,
                },
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise ErrorTecnicoError(f"Fallo de red en login de Caja: {exc}") from exc
        finally:
            self.mediciones_login.append(
                Medicion("token_semilla", (time.perf_counter() - inicio) * 1000)
            )

        if respuesta.status_code >= 400:
            raise ErrorTecnicoError(
                f"Caja rechazo el login (HTTP {respuesta.status_code}): {recortar(respuesta.text)}"
            )
        semilla = respuesta.headers.get("authorization", "")
        if not semilla:
            raise ErrorTecnicoError("Caja no devolvio el seed token en el header authorization")
        return semilla

    def _canjear_permisos(self, semilla: str) -> str:
        permisos = self._payload_permisos(semilla)
        if not permisos:
            raise ErrorTecnicoError("No se pudo construir el payload de permisos desde el seed token")

        base = self.cred["CAJA_BASE_URL"]
        origin, referer = origin_referer(base, "/")
        cuerpo = cifrar(permisos, self.cred["CAJA_ENCRYPT_PASS"])
        inicio = time.perf_counter()
        try:
            respuesta = self._http.post(
                unir(base, RUTA_PERMISOS_CAJA),
                headers={
                    "authorization": semilla,
                    "Cookie": self._cookie_cidi,
                    "Accept": "application/json, text/plain, */*",
                    "Origin": origin,
                    "Referer": referer,
                    "Content-Type": "application/json",
                },
                json={"body": cuerpo},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise ErrorTecnicoError(f"Fallo de red al canjear permisos: {exc}") from exc
        finally:
            self.mediciones_login.append(
                Medicion("token_caja", (time.perf_counter() - inicio) * 1000)
            )

        token = respuesta.headers.get("authorization", "")
        if not token:
            raise ErrorTecnicoError(
                f"Caja no devolvio token de sesion (HTTP {respuesta.status_code})"
            )
        return token

    def _payload_permisos(self, semilla: str) -> Dict[str, Any] | str:
        datos = decodificar_jwt(semilla)
        usuario = datos.get("usuario") if isinstance(datos, dict) else None
        if not usuario or "id" not in usuario:
            return ""

        preferido = self.cred.get("CAJA_ID_TIPO_USUARIO", "")
        id_tipo = usuario.get("idTipoUsuario")
        if preferido.isdigit():
            id_tipo = int(preferido)
        elif id_tipo == 0:
            for item in datos.get("tipoUsuario", []):
                if isinstance(item, dict) and item.get("id") == 4:
                    id_tipo = 4
                    break

        if id_tipo is None:
            return ""
        return {"idUsuario": usuario["id"], "idTipoUsuario": id_tipo}

    # -- transporte -------------------------------------------------------

    def _post_cifrado(
        self,
        ruta: str,
        payload: Dict[str, Any],
        etiqueta: str,
        mediciones: List[Medicion],
    ) -> Dict[str, Any]:
        base = self.cred["CAJA_BASE_URL"]
        origin, referer = origin_referer(base, "/")
        cuerpo = cifrar(payload, self.cred["CAJA_ENCRYPT_PASS"])
        if not cuerpo:
            raise ErrorTecnicoError(f"No se pudo cifrar el body para {ruta}")

        inicio = time.perf_counter()
        try:
            respuesta = self._http.post(
                unir(base, ruta),
                headers={
                    "Accept": "application/json, text/plain, */*",
                    "Content-Type": "application/json",
                    "Cookie": self._cookie_cidi,
                    "authorization": self._token_caja,
                    "Origin": origin,
                    "Referer": referer,
                },
                json={"body": cuerpo},
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise ErrorTecnicoError(f"Fallo de red en {ruta}: {exc}") from exc
        finally:
            mediciones.append(Medicion(etiqueta, (time.perf_counter() - inicio) * 1000))

        texto = decodificar(respuesta)

        if respuesta.status_code in (401, 403):
            raise SesionVencidaError(f"Caja rechazo la sesion en {ruta} (HTTP {respuesta.status_code})")
        if respuesta.status_code == 429:
            raise RitmoExcedidoError(f"Caja respondio 429 en {ruta}. Hay que bajar el ritmo.")
        if respuesta.status_code >= 400:
            if es_persona_no_encontrada(texto):
                raise PersonaNoEncontradaError(recortar(texto))
            raise ErrorTecnicoError(f"HTTP {respuesta.status_code} en {ruta}: {recortar(texto)}")

        try:
            return json.loads(texto)
        except ValueError as exc:
            raise ErrorTecnicoError(f"Respuesta no JSON en {ruta}: {recortar(texto)}") from exc


def es_persona_no_encontrada(mensaje: str) -> bool:
    normalizado = " ".join(str(mensaje or "").strip().lower().split())
    return "no se encontr" in normalizado and "la persona" in normalizado


def decodificar(respuesta: requests.Response) -> str:
    """Decodifica el cuerpo probando encodings, no confiando en el default.

    Caja no siempre declara charset. Cuando no lo hace, requests asume
    ISO-8859-1 para las respuestas de texto y las vocales acentuadas terminan
    rotas: se ve "No se encontr? la persona" en lugar de "encontró", y los
    nombres del padron llegarian como PEREZ con la E partida.

    Mismo criterio que usa `consulta_cuad` con el sitio de Santa Fe.
    """
    crudo = respuesta.content
    declarado = (respuesta.headers.get("content-type") or "").lower()

    if "charset=" in declarado:
        charset = declarado.split("charset=", 1)[1].split(";", 1)[0].strip()
        try:
            return crudo.decode(charset, errors="replace")
        except LookupError:
            pass

    for encoding in ("utf-8", "cp1252", "latin-1"):
        try:
            return crudo.decode(encoding)
        except UnicodeDecodeError:
            continue

    return crudo.decode("latin-1", errors="replace")


# -- criptografia (compatible con el "Salted__" de OpenSSL) ----------------


def cifrar(payload: Any, passphrase: str) -> str:
    if not payload or not passphrase:
        return ""
    from Crypto.Cipher import AES

    salt = os.urandom(8)
    clave, iv = derivar_clave_iv(passphrase.encode("utf-8"), salt, 32, 16)
    cipher = AES.new(clave, AES.MODE_CBC, iv)
    crudo = payload if isinstance(payload, str) else json.dumps(payload)
    return base64.b64encode(b"Salted__" + salt + cipher.encrypt(pkcs7(crudo.encode("utf-8")))).decode("utf-8")


def derivar_clave_iv(passphrase: bytes, salt: bytes, largo_clave: int, largo_iv: int):
    material = b""
    previo = b""
    while len(material) < largo_clave + largo_iv:
        previo = hashlib.md5(previo + passphrase + salt).digest()
        material += previo
    return material[:largo_clave], material[largo_clave : largo_clave + largo_iv]


def pkcs7(datos: bytes, bloque: int = 16) -> bytes:
    relleno = bloque - (len(datos) % bloque)
    return datos + bytes([relleno] * relleno)


def decodificar_jwt(token: str) -> Dict[str, Any]:
    try:
        carga = token.split(".")[1]
        if not carga:
            return {}
        relleno = carga + "=" * (-len(carga) % 4)
        return json.loads(base64.urlsafe_b64decode(relleno.encode("utf-8")).decode("utf-8"))
    except Exception:
        return {}


# -- utilidades ------------------------------------------------------------


def normalizar_cuil(valor: Any) -> str:
    """Deja solo los digitos y valida que sean 11."""
    digitos = re.sub(r"\D+", "", str(valor or ""))
    if len(digitos) != 11:
        raise CuilInvalidoError(
            f"Se esperaban 11 digitos y llegaron {len(digitos)}: {valor!r}"
        )
    return digitos


def formatear_cuil(digitos: str, formato: str) -> str:
    """Devuelve el CUIL en el formato que se le va a mandar a Caja.

    El flow de a uno manda el string tal como se lo dan, sin normalizar, asi que
    el repo no permite deducir cual de los dos formatos espera la API. Queda
    configurable para poder determinarlo empiricamente.
    """
    if formato == "guiones":
        return f"{digitos[:2]}-{digitos[2:10]}-{digitos[10]}"
    return digitos


def a_float(valor: Any) -> float:
    try:
        return float(valor)
    except Exception:
        return 0.0


def unir(base_url: str, ruta: str) -> str:
    return f"{base_url.rstrip('/')}{ruta}"


def origin_referer(base_url: str, ruta: str) -> tuple[str, str]:
    origin = base_url.rstrip("/")
    return origin, unir(origin, ruta)


def recortar(texto: str, largo: int = 300) -> str:
    return " ".join(str(texto or "").split())[:largo]


# -- prueba manual ---------------------------------------------------------


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Consulta el tope de descuento de un CUIL y mide cuanto tarda."
    )
    parser.add_argument("cuil", help="CUIL de 11 digitos, con o sin guiones.")
    parser.add_argument(
        "--formato",
        choices=["digitos", "guiones"],
        default="digitos",
        help="Como mandarle el CUIL a Caja. Sirve para determinar cual acepta.",
    )
    args = parser.parse_args(argv)

    try:
        digitos = normalizar_cuil(args.cuil)
    except CuilInvalidoError as exc:
        print(f"CUIL invalido: {exc}", file=sys.stderr)
        return 2

    try:
        cred = config.cargar()
    except config.ConfigError as exc:
        print(f"No se pudieron cargar las credenciales: {exc}", file=sys.stderr)
        return 2

    print(f"credenciales: {cred.resumen_origenes()}")
    print(f"cuil: {formatear_cuil(digitos, args.formato)} (formato {args.formato})")
    print()

    sesion = SesionCaja(cred)
    try:
        sesion.abrir()
    except ErrorTecnicoError as exc:
        print(f"FALLO al abrir la sesion: {exc}", file=sys.stderr)
        _imprimir_mediciones("login", sesion.mediciones_login)
        return 1

    print("sesion abierta")
    _imprimir_mediciones("login", sesion.mediciones_login)
    print()

    try:
        resultado = sesion.consultar(formatear_cuil(digitos, args.formato))
    except PersonaNoEncontradaError as exc:
        print(f"NO ENCONTRADO: {exc}")
        return 0
    except (ErrorTecnicoError, SesionVencidaError) as exc:
        print(f"FALLO la consulta: {exc}", file=sys.stderr)
        return 1

    print("resultado")
    print(f"  nombre         {resultado.nombre} {resultado.apellido}".rstrip())
    print(f"  disponible     {resultado.disponible:,.2f}")
    print(f"  tope descuento {resultado.tope_descuento:,.2f}")
    print()
    _imprimir_mediciones("consulta", resultado.mediciones)
    print()
    print(f"la consulta de un CUIL tarda {resultado.ms_total:,.0f} ms")
    return 0


def _imprimir_mediciones(titulo: str, mediciones: List[Medicion]) -> None:
    if not mediciones:
        return
    total = sum(m.ms for m in mediciones)
    print(f"  tiempos de {titulo}:")
    for medicion in mediciones:
        print(f"    {medicion.etiqueta:<18} {medicion.ms:>8,.0f} ms")
    print(f"    {'total':<18} {total:>8,.0f} ms")


if __name__ == "__main__":
    raise SystemExit(main())
