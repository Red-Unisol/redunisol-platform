"""De donde salen las credenciales de CIDI y Caja.

Esta app no tiene credenciales propias. Lee las mismas que usa el flow
`tope_descuento_caja` de Kestra, cuya fuente de verdad es el env cifrado del
repo. Si manana cambia la clave de CIDI, se cambia ahi y esta app se entera
sola: no hay una segunda copia que mantener sincronizada.

Orden de resolucion, de mayor a menor prioridad:

1. variable de entorno ya definida, para pisar un valor puntual en una prueba
2. `kestra/platform/infra/kestra-runtime.env`, el descifrado que ya vive en el repo
3. `kestra-runtime.env.enc` mas `.local-secrets/runtime-env.key`, descifrando en
   memoria, sin dejar texto plano en disco

El punto 3 es el que hace que funcione en una maquina donde nadie descifro el
archivo antes: le alcanza con el `.enc` versionado y la llave.

El descifrado se delega en `kestra/tools/manage_encrypted_env.py`. Reimplementar
aca el formato criptografico solo abriria la puerta a que las dos copias se
separen con el tiempo.
"""
from __future__ import annotations

import importlib.util
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict

# Nombre que usa esta app -> nombre en el env de Kestra.
# Los prefijos ENV_ y SECRET_ son convencion de la infraestructura de Kestra.
CLAVES: Dict[str, str] = {
    "CIDI_BASE_URL": "ENV_CIDI_BASE_URL",
    "CIDI_CLIENT_ID": "ENV_CIDI_CLIENT_ID",
    "CIDI_CLIENT_SECRET": "SECRET_CIDI_CLIENT_SECRET",
    "CIDI_USER": "SECRET_CIDI_USER",
    "CIDI_PASS": "SECRET_CIDI_PASS",
    "CAJA_BASE_URL": "ENV_CAJA_BASE_URL",
    "CAJA_ENCRYPT_PASS": "SECRET_CAJA_ENCRYPT_PASS",
    "CAJA_ID_TIPO_USUARIO": "ENV_CAJA_ID_TIPO_USUARIO",
}

# Estas pueden faltar sin que sea un problema.
OPCIONALES = frozenset({"CAJA_ID_TIPO_USUARIO", "CIDI_CLIENT_ID"})

RUTA_ENV_DESCIFRADO = Path("kestra/platform/infra/kestra-runtime.env")
RUTA_ENV_CIFRADO = Path("kestra/platform/infra/kestra-runtime.env.enc")
RUTA_LLAVE = Path(".local-secrets/runtime-env.key")
RUTA_TOOL = Path("kestra/tools/manage_encrypted_env.py")


class ConfigError(RuntimeError):
    """No se pudieron resolver las credenciales."""


@dataclass(frozen=True)
class Credenciales:
    valores: Dict[str, str]
    # De donde salio cada clave. Nunca contiene valores: sirve para loguear
    # el origen de la configuracion sin filtrar secretos.
    origenes: Dict[str, str] = field(default_factory=dict)

    def __getitem__(self, clave: str) -> str:
        return self.valores[clave]

    def get(self, clave: str, por_defecto: str = "") -> str:
        return self.valores.get(clave, por_defecto)

    def resumen_origenes(self) -> str:
        return ", ".join(f"{c}={o}" for c, o in sorted(self.origenes.items()))


def raiz_repo(desde: Path | None = None) -> Path:
    """Sube directorios hasta encontrar la raiz de la monorepo."""
    actual = (desde or Path(__file__)).resolve()
    for candidato in [actual, *actual.parents]:
        if (candidato / RUTA_TOOL).is_file():
            return candidato
    raise ConfigError(
        "No se encontro la raiz de la monorepo. Se esperaba hallar "
        f"{RUTA_TOOL} en algun directorio padre de {actual}."
    )


