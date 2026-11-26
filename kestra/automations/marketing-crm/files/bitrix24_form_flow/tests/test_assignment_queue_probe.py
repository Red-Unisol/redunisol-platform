from datetime import datetime
import unittest
from unittest.mock import Mock

from bitrix24_form_flow.kestra_assignment_queue_probe import eligible, ready_count


class QueueProbeTests(unittest.TestCase):
    now = datetime.fromisoformat("2026-12-06T12:00:00-03:00")
    calendar = {"timezone": "America/Argentina/Cordoba", "open": "09:00", "close": "17:00",
                "weekdays": [1, 2, 3, 4, 5], "holidays": []}
    row = {"createdTime": "2026-12-04T16:00:00-03:00", "bucket": "cordoba_general",
           "reason": "waiting_for_sales_opening|2026-12-04T20:00:00+00:00|2026-12-07T12:00:00+00:00|cbu_approved"}

    def test_reads_every_page_and_one_calendar_before_sleeping(self):
        pages = Mock(side_effect=[
            {"result": {"items": [self.row]}, "total": 2, "next": 1},
            {"result": {"items": [self.row]}, "total": 2},
        ])
        settings = Mock(return_value=({"cordoba_general": (29, 57)}, self.calendar))
        self.assertEqual(ready_count(pages, settings, "reason", "bucket", self.now), 0)
        self.assertEqual(pages.call_count, 2)
        settings.assert_called_once()

    def test_legacy_or_ready_deal_runs_worker_even_if_calendar_is_unavailable(self):
        for row in ({**self.row, "reason": "assignment_queued|cbu_approved"},
                    {**self.row, "createdTime": "2026-01-01T00:00:00Z"}):
            settings = Mock(side_effect=RuntimeError)
            page = Mock(return_value={"result": {"items": [row]}, "total": 1})
            self.assertEqual(ready_count(page, settings, "reason", "bucket", self.now), 1)
            settings.assert_not_called()

    def test_exact_request_wakes_existing_probe_only_during_sales_hours(self):
        row = {**self.row, "id": 14, "leadId": 13,
               "reason": "waiting_for_request_chat|web|29cfe69d-2904-4b38-a7ec-5161f3d2067e|approved"}
        def fetch(offset, filters):
            if "!action" in filters:
                return {"result": {"items": []}, "total": 0}
            self.assertEqual(offset, -1)  # never enumerate the dormant CRM stock
            return {"result": {"items": [row]}}
        opening = datetime.fromisoformat("2026-12-07T10:05:00-03:00")
        lookup = Mock(return_value=[{"@id": [14]}])
        conf = lambda: ({"cordoba_general": (29, 30)}, self.calendar)
        self.assertEqual(eligible(fetch, conf, ("action", "reason", "bucket"), self.now, lookup), 0)
        lookup.assert_not_called()
        self.assertEqual(eligible(fetch, conf, ("action", "reason", "bucket"), opening, lookup), 1)
        lookup.assert_called_once()

    def test_wakes_for_shifted_calendar_or_pool_change(self):
        page = Mock(return_value={"result": {"items": [self.row]}, "total": 1})
        for pool, calendar in (((29,), self.calendar), ((), self.calendar),
                               ((29, 57), {**self.calendar, "holidays": ["2026-12-07"]})):
            self.assertEqual(ready_count(page, lambda: ({"cordoba_general": pool}, calendar),
                                         "reason", "bucket", self.now), 1)
