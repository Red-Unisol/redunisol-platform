from __future__ import annotations

from datetime import datetime, timezone
import sys


class Logger:
    def info(self, message: str) -> None:
        _write("INFO", message)

    def error(self, message: str) -> None:
        _write("ERROR", message)


def create_logger() -> Logger:
    return Logger()


def _write(level: str, message: str) -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    stream = sys.stderr if level == "ERROR" else sys.stdout
    print(f"[{timestamp}] {level} {message}", file=stream, flush=True)
