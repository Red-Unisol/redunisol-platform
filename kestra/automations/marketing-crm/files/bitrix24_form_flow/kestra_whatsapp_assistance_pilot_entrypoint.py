"""Dedicated test endpoint; an older shared namespace must never write real intake."""
import json
import os

from kestra import Kestra


try:
    from .form_processor.whatsapp_assistance import TEST_CONTRACT_VERSION, process

    body = json.loads(os.environ.get('TRIGGER_BODY_JSON', '{}'))
    if (TEST_CONTRACT_VERSION != 'isolated-test-v1' or not isinstance(body, dict)
            or body.get('test_mode') is not True
            or os.environ.get('EDNA_ASSISTANCE_TEST_MODE', '').lower() not in {'true', '1'}):
        raise ValueError('Pilot contract is not enabled')
    result = process(body)
except Exception:
    result = {'ok': False, 'case_id': '', 'lead_id': '', 'contact_id': '',
              'action': 'error', 'reason': 'assistance_pilot_processing_failed'}
Kestra.outputs(result)
