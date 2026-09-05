"""Punto de entrada: `python -m tope_caja_masivo`.

Traduce lo que se tipea en la terminal a una llamada al runner. Sin logica de
negocio propia.

    python -m tope_caja_masivo planilla.xlsx
    python -m tope_caja_masivo planilla.xlsx --limite 10
    python -m tope_caja_masivo planilla.xlsx --corrida corridas/2026-09-01

Volver a lanzar el mismo comando sobre la misma corrida retoma donde quedo: los
CUILs ya resueltos se saltean y los que fallaron por un problema tecnico se
reintentan.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import config, planilla, runner


def construir_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tope_caja_masivo",
        description="Consulta el tope de descuento en Caja para una lista de CUILs.",
    )
    parser.add_argument("entrada", type=Path, help="Excel con los CUILs a consultar.")
    parser.add_argument(
        "--corrida",
        type=Path,
        default=None,
        help="Directorio de la corrida. Por defecto corridas/<fecha de hoy>.",
    )
    parser.add_argument(
        "--pausa",
        type=float,
        default=runner.PAUSA_POR_DEFECTO,
        help=f"Segundos de espera entre consultas (por defecto {runner.PAUSA_POR_DEFECTO}).",
    )
    parser.add_argument(
        "--limite",
        type=int,
        default=None,
        help="Consultar como mucho N CUILs. Util para probar antes de la corrida real.",
    )
    parser.add_argument(
        "--max-fallos",
        type=int,
        default=runner.MAX_FALLOS_CONSECUTIVOS,
        help="Fallos tecnicos seguidos tolerados antes de frenar "
             f"(por defecto {runner.MAX_FALLOS_CONSECUTIVOS}).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = construir_parser().parse_args(argv)

    raiz_app = Path(__file__).resolve().parents[2]
    directorio = args.corrida or runner.directorio_por_defecto(raiz_app)

    if args.pausa < 0:
        print("La pausa no puede ser negativa.", file=sys.stderr)
        return 2

    opciones = runner.Opciones(
        entrada=args.entrada,
        directorio=directorio,
        pausa=args.pausa,
        limite=args.limite,
        max_fallos_consecutivos=args.max_fallos,
    )

    try:
        resumen = runner.correr(opciones)
    except planilla.PlanillaError as exc:
        print(f"No se pudo leer la planilla: {exc}", file=sys.stderr)
        return 2
    except config.ConfigError as exc:
        print(f"No se pudieron cargar las credenciales: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\nInterrumpida. Lo consultado quedo guardado.", file=sys.stderr)
        return 1

    return 0 if resumen.completa else 1


if __name__ == "__main__":
    raise SystemExit(main())
