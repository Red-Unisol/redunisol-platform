import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import yaml

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "infra/ansible/roles/kestra_crm_watchdog/files"))
sys.path.insert(0, str(ROOT / "kestra/platform/system/files/alerta_barrido"))
import watchdog as w


class Kestra:
    def __init__(self):
        self.time = 200_000
        self.healthy = set(w.CALENDARIOS_CRM)
        self.healthy.remove(w.PREFILL)
        self.eid = "prefill-a"
        self.return_id = self.eid
        self.kills = []
        self.problem = None
        self.duplicate = self.disabled = self.race = False
        self.reads = 0
        self.status = "RUNNING"
        self.later = False
        self.policy = "NONE"
        self.schedule_type = w.SCHEDULE
        self.schedule_result = "SUCCESS"
        self.definition = yaml.safe_load((ROOT / "kestra/automations/marketing-crm/flows/bitrix24_lead_prefill.yaml").read_text(encoding="utf-8"))
        self.definition.update(namespace=w.CRM, disabled=False, deleted=False, revision=10)
        task = self.definition["tasks"][0]
        task["env"] = json.dumps(task["env"])
        selector = self.definition["tasks"][1]
        for field in ("commands", "env"):
            selector[field] = json.dumps(selector[field])
        self.start = self.time
        self.post_at = None

    def __call__(self, method, path):
        parts = urlsplit(path)
        flow = parse_qs(parts.query).get("filters[flowId][EQUALS]", [w.PREFILL])[0]
        schedule = w.CALENDARIOS_CRM[flow]
        if parts.path.endswith("/triggers/search"):
            state = dict(namespace=w.CRM, flowId=flow, triggerId=schedule, executionId=self.eid,
                         locked=True, disabled=self.disabled)
            row = {"state": state, "trigger": dict(id=schedule, type=w.SCHEDULE, recoverMissedSchedules=self.policy)}
            rows = [row, row] if self.duplicate else [row]
        elif parts.path.endswith("/executions/search"):
            rows = []
            if flow in self.healthy:
                start = self.post_at if self.post_at is not None and flow == w.PREFILL else self.time-1
                rows = [{"namespace": w.CRM, "flowId": flow, "trigger": {"id": schedule, "type": self.schedule_type},
                         "state": {"current": self.schedule_result, "startDate": w.utc(start).isoformat()}}]
        elif parts.path.endswith("/actions/kill"):
            assert method == "DELETE"
            assert path.endswith(self.eid + "/actions/kill?isOnKillCascade=false")
            self.kills.append(self.eid)
            if self.problem:
                raise self.problem
            return None
        elif "/executions/" in parts.path:
            runs = [{"taskId": "hay_pendientes", "state": {
                "current": "SUCCESS", "endDate": w.utc(self.start+1).isoformat()}}]
            self.reads += 1
            if self.later or (self.race and self.reads >= 2):
                runs.append({"taskId": "procesar_lote", "state": {"current": "RUNNING"}})
            return {"namespace": w.CRM, "flowId": w.PREFILL, "flowRevision": 10, "id": self.return_id,
                    "trigger": {"id": schedule, "type": w.SCHEDULE}, "taskRunList": runs,
                    "state": {"current": self.status, "startDate": w.utc(self.start).isoformat()}}
        elif "/flows/" in parts.path:
            return copy.deepcopy(self.definition)
        else:
            raise AssertionError(path)
        return {"total": len(rows), "results": rows}


