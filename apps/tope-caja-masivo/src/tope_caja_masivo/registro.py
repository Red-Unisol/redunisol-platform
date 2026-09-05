"""CSV de trabajo de una corrida: append fila por fila y lectura de lo ya hecho.

Es lo que hace reanudable una corrida de horas. Cada resultado se escribe y se
baja a disco apenas se obtiene, de modo que un corte pierde como mucho el CUIL
en curso.

Por que CSV y no el Excel final: un .xlsx se reescribe entero en cada fila y un
corte a mitad de escritura lo deja corrupto. El Excel se genera una sola vez al
terminar, desde este CSV.

El archivo es append-only y puede tener varias filas para el mismo CUIL: si una
corrida anterior fallo por un problema tecnico y despues se reintento, quedan
las dos. Vale la ultima.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterator, List

# Respuestas cerradas: no se vuelven a consultar al reanudar.
ESTADO_OK = "completed"
ESTADO_NO_ENCONTRADO = "not_found"
ESTADO_CUIL_INVALIDO = "invalid_cuil"
# Falla recuperable: al reanudar se reintenta.
ESTADO_ERROR = "technical_error"

DEFINITIVOS = frozenset({ESTADO_OK, ESTADO_NO_ENCONTRADO, ESTADO_CUIL_INVALIDO})

COLUMNAS = [
    "cuil",
    "estado",
    "nombre",
    "apellido",
    "disponible",
    "tope_descuento",
    "error",
    "consultado_at",
    "ms",
]


@dataclass
class Fila:
    cuil: str
    estado: str
    nombre: str = ""
    apellido: str = ""
    disponible: str = ""
    tope_descuento: str = ""
    error: str = ""
    consultado_at: str = ""
    ms: str = ""

    def __post_init__(self) -> None:
        if not self.consultado_at:
            self.consultado_at = datetime.now().isoformat(timespec="seconds")

    @property
    def es_definitiva(self) -> bool:
        return self.estado in DEFINITIVOS


class Registro:
    """Escribe el CSV de la corrida y sabe que se resolvio antes."""

    def __init__(self, ruta: Path) -> None:
        self.ruta = Path(ruta)
        self.ruta.parent.mkdir(parents=True, exist_ok=True)
        if not self.ruta.exists():
            self._escribir_encabezado()

    def _escribir_encabezado(self) -> None:
        with self.ruta.open("w", encoding="utf-8", newline="") as fh:
            csv.writer(fh).writerow(COLUMNAS)

    def agregar(self, fila: Fila) -> None:
        """Agrega una fila y la baja a disco antes de seguir.

        El flush explicito es el punto del diseno: sin el, un corte se llevaria
        lo que quedo en el buffer del sistema operativo.
        """
        with self.ruta.open("a", encoding="utf-8", newline="") as fh:
            escritor = csv.DictWriter(fh, fieldnames=COLUMNAS)
            escritor.writerow(asdict(fila))
            fh.flush()

    def leer(self) -> Iterator[Dict[str, str]]:
        if not self.ruta.exists():
            return iter(())
        with self.ruta.open("r", encoding="utf-8", newline="") as fh:
            yield from csv.DictReader(fh)

    def estados_por_cuil(self) -> Dict[str, str]:
        """Ultimo estado conocido de cada CUIL."""
        estados: Dict[str, str] = {}
        for fila in self.leer():
            cuil = (fila.get("cuil") or "").strip()
            if cuil:
                estados[cuil] = (fila.get("estado") or "").strip()
        return estados

    def resueltos(self) -> set[str]:
        """CUILs que no hace falta volver a consultar.

        Los `technical_error` quedan afuera a proposito: son fallas
        recuperables y merecen otro intento en la proxima corrida.
        """
        return {c for c, e in self.estados_por_cuil().items() if e in DEFINITIVOS}

    def ultimas_filas(self) -> Dict[str, Dict[str, str]]:
        """Ultima fila de cada CUIL, que es la que vale para el Excel final."""
        ultimas: Dict[str, Dict[str, str]] = {}
        for fila in self.leer():
            cuil = (fila.get("cuil") or "").strip()
            if cuil:
                ultimas[cuil] = fila
        return ultimas

    def resumen(self) -> Dict[str, int]:
        conteo: Dict[str, int] = {}
        for estado in self.estados_por_cuil().values():
            conteo[estado] = conteo.get(estado, 0) + 1
        return conteo


def formatear_importe(valor: float | None) -> str:
    if valor is None:
        return ""
    return f"{valor:.2f}"


def leer_importe(texto: str) -> float | None:
    texto = (texto or "").strip()
    if not texto:
        return None
    try:
        return float(texto)
    except ValueError:
        return None
