"""Validate and preserve a source snapshot without interpreting its answers."""

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

MAX_DOCUMENT_BYTES = 256 * 1024


class InvalidSubmission(ValueError):
    """The transport envelope cannot be recorded safely."""


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def parse_datetime(value):
    if not isinstance(value, str):
        raise InvalidSubmission("declared_at must include a timezone")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise InvalidSubmission("declared_at must include a timezone") from None
    if parsed.utcoffset() is None:
        raise InvalidSubmission("declared_at must include a timezone")
    return parsed.astimezone(timezone.utc)


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_:.@/-]{1,160}", value):
        raise InvalidSubmission("invalid source identifier")
    return value


def validate_value(value, depth=0):
    if depth > 32:
        raise InvalidSubmission("document nesting exceeds the supported depth")
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or "\x00" in key:
                raise InvalidSubmission("invalid document key")
            validate_value(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            validate_value(child, depth + 1)
    elif isinstance(value, str):
        if "\x00" in value:
            raise InvalidSubmission("document strings cannot contain NUL")
    elif value is not None and type(value) not in (bool, int, float):
        raise InvalidSubmission("document must contain JSON values")


def bounded_text(text):
    try:
        if len(text.encode("utf-8")) > MAX_DOCUMENT_BYTES:
            raise InvalidSubmission("document exceeds 256 KiB")
    except UnicodeError:
        raise InvalidSubmission("document must be UTF-8") from None
    return text


def document_json(value):
    if not isinstance(value, dict):
        raise InvalidSubmission("document must be a JSON object")
    validate_value(value)
    try:
        return bounded_text(canonical_json(value))
    except InvalidSubmission:
        raise
    except (ValueError, RecursionError):
        raise InvalidSubmission("document must contain finite JSON values") from None


def decode_json(text):
    def unique_fields(pairs):
        result = dict(pairs)
        if len(result) != len(pairs):
            raise ValueError("duplicate object key")
        return result

    return json.loads(text, object_pairs_hook=unique_fields)


@dataclass(frozen=True)
class FormRevision:
    provider_form_id: str
    provider_revision: str
    definition_json: str

    @property
    def fingerprint(self):
        return digest(self.definition_json)


@dataclass(frozen=True)
class Submission:
    channel: str
    source_scope: str
    source_id: str
    form_version: str
    declared_at: datetime
    received_at: datetime
    original_body: str
    payload_json: str
    source_metadata_json: str
    answers_path: tuple
    form: FormRevision
    fingerprint: str

    @property
    def payload(self):
        return json.loads(self.payload_json)


def capture(envelope, *, now=None):
    fields = {
        "channel", "source_scope", "source_id", "form_version", "declared_at",
        "original_body", "source_metadata", "answers_path", "form",
    }
    if not isinstance(envelope, dict) or envelope.keys() != fields:
        raise InvalidSubmission("submission envelope has missing or unexpected fields")
    channel = envelope["channel"]
    if channel not in ("web", "whatsapp"):
        raise InvalidSubmission("unsupported capture channel")
    scope = identifier(envelope["source_scope"])
    source_id = identifier(envelope["source_id"])
    form_version = identifier(envelope["form_version"])
    declared_at = parse_datetime(envelope["declared_at"])
    received_at = now or datetime.now(timezone.utc)
    if received_at.utcoffset() is None or declared_at > received_at + timedelta(minutes=5):
        raise InvalidSubmission("invalid receipt clock or future declaration")

    body = envelope["original_body"]
    if not isinstance(body, str):
        raise InvalidSubmission("original_body must be the original UTF-8 JSON text")
    bounded_text(body)
    try:
        payload = decode_json(body)
    except (ValueError, RecursionError):
        raise InvalidSubmission("original_body must be valid JSON with unique object keys") from None
    payload_json = document_json(payload)
    metadata_json = document_json(envelope["source_metadata"])
    form = envelope["form"]
    if not isinstance(form, dict) or form.keys() != {"id", "revision", "definition"} or not form["definition"]:
        raise InvalidSubmission("an exact form identifier, revision and definition are required")
    revision = FormRevision(identifier(form["id"]), identifier(form["revision"]), document_json(form["definition"]))
    path = envelope["answers_path"]
    if not isinstance(path, list) or len(path) > 20 or any(
        not ((isinstance(step, str) and step and len(step) <= 200 and "\x00" not in step)
             or (type(step) is int and 0 <= step < 100_000)) for step in path
    ):
        raise InvalidSubmission("answers_path must identify a JSON object or an encoded response")
    fingerprint = digest(canonical_json([
        channel, scope, source_id, form_version, declared_at.isoformat(), body, metadata_json,
        path, revision.provider_form_id, revision.provider_revision, revision.fingerprint,
    ]))
    return Submission(
        channel, scope, source_id, form_version, declared_at, received_at, body, payload_json,
        metadata_json, tuple(path), revision, fingerprint,
    )
