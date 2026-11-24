import hashlib
import json
from unittest.mock import Mock, patch

import pytest

from bitrix24_form_flow.form_processor.web_crm_delivery import ingest_guarded

FORM = {"full_name": "Prueba", "email": "test@example.com", "whatsapp": "3511234567", "cuil": "20876543219",
        "province": "Cordoba", "employment_status": "Jubilado Provincial", "payment_bank": "Banco Santander Rio S.A.",
        "lead_source": "Facebook", "submission_channel": "redunisol-web",
        "web_submission_id": "fef70819-e9f9-4468-be65-c725e584fdcf"}
PAYLOAD = json.dumps(FORM)


def test_only_the_receiver_with_the_irrevocable_permit_can_ingest():
    ingest = Mock(return_value={"ok": True})
    claim = Mock(side_effect=[{"state": "granted"}, {"state": "in_progress"},
                              {"state": "synced", "lead_id": "21", "contact_id": "12"}])
    assert ingest_guarded(PAYLOAD, ingest, claim)["ok"]
    assert not ingest_guarded(PAYLOAD, ingest, claim)["ok"]
    result = ingest_guarded(PAYLOAD, ingest, claim)
    assert (result["ok"], result["lead_id"], result["contact_id"]) == (True, 21, 12)
    claim.assert_called_with(FORM["web_submission_id"], hashlib.sha256(PAYLOAD.encode()).hexdigest())
    ingest.assert_called_once_with(FORM)


def test_invalid_payload_before_permission_and_uncertain_claim_never_reach_crm():
    claim, ingest = Mock(side_effect=TimeoutError), Mock()
    with pytest.raises(ValueError):
        ingest_guarded(json.dumps(dict(FORM, cuil="invalido")), ingest, claim)
    claim.assert_not_called()
    with pytest.raises(TimeoutError):
        ingest_guarded(PAYLOAD, ingest, claim)
    ingest.assert_not_called()


def test_routing_never_treats_a_guarded_envelope_as_a_legacy_submission():
    from bitrix24_form_flow.kestra_form_intake_entrypoint import _process_payload
    from bitrix24_form_flow.form_processor.input_parser import normalize_business_input
    envelope = {"web_crm_delivery_v1": PAYLOAD}
    # Legacy handlers see none of the required business fields at the root.
    with pytest.raises(ValueError):
        normalize_business_input(envelope)
    with patch("bitrix24_form_flow.form_processor.web_crm_delivery._claim", return_value={"state": "in_progress"}), \
         patch("bitrix24_form_flow.kestra_form_intake_entrypoint.ingest_submission") as ingest:
        assert not _process_payload(envelope)["ok"]
        with pytest.raises(ValueError):
            _process_payload({**envelope, "cuil": FORM["cuil"]})
        ingest.assert_not_called()
