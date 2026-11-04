"""Trusted entry and exact CRM binding for the channel-wide intake contract."""
from datetime import datetime
import re

CHANNEL_CONTRACT = "whatsapp-intake-v2"
CHANNEL_SUBFLOW = "whatsapp_single_intake"
CHANNEL_ORIGINS = {"website", "whatsapp_directo", "unknown"}
BINDING_EVIDENCE = {"external_message_id"}


def _id(value):
    return isinstance(value, str) and re.fullmatch(r"[1-9][0-9]{0,63}", value) is not None


def _event_id(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _version(value):
    return isinstance(value, int) and not isinstance(value, bool) and value == 1


def validate_channel_context(payload, source, attribution):
    """Reject public/unproven context before any provider lookup or write."""
    entry = payload.get("entry_context")
    binding = payload.get("crm_binding")
    if (not isinstance(entry, dict) or not _version(entry.get("version"))
            or entry.get("source") != "edna_authenticated" or not _event_id(entry.get("event_id"))
            or not _id(entry.get("message_id")) or not _id(entry.get("subject_id"))
            or entry.get("subject_id") != source.get("EDNA_INCOMING_SUBJECT_ID", "").strip()
            or entry.get("origin") not in CHANNEL_ORIGINS):
        raise ValueError("Authenticated Sales entry context is required.")
    received = datetime.fromisoformat(str(entry.get("received_at", "")).replace("Z", "+00:00"))
    if received.tzinfo is None:
        raise ValueError("An aware entry timestamp is required.")
    if (not isinstance(binding, dict) or not _version(binding.get("version"))
            or binding.get("source") != "bitrix_openline_session" or binding.get("verified") is not True
            or any(not _id(binding.get(name)) for name in ("lead_id", "chat_id", "session_id", "message_id", "entry_message_id"))
            or not _event_id(binding.get("entry_event_id"))
            or binding["entry_event_id"] != entry["event_id"]
            or binding["entry_message_id"] != entry["message_id"]
            or binding.get("evidence") not in BINDING_EVIDENCE):
        raise ValueError("An exact verified Open Lines entry binding is required.")
    if not attribution or attribution.get("test_reference") is not None or payload.get("test_reference") is not None:
        raise ValueError("Channel intake requires its ordinary provenance contract.")
    wa_entry = attribution.get("wa", {}).get("WA_ENTRY")
    if entry["origin"] == "website":
        if attribution.get("status") != "resolved" or not attribution.get("journey_id") or wa_entry != "website":
            raise ValueError("Website provenance must retain its verified journey.")
    elif (attribution.get("status") != "unknown" or attribution.get("journey_id") is not None
          or attribution.get("first") or attribution.get("last")
          or wa_entry not in ({"whatsapp_directo", "unknown"} if entry["origin"] == "unknown" else {"whatsapp_directo"})):
        raise ValueError("A direct entry cannot inherit a website journey or campaign.")
    return entry, binding
