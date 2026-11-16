"""Pruebas del motor con puertos simulados; NO verifican PostgreSQL ni APIs reales."""
from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timezone
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "files"))
from pago360_cuotas.domain import (Attempt, AttemptStatus, ContractError, Debt,
    Installment, Operation, Receipt, Status, VerifiedPayment, cents)
from pago360_cuotas.processor import (Claim, ClaimConflict, DefiniteRejection,
    OperationNotFound, Processor)


I1 = Installment("101", "9001", 1, date(2026, 9, 1), 123456)
I2 = Installment("101", "9002", 2, date(2026, 10, 1), 234567)
I3 = Installment("101", "9003", 3, date(2026, 10, 20), 10000)


def operation(items=(I1,)):
    return Operation("operation-test", "provider-test", "sandbox", sum(i.amount_cents for i in items), items)


def payment(op):
    return VerifiedPayment(op.provider_reference, op.operation_id, op.environment,
                           "ARS", "paid", op.total_cents,
                           datetime(2026, 11, 1, 15, tzinfo=timezone.utc))


class MemoryRepository:
    """Doble contractual atómico en memoria; no es persistencia para producción."""
    def __init__(self, op):
        self.operation = op
        self.status = Status.PENDING
        self.reason = None
        self.attempts = {}
        self.busy = False
        self.lock = threading.Lock()
        self.trace = []
        self.publish_fail = False
        self.receive_fail = False
        self.uncertain_fail = False
        self.finish_fail = False
        self.verify_commit_fail = False
        self.begin_fail = None
        self.notifications = 0

    def claim(self, operation_id, executor_id):
        with self.lock:
            if operation_id != self.operation.operation_id:
                raise OperationNotFound()
            if self.busy:
                return None
            self.busy = True
            return Claim("lease-test", self.operation, self.status, tuple(self.attempts.values()), self.reason)

    def begin(self, token, installment):
        with self.lock:
            if self.begin_fail:
                raise self.begin_fail
            if any(a.installment.key == installment.key for a in self.attempts.values()):
                raise ClaimConflict()
            key = "attempt-" + str(len(self.attempts) + 1)
            self.attempts[key] = Attempt(key, installment, AttemptStatus.WRITING)
            self.trace.append(("intent", installment.installment_id))
            return key

    def received(self, token, attempt_id, receipt):
        if self.receive_fail:
            raise ConnectionError("Synthetic database failure")
        self.attempts[attempt_id] = replace(self.attempts[attempt_id], status=AttemptStatus.RECEIVED, receipt=receipt)
        self.trace.append(("received", receipt.installment_id))

    def verified(self, token, attempt_id):
        if self.verify_commit_fail:
            raise ConnectionError("Synthetic verification commit failure")
        self.attempts[attempt_id] = replace(self.attempts[attempt_id], status=AttemptStatus.VERIFIED)

    def uncertain(self, token, attempt_id, receipt):
        if self.uncertain_fail:
            raise ConnectionError("Synthetic database failure")
        self.attempts[attempt_id] = replace(self.attempts[attempt_id], status=AttemptStatus.UNCERTAIN, receipt=receipt)

    def rejected(self, token, attempt_id):
        self.attempts[attempt_id] = replace(self.attempts[attempt_id], status=AttemptStatus.REJECTED)

    def finish(self, token, status, reason):
        if self.finish_fail:
            raise ConnectionError("Synthetic result commit failure")
        if status == Status.APPLIED:
            assert len(self.attempts) == len(self.operation.installments)
            assert all(a.status == AttemptStatus.VERIFIED for a in self.attempts.values())
        self.status, self.reason = status, reason
        self.busy = False

    def publish(self, operation_id):
        self.notifications += 1
        if self.publish_fail:
            raise ConnectionError("Synthetic portal callback failure")

    def simulate_executor_restart(self):
        self.busy = False  # No modifica el journal ni demuestra persistencia real.


