import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "files"))
from edna_incoming.out_of_hours import VERSION, evaluate


def request():
    return {"request_id": "test-request", "event_key": "2423:100", "subject_id": "2423",
            "action": "evaluate", "candidate": True, "transport_ready": True, "automatic_route": False,
            "now": "2026-10-15T08:53:16-03:00", "received_at": "2026-10-15T08:53:16-03:00",
            "settings": {"enabled": True, "enabled_since": "2026-10-01T00:00:00-03:00",
                         "timezone": "America/Argentina/Cordoba", "open": "09:00", "close": "17:00",
                         "weekdays": [1, 2, 3, 4, 5], "holidays": ["2026-10-12"],
                         "general_text": "Recibimos tu mensaje. Respondemos {proxima_apertura}. Horario: {horario}.",
                         "managed_text": "{saludo} {asesor} sigue tu gestión {proxima_apertura}."},
            "context": {"evidence": []}}


class OutOfHoursPolicyTest(unittest.TestCase):
    def decide(self, **changes):
        data = request()
        data.update(changes)
        return evaluate(data, "2423")

    def test_actual_morning_case_returns_today_at_nine_and_no_customer_pii(self):
        result = self.decide()
        self.assertEqual(result["decision"], "send")
        self.assertIn("jueves 15/10 a partir de las 09:00", result["message_template"])
        self.assertEqual(result["notice_type"], "general")
        self.assertEqual(result["policy_version"], VERSION)
        self.assertNotIn("mañana", result["message_template"])

    def test_boundaries_weekend_and_holiday_share_the_correct_window(self):
        for instant, opening in [
            ("2026-10-09T16:59:59-03:00", None), ("2026-10-09T17:00:00-03:00", "2026-10-13T12:00:00+00:00"),
            ("2026-10-10T12:00:00-03:00", "2026-10-13T12:00:00+00:00"),
            ("2026-10-12T12:00:00-03:00", "2026-10-13T12:00:00+00:00"),
            ("2026-10-15T09:00:00-03:00", None),
        ]:
            with self.subTest(instant=instant):
                result = self.decide(now=instant, received_at=instant)
                self.assertEqual(result["window_end"] or None, opening)
                self.assertEqual(result["decision"], "send" if opening else "suppress")

    def test_transport_switch_candidate_and_automatic_route_suppress(self):
        for changes in [{"transport_ready": False}, {"candidate": False}, {"automatic_route": True}]:
            with self.subTest(changes=changes):
                self.assertEqual(self.decide(**changes)["decision"], "suppress")

    def test_expired_future_and_pre_activation_messages_are_suppressed(self):
        for received in ["2026-10-01T00:00:00-03:00", "2026-10-15T09:00:00-03:00", "2026-09-30T22:00:00-03:00"]:
            self.assertEqual(self.decide(received_at=received)["decision"], "suppress")
        self.assertEqual(self.decide(now="2026-10-15T09:00:00-03:00")["decision"], "suppress")

    def test_screen_returns_query_requirements_without_assuming_general(self):
        result = self.decide(action="screen", context=None)
        self.assertEqual(result["decision"], "context_required")
        requirements = json.loads(result["context_requirements"])
        self.assertEqual(requirements["deal_categories"], [1, 5])
        self.assertEqual(requirements["form_since"], "2026-08-16T11:53:16+00:00")
        self.assertEqual(result["notice_type"], "")

    def test_all_three_management_sources_and_both_deal_categories(self):
        for fact in [{"kind": "open_deal", "category_id": 1}, {"kind": "open_deal", "category_id": 5},
                     {"kind": "form", "observed_at": "2026-10-01T10:00:00-03:00", "status_semantic": "P"},
                     {"kind": "advisor_message", "observed_at": "2026-09-16T10:00:00-03:00", "verified_human": True}]:
            with self.subTest(fact=fact):
                result = self.decide(context={"evidence": [fact]})
                self.assertEqual(result["notice_type"], "managed")
                self.assertEqual(result["reason"], fact["kind"])
                self.assertIn("{saludo}", result["message_template"])

    def test_lost_old_future_and_non_human_records_do_not_establish_management(self):
        facts = [{"kind": "open_deal", "category_id": 11},
                 {"kind": "form", "observed_at": "2026-10-01T10:00:00-03:00", "status_semantic": "F"},
                 {"kind": "form", "observed_at": "2026-08-01T10:00:00-03:00", "status_semantic": "P"},
                 {"kind": "advisor_message", "observed_at": "2026-09-01T10:00:00-03:00", "verified_human": True},
                 {"kind": "advisor_message", "observed_at": "2026-10-01T10:00:00-03:00", "verified_human": False},
                 {"kind": "form", "observed_at": "2026-10-16T10:00:00-03:00", "status_semantic": "P"}]
        self.assertEqual(self.decide(context={"evidence": facts})["notice_type"], "general")

    def test_missing_context_is_an_error_instead_of_a_general_notice(self):
        with self.assertRaises((ValueError, TypeError)):
            self.decide(context=None)

    def test_calendar_report_uses_the_same_policy(self):
        result = self.decide(action="calendar", instants=["2026-10-10T12:00:00-03:00", "2026-10-15T09:00:00-03:00"])
        rows = json.loads(result["calendar"])
        self.assertTrue(rows[0]["weekend"])
        self.assertEqual(rows[0]["window"]["window_end"], "2026-10-13T12:00:00+00:00")
        self.assertIsNone(rows[1]["window"])

    def test_unknown_channel_or_unsafe_templates_fail_closed(self):
        for changes in [{"subject_id": "2580"}, {"settings": {**request()["settings"], "general_text": "www.example.com"}},
                        {"settings": {**request()["settings"], "general_text": "Hola {unknown}"}}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.decide(**changes)

    def test_actual_kestra_entrypoint_dispatches_policy_and_keeps_artifact_free_of_pii(self):
        from edna_incoming import entrypoint

        output = Mock()
        data = {**request(), "operation": "out_of_hours"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "request.json").write_text(json.dumps(data), encoding="utf-8")
            with patch.dict(sys.modules, {"kestra": SimpleNamespace(Kestra=SimpleNamespace(outputs=output))}), \
                    patch.dict("os.environ", {"EDNA_INCOMING_SUBJECT_ID": "2423"}), \
                    patch.object(entrypoint, "Path", side_effect=lambda name: root / name):
                entrypoint.main()
            result = output.call_args.args[0]
            self.assertEqual(result["decision"], "send")
            self.assertEqual(json.loads((root / "event.json").read_text(encoding="utf-8")), None)


if __name__ == "__main__":
    # Used by the PHP integration suite to exercise the actual cross-language contract.
    if "--json" in sys.argv:
        print(json.dumps(evaluate(json.load(sys.stdin), "2423"), ensure_ascii=True))
    else:
        unittest.main()
