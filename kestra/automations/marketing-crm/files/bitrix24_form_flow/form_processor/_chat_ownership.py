"""Request-scoped seller selection. The original intake opts in; a replay cannot enroll it."""
from datetime import datetime
from http.client import HTTPSConnection, HTTPException
import json
from urllib.parse import urlsplit
from uuid import UUID


WEB_ORIGIN = "redunisol.web.chat-owner-v1"
V3_DESCRIPTION = "redunisol.chat-owner-v1"
WAIT = "waiting_for_request_chat"


def request_id(value):
    if not isinstance(value, str):
        return None
    try:
        return value if str(UUID(value)) == value else None
    except ValueError:
        return None


def lead_request(lead):
    token = request_id(lead.get("ORIGIN_ID"))
    if token and lead.get("ORIGINATOR_ID") == WEB_ORIGIN:
        return "web", token
    if (token and lead.get("ORIGINATOR_ID") == "redunisol.edna.fresh-v3"
            and lead.get("SOURCE_DESCRIPTION") == V3_DESCRIPTION):
        return "v3", token
    return None


def queue_marker(request, reason):
    return "|".join((WAIT, *request, reason))


def queued_case(row, reason_field):
    raw = str(row.get(reason_field) or "")
    if not raw.startswith(WAIT + "|"):
        return None
    parts = raw.split("|", 3)
    if len(parts) != 4 or parts[1] not in ("web", "v3") or not request_id(parts[2]):
        raise ValueError("Invalid request ownership marker.")
    deal, lead = int(row["id"]), int(row["leadId"])
    if min(deal, lead) <= 0:
        raise ValueError("Missing request binding.")
    return {"deal_id": deal, "lead_id": lead, "channel": parts[1], "request_id": parts[2]}


def api(source, path, payload, timeout):
    base = urlsplit(source.get("BITRIX24_ROUTING_CONFIG_URL", ""))
    token = source.get("BITRIX24_VOLUME_COMPENSATION_TOKEN", "")
    if base.scheme != "https" or not base.hostname or not token:
        raise RuntimeError("Missing authenticated commercial routing endpoint.")
    connection = HTTPSConnection(base.hostname, port=base.port, timeout=5)
    try:
        connection.connect()
        connection.sock.settimeout(timeout)
        connection.request("POST", base.path.rstrip("/") + path, body=json.dumps(payload).encode(),
                           headers={"Content-Type": "application/json", "Accept": "application/json",
                                    "Authorization": "Bearer " + token})
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError("Unexpected routing HTTP status.")
        return json.loads(response.read(256 * 1024))
    except (OSError, HTTPException, ValueError):
        raise RuntimeError("No se pudo comprobar la disponibilidad de las solicitudes.") from None
    finally:
        connection.close()


def candidate_filters(source):
    """Only active receipts and open requested calls ever enter a Bitrix lookup."""
    for channel, field in (("web", "@id"), ("v3", "@leadId"), ("outbound", "@id")):
        cursor = 0
        while True:
            result = api(source, "/chat-candidates", {"channel": channel, "after": cursor}, 15)
            ids = result["ids"]
            if not isinstance(ids, list) or len(ids) > 50 or any(type(i) is not int or i < 1 for i in ids):
                raise ValueError("Invalid candidate IDs.")
            if ids:
                yield {field: ids}
            next_page = result["next"]
            if next_page is None:
                break
            if type(next_page) is not int or next_page <= cursor:
                raise ValueError("Invalid candidate cursor.")
            cursor = next_page


def readiness(cases, source, *, live, now):
    available = {}
    for start in range(0, len(cases), 50):
        batch = cases[start:start + 50]
        rows = api(source, "/chat-readiness", {"cases": batch, "live": live}, 45 if live else 15)["cases"]
        if not isinstance(rows, list) or len(rows) != len(batch):
            raise ValueError("Incomplete request availability response.")
        expected = {c["deal_id"]: c for c in batch}
        for row in rows:
            deal = int(row["deal_id"])
            case = expected.pop(deal, None)
            if not case or row.get("request_id") != case["request_id"] or int(row["lead_id"]) != case["lead_id"]:
                raise ValueError("Unexpected request availability binding.")
            if row["state"] == "waiting":
                continue
            if row["state"] == "outbound" and int(row.get("activity_id") or 0) > 0:
                available[deal] = ("outbound", int(row["activity_id"]))
            elif row["state"] == "ready" and min(int(row.get("chat_id") or 0), int(row.get("session_id") or 0)) > 0:
                expires = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
                if expires > now:
                    available[deal] = ("chat", int(row["chat_id"]), int(row["session_id"]))
            else:
                raise ValueError("Invalid request availability evidence.")
    return available