class WatchdogTests(unittest.TestCase):
    def setUp(self):
        self.api = Kestra()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name)/"state.db"
        self.db = w.open_state(self.path)
        self.addCleanup(lambda: self.db.close())
        self.step()

    def step(self, seconds=0, mode="recover"):
        self.api.time += seconds
        return w.tick(self.api, self.db, mode, self.api.time)

    def arm(self):
        self.step(w.MIN_STALL+2)
        self.step(120)

    def test_recover_and_require_new_native_start(self):
        self.arm()
        self.assertFalse(self.api.kills)
        self.assertEqual(self.step(120)["recovery"], "acknowledged")
        at = self.api.time
        self.api.status = "KILLED"
        self.api.healthy.add(w.PREFILL)
        self.api.post_at = at-1
        self.assertEqual(self.step(120)["recovery"], "unverified")
        self.api.schedule_type = "manual"
        self.api.post_at = at+1
        self.assertEqual(self.step(120)["recovery"], "unverified")
        self.api.schedule_type = w.SCHEDULE
        self.api.schedule_result = "RUNNING"
        self.assertEqual(self.step(120)["recovery"], "unverified")
        self.api.schedule_result = "SUCCESS"
        self.assertEqual(self.step(120)["recovery"], "verified")
        self.assertEqual(self.api.kills, [self.api.eid])

    def test_timeout_and_restart_never_resubmit(self):
        self.arm()
        self.api.problem = TimeoutError()
        self.assertEqual(self.step(120)["recovery"], "unknown")
        self.db.close()
        self.db = w.open_state(self.path)
        self.assertEqual(self.step(w.COOLDOWN + 1)["recovery"], "unverified")
        self.step(241)
        self.assertEqual(self.api.kills, [self.api.eid])

    def test_old_and_observe_modes_never_mutate(self):
        self.step(10, "observe")
        self.step(2000, "observe")
        self.step(241, "observe")
        self.step(10, "recover")
        self.step(241, "recover")
        self.assertFalse(self.api.kills)

    def test_no_action_on_inconclusive_observations(self):
        for field, value in (("later", True), ("status","KILLING"), ("return_id","different"),
                             ("status","SUCCESS"), ("policy","ALL"), ("disabled",True),
                             ("healthy",set())):
            with self.subTest(field=field):
                before = getattr(self.api, field)
                setattr(self.api, field, value)
                self.step(2000)
                self.step(241)
                self.assertFalse(self.api.kills)
                setattr(self.api, field, before)

    def test_stopped_reactivation_cannot_recover_an_older_execution(self):
        self.arm()
        later_activation = self.api.time
        self.api.time += 120
        w.tick(self.api, self.db, "recover", self.api.time, activation_floor=later_activation)
        self.assertFalse(self.api.kills)

    def test_revision_or_prefilter_drift_and_queued_work(self):
        for field, value in (("revision", 11), ("concurrency", {"limit":1, "behavior":"QUEUE"})):
            existing = self.api.definition[field]
            self.api.definition[field] = value
            self.step(2000)
            self.step(241)
            self.assertFalse(self.api.kills)
            self.api.definition[field] = existing
        self.api.definition["tasks"][0]["script"] += "\npass"
        self.step(2000)
        self.step(241)
        self.assertFalse(self.api.kills)

    def test_read_again_before_sending(self):
        self.arm()
        self.api.reads = 0
        self.api.race = True
        self.assertEqual(self.step(120)["prefill_probe"], "changed_on_recheck")
        self.assertFalse(self.api.kills)

    def test_legacy_selector_or_ungated_child_fails_closed(self):
        selector = self.api.definition["tasks"][1]
        previous = selector["commands"]
        selector["commands"] = '["python -m old_selector"]'
        self.step(2000)
        self.step(241)
        self.assertFalse(self.api.kills)
        selector["commands"] = previous
        self.api.definition["tasks"][2]["tasks"][0].pop("runIf")
        self.step(2000)
        self.step(241)
        self.assertFalse(self.api.kills)

    def test_duplicate_trigger_does_not_authorize(self):
        self.arm()
        self.api.duplicate = True
        self.assertEqual(self.step(120)[w.PREFILL], "read_error")
        self.assertFalse(self.api.kills)

    def test_long_or_negative_gap_forgets_confirmation(self):
        self.arm()
        self.step(w.MAX_PROBE_GAP+1)
        self.step(-1)
        self.step(120)
        self.assertFalse(self.api.kills)

    def test_global_cooldown_applies_across_ids(self):
        self.arm()
        self.step(120)
        self.api.status = "KILLED"
        self.api.healthy.add(w.PREFILL)
        self.step(120)
        self.api.healthy.remove(w.PREFILL)
        self.api.eid = self.api.return_id = "prefill-b"
        self.api.status = "RUNNING"
        self.api.start = self.api.time
        self.arm()
        self.assertEqual(self.step(120)["prefill_probe"], "recovery_fenced")
        self.assertEqual(self.api.kills, ["prefill-a"])


if __name__ == "__main__":
    unittest.main()
