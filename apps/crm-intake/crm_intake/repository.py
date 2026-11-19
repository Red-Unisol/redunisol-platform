"""Record append-only evidence and schedule independent interpretation in PostgreSQL."""

from datetime import datetime, timezone
from uuid import uuid4

from .capture import capture, canonical_json, identifier
from .contract import NORMALIZER_VERSION


class SourceConflict(ValueError):
    """The same source identity was used for different evidence."""


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


def enqueue(connection, submission_id, normalizer_version=NORMALIZER_VERSION, *, now=None):
    """Schedule another interpretation without mutating previous jobs or results."""
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO crm_intake.normalization_jobs (submission_id, normalizer_version, available_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (submission_id, normalizer_version) DO NOTHING
            """,
            (submission_id, identifier(normalizer_version), now or datetime.now(timezone.utc)),
        )
        return cursor.rowcount == 1


def archive_form(cursor, submission):
    form = submission.form
    identity = (submission.channel, submission.source_scope, form.provider_form_id, form.provider_revision)
    cursor.execute(
        """
        INSERT INTO crm_intake.form_revisions
            (id, channel, source_scope, provider_form_id, provider_revision, definition, fingerprint)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s)
        ON CONFLICT (channel, source_scope, provider_form_id, provider_revision) DO NOTHING
        RETURNING id
        """,
        (uuid4(), *identity, form.definition_json, form.fingerprint),
    )
    inserted = cursor.fetchone()
    if inserted is not None:
        return inserted[0]
    cursor.execute(
        """
        SELECT id, fingerprint FROM crm_intake.form_revisions
        WHERE channel = %s AND source_scope = %s AND provider_form_id = %s AND provider_revision = %s
        """,
        identity,
    )
    revision_id, fingerprint = cursor.fetchone()
    if fingerprint != form.fingerprint:
        raise SourceConflict("the published form revision conflicts with its archive")
    return revision_id


def require_dedicated_connection(connection):
    if not connection.autocommit or connection.info.transaction_status.name != "IDLE":
        raise ValueError("CRM intake requires an idle autocommit connection")


def ingest(connection, envelope, *, now=None):
    """Commit the original plus its queue entry, without running an interpreter."""
    # A savepoint inside a caller's transaction would acknowledge before durability.
    require_dedicated_connection(connection)
    submission = capture(envelope, now=now)
    with connection.transaction(), connection.cursor() as cursor:
        form_revision_id = archive_form(cursor, submission)
        cursor.execute(
            """
            INSERT INTO crm_intake.submissions
                (id, channel, source_scope, source_id, form_version, declared_at, received_at,
                 original_payload, original_body, source_metadata, answers_path, form_revision_id, fingerprint)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s::jsonb, %s, %s)
            ON CONFLICT (channel, source_scope, source_id) DO NOTHING
            RETURNING id
            """,
            (
                uuid4(), submission.channel, submission.source_scope, submission.source_id,
                submission.form_version, submission.declared_at, submission.received_at,
                submission.payload_json, submission.original_body, submission.source_metadata_json,
                canonical_json(submission.answers_path), form_revision_id, submission.fingerprint,
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
            enqueue(connection, submission_id, now=submission.received_at)
    return {"submission_id": str(submission_id), "duplicate": inserted is None}
