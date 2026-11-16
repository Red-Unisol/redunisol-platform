"""Keep the Kestra role skeleton disabled, scoped to the dedicated host and gated, without a server."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
ROLE = ROOT / "roles/kestra"
DEFAULTS = yaml.safe_load((ROLE / "defaults/main.yml").read_text(encoding="utf-8"))
REVISION = "a" * 40


def load(relative):
    return yaml.safe_load((ROOT / relative).read_text(encoding="utf-8"))


class SafeDefaultsTests(unittest.TestCase):
    def test_every_switch_is_off_by_default(self):
        self.assertIs(DEFAULTS["kestra_apply_authorized"], False)
        self.assertIs(DEFAULTS["kestra_running"], False)
        self.assertEqual(DEFAULTS["kestra_revision"], "")

    def test_configuration_and_data_live_apart_under_the_dedicated_layout(self):
        self.assertEqual(DEFAULTS["kestra_platform_dir"], "/srv/redunisol/platform/kestra")
        self.assertEqual(DEFAULTS["kestra_data_dir"], "/srv/redunisol/state/kestra")


class TargetAndOrderTests(unittest.TestCase):
    def test_only_the_dedicated_host_belongs_to_kestra_hosts(self):
        groups = load("inventories/production/hosts.yml")["all"]["children"]
        self.assertEqual(groups["kestra_hosts"], {"hosts": {"dedicated_prod_01": {}}})
        self.assertIn("dedicated_prod_01", groups["foundation_hosts"]["hosts"])

    def test_deploy_confirms_the_host_before_running_the_role(self):
        play = load("playbooks/kestra-deploy.yml")[0]
        self.assertEqual(play["hosts"], "kestra_hosts")
        self.assertTrue(play["any_errors_fatal"])
        self.assertEqual(play["serial"], 1)
        self.assertEqual(play["roles"], [
            {"role": "preflight", "tags": ["always"]},
            {"role": "kestra", "tags": ["kestra"]},
        ])

    def test_verify_confirms_the_host_and_only_runs_the_read_only_tasks(self):
        play = load("playbooks/kestra-verify.yml")[0]
        self.assertEqual(play["hosts"], "kestra_hosts")
        self.assertNotIn("roles", play)
        first, second = play["tasks"]
        self.assertEqual(first["ansible.builtin.import_role"], {"name": "preflight"})
        self.assertEqual(first["tags"], ["always"])
        self.assertEqual(second["ansible.builtin.import_role"], {"name": "kestra", "tasks_from": "verify"})


class ExecutableGateTests(unittest.TestCase):
    """Run the real role tasks against localhost inside a throwaway Git checkout; nothing on the host changes."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.repo = Path(self.directory.name) / "repo"
        self.playbooks = self.repo / "infra/ansible/playbooks"
        self.playbooks.mkdir(parents=True)
        (self.repo / "kestra/platform/infra").mkdir(parents=True)
        (self.repo / "kestra/platform/infra/application.yaml").write_text("reviewed: true\n", encoding="utf-8")
        tasks = load("roles/kestra/tasks/main.yml")
        play = [{"name": "Check Kestra gates locally only", "hosts": "localhost", "connection": "local",
                 "gather_facts": False, "become": False, "vars": DEFAULTS, "tasks": tasks}]
        (self.playbooks / "play.yml").write_text(yaml.safe_dump(play, sort_keys=False), encoding="utf-8")
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "reviewed")
        self.head = self.git("rev-parse", "HEAD")

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True,
                              capture_output=True, text=True).stdout.strip()

    def run_tasks(self, check=False, **changes):
        path = Path(self.directory.name)
        extra = path / "extra.yml"
        extra.write_text(yaml.safe_dump(changes), encoding="utf-8")
        env = dict(os.environ, ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"), ANSIBLE_NOCOLOR="1",
                   ANSIBLE_LOCAL_TEMP=str(path / "local"), ANSIBLE_REMOTE_TEMP=str(path / "remote"))
        command = ["ansible-playbook", "-i", "localhost,", "--limit", "localhost",
                   "--extra-vars", f"@{extra}", str(self.playbooks / "play.yml")]
        if check:
            command.append("--check")
        return subprocess.run(command, env=env, capture_output=True, text=True, timeout=45)

    def assert_refused(self, result, message="Kestra changes require kestra_apply_authorized=true"):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(message, result.stdout)

    def assert_checkout_refused(self, result):
        self.assert_refused(result, "The local checkout must be exactly kestra_revision")

    def test_apply_without_authorization_is_refused(self):
        self.assert_refused(self.run_tasks(kestra_revision=self.head))

    def test_apply_without_a_full_reviewed_sha_is_refused(self):
        for revision in ("", "abc", "A" * 40, "a" * 39):
            with self.subTest(revision=revision):
                self.assert_refused(self.run_tasks(kestra_apply_authorized=True, kestra_revision=revision))

    def test_authorized_apply_of_the_exact_clean_checkout_passes_without_changes(self):
        result = self.run_tasks(kestra_apply_authorized=True, kestra_revision=self.head)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("changed=0", result.stdout)
        self.assertIn("running=false prepares Kestra files only", result.stdout)

    def test_a_valid_sha_that_is_not_the_checkout_is_refused(self):
        self.assertNotEqual(self.head, REVISION)
        self.assert_checkout_refused(self.run_tasks(kestra_apply_authorized=True, kestra_revision=REVISION))

    def test_uncommitted_changes_to_tracked_files_are_refused(self):
        (self.repo / "kestra/platform/infra/application.yaml").write_text("reviewed: false\n", encoding="utf-8")
        self.assert_checkout_refused(self.run_tasks(kestra_apply_authorized=True, kestra_revision=self.head))

    def test_untracked_files_in_the_deployed_sources_are_refused(self):
        for relative in ("infra/ansible/playbooks/extra.yml", "kestra/platform/infra/override.yaml"):
            with self.subTest(relative=relative):
                untracked = self.repo / relative
                untracked.write_text("local only\n", encoding="utf-8")
                self.assert_checkout_refused(self.run_tasks(kestra_apply_authorized=True, kestra_revision=self.head))
                untracked.unlink()

    def test_unrelated_untracked_files_do_not_block_the_apply(self):
        (self.repo / "notes.txt").write_text("personal\n", encoding="utf-8")
        result = self.run_tasks(kestra_apply_authorized=True, kestra_revision=self.head)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_check_mode_is_always_allowed_without_authorization_or_git(self):
        shutil.rmtree(self.repo / ".git")
        result = self.run_tasks(check=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("changed=0", result.stdout)


if __name__ == "__main__":
    unittest.main()
