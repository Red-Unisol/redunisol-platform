from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

from .caja_client import (
    CajaPersonNotFoundError,
    CajaRateLimitedError,
    CajaSession,
    CajaTechnicalError,
)
from .checkpoint import Checkpoint, ResultRow, now_iso
from .sources import Candidate, is_valid_cuil

INVALID_CUIL_ERROR = "CUIL con digito verificador invalido."


@dataclass(frozen=True)
class RunSummary:
    total_candidates: int
    target_candidates: int
    already_resolved: int
    queried: int
    completed: int
    not_found: int
    invalid_cuils: int
    technical_errors: int
    pending: int
    limited: bool
    stop_reason: str
    session_opens: int

    @property
    def complete(self) -> bool:
        return not self.limited and self.pending == 0 and not self.stop_reason


def run_candidates(
    candidates: list[Candidate],
    checkpoint: Checkpoint,
    *,
    caja: CajaSession,
    now: Callable[[], datetime],
    sleep: Callable[[float], None] = time.sleep,
    pause_seconds: float = 3,
    limit: int | None = None,
    max_consecutive_errors: int = 8,
    retry_delays: tuple[float, ...] = (5, 15),
) -> RunSummary:
    latest = checkpoint.latest()
    already_resolved = sum(
        latest.get(candidate.cuil, _pending(candidate.cuil)).resolved
        for candidate in candidates
    )
    invalid_cuils = 0
    for candidate in candidates:
        if is_valid_cuil(candidate.cuil):
            continue
        invalid_cuils += 1
        current = latest.get(candidate.cuil)
        if current is not None and current.status == "invalid_cuil":
            continue
        row = ResultRow(
            cuil=candidate.cuil,
            status="invalid_cuil",
            checked_at=now_iso(now()),
            error=INVALID_CUIL_ERROR,
        )
        checkpoint.append(row)
        latest[row.cuil] = row

    unresolved = [
        candidate for candidate in candidates if not latest.get(candidate.cuil, _pending(candidate.cuil)).resolved
    ]
    target = unresolved[:limit] if limit is not None else unresolved
    queried = completed = not_found = technical_errors = 0
    consecutive_errors = 0
    stop_reason = ""

    for index, candidate in enumerate(target, start=1):
        if queried:
            sleep(pause_seconds)
        row: ResultRow | None = None
        for attempt in range(len(retry_delays) + 1):
            try:
                result = caja.query(candidate.cuil)
                row = ResultRow(
                    cuil=candidate.cuil,
                    status="completed",
                    checked_at=now_iso(now()),
                    nombre=result.nombre,
                    apellido=result.apellido,
                    disponible=result.disponible,
                    tope_descuento=result.tope_descuento,
                )
                break
            except CajaPersonNotFoundError as exc:
                row = ResultRow(
                    cuil=candidate.cuil,
                    status="not_found",
                    checked_at=now_iso(now()),
                    error=str(exc),
                )
                break
            except CajaRateLimitedError as exc:
                stop_reason = str(exc)
                row = ResultRow(
                    cuil=candidate.cuil,
                    status="technical_error",
                    checked_at=now_iso(now()),
                    error=stop_reason,
                )
                break
            except CajaTechnicalError as exc:
                if attempt < len(retry_delays):
                    sleep(retry_delays[attempt])
                    continue
                row = ResultRow(
                    cuil=candidate.cuil,
                    status="technical_error",
                    checked_at=now_iso(now()),
                    error=str(exc),
                )

        if row is None:  # pragma: no cover - defensive
            raise RuntimeError("La consulta Caja no produjo un resultado.")
        checkpoint.append(row)
        latest[row.cuil] = row
        queried += 1
        if row.status == "completed":
            completed += 1
            consecutive_errors = 0
        elif row.status == "not_found":
            not_found += 1
            consecutive_errors = 0
        else:
            technical_errors += 1
            consecutive_errors += 1

        if index % 25 == 0:
            print(
                json.dumps(
                    {
                        "event": "caja_monthly_progress",
                        "processed": index,
                        "target": len(target),
                        "completed": completed,
                        "not_found": not_found,
                        "technical_errors": technical_errors,
                    },
                    ensure_ascii=True,
                )
            )
        if stop_reason:
            break
        if consecutive_errors >= max_consecutive_errors:
            stop_reason = f"{consecutive_errors} errores tecnicos consecutivos."
            break
    final_rows = checkpoint.latest()
    pending = sum(
        not final_rows.get(candidate.cuil, _pending(candidate.cuil)).resolved
        for candidate in candidates
    )
    limited = limit is not None
    return RunSummary(
        total_candidates=len(candidates),
        target_candidates=len(target),
        already_resolved=already_resolved,
        queried=queried,
        completed=completed,
        not_found=not_found,
        invalid_cuils=invalid_cuils,
        technical_errors=technical_errors,
        pending=pending,
        limited=limited,
        stop_reason=stop_reason,
        session_opens=caja.open_count,
    )


def _pending(cuil: str) -> ResultRow:
    return ResultRow(cuil=cuil, status="pending", checked_at="")
