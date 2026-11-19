"""Append original submissions and separate interpretations in PostgreSQL."""

from uuid import uuid4

from .capture import capture, canonical_json
from .normalize import normalize


class SourceConflict(ValueError):
    """The same external source identity was used for different submissions."""


class InterpretationConflict(ValueError):
    """The same normalizer version returned a different result."""


def append_interpretation(connection, submission_id, result):
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO crm_intake.interpretations (submission_id, normalizer_version, result)
            VALUES (%s, %s, %s::jsonb)
            ON CONFLICT (submission_id, normalizer_version) DO NOTHING
            RETURNING submission_id
            """,
            (submission_id, result["version"], canonical_json(result)),
        )
        if cursor.fetchone() is None:
            cursor.execute(
                """
                SELECT result FROM crm_intake.interpretations
                WHERE submission_id = %s AND normalizer_version = %s
                """,
                (submission_id, result["version"]),
            )
            if cursor.fetchone()[0] != result:
                raise InterpretationConflict("raise the normalizer version before changing a result")


def ingest(connection, envelope, *, now=None):
    submission = capture(envelope, now=now)
    result = normalize(submission)
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO crm_intake.submissions
                (id, channel, source_scope, source_id, form_version, declared_at,
                 received_at, original_payload, fingerprint)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
            ON CONFLICT (channel, source_scope, source_id) DO NOTHING
            RETURNING id
            """,
            (
                uuid4(), submission.channel, submission.source_scope, submission.source_id,
                submission.form_version, submission.declared_at, submission.received_at,
                submission.payload_json, submission.fingerprint,
            ),
        )
        inserted = cursor.fetchone()
        if inserted is None:
            cursor.execute(
                """
                SELECT id, fingerprint FROM crm_intake.submissions
                WHERE channel = %s AND source_scope = %s AND source_id = %s
                """,
                (submission.channel, submission.source_scope, submission.source_id),
            )
            submission_id, fingerprint = cursor.fetchone()
            if fingerprint != submission.fingerprint:
                raise SourceConflict("external source identity conflicts with a previous submission")
        else:
            submission_id = inserted[0]
        append_interpretation(connection, submission_id, result)
    return {
        "submission_id": str(submission_id),
        "duplicate": inserted is None,
        "normalizer_version": result["version"],
        "interpretation_status": result["status"],
    }
