"""Link durable evidence to commercial requests in the dedicated CRM."""

from uuid import UUID, uuid4

from .capture import identifier
from .repository import ingest, require_dedicated_connection


class RequestConflict(ValueError):
    """A proven link disagrees with a previously recorded link."""


def receive_form(connection, envelope, *, continuation_of=None, evidence_ref=None, now=None):
    """Called by a trusted channel adapter after resolving opening versus continuation."""
    if continuation_of is not None:
        continuation_of = UUID(str(continuation_of))
        evidence_ref = identifier(evidence_ref)
    elif evidence_ref is not None:
        raise ValueError("an opening is identified by its own submission")
    receipt = ingest(connection, envelope, now=now)
    submission_id = receipt["submission_id"]
    # Capture committed first. A conflict or crash here cannot erase the original.
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute("SELECT id FROM crm_intake.submissions WHERE id=%s FOR UPDATE", (submission_id,))
        cursor.execute("SELECT request_id FROM crm_intake.request_submissions WHERE submission_id=%s", (submission_id,))
        linked = cursor.fetchone()
        if linked:
            request_id = linked[0]
            if continuation_of is not None and request_id != continuation_of:
                raise RequestConflict("submission already belongs to another request")
        else:
            if continuation_of is None:
                request_id = uuid4()
                cursor.execute("INSERT INTO crm_intake.requests (id) VALUES (%s)", (request_id,))
                kind, evidence_ref = "opening", submission_id
            else:
                request_id, kind = continuation_of, "continuation"
            cursor.execute(
                """INSERT INTO crm_intake.request_submissions (submission_id, request_id, kind, evidence_ref)
                   VALUES (%s, %s, %s, %s)""",
                (submission_id, request_id, kind, evidence_ref),
            )
    return {**receipt, "request_id": str(request_id)}


def link_record(connection, request_id, record_type, source_scope, source_id, *, evidence_ref):
    """Record a verified external reference. Historical references never authorize writes."""
    require_dedicated_connection(connection)
    identity = (request_id, record_type, identifier(source_scope), identifier(source_id))
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """INSERT INTO crm_intake.request_records
                   (request_id, record_type, source_scope, source_id, evidence_ref)
               VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
            (*identity, identifier(evidence_ref)),
        )
        if cursor.rowcount:
            return True
        cursor.execute(
            """SELECT 1 FROM crm_intake.request_records
               WHERE request_id=%s AND record_type=%s AND source_scope=%s AND source_id=%s""", identity,
        )
        if cursor.fetchone() is None:
            raise RequestConflict("message is already linked to another request")
        return False


def main():
    """Internal entry point for a trusted operator in an isolated environment."""
    import argparse
    import json
    import os
    import sys

    import psycopg

    parser = argparse.ArgumentParser(description="Bind an original form from standard input to a CRM request")
    mode = parser.add_subparsers(dest="mode", required=True)
    mode.add_parser("open-form")
    continuation = mode.add_parser("continue-form")
    continuation.add_argument("request_id", type=UUID)
    continuation.add_argument("evidence_ref")
    args = parser.parse_args()
    with psycopg.connect(os.environ["CRM_INTAKE_DATABASE_URL"], autocommit=True) as connection:
        receipt = receive_form(
            connection, json.load(sys.stdin), continuation_of=getattr(args, "request_id", None),
            evidence_ref=getattr(args, "evidence_ref", None),
        )
    print(json.dumps(receipt))


if __name__ == "__main__":
    main()
