"""Compatibility of the decrypted Laravel attribution envelope with existing CRM storage."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from bitrix24_form_flow.form_processor.attribution import (
    ASSISTANCE_FIELDS,
    CRM_FIELDS,
    WA_FIELDS,
    copy_to_deal,
    lead_fields,
    normalize_attribution,
)
from bitrix24_form_flow.form_processor.intake_context import validate_channel_context


class MetadataOnlyCrm:
    """Expose provisioned field aliases, rejecting any business read or write."""

    def __init__(self):
        self.calls = []
        self.aliases = {
            name: "provisionedDealField" + str(index)
            for index, name in enumerate((*CRM_FIELDS, *WA_FIELDS, *ASSISTANCE_FIELDS))
        }

    def call(self, method, payload):
        self.calls.append((method, copy.deepcopy(payload)))
        if method == "crm.lead.fields" and payload == {}:
            return {
                name: {
                    "type": "datetime" if name in {"UF_CRM_WA_TIMESTAMP", "UF_CRM_FECHA_ORIGEN"} else "string",
                    "isMultiple": False,
                }
                for name in (*CRM_FIELDS, *WA_FIELDS)
            }
        if method == "crm.item.fields" and payload == {"entityTypeId": 2}:
            return {"fields": {alias: {"upperName": name} for name, alias in self.aliases.items()}}
        raise AssertionError("This compatibility test permits metadata reads only.")


def entry_context(origin):
    return {
        "entry_context": {
            "version": 1, "source": "edna_authenticated", "event_id": 20,
            "message_id": "101", "subject_id": "2423", "origin": origin,
            "received_at": "2026-11-11T15:00:00Z",
        },
        "crm_binding": {
            "version": 1, "source": "bitrix_openline_session", "verified": True,
            "lead_id": "10", "chat_id": "200", "session_id": "300", "message_id": "400",
            "entry_event_id": 20, "entry_message_id": "101", "evidence": "external_message_id",
        },
    }


class PaidAttributionContextTests(unittest.TestCase):
    def roundtrip(self, snapshot, *, origin, source_label):
        original = copy.deepcopy(snapshot)
        # Laravel decrypts its at-rest snapshot before POSTing ordinary JSON.
        normalized = normalize_attribution(json.loads(json.dumps(snapshot, ensure_ascii=False)))
        context = entry_context(origin)
        self.assertEqual(
            validate_channel_context(context, {"EDNA_INCOMING_SUBJECT_ID": "2423"}, normalized),
            (context["entry_context"], context["crm_binding"]),
        )
        client = MetadataOnlyCrm()
        fields = lead_fields(client, normalized, source_label=source_label, source_id="9991")
        # Simulate reading the stored lead through REST, including its JSON string field.
        persisted_lead = json.loads(json.dumps({"ID": "10", **fields}))
        deal = {"title": "Synthetic current request"}
        copy_to_deal(client, persisted_lead, deal)
        self.assertEqual(deal[client.aliases["UF_CRM_ATTR_JSON"]], fields["UF_CRM_ATTR_JSON"])
        self.assertEqual(deal[client.aliases["UF_CRM_ATTR_STATUS"]], snapshot["status"])
        self.assertEqual(client.calls, [
            ("crm.lead.fields", {}), ("crm.item.fields", {"entityTypeId": 2}),
        ])
        self.assertEqual(snapshot, original)
        return normalized, fields, deal, client

    def test_direct_referral_and_routing_survive_without_inventing_acquisition(self):
        routing = {
            "version": 1, "route": "paid_direct_v3",
            "evidence": {"kind": "provider_ad_referral", "source_type": "ad", "source_id": "provider-ad-123"},
        }
        referral = {
            "sourceId": "provider-ad-123", "sourceType": "ad",
            "sourceUrl": "https://ads.example.test/original", "headline": "Synthetic advertised offer",
            "ctwaClid": "provider-click-fixture",
        }
        snapshot = {
            "version": 1, "status": "unknown", "journey_id": None, "first": [], "last": [],
            "wa_assisted": True, "wa": {"WA_ENTRY": "whatsapp_directo", "WA_FLOW_ID": "950118281197789"},
            "referral": referral, "entry_routing": routing,
        }
        normalized, fields, deal, client = self.roundtrip(snapshot, origin="unknown", source_label="Sin origen")
        stored = json.loads(deal[client.aliases["UF_CRM_ATTR_JSON"]])
        self.assertEqual((stored["first"], stored["last"], stored["journey_id"]), ({}, {}, None))
        self.assertEqual(stored["source_label"], "Sin origen")
        self.assertEqual(stored["entry_routing"], routing)
        self.assertEqual(stored["referral"], referral)
        self.assertEqual(normalized["entry_routing"], routing)
        self.assertEqual(fields["UF_CRM_WA_ENTRY"], "whatsapp_directo")
        self.assertEqual(set(fields), {
            "UF_CRM_ATTR_JSON", "UF_CRM_ATTR_STATUS", "UF_CRM_WA_ASSISTED", "UF_CRM_WA_ENTRY", "UF_CRM_WA_FLOW_ID",
        })
        self.assertNotIn("network", stored["entry_routing"]["evidence"])
        self.assertFalse(any(name.startswith("UTM_") for name in fields))

    def test_resolved_web_journey_keeps_real_touches_clicks_and_routing_together(self):
        first = {"utm_source": "meta", "utm_medium": "paid_social", "utm_campaign": "original-campaign",
                 "fbclid": "original-meta-click", "at": "2026-11-10T12:00:00Z"}
        last = {"utm_source": "google", "utm_medium": "cpc", "utm_campaign": "current-campaign",
                "utm_content": "current-ad-group", "gclid": "current-google-click",
                "landing": "https://www.example.test/current-landing", "at": "2026-11-11T14:59:00Z"}
        routing = {"version": 1, "route": "paid_direct_v3", "evidence": {
            "kind": "tracked_paid_click", "journey_id": "AbCdEf1234", "signal": "gclid", "network": "google",
        }}
        snapshot = {
            "version": 1, "status": "resolved", "journey_id": "AbCdEf1234", "first": first, "last": last,
            "wa_assisted": True, "wa": {"WA_ENTRY": "website", "WA_FLOW_ID": "950118281197789"},
            "entry_routing": routing,
        }
        _, fields, deal, client = self.roundtrip(snapshot, origin="website", source_label="Google")
        stored = json.loads(deal[client.aliases["UF_CRM_ATTR_JSON"]])
        self.assertEqual(stored["first"], first)
        self.assertEqual(stored["last"], last)
        self.assertEqual(stored["entry_routing"], routing)
        self.assertEqual(fields["UF_CRM_GCLID"], "current-google-click")
        self.assertEqual(deal[client.aliases["UF_CRM_GCLID"]], "current-google-click")
        self.assertEqual(deal[client.aliases["UF_CRM_JOURNEY_ID"]], "AbCdEf1234")
        self.assertEqual(deal[client.aliases["UF_CRM_LANDING_ORIGEN"]], last["landing"])
        self.assertEqual(deal[client.aliases["UF_CRM_FECHA_ORIGEN"]], last["at"])
        self.assertNotIn("campaign_id", stored)
        self.assertNotIn("ad_id", stored)

    def test_routing_decision_does_not_allow_direct_context_to_claim_a_campaign(self):
        snapshot = normalize_attribution({
            "version": 1, "status": "unknown", "journey_id": None, "first": [],
            "last": {"utm_source": "google", "utm_campaign": "unproven-campaign"},
            "wa_assisted": True, "wa": {"WA_ENTRY": "whatsapp_directo"},
            "entry_routing": {"version": 1, "route": "paid_direct_v3", "evidence": {"kind": "documented_ad_prefill"}},
        })
        with self.assertRaisesRegex(ValueError, "cannot inherit"):
            validate_channel_context(entry_context("unknown"), {"EDNA_INCOMING_SUBJECT_ID": "2423"}, snapshot)


if __name__ == "__main__":
    unittest.main()
