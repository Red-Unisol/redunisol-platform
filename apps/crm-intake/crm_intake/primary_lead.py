"""One logical Bitrix lead per request; an uncertain POST is never sent again."""

from uuid import UUID

from .capture import identifier
from .repository import require_dedicated_connection
from .requests import RequestConflict


ORIGINATOR = "redunisol.crm-intake"


def lead_number(value):
    if type(value) not in (str, int) or not str(value).isascii() or not str(value).isdigit():
        raise ValueError("invalid Bitrix ID")
    number = int(value)
    if not 0 < number <= 2**63 - 1:
        raise ValueError("Bitrix ID out of range")
    return number


def current(connection, request_id):
    row = connection.execute(
        "SELECT lead_id FROM crm_intake.request_primary_leads WHERE request_id=%s", (request_id,)
    ).fetchone()
    if not row:
        return None
    return {"status": "confirmed" if row[0] else "awaiting_confirmation", "lead_id": row[0]}


def confirm(connection, request_id, lead_id, evidence_ref, *, matches_origin):
    lead_id = lead_number(lead_id)
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """INSERT INTO crm_intake.request_primary_leads (request_id, lead_id, evidence_ref, confirmed_at)
               VALUES (%s, %s, %s, CURRENT_TIMESTAMP) ON CONFLICT (request_id) DO NOTHING
               RETURNING lead_id""", (request_id, lead_id, evidence_ref),
        )
        if not cursor.fetchone():
            cursor.execute(
                "SELECT lead_id FROM crm_intake.request_primary_leads WHERE request_id=%s FOR UPDATE", (request_id,)
            )
            existing = cursor.fetchone()[0]
            if existing is None and matches_origin:
                cursor.execute(
                    """UPDATE crm_intake.request_primary_leads SET lead_id=%s, evidence_ref=%s,
                       confirmed_at=CURRENT_TIMESTAMP WHERE request_id=%s""", (lead_id, evidence_ref, request_id),
                )
            elif existing != lead_id:
                raise RequestConflict("another lead or an unresolved create is already recorded")
    return {"status": "confirmed", "lead_id": lead_id}


def adopt_primary_lead(connection, request_id, lead_id, *, evidence_ref):
    """Trusted identity resolver found the operative lead for this exact request."""
    require_dedicated_connection(connection)
    return confirm(connection, request_id, lead_id, identifier(evidence_ref), matches_origin=False)


def find_by_origin(client, request_id):
    response = client.call_full("crm.lead.list", {
        "filter": {"=ORIGINATOR_ID": ORIGINATOR, "=ORIGIN_ID": request_id},
        "select": ["ID", "ORIGINATOR_ID", "ORIGIN_ID"],
    })
    rows = response.get("result")
    if not isinstance(rows, list) or response.get("next") is not None or len(rows) > 1:
        raise RequestConflict("Bitrix returned an ambiguous or invalid lead lookup")
    if "total" in response and int(response["total"]) != len(rows):
        raise RequestConflict("incomplete Bitrix lead lookup")
    if not rows:
        return None
    row = rows[0]
    if row.get("ORIGINATOR_ID") != ORIGINATOR or row.get("ORIGIN_ID") != request_id:
        raise RequestConflict("Bitrix lead does not match the exact request")
    return lead_number(row.get("ID"))


def ensure_primary_lead(connection, client, request_id, *, fields):
    """Use a non-retrying Bitrix transport and fields from the trusted commercial adapter.

    The adapter calls this only after it has resolved identity and authorized creation.
    A repeat following an ambiguous send can only reconcile the exact external origin.
    """
    require_dedicated_connection(connection)
    request_id = str(UUID(str(request_id)))
    existing = current(connection, request_id)
    if existing and existing["status"] == "confirmed":
        return existing
    match = find_by_origin(client, request_id)
    if match is not None:
        return confirm(connection, request_id, match, "bitrix:origin", matches_origin=True)
    if existing:
        return existing
    if not isinstance(fields.get("TITLE"), str) or not fields["TITLE"].strip():
        raise ValueError("a resolved lead title is required")
    lead_number(fields.get("CONTACT_ID"))
    payload = {**fields, "ORIGINATOR_ID": ORIGINATOR, "ORIGIN_ID": request_id}
    # Commit the reservation before the POST. No automatic expiry or takeover.
    with connection.transaction():
        reservation = connection.execute(
            """INSERT INTO crm_intake.request_primary_leads (request_id) VALUES (%s)
               ON CONFLICT (request_id) DO NOTHING RETURNING request_id""", (request_id,),
        ).fetchone()
    if not reservation:
        return current(connection, request_id)
    try:
        lead_id = lead_number(client.call("crm.lead.add", {"fields": payload}))
    except (OSError, RuntimeError, ValueError):
        return {"status": "awaiting_confirmation", "lead_id": None}
    return confirm(connection, request_id, lead_id, "bitrix:add", matches_origin=True)