class FakeLegacy:
    def __init__(self, repo):
        self.repo = repo
        self.calls = []
        self.verify_calls = 0
        self.fail_at = None
        self.failure = TimeoutError()
        self.verify_failure = False
        self.verify_matches = True
        self.reads = {}
        self.read_hook = None
        self.on_charge = None

    def debt(self, i):
        if self.read_hook:
            self.read_hook(i)
        return self.reads.get(i.key, Debt(i.installment_id, i.loan_id, i.number, i.due_on, i.amount_cents, False))

    def charge(self, op, provider_payment, installment, attempt_id):
        assert self.repo.attempts[attempt_id].status == AttemptStatus.WRITING
        self.calls.append(installment.installment_id)
        self.repo.trace.append(("write", installment.installment_id))
        if self.on_charge:
            self.on_charge()
        if self.fail_at == len(self.calls):
            raise self.failure
        return Receipt(str(8000 + len(self.calls)), installment.loan_id, installment.installment_id, installment.amount_cents)

    def verify(self, receipt, installment):
        self.verify_calls += 1
        if self.verify_failure:
            raise TimeoutError()
        return self.verify_matches


class Pago360Tests(unittest.TestCase):
    def fixture(self, items=(I1,)):
        op = operation(items)
        repo = MemoryRepository(op)
        provider = Mock()
        provider.verify.return_value = payment(op)
        legacy = FakeLegacy(repo)
        worker = Processor(repo, provider, legacy, contracts_verified=True)
        return repo, provider, legacy, worker

    def test_real_write_gate_is_closed_by_default_without_any_io(self):
        repo, provider, legacy, _ = self.fixture()
        worker = Processor(repo, provider, legacy)
        self.assertEqual(worker.run("operation-test", "execution-test").status, "BLOCKED")
        self.assertFalse(repo.busy)
        provider.verify.assert_not_called()
        self.assertEqual(legacy.calls, [])

    def test_operation_does_not_exist(self):
        repo, provider, legacy, worker = self.fixture()
        self.assertEqual(worker.run("unknown", "execution-test").status, "NOT_FOUND")
        provider.verify.assert_not_called()
        self.assertFalse(legacy.calls)

    def test_exact_verified_payment_is_applied_with_durable_intent_first(self):
        repo, provider, legacy, worker = self.fixture()
        result = worker.run("operation-test", "execution-test")
        self.assertEqual(result.status, "APPLIED")
        self.assertTrue(result.notified)
        self.assertEqual(repo.trace[:3], [("intent", "9001"), ("write", "9001"), ("received", "9001")])
        self.assertEqual(repo.attempts['attempt-1'].status, AttemptStatus.VERIFIED)
        self.assertEqual(legacy.verify_calls, 1)

    def test_provider_amount_cannot_fall_back_to_local_amount(self):
        for amount in [None, 0, True, 123455, 123456.0]:
            with self.subTest(amount=amount):
                repo, provider, legacy, worker = self.fixture()
                provider.verify.return_value = replace(payment(repo.operation), collected_cents=amount)
                self.assertEqual(worker.run("operation-test", "execution-test").reason, "AMOUNT_MISMATCH")
                self.assertFalse(legacy.calls)

    def test_reference_environment_currency_and_date_must_match(self):
        for changes, expected in [
            ({"external_reference": "other"}, "REFERENCE_MISMATCH"),
            ({"provider_reference": "other"}, "REFERENCE_MISMATCH"),
            ({"environment": "production"}, "REFERENCE_MISMATCH"),
            ({"currency": "USD"}, "CURRENCY_MISMATCH"),
            ({"paid_at": None}, "PAID_DATE_UNKNOWN"),
            ({"paid_at": datetime(2026, 11, 1)}, "PAID_DATE_UNKNOWN"),
        ]:
            with self.subTest(changes=changes):
                repo, provider, legacy, worker = self.fixture()
                provider.verify.return_value = replace(payment(repo.operation), **changes)
                self.assertEqual(worker.run("operation-test", "execution-test").reason, expected)
                self.assertFalse(legacy.calls)

    def test_rejected_refunded_expired_pending_do_not_write_or_reverse(self):
        for state in ['pending', 'rejected', 'expired', 'refunded']:
            with self.subTest(state=state):
                repo, provider, legacy, worker = self.fixture()
                provider.verify.return_value = replace(payment(repo.operation), state=state)
                self.assertEqual(worker.run("operation-test", "execution-test").reason, "PROVIDER_NOT_PAID")
                self.assertFalse(repo.attempts)
                self.assertFalse(legacy.calls)

    def test_provider_unavailable_remains_pending(self):
        repo, provider, legacy, worker = self.fixture()
        provider.verify.side_effect = TimeoutError()
        self.assertEqual(worker.run("operation-test", "execution-test").status, "PENDING")
        self.assertFalse(legacy.calls)

    def test_cancellation_and_refinancing_are_excluded(self):
        for kind in ['early_settlement', 'refinancing']:
            repo, provider, legacy, worker = self.fixture()
            repo.operation = replace(repo.operation, kind=kind)
            self.assertEqual(worker.run("operation-test", "execution-test").reason, "OUT_OF_SCOPE")
            self.assertFalse(legacy.calls)

    def test_installment_paid_elsewhere_is_not_an_applied_payment(self):
        repo, provider, legacy, worker = self.fixture()
        legacy.reads[I1.key] = Debt('9001', '101', 1, I1.due_on, 0, True)
        result = worker.run("operation-test", "execution-test")
        self.assertEqual(result.reason, "PAID_BY_OTHER_OPERATION")
        self.assertEqual(result.status, "RECONCILIATION")
        self.assertFalse(legacy.calls)

    def test_changed_debt_or_id_and_not_overdue_are_blocked(self):
        for debt, expected in [
            (Debt('9999','101',1,I1.due_on,I1.amount_cents,False), 'INSTALLMENT_MISMATCH'),
            (Debt('9001','101',1,I1.due_on,I1.amount_cents+1,False), 'DEBT_CHANGED'),
        ]:
            repo, provider, legacy, worker = self.fixture()
            legacy.reads[I1.key] = debt
            self.assertEqual(worker.run("operation-test", "execution-test").reason, expected)
            self.assertFalse(legacy.calls)
        today = replace(I1, due_on=date(2026,11,1))
        repo, provider, legacy, worker = self.fixture((today,))
        self.assertEqual(worker.run("operation-test", "execution-test").reason, 'NOT_OVERDUE_OR_CHANGED')
        self.assertFalse(legacy.calls)

    def test_overdue_uses_argentina_day_not_utc_day(self):
        i = replace(I1, due_on=date(2026,10,31))
        repo, provider, legacy, worker = self.fixture((i,))
        provider.verify.return_value = replace(payment(repo.operation), paid_at=datetime(2026,11,1,1,tzinfo=timezone.utc))
        self.assertEqual(worker.run("operation-test", "execution-test").reason, 'NOT_OVERDUE_OR_CHANGED')
        self.assertFalse(legacy.calls)

    def test_all_selected_installments_preflight_before_first_write(self):
        repo, provider, legacy, worker = self.fixture((I1,I2))
        legacy.reads[I2.key] = Debt('9002','101',2,I2.due_on,1,False)
        self.assertEqual(worker.run("operation-test", "execution-test").reason, 'DEBT_CHANGED')
        self.assertFalse(legacy.calls)

    def test_older_installments_first_without_relying_on_portal_order(self):
        repo, provider, legacy, worker = self.fixture((I2,I1))
        self.assertEqual(worker.run("operation-test", "execution-test").status, 'APPLIED')
        self.assertEqual(legacy.calls, ['9001', '9002'])

    def test_duplicate_event_only_republishes_persisted_result(self):
        repo, provider, legacy, worker = self.fixture()
        worker.run('operation-test','execution-1')
        worker.run('operation-test','execution-2')
        self.assertEqual(legacy.calls,['9001'])
        self.assertEqual(provider.verify.call_count,1)

    def test_concurrent_executors_do_not_both_charge(self):
        repo, provider, legacy, worker = self.fixture()
        started, release = threading.Event(), threading.Event()
        legacy.on_charge = lambda: (started.set(), release.wait(3))
        results=[]
        thread=threading.Thread(target=lambda:results.append(worker.run('operation-test','execution-1')))
        thread.start()
        try:
            self.assertTrue(started.wait(2))
            self.assertEqual(worker.run('operation-test','execution-2').status,'BUSY')
        finally:
            release.set();thread.join(3)
        self.assertEqual(results[0].status,'APPLIED')
        self.assertEqual(legacy.calls,['9001'])

    def test_timeout_after_possible_write_is_not_retried(self):
        repo, provider, legacy, worker = self.fixture()
        legacy.fail_at = 1
        self.assertEqual(worker.run('operation-test','execution-1').reason,'WRITE_UNCERTAIN')
        worker.run('operation-test','execution-2')
        self.assertEqual(legacy.calls,['9001'])
        self.assertEqual(repo.attempts['attempt-1'].status,AttemptStatus.UNCERTAIN)

    def test_partial_result_survives_and_no_remaining_installment_is_written(self):
        repo, provider, legacy, worker = self.fixture((I1,I2,I3))
        legacy.fail_at = 2
        worker.run('operation-test','execution-1')
        worker.run('operation-test','execution-2')
        self.assertEqual(legacy.calls,['9001','9002'])
        self.assertEqual(repo.attempts['attempt-1'].status,AttemptStatus.VERIFIED)
        self.assertEqual(repo.attempts['attempt-2'].status,AttemptStatus.UNCERTAIN)

    def test_no_write_if_intent_cannot_commit(self):
        repo, provider, legacy, worker = self.fixture()
        repo.begin_fail=ConnectionError('Synthetic intent failure')
        with self.assertRaises(ConnectionError):worker.run('operation-test','execution-1')
        self.assertFalse(legacy.calls)

    def test_foreign_reservation_requires_reconciliation(self):
        repo, provider, legacy, worker = self.fixture()
        repo.begin_fail=ClaimConflict()
        self.assertEqual(worker.run('operation-test','execution-1').reason,'RESERVATION_CONFLICT')
        self.assertFalse(legacy.calls)

    def test_local_confirmation_failure_retains_response_and_does_not_repeat(self):
        repo, provider, legacy, worker = self.fixture()
        repo.receive_fail=True
        worker.run('operation-test','execution-1')
        self.assertIsNotNone(repo.attempts['attempt-1'].receipt)
        worker.run('operation-test','execution-2')
        self.assertEqual(legacy.calls,['9001'])

    def test_uncertain_update_failure_still_leaves_prewrite_intent(self):
        repo, provider, legacy, worker = self.fixture()
        legacy.fail_at=1;repo.uncertain_fail=True;repo.finish_fail=True
        with self.assertRaises(ConnectionError):worker.run('operation-test','execution-1')
        self.assertEqual(repo.attempts['attempt-1'].status,AttemptStatus.WRITING)
        repo.simulate_executor_restart();repo.finish_fail=False
        self.assertEqual(worker.run('operation-test','execution-2').reason,'WRITE_UNCERTAIN')
        self.assertEqual(legacy.calls,['9001'])

    def test_known_receipt_recovery_is_read_only(self):
        repo, provider, legacy, worker = self.fixture()
        legacy.verify_failure=True
        self.assertEqual(worker.run('operation-test','execution-1').status,'PENDING')
        self.assertEqual(repo.attempts['attempt-1'].status,AttemptStatus.RECEIVED)
        legacy.verify_failure=False
        self.assertEqual(worker.run('operation-test','execution-2').status,'APPLIED')
        self.assertEqual(legacy.calls,['9001'])
        self.assertEqual(legacy.verify_calls,2)

    def test_paid_balance_without_receipt_proof_is_not_applied(self):
        repo, provider, legacy, worker = self.fixture()
        legacy.verify_matches=False
        self.assertEqual(worker.run('operation-test','execution-1').reason,'RECEIPT_NOT_PROVEN')
        self.assertEqual(repo.status,Status.RECONCILIATION)

    def test_portal_callback_failure_does_not_repeat_a_confirmed_charge(self):
        repo, provider, legacy, worker = self.fixture()
        repo.publish_fail=True
        result=worker.run('operation-test','execution-1')
        self.assertEqual(result.status,'APPLIED');self.assertFalse(result.notified)
        repo.publish_fail=False
        self.assertTrue(worker.run('operation-test','execution-2').notified)
        self.assertEqual(legacy.calls,['9001'])

    def test_finish_commit_failure_recovers_verified_attempt_without_write(self):
        repo, provider, legacy, worker = self.fixture()
        repo.finish_fail=True
        with self.assertRaises(ConnectionError):worker.run('operation-test','execution-1')
        repo.simulate_executor_restart();repo.finish_fail=False
        self.assertEqual(worker.run('operation-test','execution-2').status,'APPLIED')
        self.assertEqual(legacy.calls,['9001'])

    def test_definite_rejection_is_distinct_from_uncertain(self):
        repo, provider, legacy, worker = self.fixture()
        legacy.fail_at=1;legacy.failure=DefiniteRejection()
        self.assertEqual(worker.run('operation-test','execution-1').reason,'LEGACY_REJECTED')
        self.assertEqual(repo.attempts['attempt-1'].status,AttemptStatus.REJECTED)

    def test_invalid_receipt_is_uncertain_not_success(self):
        repo, provider, legacy, worker = self.fixture()
        legacy.charge=lambda *args:Receipt('0','101','9001',123456)
        self.assertEqual(worker.run('operation-test','execution-1').reason,'WRITE_UNCERTAIN')

    def test_debt_changed_after_first_charge_preserves_partial_result(self):
        repo, provider, legacy, worker = self.fixture((I1,I2))
        def change_second(installment):
            if installment == I2 and legacy.calls:
                legacy.reads[I2.key] = Debt('9002','101',2,I2.due_on,1,False)
        legacy.read_hook = change_second
        self.assertEqual(worker.run('operation-test','execution-1').reason,'DEBT_CHANGED')
        self.assertEqual(legacy.calls,['9001'])
        self.assertEqual(repo.attempts['attempt-1'].status,AttemptStatus.VERIFIED)

    def test_verification_commit_failure_retains_received_for_read_only_recovery(self):
        repo, provider, legacy, worker = self.fixture()
        repo.verify_commit_fail=True
        with self.assertRaises(ConnectionError):worker.run('operation-test','execution-1')
        self.assertEqual(repo.attempts['attempt-1'].status,AttemptStatus.RECEIVED)
        repo.simulate_executor_restart();repo.verify_commit_fail=False
        self.assertEqual(worker.run('operation-test','execution-2').status,'APPLIED')
        self.assertEqual(legacy.calls,['9001'])

    def test_immutable_snapshot_and_exact_cents(self):
        self.assertEqual(cents('1234.56'),123456)
        for value in ['1.234','NaN','Infinity','0','-1',1.2,True,'1.234,56']:
            with self.subTest(value=value),self.assertRaises(ContractError):cents(value)
        with self.assertRaises(ContractError):Operation('op','p','sandbox',1,(I1,))
        with self.assertRaises(ContractError):operation((I1,I1))
        with self.assertRaises(ContractError):replace(I1,installment_id='1 OR 1=1')
        with self.assertRaises(ContractError):Attempt('id',I1,'unexpected')


if __name__ == '__main__':
    unittest.main()
