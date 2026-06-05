from __future__ import annotations

from datetime import datetime
from pathlib import Path
import os
import requests
import sys
import unittest
from unittest.mock import patch

FILES_ROOT = Path(__file__).resolve().parent.parent / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

from bitrix_crm_negociaciones import (  # noqa: E402
    kestra_pending_entrypoint,
    kestra_plan_guard_entrypoint,
    kestra_webhook_entrypoint,
    service,
)


class BitrixCrmNegociacionesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.env = {
            "LOCAL_TZ": "America/Argentina/Buenos_Aires",
            "BUSINESS_START_HOUR": "9",
            "BUSINESS_START_MINUTE": "0",
            "BUSINESS_END_HOUR": "17",
            "BUSINESS_END_MINUTE": "0",
            "PROMISE_DATE_FIELD": "UF_CRM_1724427951",
            "PROMISE_AMOUNT_FIELD": "UF_CRM_1724429048",
        }

    def test_add_business_hours_skips_weekend_and_after_hours(self) -> None:
        with patch.dict(os.environ, self.env, clear=False):
            start = datetime.fromisoformat("2026-04-17T16:00:00-03:00")
            result = service.add_business_hours(start, 3)

        self.assertEqual(result.isoformat(), "2026-04-20T11:00:00-03:00")

    def test_promise_send_time_moves_weekend_to_next_business_start(self) -> None:
        with patch.dict(os.environ, self.env, clear=False):
            result = service.promise_send_time("2026-04-19")

        self.assertEqual(result.isoformat(), "2026-04-20T09:00:00-03:00")

    def test_promise_send_time_preserves_calendar_day_from_bitrix_offset_datetime(self) -> None:
        with patch.dict(os.environ, self.env, clear=False):
            result = service.promise_send_time("2026-05-01T03:00:00+03:00")

        self.assertEqual(result.isoformat(), "2026-05-01T09:00:00-03:00")

    def test_future_promise_send_time_only_uses_future_calendar_dates(self) -> None:
        with patch.dict(os.environ, self.env, clear=False):
            fake_now = datetime.fromisoformat("2026-04-17T10:00:00-03:00")
            future = service.future_promise_send_time("2026-04-20", reference_dt=fake_now)
            today = service.future_promise_send_time("2026-04-17", reference_dt=fake_now)
            past = service.future_promise_send_time("2026-04-16", reference_dt=fake_now)

        self.assertEqual(future.isoformat(), "2026-04-20T09:00:00-03:00")
        self.assertIsNone(today)
        self.assertIsNone(past)

    def test_parse_bitrix_date_without_timezone_uses_local_timezone(self) -> None:
        with patch.dict(os.environ, self.env, clear=False):
            result = service.parse_bitrix_datetime("2026-04-25")

        self.assertIsNotNone(result)
        self.assertEqual(result.isoformat(), "2026-04-25T00:00:00-03:00")

    def test_extract_contact_name_uses_deal_title_before_contact(self) -> None:
        deal = {"TITLE": "Negociacion #"}
        contact_data = {
            "NAME": "GISELLA PAULA",
            "LAST_NAME": "CONTRERA",
        }

        self.assertEqual(service.extract_contact_name(contact_data, deal), "Negociacion #")

    def test_extract_contact_name_falls_back_to_contact_if_title_missing(self) -> None:
        deal = {"TITLE": ""}
        contact_data = {
            "NAME": "GISELLA PAULA",
            "LAST_NAME": "CONTRERA",
        }

        self.assertEqual(service.extract_contact_name(contact_data, deal), "CONTRERA GISELLA PAULA")

    def test_template_variables_use_deal_title_before_contact_name(self) -> None:
        deal = {
            "TITLE": "Negociacion #",
            "UF_CRM_1724429048": "125245,57",
        }
        contact_data = {
            "NAME": "GISELLA PAULA",
            "LAST_NAME": "CONTRERA",
        }

        with patch.dict(os.environ, self.env, clear=False):
            variables = service.get_template_variables(51765, deal, contact_data)

        self.assertEqual(variables, ["Negociacion #", "$125.245,57"])

    def test_extract_contact_name_falls_back_to_deal_title(self) -> None:
        deal = {"TITLE": "CONTRERA G."}

        self.assertEqual(service.extract_contact_name(None, deal), "CONTRERA G.")

    def test_extract_contact_name_uses_partial_contact_without_deal_title(self) -> None:
        deal = {"TITLE": ""}
        contact_data = {
            "NAME": "",
            "LAST_NAME": "CONTRERA",
        }

        self.assertEqual(service.extract_contact_name(contact_data, deal), "CONTRERA")

    def test_extract_contact_name_falls_back_to_cliente_without_deal_or_contact(self) -> None:
        deal = {"TITLE": ""}

        self.assertEqual(service.extract_contact_name(None, deal), "cliente")

    def test_format_amount_preserves_dot_decimal_values(self) -> None:
        self.assertEqual(service.format_amount("323067.93|ARS"), "$323.067,93")

    def test_format_amount_preserves_comma_decimal_values(self) -> None:
        self.assertEqual(service.format_amount("1.234.567,89|ARS"), "$1.234.567,89")

    def test_get_template_variables_uses_promised_amount_field(self) -> None:
        deal = {
            "TITLE": "RIPOLL FLAVIA JESSICA",
            "UF_CRM_1724429048": "323067.93|ARS",
            "OPPORTUNITY": "304064.00",
        }
        contact_data = {
            "NAME": "FLAVIA JESSICA",
            "LAST_NAME": "RIPOLL",
        }
        with patch.dict(os.environ, self.env, clear=False):
            variables = service.get_template_variables(51765, deal, contact_data)

        self.assertEqual(variables, ["RIPOLL FLAVIA JESSICA", "$323.067,93"])

    def test_build_stage_plan_creates_three_dependent_actions(self) -> None:
        stage_cfg = {
            "name": "RECORDATORIO DE PROMESA",
            "template_id": 51765,
            "second_template_id": 51770,
            "second_wait_hours": 8,
            "final_wait_hours": 8,
            "next_stage_if_no_response": "C11:LOSE",
        }

        with patch.dict(os.environ, self.env, clear=False):
            fake_now = datetime.fromisoformat("2026-04-17T10:00:00-03:00")
            with patch.object(kestra_webhook_entrypoint.service, "get_now", return_value=fake_now):
                plan = kestra_webhook_entrypoint.build_stage_plan(
                    {"ID": "123", "STAGE_ID": "C11:UC_6KG2Z3"},
                    "C11:UC_6KG2Z3",
                    stage_cfg,
                )

        self.assertEqual(plan["plan_kind"], "double_send_then_move")
        self.assertEqual(len(plan["actions"]), 3)
        self.assertEqual(plan["plan"]["status"], "draft")
        self.assertEqual(plan["plan_ready"]["status"], "ready")
        self.assertEqual(plan["actions"][0]["action_kind"], "send_or_noop")
        self.assertEqual(
            plan["actions"][0]["message_id"],
            plan["actions"][0]["action_key"],
        )
        self.assertEqual(plan["actions"][0]["due_at"], "2026-04-17T10:00:00-03:00")
        self.assertEqual(plan["actions"][1]["depends_on_order"], 1)
        self.assertEqual(plan["actions"][2]["depends_on_order"], 2)

    def test_build_stage_plan_delays_reminder_when_promise_date_is_future(self) -> None:
        stage_cfg = {
            "name": "RECORDATORIO DE PROMESA",
            "template_id": 51765,
            "second_template_id": 51770,
            "send_on_future_promise_date": True,
            "second_wait_hours": 8,
            "final_wait_hours": 8,
            "next_stage_if_no_response": "C11:LOSE",
        }

        with patch.dict(os.environ, self.env, clear=False):
            fake_now = datetime.fromisoformat("2026-04-17T10:00:00-03:00")
            with patch.object(kestra_webhook_entrypoint.service, "get_now", return_value=fake_now):
                plan = kestra_webhook_entrypoint.build_stage_plan(
                    {
                        "ID": "123",
                        "STAGE_ID": "C11:UC_6KG2Z3",
                        "UF_CRM_1724427951": "2026-04-20",
                    },
                    "C11:UC_6KG2Z3",
                    stage_cfg,
                )

        self.assertEqual(plan["plan_kind"], "future_promise_reminder")
        self.assertEqual(plan["actions"][0]["due_at"], "2026-04-20T09:00:00-03:00")
        self.assertEqual(plan["actions"][1]["due_at"], "2026-04-20T17:00:00-03:00")
        self.assertEqual(plan["actions"][2]["due_at"], "2026-04-21T17:00:00-03:00")

    def test_build_stage_plan_keeps_immediate_reminder_when_promise_date_is_not_future(self) -> None:
        stage_cfg = {
            "name": "RECORDATORIO DE PROMESA",
            "template_id": 51765,
            "second_template_id": 51770,
            "send_on_future_promise_date": True,
            "second_wait_hours": 8,
            "final_wait_hours": 8,
            "next_stage_if_no_response": "C11:LOSE",
        }

        with patch.dict(os.environ, self.env, clear=False):
            fake_now = datetime.fromisoformat("2026-04-17T10:00:00-03:00")
            with patch.object(kestra_webhook_entrypoint.service, "get_now", return_value=fake_now):
                plan = kestra_webhook_entrypoint.build_stage_plan(
                    {
                        "ID": "123",
                        "STAGE_ID": "C11:UC_6KG2Z3",
                        "UF_CRM_1724427951": "2026-04-17",
                    },
                    "C11:UC_6KG2Z3",
                    stage_cfg,
                )

        self.assertEqual(plan["plan_kind"], "double_send_then_move")
        self.assertEqual(plan["actions"][0]["due_at"], "2026-04-17T10:00:00-03:00")
        self.assertEqual(plan["actions"][1]["due_at"], "2026-04-20T10:00:00-03:00")
        self.assertEqual(plan["actions"][2]["due_at"], "2026-04-21T10:00:00-03:00")

    def test_build_stage_plan_includes_stage_cycle_in_keys_when_available(self) -> None:
        stage_cfg = {
            "name": "CLIENTE CON INTENCION DE DIALOGO",
            "template_id": 52885,
            "wait_hours_no_response": 8,
            "next_stage_if_no_response": "C11:APOLOGY",
        }

        with patch.dict(os.environ, self.env, clear=False):
            fake_now = datetime.fromisoformat("2026-04-17T10:00:00-03:00")
            with patch.object(kestra_webhook_entrypoint.service, "get_now", return_value=fake_now):
                plan = kestra_webhook_entrypoint.build_stage_plan(
                    {
                        "ID": "123",
                        "STAGE_ID": "C11:UC_VO2IJO",
                        "MOVED_TIME": "2026-05-13T12:00:21+00:00",
                    },
                    "C11:UC_VO2IJO",
                    stage_cfg,
                )

        self.assertIn(".cycle.2026_05_13T12_00_21_00_00.", plan["plan"]["key"])
        self.assertIn(".cycle.2026_05_13T12_00_21_00_00.", plan["actions"][0]["action_key"])
        self.assertEqual(plan["actions"][0]["message_id"], plan["actions"][0]["action_key"])
        self.assertEqual(
            plan["legacy_plan_key"],
            "bitrix_crm_negociaciones.deal.123.stage.C11_UC_VO2IJO.plan",
        )

    def test_build_stage_plan_uses_fallback_stage_cycle_when_moved_time_is_missing(self) -> None:
        stage_cfg = {
            "name": "CLIENTE CON INTENCION DE DIALOGO",
            "template_id": 52885,
            "wait_hours_no_response": 8,
            "next_stage_if_no_response": "C11:APOLOGY",
        }

        with patch.dict(os.environ, self.env, clear=False):
            fake_now = datetime.fromisoformat("2026-04-17T10:00:00-03:00")
            with patch.object(kestra_webhook_entrypoint.service, "get_now", return_value=fake_now):
                plan = kestra_webhook_entrypoint.build_stage_plan(
                    {"ID": "123", "STAGE_ID": "C11:UC_VO2IJO"},
                    "C11:UC_VO2IJO",
                    stage_cfg,
                    stage_cycle_fallback="created_2026-05-13T12:00:21+00:00",
                )

        self.assertIn(".cycle.created_2026_05_13T12_00_21_00_00.", plan["plan"]["key"])

    def test_process_webhook_plans_deal_add_event(self) -> None:
        payload = {
            "event": "ONCRMDEALADD",
            "data[FIELDS][ID]": "123",
        }
        deal = {
            "ID": "123",
            "STAGE_ID": "C11:UC_VO2IJO",
            "MOVED_TIME": "2026-05-13T12:00:21+00:00",
        }

        with patch.dict(os.environ, self.env, clear=False):
            fake_now = datetime.fromisoformat("2026-04-17T10:00:00-03:00")
            with patch.object(kestra_webhook_entrypoint.service, "get_now", return_value=fake_now):
                with patch.object(
                    kestra_webhook_entrypoint.service,
                    "fetch_deal_with_contact",
                    return_value=(deal, None),
                ):
                    result = kestra_webhook_entrypoint.process_webhook(payload)

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "planned")
        self.assertEqual(result["reason"], "send_then_move")
        self.assertEqual(result["deal_id"], "123")
        self.assertEqual(result["stage_id"], "C11:UC_VO2IJO")
        self.assertEqual(result["planned_action_count"], "2")

    def test_process_webhook_uses_event_ts_for_deal_add_cycle_when_moved_time_is_missing(self) -> None:
        payload = {
            "event": "ONCRMDEALADD",
            "data[FIELDS][ID]": "123",
            "ts": "2026-05-13T12:00:21+00:00",
        }
        deal = {
            "ID": "123",
            "STAGE_ID": "C11:UC_VO2IJO",
        }

        with patch.dict(os.environ, self.env, clear=False):
            fake_now = datetime.fromisoformat("2026-04-17T10:00:00-03:00")
            with patch.object(kestra_webhook_entrypoint.service, "get_now", return_value=fake_now):
                with patch.object(
                    kestra_webhook_entrypoint.service,
                    "fetch_deal_with_contact",
                    return_value=(deal, None),
                ):
                    result = kestra_webhook_entrypoint.process_webhook(payload)

        self.assertIn(".cycle.created_2026_05_13T12_00_21_00_00.", result["plan_key"])

    def test_process_webhook_uses_event_ts_for_stage_change_cycle_when_moved_time_is_missing(self) -> None:
        payload = {
            "event": "ONCRMDEALUPDATE",
            "data[FIELDS][ID]": "123",
            "data[PREVIOUS][STAGE_ID]": "C11:NEW",
            "ts": "2026-05-13T12:00:21+00:00",
        }
        deal = {
            "ID": "123",
            "STAGE_ID": "C11:UC_VO2IJO",
        }

        with patch.dict(os.environ, self.env, clear=False):
            fake_now = datetime.fromisoformat("2026-04-17T10:00:00-03:00")
            with patch.object(kestra_webhook_entrypoint.service, "get_now", return_value=fake_now):
                with patch.object(
                    kestra_webhook_entrypoint.service,
                    "fetch_deal_with_contact",
                    return_value=(deal, None),
                ):
                    result = kestra_webhook_entrypoint.process_webhook(payload)

        self.assertIn(".cycle.moved_2026_05_13T12_00_21_00_00.", result["plan_key"])

    def test_process_webhook_ignores_generic_update_without_stage_change_evidence(self) -> None:
        payload = {
            "event": "ONCRMDEALUPDATE",
            "data[FIELDS][ID]": "123",
            "ts": "2026-05-13T12:00:21+00:00",
        }
        deal = {
            "ID": "123",
            "STAGE_ID": "C11:UC_VO2IJO",
        }

        with patch.dict(os.environ, self.env, clear=False):
            fake_now = datetime.fromisoformat("2026-04-17T10:00:00-03:00")
            with patch.object(kestra_webhook_entrypoint.service, "get_now", return_value=fake_now):
                with patch.object(
                    kestra_webhook_entrypoint.service,
                    "fetch_deal_with_contact",
                    return_value=(deal, None),
                ):
                    result = kestra_webhook_entrypoint.process_webhook(payload)

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "ignored")
        self.assertEqual(result["reason"], "stage_change_not_detected")

    def test_process_webhook_ignores_unsupported_event(self) -> None:
        result = kestra_webhook_entrypoint.process_webhook(
            {
                "event": "ONCRMCONTACTADD",
                "data[FIELDS][ID]": "123",
            }
        )

        self.assertTrue(result["ok"])
        self.assertEqual(result["action"], "ignored")
        self.assertEqual(result["reason"], "event_not_supported")

    def test_plan_guard_allows_reentry_when_only_legacy_plan_is_finalized(self) -> None:
        legacy_plan = {
            "status": "completed",
            "actions": [{"status": "completed"}, {"status": "cancelled"}],
        }

        result = kestra_plan_guard_entrypoint.evaluate_plan_guard(None, legacy_plan)

        self.assertTrue(result["should_schedule"])
        self.assertFalse(result["plan_already_exists"])
        self.assertEqual(result["reason"], "legacy_plan_finalized")

    def test_plan_guard_blocks_when_legacy_plan_is_active(self) -> None:
        legacy_plan = {
            "status": "ready",
            "actions": [{"status": "pending"}],
        }

        result = kestra_plan_guard_entrypoint.evaluate_plan_guard(None, legacy_plan)

        self.assertFalse(result["should_schedule"])
        self.assertTrue(result["plan_already_exists"])
        self.assertEqual(result["reason"], "legacy_plan_active")

    def test_plan_guard_blocks_when_cycle_plan_already_exists_even_if_completed(self) -> None:
        new_plan = {
            "status": "completed",
            "actions": [{"status": "completed"}],
        }

        result = kestra_plan_guard_entrypoint.evaluate_plan_guard(new_plan, None)

        self.assertFalse(result["should_schedule"])
        self.assertTrue(result["plan_already_exists"])
        self.assertEqual(result["reason"], "new_plan_exists")

    def test_pending_entrypoint_waits_if_dependency_is_pending(self) -> None:
        plan = {
            "key": "bitrix_crm_negociaciones.deal.1.stage.C11_PREPARATION.plan",
            "status": "ready",
            "actions": [
                {
                    "order": 1,
                    "status": "pending",
                },
                {
                    "action_key": "bitrix_crm_negociaciones.deal.1.stage.C11_PREPARATION.action_2",
                    "deal_id": "1",
                    "expected_stage": "C11:PREPARATION",
                    "action_kind": "send_or_noop",
                    "template_id": "51770",
                    "depends_on_order": 1,
                    "due_at": "2026-04-17T10:00:00-03:00",
                    "status": "pending",
                    "order": 2,
                },
            ],
        }
        env = {
            "PLAN_JSON": __import__("json").dumps(plan),
            "ACTION_ORDER": "2",
            "LOCAL_TZ": "America/Argentina/Buenos_Aires",
        }

        with patch.dict(os.environ, env, clear=False):
            with self.assertRaises(service.RetryableActionError) as exc:
                kestra_pending_entrypoint.handle_pending_action()

        self.assertEqual(exc.exception.reason, "waiting_dependency")

    def test_pending_entrypoint_cancels_when_dependency_failed(self) -> None:
        plan = {
            "key": "bitrix_crm_negociaciones.deal.1.stage.C11_PREPARATION.plan",
            "status": "ready",
            "actions": [
                {
                    "order": 1,
                    "status": "cancelled",
                },
                {
                    "action_key": "bitrix_crm_negociaciones.deal.1.stage.C11_PREPARATION.action_2",
                    "deal_id": "1",
                    "expected_stage": "C11:PREPARATION",
                    "action_kind": "send_or_noop",
                    "template_id": "51770",
                    "depends_on_order": 1,
                    "due_at": "2026-04-17T10:00:00-03:00",
                    "status": "pending",
                    "order": 2,
                },
            ],
        }
        env = {
            "PLAN_JSON": __import__("json").dumps(plan),
            "ACTION_ORDER": "2",
            "LOCAL_TZ": "America/Argentina/Buenos_Aires",
        }

        with patch.dict(os.environ, env, clear=False):
            result = kestra_pending_entrypoint.handle_pending_action()

        self.assertTrue(result["ok"])
        self.assertEqual(result["reason"], "dependency_not_completed")
        self.assertTrue(result["should_update"])
        updated_plan = __import__("json").loads(result["updated_plan_json"])
        self.assertEqual(updated_plan["actions"][1]["status"], "cancelled")

    def test_pending_entrypoint_marks_terminal_errors(self) -> None:
        plan = {
            "key": "bitrix_crm_negociaciones.deal.1.stage.C11_PREPARATION.plan",
            "status": "ready",
            "actions": [
                {
                    "action_key": "bitrix_crm_negociaciones.deal.1.stage.C11_PREPARATION.action_1",
                    "deal_id": "1",
                    "expected_stage": "C11:PREPARATION",
                    "action_kind": "send_or_noop",
                    "template_id": "51770",
                    "depends_on_order": 0,
                    "due_at": "2026-04-17T10:00:00-03:00",
                    "status": "pending",
                    "message_id": "stable-id",
                    "order": 1,
                },
            ],
        }
        env = {
            "PLAN_JSON": __import__("json").dumps(plan),
            "ACTION_ORDER": "1",
            "LOCAL_TZ": "America/Argentina/Buenos_Aires",
        }

        with patch.dict(os.environ, env, clear=False):
            with patch.object(
                kestra_pending_entrypoint.service,
                "fetch_deal_with_contact",
                return_value=({"ID": "1", "STAGE_ID": "C11:PREPARATION"}, None),
            ):
                result = kestra_pending_entrypoint.handle_pending_action()

        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "missing_contact_phone")
        self.assertTrue(result["should_update"])

    def test_pending_entrypoint_retries_if_plan_is_draft(self) -> None:
        plan = {
            "key": "bitrix_crm_negociaciones.deal.1.stage.C11_PREPARATION.plan",
            "status": "draft",
            "actions": [],
        }
        env = {
            "PLAN_JSON": __import__("json").dumps(plan),
            "ACTION_ORDER": "1",
            "LOCAL_TZ": "America/Argentina/Buenos_Aires",
        }

        with patch.dict(os.environ, env, clear=False):
            with self.assertRaises(service.RetryableActionError) as exc:
                kestra_pending_entrypoint.handle_pending_action()

        self.assertEqual(exc.exception.reason, "plan_not_ready")

    def test_send_to_edna_http_error_includes_response_body_and_request_context(self) -> None:
        response = requests.Response()
        response.status_code = 400
        response.url = "https://app.edna.io/api/v1/out-messages/whatsapp/template"
        response._content = b'{"message":"Duplicate messageId"}'

        env = {
            **self.env,
            "EDNA_URL": "https://app.edna.io/api/v1/out-messages/whatsapp/template",
            "EDNA_SENDER": "5493513105768_WA",
            "EDNA_API_KEY": "secret",
            "EDNA_TIMEOUT_SECONDS": "15",
        }
        deal = {"ID": "123", "UF_CRM_1724429048": "1000|ARS"}
        contact_data = {
            "NAME": "ANA",
            "LAST_NAME": "PEREZ",
            "PHONE": [{"VALUE": "+5493510000000"}],
        }

        with patch.dict(os.environ, env, clear=False):
            with patch.object(service.requests, "post", return_value=response):
                with self.assertRaises(service.TerminalActionError) as exc:
                    service.send_to_edna_with_message_id(
                        template_id=51765,
                        deal=deal,
                        contact_data=contact_data,
                        message_id="stable-id",
                    )

        self.assertEqual(exc.exception.reason, "edna_http_error")
        self.assertIn("EDNA HTTP 400", exc.exception.message)
        self.assertIn("Duplicate messageId", exc.exception.message)
        self.assertIn('"messageId": "stable-id"', exc.exception.message)
        self.assertIn('"templateId": 51765', exc.exception.message)
        self.assertIn('"phone": "5493510000000"', exc.exception.message)


if __name__ == "__main__":
    unittest.main()
