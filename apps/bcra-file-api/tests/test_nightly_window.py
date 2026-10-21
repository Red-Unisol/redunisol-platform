from dataclasses import replace
from datetime import datetime, timezone
import itertools
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from bcra_file_api.config import Config
from bcra_file_api.refresh import RefreshManager, refresh_budget_seconds
from bcra_file_api.source import Asset, SourceClient, SourceError
from bcra_file_api.store import import_snapshot
from test_bcra import PERIOD, archives, base, manifest


class NightlyWindowTests(unittest.TestCase):
    def setUp(self):
        self.config = Config(Path("unused"), "x" * 32, refresh_start_hour=21)

    def test_argentina_window_and_midnight_use_the_same_morning_cutoff(self):
        for instant, seconds in (
            ("2026-10-22T00:00:00+00:00", 36000),  # 21:00 Argentina
            ("2026-10-22T02:00:00+00:00", 28800),  # 23:00 Argentina
            ("2026-10-22T03:00:00+00:00", 25200),  # midnight
            ("2026-10-22T09:30:00+00:00", 1800),   # 06:30
        ):
            with self.subTest(instant=instant):
                self.assertEqual(
                    refresh_budget_seconds(self.config, datetime.fromisoformat(instant)), seconds
                )
        for instant in ("2026-10-22T10:00:00+00:00", "2026-10-21T23:59:59+00:00"):
            with self.subTest(instant=instant), self.assertRaisesRegex(SourceError, "outside"):
                refresh_budget_seconds(self.config, datetime.fromisoformat(instant))

    def test_runtime_environment_enables_window_and_rejects_invalid_hours(self):
        with patch.dict(os.environ, {
            "BCRA_FILE_API_TOKEN": "x" * 32,
            "BCRA_FILE_REFRESH_START_HOUR": "21",
            "BCRA_FILE_REFRESH_END_HOUR": "7",
            "BCRA_FILE_REFRESH_TIMEZONE": "America/Argentina/Buenos_Aires",
        }, clear=True):
            config = Config.from_env()
        self.assertEqual(config.refresh_start_hour, 21)
        self.assertEqual(config.refresh_end_hour, 7)
        for start, end in ((24, 7), (21, -1), (7, 7)):
            with self.subTest(start=start, end=end), self.assertRaises(ValueError):
                replace(self.config, refresh_start_hour=start, refresh_end_hour=end)

    def test_daytime_job_fails_before_any_source_request(self):
        with tempfile.TemporaryDirectory() as temporary:
            manager = RefreshManager(replace(self.config, data_dir=Path(temporary), terms_accepted=True))
            now = datetime(2026, 10, 21, 16, tzinfo=timezone.utc)
            with patch("bcra_file_api.refresh.refresh_budget_seconds",
                       side_effect=lambda config: refresh_budget_seconds(config, now)), \
                    patch("bcra_file_api.refresh.SourceClient") as source:
                manager._run()
            source.assert_not_called()
            self.assertEqual(manager.state["status"], "failed")
            self.assertIn("outside", manager.state["error"])

    def test_expired_budget_interrupts_bulk_sql_instead_of_finishing_it(self):
        clock = itertools.count()
        rows = "".join(base(identification=str(20000000000 + i)) for i in range(3000))
        with tempfile.TemporaryDirectory() as temporary, \
                patch("bcra_file_api.store.time.monotonic", side_effect=lambda: next(clock)):
            with self.assertRaisesRegex(SourceError, "time budget"):
                import_snapshot(Path(temporary) / "staged.sqlite", archives(rows=rows),
                                manifest(), 1, deadline=3)

    def test_expiry_after_build_cannot_publish_or_replace_the_active_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            manager = RefreshManager(Config(Path(temporary), "x" * 32, terms_accepted=True, min_rows=1))
            import_snapshot(manager.database, archives(), manifest(), 1)
            original = manager.database.read_bytes()
            assets = [Asset(PERIOD + kind + ".7Z", kind, PERIOD, "unused")
                      for kind in ("DEUDORES", "INFRET", "INFRETPA")]
            clock = [1000.0]

            def download(asset, path):
                path.write_bytes(b"fixture")
                return {"kind": asset.kind, "sha256": asset.kind}

            def build(*args, **kwargs):
                result = import_snapshot(*args, **kwargs)
                clock[0] = kwargs["deadline"] + 1
                return result

            with patch("bcra_file_api.refresh.SourceClient") as source, \
                    patch("bcra_file_api.refresh.Archive", side_effect=lambda path, *_args, **_kwargs:
                          archives()[next(kind for kind in ("DEUDORES", "INFRET", "INFRETPA")
                                          if path.name == PERIOD + kind + ".7Z")]), \
                    patch("bcra_file_api.refresh.time.monotonic", side_effect=lambda: clock[0]), \
                    patch("bcra_file_api.refresh.import_snapshot", side_effect=build):
                source.return_value.catalog.return_value = assets
                source.return_value.download.side_effect = download
                with self.assertRaisesRegex(SourceError, "time budget"):
                    manager._refresh()
            self.assertEqual(manager.database.read_bytes(), original)
            self.assertEqual(list(Path(temporary).glob("refresh-*")), [])

    def test_expired_source_request_never_opens_the_network(self):
        client = SourceClient(self.config, deadline=0)
        with patch.object(client.opener, "open") as opened:
            with self.assertRaisesRegex(SourceError, "time budget"):
                client.catalog()
        opened.assert_not_called()


if __name__ == "__main__":
    unittest.main()
