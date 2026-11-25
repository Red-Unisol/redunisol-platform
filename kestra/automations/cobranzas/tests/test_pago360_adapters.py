"""Production ports tested with HTTP doubles, never live financial calls."""
from dataclasses import replace
from datetime import date
from decimal import Decimal
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'files'))
from pago360.adapters import Legacy, Provider, Repository
from pago360.portal import PortalError
from pago360_cuotas.domain import ContractError, Debt, Installment, Receipt, Status
from pago360_cuotas.processor import Processor, OperationTerminal
from kestra.automations.cobranzas.tests import test_pago360_cuotas as fixtures
from kestra.automations.cobranzas.tests.test_pago360_portal import OP, ITEM, TOKEN, ATTEMPT, snapshot

I = Installment('900','700',3,date(2026,10,1),150000)


def response(value, status=200):
    return Mock(status_code=status, text=json.dumps(value))


class AdaptersTests(unittest.TestCase):
    def test_provider_uses_fresh_service_verification_without_inventing_a_time(self):
        client=Mock()
        client.verify_payment.return_value={'proveedor_ref':'816','external_reference':OP,'ambiente':'live',
            'moneda':'ARS','estado':'paid','importe_cobrado':'1500.00','pagado_el':'2026-11-16'}
        from pago360.portal import normalize_operation
        op=normalize_operation(snapshot())
        proof=Provider(client).verify(op)
        self.assertIsNone(proof.paid_at)
        self.assertEqual(proof.paid_on,date(2026,11,16))
        self.assertEqual(proof.collected_cents,150000)
        client.verify_payment.assert_called_once_with(OP)

    def test_provider_rejection_cannot_authorize_a_charge(self):
        from pago360.portal import normalize_operation
        client=Mock();client.verify_payment.side_effect=PortalError(409,'pago_no_verificado')
        self.assertEqual(Provider(client).verify(normalize_operation(snapshot())).state,'not_verified')

    @patch('pago360.adapters.requests.post')
    def test_debt_reads_identity_not_current_balance(self,post):
        post.return_value=response([[700,900,3,'2026-10-01',None,False]])
        d=Legacy('https://legacy.test').debt(I)
        self.assertEqual(d.payable_cents,I.amount_cents)
        self.assertEqual(d.loan_id,'900')
        self.assertNotIn('Saldo',post.call_args.kwargs['json']['campos'])

    @patch('pago360.adapters.requests.post')
    def test_deleted_or_missing_installment_is_rejected(self,post):
        for rows in ([],[[700,900,3,'2026-10-01',None,True]],[[700,900,3,'2026-10-01',None,None]]):
            post.return_value=response(rows)
            with self.assertRaises(ContractError):Legacy('https://legacy.test').debt(I)

    @patch('pago360.adapters.requests.post')
    def test_financial_post_is_exact_once_after_collector_check(self,post):
        post.side_effect=[response([[42,'PAGOS 360',True,False]]),response(800)]
        r=Legacy('https://legacy.test').charge(None,None,I,ATTEMPT)
        self.assertEqual(r.receipt_id,'800')
        self.assertEqual(len(post.call_args_list),2)
        write=post.call_args_list[1]
        self.assertEqual(write.args[0],'https://legacy.test/fapi/PagoDeuda')
        self.assertEqual(write.kwargs['json']['importe'],1500)
        self.assertEqual(write.kwargs['json']['idCuota'],'700')
        self.assertEqual(write.kwargs['json']['idCobrador'],42)
        self.assertFalse(write.kwargs['json']['permitirPagarFueraDeOrden'])
        self.assertFalse(write.kwargs['allow_redirects'])

    @patch('pago360.adapters.requests.post')
    def test_timeout_or_unknown_reply_is_not_retried(self,post):
        import requests
        for failure in (requests.Timeout('private details'),response({'Success':True})):
            post.reset_mock();post.side_effect=[response([[42,'PAGOS 360',True,False]]),failure]
            with self.assertRaises(RuntimeError):Legacy('https://legacy.test').charge(None,None,I,ATTEMPT)
            self.assertEqual(post.call_count,2)

    @patch('pago360.adapters.requests.post')
    def test_wrong_collector_does_not_write(self,post):
        post.return_value=response([[42,'CAJA',True,False]])
        with self.assertRaises(ContractError):Legacy('https://legacy.test').charge(None,None,I,ATTEMPT)
        post.assert_called_once()

    @patch('pago360.adapters.requests.post')
    def test_verification_checks_cash_amount_and_receipt_link_without_balance_zero(self,post):
        post.side_effect=[response([[800,900,42,'2026-11-24',-1500,False]]),
                          response([[123,700,800,1500],[124,700,800,-1500]])]
        proof=Legacy('https://legacy.test').read_receipt(Receipt('800','900','700',150000),I)
        self.assertEqual(proof['importe'],'1500.00')
        self.assertEqual(proof['referencia'],'800')
        self.assertEqual(proof['fecha_contable'],'2026-11-24')
        self.assertTrue(all('Saldo' not in c.kwargs['json']['campos'] for c in post.call_args_list))

    @patch('pago360.adapters.requests.post')
    def test_unrelated_receipt_or_amount_cannot_be_verified(self,post):
        for row in ([800,901,42,'2026-11-24',-1500,False], [800,900,2,'2026-11-24',-1500,False],
                    [800,900,42,'2026-11-24',-1499,False]):
            post.return_value=response([row])
            with self.assertRaises(ContractError):Legacy('https://legacy.test').verify(Receipt('800','900','700',150000),I)

    def test_production_policy_accepts_collected_amount_even_when_debt_differs(self):
        op=fixtures.operation();repo=fixtures.MemoryRepository(op);legacy=fixtures.FakeLegacy(repo)
        legacy.reads[op.installments[0].key]=replace(legacy.debt(op.installments[0]),payable_cents=999999)
        provider=Mock();provider.verify.return_value=replace(fixtures.payment(op),paid_at=None,paid_on=date(2026,11,1))
        result=Processor(repo,provider,legacy,contracts_verified=True,apply_collected_amount=True).run(op.operation_id,'exec')
        self.assertEqual(result.status,'APPLIED')
        self.assertEqual(len(legacy.calls),1)

    def test_new_policy_keeps_identity_and_provider_amount_controls(self):
        for mismatch in ('identity','provider'):
            op=fixtures.operation();repo=fixtures.MemoryRepository(op);legacy=fixtures.FakeLegacy(repo);provider=Mock()
            provider.verify.return_value=fixtures.payment(op)
            if mismatch=='identity':legacy.reads[op.installments[0].key]=replace(legacy.debt(op.installments[0]),loan_id='999')
            else:provider.verify.return_value=replace(fixtures.payment(op),collected_cents=1)
            result=Processor(repo,provider,legacy,contracts_verified=True,apply_collected_amount=True).run(op.operation_id,'exec')
            self.assertEqual(result.status,'RECONCILIATION');self.assertEqual(legacy.calls,[])

    def test_repository_terminal_does_not_fabricate_a_lease_or_rewrite(self):
        client=Mock();client.claim.side_effect=PortalError(409,'terminal');client.snapshot.return_value={'trabajo':{'estado':'aplicado'}}
        with self.assertRaises(OperationTerminal):Repository(client,Mock()).claim(OP,'exec')
        client.begin.assert_not_called();client.record.assert_not_called()

    def test_repository_maps_pending_to_release_and_verified_to_new_legacy_read(self):
        client=Mock();data=snapshot();data['trabajo']={'estado':'en_proceso'}
        client.claim.return_value={'resultado':'tomado','token':TOKEN,'fencing':7,'snapshot':data}
        legacy=Mock();legacy.read_receipt.return_value={'cuota_prestamo_id':'700','importe':'1500.00','referencia':'800'}
        repo=Repository(client,legacy);claim=repo.claim(OP,'exec')
        receipt=Receipt('800','900','700',150000);repo.received(TOKEN,ATTEMPT,receipt);repo.verified(TOKEN,ATTEMPT)
        legacy.read_receipt.assert_called_once_with(receipt,claim.operation.installments[0])
        self.assertEqual(client.record.call_args.args[2],'verified')
        repo.finish(TOKEN,Status.PENDING,'read_unavailable');client.release.assert_called_once();client.finish.assert_not_called()