def cargar(raiz: Path | None = None) -> Credenciales:
    """Resuelve las credenciales siguiendo el orden de prioridad documentado."""
    base = raiz or raiz_repo()

    valores: Dict[str, str] = {}
    origenes: Dict[str, str] = {}

    def incorporar(fuente: Dict[str, str], etiqueta: str) -> None:
        for logico, valor in fuente.items():
            if logico not in valores and valor:
                valores[logico] = valor
                origenes[logico] = etiqueta

    incorporar(_desde_entorno(), "entorno")

    if not _completo(valores):
        incorporar(_desde_env_descifrado(base), "kestra-runtime.env")

    if not _completo(valores):
        incorporar(_desde_env_cifrado(base), "kestra-runtime.env.enc")

    faltantes = [c for c in CLAVES if c not in OPCIONALES and not valores.get(c)]
    if faltantes:
        raise ConfigError(
            "Faltan credenciales: "
            + ", ".join(faltantes)
            + ". Se buscaron en el entorno, en "
            + str(base / RUTA_ENV_DESCIFRADO)
            + " y en "
            + str(base / RUTA_ENV_CIFRADO)
            + " (con la llave "
            + str(base / RUTA_LLAVE)
            + ")."
        )

    return Credenciales(valores=valores, origenes=origenes)


def _completo(valores: Dict[str, str]) -> bool:
    return all(valores.get(c) for c in CLAVES if c not in OPCIONALES)


def _desde_entorno() -> Dict[str, str]:
    encontrados = {}
    for logico in CLAVES:
        valor = os.getenv(logico, "").strip()
        if valor:
            encontrados[logico] = valor
    return encontrados


def _desde_env_descifrado(raiz: Path) -> Dict[str, str]:
    ruta = raiz / RUTA_ENV_DESCIFRADO
    if not ruta.is_file():
        return {}
    return _mapear(_parsear_env(ruta.read_text(encoding="utf-8", errors="replace")))


def _desde_env_cifrado(raiz: Path) -> Dict[str, str]:
    ruta_enc = raiz / RUTA_ENV_CIFRADO
    ruta_llave = raiz / RUTA_LLAVE
    if not ruta_enc.is_file() or not ruta_llave.is_file():
        return {}

    tool = _cargar_tool(raiz)
    contenido = ruta_enc.read_bytes()
    try:
        if tool.is_line_encrypted_env(contenido):
            plano = tool.decrypt_env_lines(tool.load_aessiv(ruta_llave), contenido)
        else:
            plano = tool.decrypt_legacy_blob(tool.load_fernet(ruta_llave), contenido)
    except Exception as exc:
        raise ConfigError(
            f"No se pudo descifrar {ruta_enc} con la llave {ruta_llave}: {exc}"
        ) from exc

    return _mapear(_parsear_env(plano.decode("utf-8", errors="replace")))


def _cargar_tool(raiz: Path):
    """Importa `manage_encrypted_env.py` desde su ubicacion en el repo."""
    ruta = raiz / RUTA_TOOL
    spec = importlib.util.spec_from_file_location("manage_encrypted_env", ruta)
    if spec is None or spec.loader is None:
        raise ConfigError(f"No se pudo cargar {ruta}")
    modulo = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(modulo)
    except ImportError as exc:
        raise ConfigError(
            f"Falta una dependencia para descifrar {ruta}: {exc}. "
            "Instalar `cryptography` o descifrar el env con el tooling del repo."
        ) from exc
    return modulo


def _parsear_env(texto: str) -> Dict[str, str]:
    """Parsea KEY=VALUE, ignorando comentarios y lineas vacias."""
    pares: Dict[str, str] = {}
    for linea in texto.splitlines():
        limpia = linea.strip()
        if not limpia or limpia.startswith("#") or "=" not in limpia:
            continue
        clave, _, valor = limpia.partition("=")
        clave = clave.strip()
        valor = valor.strip()
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "\"'":
            valor = valor[1:-1]
        if clave:
            pares[clave] = valor
    return pares


def _mapear(pares: Dict[str, str]) -> Dict[str, str]:
    """Traduce los nombres de Kestra a los que usa esta app."""
    return {
        logico: pares[en_kestra]
        for logico, en_kestra in CLAVES.items()
        if pares.get(en_kestra)
    }
