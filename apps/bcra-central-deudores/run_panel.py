from __future__ import annotations

import argparse
from pathlib import Path

from bcra_deudores.panel import run_server


def main() -> int:
    parser = argparse.ArgumentParser(description="Panel local BCRA PNFC")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--db", default="data/panel_control.db")
    parser.add_argument("--config", default="config.full.json")
    args = parser.parse_args()

    server = run_server(
        host=args.host,
        port=args.port,
        db_path=Path(args.db),
        base_config_path=Path(args.config),
        workspace=Path("."),
    )
    print(f"Panel disponible en http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nCerrando panel...")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
