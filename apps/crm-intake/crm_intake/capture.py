"""Validate the capture envelope without discarding unanswered or unknown values."""

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


class InvalidSubmission(ValueError):
    """The transport envelope cannot be recorded safely."""


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))


def parse_datetime(value):
    if not isinstance(value, str):
        raise InvalidSubmission("declared_at must be an ISO 8601 timestamp with an offset")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise InvalidSubmission("declared_at must be an ISO 8601 timestamp with an offset") from None
    if parsed.utcoffset() is None:
        raise InvalidSubmission("declared_at must be an ISO 8601 timestamp with an offset")
    return parsed.astimezone(timezone.utc)


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_:.@/-]{1,160}", value):
        raise InvalidSubmission("source identifiers must be nonempty and use the documented character set")
    return value


def validate_value(value, depth=0):
    if depth > 12:
        raise InvalidSubmission("payload nesting exceeds the supported depth")
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or len(key) > 160 or "\x00" in key:
                raise InvalidSubmission("invalid payload key")
            validate_value(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            validate_value(child, depth + 1)
    elif isinstance(value, str):
        if "\x00" in value:
            raise InvalidSubmission("payload strings cannot contain NUL")
    elif value is not None and type(value) not in (bool, int, float):
        raise InvalidSubmission("payload must contain JSON values")


@dataclass(frozen=True)
class Submission:
    channel: str
    source_scope: str
    source_id: str
    form_version: str
    declared_at: datetime
    received_at: datetime
    payload_json: str
    fingerprint: str

    @property
    def payload(self):
        return json.loads(self.payload_json)


def capture(envelope, *, now=None):
    if not isinstance(envelope, dict):
        raise InvalidSubmission("submission must be an object")
    fields = {"channel", "source_scope", "source_id", "form_version", "declared_at", "payload"}
    if envelope.keys() != fields:
        raise InvalidSubmission("submission envelope has missing or unexpected fields")
    channel = envelope["channel"]
    if channel not in ("web", "whatsapp"):
        raise InvalidSubmission("unsupported capture channel")
    scope = identifier(envelope["source_scope"])
    source_id = identifier(envelope["source_id"])
    form_version = identifier(envelope["form_version"])
    declared_at = parse_datetime(envelope["declared_at"])
    received_at = now or datetime.now(timezone.utc)
    if received_at.utcoffset() is None:
        raise InvalidSubmission("the capture clock must include an offset")
    if declared_at > received_at + timedelta(minutes=5):
        raise InvalidSubmission("declared_at is too far in the future")
    payload = envelope["payload"]
    if not isinstance(payload, dict):
        raise InvalidSubmission("payload must be an object")
    validate_value(payload)
    try:
        original = canonical_json(payload)
        if len(original.encode("utf-8")) > 32 * 1024:
            raise InvalidSubmission("payload exceeds 32 KiB")
        identity = canonical_json([channel, scope, source_id, form_version, declared_at.isoformat(), payload])
    except (ValueError, UnicodeError):
        raise InvalidSubmission("payload must be finite, valid UTF-8 JSON of at most 32 KiB") from None
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return Submission(channel, scope, source_id, form_version, declared_at, received_at, original, digest)
