"""Poll PostgreSQL and normalize captured submissions in separate transactions."""

import os
from datetime import datetime, timedelta, timezone
from random import uniform
from time import sleep

from .capture import canonical_json
from .contract import NORMALIZER_VERSION
from .normalize import normalize_document
from .repository import InterpretationConflict, append_interpretation, require_dedicated_connection

MAX_ATTEMPTS = 8


def finish(cursor, identity, *, status, attempts, now, error=None, next_at=None):
    cursor.execute(
        """
        UPDATE crm_intake.normalization_jobs
        SET status = %s, attempts = %s, available_at = %s, finished_at = %s, last_error = %s
        WHERE submission_id = %s AND normalizer_version = %s
        """,
        (status, attempts, next_at or now, None if next_at else now, error, *identity),
    )
    return {"submission_id": str(identity[0]), "status": status, "attempts": attempts}


def process_next(connection, *, now=None, interpreter=normalize_document):
    """Claim one due job. A crashed worker rolls back its claim automatically."""
    require_dedicated_connection(connection)
    now = now or datetime.now(timezone.utc)
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT j.submission_id, j.normalizer_version, j.attempts, s.channel, s.form_version,
                   s.original_payload, s.answers_path, s.form_revision_id
            FROM crm_intake.normalization_jobs AS j
            JOIN crm_intake.submissions AS s ON s.id = j.submission_id
            WHERE j.normalizer_version = %s AND j.status IN ('pending', 'retry') AND j.available_at <= %s
            ORDER BY j.available_at, j.submission_id
            LIMIT 1 FOR UPDATE OF j SKIP LOCKED
            """,
            (NORMALIZER_VERSION, now),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        submission_id, version, previous_attempts, channel, form_version, payload, path, form_revision = row
        identity = (submission_id, version)
        attempts = previous_attempts + 1
        if form_revision is None:
            return finish(cursor, identity, status="blocked", attempts=attempts, now=now, error="missing_form_revision")
        try:
            result = interpreter(channel, form_version, payload, path)
            if result["version"] != version or result["status"] not in {
                "interpreted", "unsupported_form_version", "unsupported_response_shape",
            }:
                raise ValueError("invalid interpretation contract")
            canonical_json(result)
        except Exception:
            retry_at = None
            if attempts < MAX_ATTEMPTS:
                retry_at = now + timedelta(seconds=uniform(0.5, 1.0) * min(300, 15 * 2 ** (attempts - 1)))
            return finish(
                cursor, identity, status="retry" if retry_at else "failed", attempts=attempts,
                now=now, error="normalizer_error", next_at=retry_at,
            )
        try:
            append_interpretation(connection, submission_id, result)
        except InterpretationConflict:
            return finish(
                cursor, identity, status="failed", attempts=attempts, now=now, error="interpretation_version_conflict",
            )
        blocked = result["status"] != "interpreted"
        return finish(
            cursor, identity, status="blocked" if blocked else "completed", attempts=attempts,
            now=now, error=result["status"] if blocked else None,
        )


def main():
    if os.environ.get("CRM_INTAKE_WORKER_ENABLED") != "1":
        return
    import psycopg

    dsn = os.environ.get("CRM_INTAKE_DATABASE_URL")
    if not dsn:
        raise SystemExit("normalization worker requires a database connection")
    try:
        with psycopg.connect(dsn, autocommit=True) as connection:
            while True:
                if process_next(connection) is None:
                    sleep(1)
    except psycopg.Error:
        raise SystemExit("normalization worker database error") from None


if __name__ == "__main__":
    main()
