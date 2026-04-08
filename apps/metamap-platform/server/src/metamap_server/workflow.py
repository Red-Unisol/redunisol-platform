from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from urllib.parse import urlparse


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


METAMAP_WEBHOOK_RECEIPT_RETENTION = timedelta(days=7)


class WorkflowError(Exception):
    """Raised when webhook data cannot be normalized or persisted."""


class ClientRole(str, Enum):
    VALIDADOR = "validador"
    TRANSFERENCIAS_CELESOL = "transferencias_celesol"


class ValidationStatus(str, Enum):
    RECEIVED = "received"
    STARTED = "started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    UNKNOWN = "unknown"


def normalize_event_name(event_name: str | None) -> str | None:
    if event_name is None:
        return None
    normalized = str(event_name).strip().lower()
    return normalized or None


def normalize_validation_status(event_name: str | None) -> ValidationStatus:
    normalized = normalize_event_name(event_name)
    if normalized is None:
        return ValidationStatus.UNKNOWN
    if normalized in {"verification_completed", "validation_completed"}:
        return ValidationStatus.COMPLETED
    if normalized in {"verification_started", "validation_started"}:
        return ValidationStatus.STARTED
    if normalized.endswith("_completed"):
        return ValidationStatus.IN_PROGRESS
    if normalized.endswith("_started"):
        return ValidationStatus.STARTED
    return ValidationStatus.RECEIVED


def extract_resource_url(payload: dict | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    raw_value = payload.get("resource_url") or payload.get("resource")
    if raw_value is None:
        return None
    resource_url = str(raw_value).strip()
    return resource_url or None


def extract_flow_id(payload: dict | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    raw_value = payload.get("flowId") or payload.get("flow_id")
    if raw_value is None:
        return None
    flow_id = str(raw_value).strip()
    return flow_id or None


def extract_event_timestamp(payload: dict | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    raw_value = payload.get("timestamp") or payload.get("eventTimestamp")
    if raw_value is None:
        return None
    event_timestamp = str(raw_value).strip()
    return event_timestamp or None


def extract_metadata(payload: dict | None) -> dict:
    if not isinstance(payload, dict):
        return {}
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        return {}
    return dict(metadata)


def extract_user_id(payload: dict | None) -> str | None:
    metadata = extract_metadata(payload)
    for key in ("userId", "user_id", "userID"):
        raw_value = metadata.get(key)
        if raw_value is None:
            continue
        user_id = str(raw_value).strip()
        if user_id:
            return user_id
    return None


def extract_verification_id(
    payload: dict | None,
    *,
    resource_url: str | None = None,
) -> str | None:
    if isinstance(payload, dict):
        for key in ("verificationId", "verification_id"):
            raw_value = payload.get(key)
            if raw_value is not None:
                verification_id = str(raw_value).strip()
                if verification_id:
                    return verification_id

        metadata = extract_metadata(payload)
        for key in ("verificationId", "verification_id"):
            raw_value = metadata.get(key)
            if raw_value is not None:
                verification_id = str(raw_value).strip()
                if verification_id:
                    return verification_id

    if not resource_url:
        return None
    path = urlparse(resource_url).path.rstrip("/")
    if not path:
        return None
    verification_id = path.rsplit("/", 1)[-1].strip()
    return verification_id or None


@dataclass
class ValidationRecord:
    verification_id: str
    latest_event_name: str
    normalized_status: ValidationStatus
    resource_url: str | None = None
    flow_id: str | None = None
    user_id: str | None = None
    request_number: str | None = None
    loan_number: str | None = None
    amount_raw: str | None = None
    amount_value: str | None = None
    metadata: dict = field(default_factory=dict)
    latest_payload: dict = field(default_factory=dict)
    first_received_at: str = field(default_factory=_utc_now)
    last_received_at: str = field(default_factory=_utc_now)
    latest_event_timestamp: str | None = None
    completed_at: str | None = None
    event_count: int = 1

    def to_dict(self, *, include_payload: bool = True) -> dict:
        data = {
            "verification_id": self.verification_id,
            "latest_event_name": self.latest_event_name,
            "normalized_status": self.normalized_status.value,
            "resource_url": self.resource_url,
            "flow_id": self.flow_id,
            "user_id": self.user_id,
            "request_number": self.request_number,
            "loan_number": self.loan_number,
            "amount_raw": self.amount_raw,
            "amount_value": self.amount_value,
            "metadata": self.metadata,
            "first_received_at": self.first_received_at,
            "last_received_at": self.last_received_at,
            "latest_event_timestamp": self.latest_event_timestamp,
            "completed_at": self.completed_at,
            "event_count": self.event_count,
        }
        if include_payload:
            data["latest_payload"] = self.latest_payload
        return data
