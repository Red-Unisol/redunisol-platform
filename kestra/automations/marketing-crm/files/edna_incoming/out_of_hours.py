"""Sales reply policy. Inputs are verified facts; outputs never contain customer PII."""

import json
import re
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

VERSION = "sales-out-of-hours-v1"
DEAL_CATEGORIES = [1, 5]  # VENTAS and ATENCION AL SOCIO, verified in Bitrix.
DAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Invalid policy timestamp")
    instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if instant.tzinfo is None:
        raise ValueError("Policy timestamps require a timezone")
    return instant


def iso(instant):
    return instant.astimezone(timezone.utc).isoformat()


def validate_text(text):
    if not isinstance(text, str) or not text.strip() or len(text) > 2000:
        raise ValueError("Invalid notice template")
    if re.search(r"https?://|www\.|\[url|[a-z0-9-]+\.[a-z]{2,}(?:\b|/)", text, re.I):
        raise ValueError("Notice templates cannot contain links")
    if any(key not in {"saludo", "asesor", "proxima_apertura", "horario"}
           for key in re.findall(r"\{([^}]*)\}", text)):
        raise ValueError("Unknown notice placeholder")


def calendar(instant, settings):
    zone = ZoneInfo(settings["timezone"])
    opening = time.fromisoformat(settings["open"])
    closing = time.fromisoformat(settings["close"])
    weekdays = settings["weekdays"]
    holidays = settings["holidays"]
    if (opening >= closing or not weekdays or len(holidays) > 366
            or any(type(day) is not int or day not in range(1, 8) for day in weekdays)):
        raise ValueError("Invalid notice calendar")
    for day in holidays:
        datetime.strptime(day, "%Y-%m-%d")
    local = instant.astimezone(zone)

    def working(day):
        return day.isoweekday() in weekdays and day.isoformat() not in holidays

    if working(local.date()) and opening <= local.time().replace(tzinfo=None) < closing:
        return None
    start = end = None
    for offset in range(371):
        past, future = local.date() - timedelta(days=offset), local.date() + timedelta(days=offset)
        past_close = datetime.combine(past, closing, zone)
        future_open = datetime.combine(future, opening, zone)
        if start is None and working(past) and past_close <= local:
            start = past_close
        if end is None and working(future) and future_open > local:
            end = future_open
        if start is not None and end is not None:
            return {"window_start": iso(start), "window_end": iso(end)}
    raise ValueError("No opening in the configured calendar")


def evaluate(request, allowed_subject):
    """Screen before CRM lookup, then decide from normalized, verified evidence."""
    result = {"ok": True, "kind": "out_of_hours_policy", "policy_version": VERSION,
              "request_id": request["request_id"], "event_key": request.get("event_key", ""),
              "decision": "suppress", "reason": "disabled", "window_start": "", "window_end": "",
              "notice_type": "", "message_template": "", "context_requirements": "", "calendar": ""}
    if not allowed_subject or str(request["subject_id"]) != str(allowed_subject):
        raise ValueError("Policy channel mismatch")
    settings = request["settings"]
    action = request["action"]
    if action == "calendar":
        instants = request["instants"]
        if not isinstance(instants, list) or len(instants) > 500:
            raise ValueError("Invalid calendar batch")
        result.update(decision="calendar", reason="calendar", calendar=json.dumps([
            {"window": calendar(timestamp(value), settings),
             "weekend": timestamp(value).astimezone(ZoneInfo(settings["timezone"])).isoweekday() >= 6}
            for value in instants], separators=(",", ":")))
        return result
    if action not in {"screen", "evaluate"}:
        raise ValueError("Unknown policy action")
    if request["transport_ready"] is not True or settings.get("enabled") is not True or not settings.get("enabled_since"):
        return result
    if request["candidate"] is not True or request["automatic_route"] is not False:
        return {**result, "reason": "automatic_route"}
    now, received = timestamp(request["now"]), timestamp(request["received_at"])
    if (received < timestamp(settings["enabled_since"]) or received < now - timedelta(hours=23)
            or received > now + timedelta(minutes=5)):
        return {**result, "reason": "outside_send_window"}
    window, current = calendar(received, settings), calendar(now, settings)
    if window is None or current is None or window["window_end"] != current["window_end"]:
        return {**result, "reason": "business_hours_or_expired"}
    result.update(window)
    requirements = {"deal_categories": DEAL_CATEGORIES, "form_since": iso(now - timedelta(days=60)),
                    "advisor_since": iso(now - timedelta(days=30))}
    result["context_requirements"] = json.dumps(requirements, separators=(",", ":"))
    if action == "screen":
        return {**result, "decision": "context_required", "reason": "eligible"}
    context = request["context"]
    if not isinstance(context, dict) or not isinstance(context.get("evidence"), list):
        raise ValueError("Verified CRM evidence is required")
    reason = "no_management_evidence"
    for fact in context["evidence"]:
        kind = fact.get("kind")
        if kind == "open_deal" and fact.get("category_id") in DEAL_CATEGORIES:
            reason = kind
            break
        if kind == "form" and fact.get("status_semantic") != "F":
            if timestamp(requirements["form_since"]) <= timestamp(fact["observed_at"]) <= now:
                reason = kind
                break
        if kind == "advisor_message" and fact.get("verified_human") is True:
            if timestamp(requirements["advisor_since"]) <= timestamp(fact["observed_at"]) <= now:
                reason = kind
                break
    notice_type = "general" if reason == "no_management_evidence" else "managed"
    template = settings[notice_type + "_text"]
    validate_text(template)
    opening = timestamp(window["window_end"]).astimezone(ZoneInfo(settings["timezone"]))
    template = template.replace("{proxima_apertura}",
                                f"el {DAYS[opening.weekday()]} {opening:%d/%m} a partir de las {opening:%H:%M} hs")
    template = template.replace("{horario}", ", ".join(DAYS[day - 1] for day in settings["weekdays"])
                                + f", de {settings['open']} a {settings['close']} hs")
    return {**result, "decision": "send", "reason": reason, "notice_type": notice_type,
            "message_template": template}
