from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from bcra_deudores.process import CriticalProcessError, load_config, run


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Genera archivos BCRA Central de Deudores PNFC."
    )
    parser.add_argument(
        "--config",
        default="config.json",
        help="Ruta al archivo de configuración JSON. Default: config.json",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Nivel de log.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(message)s",
    )

    config_path = Path(args.config)
    if not config_path.exists():
        print(
            f"No existe {config_path}. Cree config.json a partir de config.example.json.",
            file=sys.stderr,
        )
        return 2

    try:
        config = load_config(config_path)
        run(config)
    except CriticalProcessError as exc:
        logging.error("%s", exc)
        return 1
    except Exception as exc:
        logging.exception("Fallo inesperado")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