class IntegratedAdaptersTests(unittest.TestCase):
    def test_repository_provider_and_processor_complete_then_skip_duplicate(self):
        from pago360.portal import normalize_operation
        client=Mock();data=snapshot();data['trabajo']={'estado':'en_proceso'}
        client.claim.return_value={'resultado':'tomado','token':TOKEN,'fencing':7,'snapshot':data}
        client.verify_payment.return_value={'proveedor_ref':'816','external_reference':OP,'ambiente':'live',
            'moneda':'ARS','estado':'paid','importe_cobrado':'1500.00','pagado_el':'2026-11-16'}
        client.begin.return_value={'attempt_id':ATTEMPT,'cupo':{'operacion_id':OP,'reservado_centavos':150000,'limite_centavos':5000000}}
        legacy=Mock();op=normalize_operation(data);item=op.installments[0]
        legacy.debt.return_value=Debt(item.installment_id,item.loan_id,item.number,item.due_on,999999,False)
        legacy.charge.return_value=Receipt('800',item.loan_id,item.installment_id,item.amount_cents)
        legacy.verify.return_value=True
        legacy.read_receipt.return_value={'cuota_prestamo_id':item.installment_id,'importe':'1500.00','referencia':'800'}
        client.snapshot.return_value={'trabajo':{'estado':'aplicado'}}
        processor=Processor(Repository(client,legacy),Provider(client),legacy,contracts_verified=True,apply_collected_amount=True)
        self.assertEqual(processor.run(OP,'exec').status,'APPLIED')
        self.assertEqual([call.args[2] for call in client.record.call_args_list],['received','verified'])
        client.finish.assert_called_once_with(OP,'aplicado',TOKEN,7,None)
        client.claim.side_effect=PortalError(409,'terminal')
        self.assertEqual(processor.run(OP,'exec2').reason,'ALREADY_TERMINAL')
        legacy.charge.assert_called_once();client.verify_payment.assert_called_once();client.begin.assert_called_once()
