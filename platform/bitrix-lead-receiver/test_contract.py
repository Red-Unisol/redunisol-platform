import base64
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock

import yaml

from prepare_env import build_env, read_env
from operate import request


ROOT = Path(__file__).resolve().parents[2]


class Contracts(unittest.TestCase):
    def test_apache_and_probe_cover_actual_tenant_webhook(self):
        root = ROOT/'platform/bitrix-lead-receiver'
        route = '/api/v1/main/executions/webhook/redunisol.prod.marketing-crm/bitrix24_lead_won_deal_webhook/'
        self.assertIn('ProxyPass "'+route+'" "http://127.0.0.1:8092'+route+'"', (root/'apache-route.conf').read_text())
        self.assertIn(route, (root/'enable_ingress.py').read_text())

    def test_cancellation_accepts_empty_success_response(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b''
        with patch('operate.urlopen', return_value=response):
            result = request('http://localhost/kill', {'KESTRA_USERNAME':'test','KESTRA_PASSWORD':'test'},
                             ['execution'], method='DELETE', kestra=True)
        self.assertEqual(result, {})

    def test_new_worker_preserves_business_arguments_and_claims_before_writing(self):
        flows = ROOT/'kestra/automations/marketing-crm/flows'
        original = yaml.safe_load((flows/'bitrix24_lead_won_deal_webhook.yaml').read_text())
        new = yaml.safe_load((flows/'bitrix24_lead_event_process.yaml').read_text())
        self.assertEqual(new['concurrency'], original['concurrency'])
        business = new['tasks'][1]
        for field in ('env','commands','namespaceFiles','type'):
            self.assertEqual(business[field], original['tasks'][0][field])
        self.assertNotIn('beforeCommands',business)
        self.assertIn('@sha256:',business['containerImage'])
        self.assertEqual(new['tasks'][0]['id'],'reclamar_evento')
        self.assertIn('reclamar_evento', business['runIf'])
        self.assertEqual(new['tasks'][2]['id'],'confirmar_resultado')
        self.assertIn('vars.ok', new['tasks'][2]['body'])
        self.assertIn('vars.ok', new['errors'][0]['body'])
        self.assertFalse(new['triggers'][0]['wait'])

    def test_env_decodes_kestra_secrets_and_preserves_administrator_key(self):
        source = {'ENV_BITRIX24_BASE_URL':'https://example.test','ENV_BITRIX24_LEAD_STATUS_QUALIFIED':'WON',
                  'KESTRA_ADMIN_EMAIL':'admin','KESTRA_ADMIN_PASSWORD':'pa$word'}
        for k,v in {'BITRIX24_LEAD_WON_DEAL_WEBHOOK_KEY':'hook','BITRIX24_WEBHOOK_PATH':'rest/1/secret',
                    'BITRIX24_LEAD_WON_DEAL_APPLICATION_TOKEN':'application'}.items():
            source['SECRET_'+k] = base64.b64encode(v.encode()).decode()
        env = build_env(source,{'RECEIVER_ADMIN_TOKEN':'keep'},'revision')
        self.assertEqual(env['RECEIVER_ADMIN_TOKEN'],'keep')
        self.assertEqual(env['BITRIX_APPLICATION_TOKEN'],'application')
        self.assertEqual(env['BITRIX_REST_URL'],'https://example.test/rest/1/secret')
        self.assertEqual(env['ACTIONABLE_STATUSES'],'NEW,WON')
        self.assertIn('/api/v1/main/executions/webhook/', env['KESTRA_DISPATCH_URL'])
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'env'
            path.write_text("KESTRA_PASSWORD='pa$word'\n")
            self.assertEqual(read_env(path)['KESTRA_PASSWORD'],'pa$word')


if __name__ == '__main__':
    unittest.main()
