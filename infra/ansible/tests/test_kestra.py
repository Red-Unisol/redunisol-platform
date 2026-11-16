"""Keep the Kestra role disabled, scoped to the dedicated host, gated and idempotent, without a server."""
import grp
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

    def test_the_database_directory_is_private(self):
        modes = {item["path"]: item["mode"] for item in DEFAULTS["kestra_data_subdirs"]}
        self.assertEqual(modes["postgres"], "0700")
        self.assertEqual(set(modes), {"postgres", "storage", "tmp", "data", "data/credixsa-cache", "reports"})

    def test_vps_paths_used_by_flows_point_inside_the_data_directory(self):
        links = {item["path"]: item["src"] for item in DEFAULTS["kestra_compat_links"]}
        self.assertEqual(links, {
            "/opt/kestra/data": "{{ kestra_data_dir }}/data",
            "/srv/redunisol-reports": "{{ kestra_data_dir }}/reports",
        })


VPS_COMPOSE = ROOT.parents[1] / "kestra/platform/infra/docker-compose.yml"
DEDICATED_COMPOSE = ROLE / "templates/docker-compose.yml.j2"
# The only lines the dedicated copy may change, as (VPS line, dedicated line).
ALLOWED_COMPOSE_CHANGES = [
    ("- ./data/postgres:/var/lib/postgresql/data", "- {{ kestra_data_dir }}/postgres:/var/lib/postgresql/data"),
    ('- "8081:8081"', '- "{{ kestra_management_bind }}:8081:8081"'),
    ("- ./data/storage:/app/storage", "- {{ kestra_data_dir }}/storage:/app/storage"),
    ("- ./tmp:/tmp/kestra-wd", "- {{ kestra_data_dir }}/tmp:/tmp/kestra-wd"),
    ("- /srv/redunisol-reports:/reports", "- {{ kestra_data_dir }}/reports:/reports"),
]


def compose_body(path):
    lines = path.read_text(encoding="utf-8").replace("\r\n", "\n").splitlines()
    return [line for line in lines if not line.startswith("#")]


def kestra_variables(path):
    names = set()
    in_environment = False
    for line in compose_body(path):
        if line.strip() == "environment:" and line.startswith("    ") and not line.startswith("     "):
            in_environment = True
            continue
        if in_environment:
            if line.startswith("      ") and ":" in line:
                names.add(line.strip().split(":", 1)[0])
            elif line.strip() and not line.startswith("      "):
                in_environment = False
    return names


class CopyOfVpsComposeTests(unittest.TestCase):
    """While Kestra lives on both hosts, the dedicated Compose file must track the VPS one."""

    def test_dedicated_compose_declares_exactly_the_same_variables_as_the_vps(self):
        vps, dedicated = kestra_variables(VPS_COMPOSE), kestra_variables(DEDICATED_COMPOSE)
        self.assertGreater(len(vps), 100)
        self.assertEqual(sorted(vps - dedicated), [], "Variables missing in the dedicated compose")
        self.assertEqual(sorted(dedicated - vps), [], "Variables missing in the VPS compose")

    def test_dedicated_compose_only_differs_in_data_paths_and_the_management_port(self):
        restored = []
        for line in compose_body(DEDICATED_COMPOSE):
            for vps_line, dedicated_line in ALLOWED_COMPOSE_CHANGES:
                if line.strip() == dedicated_line:
                    line = line.replace(dedicated_line, vps_line)
            restored.append(line)
        self.assertEqual(restored, compose_body(VPS_COMPOSE))

    def test_each_allowed_change_is_really_applied(self):
        body = [line.strip() for line in compose_body(DEDICATED_COMPOSE)]
        for vps_line, dedicated_line in ALLOWED_COMPOSE_CHANGES:
            with self.subTest(line=vps_line):
                self.assertIn(dedicated_line, body)
                self.assertNotIn(vps_line, body)

    def test_the_management_port_is_local_only_by_default(self):
        self.assertEqual(DEFAULTS["kestra_management_bind"], "127.0.0.1")

    def test_the_copy_says_where_it_comes_from(self):
        header = DEDICATED_COMPOSE.read_text(encoding="utf-8").splitlines()[0]
        self.assertIn("kestra/platform/infra/docker-compose.yml", header)


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


class ExecutableRoleTests(unittest.TestCase):
    """Run the real role tasks against localhost, inside a throwaway Git checkout and a fake host tree."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        base = Path(self.directory.name)
        self.repo = base / "repo"
        self.playbooks = self.repo / "infra/ansible/playbooks"
        self.playbooks.mkdir(parents=True)
        (self.repo / "kestra/platform/infra").mkdir(parents=True)
        (self.repo / "kestra/platform/infra/application.yaml").write_text("reviewed: true\n", encoding="utf-8")
        for name in ("main", "verify"):
            play = [{"name": f"Run Kestra {name} tasks locally only", "hosts": "localhost", "connection": "local",
                     "gather_facts": False, "become": False,
                     "tasks": [{"ansible.builtin.import_role": {"name": "kestra", "tasks_from": name}}]}]
            (self.playbooks / f"{name}.yml").write_text(yaml.safe_dump(play, sort_keys=False), encoding="utf-8")
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-qm", "reviewed")
        self.head = self.git("rev-parse", "HEAD")

        self.host = base / "host"
        self.data = self.host / "srv/redunisol/state/kestra"
        self.platform = self.host / "srv/redunisol/platform/kestra"
        self.paths = {
            "kestra_platform_dir": str(self.platform),
            "kestra_data_dir": str(self.data),
            "kestra_owner": os.environ.get("USER") or Path.home().name,
            "kestra_group": grp.getgrgid(os.getgid()).gr_name,
            "kestra_compat_links": [
                {"path": str(self.host / "opt/kestra/data"), "src": str(self.data / "data")},
                {"path": str(self.host / "srv/redunisol-reports"), "src": str(self.data / "reports")},
            ],
        }

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True,
                              capture_output=True, text=True).stdout.strip()

    def run_tasks(self, check=False, tasks="main", **changes):
        base = Path(self.directory.name)
        extra = base / "extra.yml"
        extra.write_text(yaml.safe_dump({**self.paths, **changes}), encoding="utf-8")
        env = dict(os.environ, ANSIBLE_CONFIG=str(ROOT / "ansible.cfg"), ANSIBLE_NOCOLOR="1",
                   ANSIBLE_ROLES_PATH=str(ROOT / "roles"),
                   ANSIBLE_LOCAL_TEMP=str(base / "local"), ANSIBLE_REMOTE_TEMP=str(base / "remote"))
        command = ["ansible-playbook", "-i", "localhost,", "--limit", "localhost",
                   "--extra-vars", f"@{extra}", str(self.playbooks / f"{tasks}.yml")]
        if check:
            command.append("--check")
        return subprocess.run(command, env=env, capture_output=True, text=True, timeout=60)

    def apply(self):
        return self.run_tasks(kestra_apply_authorized=True, kestra_revision=self.head)

    def assert_ok(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def assert_refused(self, result, message="Kestra changes require kestra_apply_authorized=true"):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(message, result.stdout)
        self.assertFalse(self.host.exists())

    def assert_checkout_refused(self, result):
        self.assert_refused(result, "The local checkout must be exactly kestra_revision")

    # Gates

    def test_apply_without_authorization_is_refused(self):
        self.assert_refused(self.run_tasks(kestra_revision=self.head))

    def test_apply_without_a_full_reviewed_sha_is_refused(self):
        for revision in ("", "abc", "A" * 40, "a" * 39):
            with self.subTest(revision=revision):
                self.assert_refused(self.run_tasks(kestra_apply_authorized=True, kestra_revision=revision))

    def test_a_valid_sha_that_is_not_the_checkout_is_refused(self):
        self.assertNotEqual(self.head, REVISION)
        self.assert_checkout_refused(self.run_tasks(kestra_apply_authorized=True, kestra_revision=REVISION))

    def test_uncommitted_changes_to_tracked_files_are_refused(self):
        (self.repo / "kestra/platform/infra/application.yaml").write_text("reviewed: false\n", encoding="utf-8")
        self.assert_checkout_refused(self.apply())

    def test_untracked_files_in_the_deployed_sources_are_refused(self):
        for relative in ("infra/ansible/playbooks/extra.yml", "kestra/platform/infra/override.yaml"):
            with self.subTest(relative=relative):
                untracked = self.repo / relative
                untracked.write_text("local only\n", encoding="utf-8")
                self.assert_checkout_refused(self.apply())
                untracked.unlink()

    def test_unrelated_untracked_files_do_not_block_the_apply(self):
        (self.repo / "notes.txt").write_text("personal\n", encoding="utf-8")
        self.assert_ok(self.apply())

    def test_check_mode_is_always_allowed_without_authorization_or_git_and_creates_nothing(self):
        shutil.rmtree(self.repo / ".git")
        self.assert_ok(self.run_tasks(check=True))
        self.assertFalse(self.host.exists())

    # Directories and links

    def test_authorized_apply_creates_directories_and_links_then_changes_nothing(self):
        first = self.apply()
        self.assert_ok(first)
        self.assertNotIn("changed=0", first.stdout)
        self.assertIn("running=false prepares Kestra files only", first.stdout)
        self.assertEqual((self.platform.stat().st_mode & 0o777), 0o700)
        self.assertEqual((self.data.stat().st_mode & 0o777), 0o750)
        self.assertEqual(((self.data / "postgres").stat().st_mode & 0o777), 0o700)
        self.assertTrue((self.data / "data/credixsa-cache").is_dir())
        self.assertEqual(os.readlink(self.host / "opt/kestra/data"), str(self.data / "data"))
        self.assertEqual(os.readlink(self.host / "srv/redunisol-reports"), str(self.data / "reports"))
        second = self.apply()
        self.assert_ok(second)
        self.assertIn("changed=0", second.stdout)

    def test_apply_keeps_existing_data_inside_the_directories(self):
        self.assert_ok(self.apply())
        cache = self.data / "data/credixsa-cache/credixsa.sqlite"
        cache.write_text("existing\n", encoding="utf-8")
        cache.chmod(0o600)
        self.assert_ok(self.apply())
        self.assertEqual(cache.read_text(encoding="utf-8"), "existing\n")
        self.assertEqual(cache.stat().st_mode & 0o777, 0o600)

    def test_a_real_directory_at_a_vps_path_is_never_replaced(self):
        existing = self.host / "srv/redunisol-reports"
        existing.mkdir(parents=True)
        (existing / "report.csv").write_text("keep\n", encoding="utf-8")
        result = self.apply()
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(existing.is_dir() and not existing.is_symlink())
        self.assertEqual((existing / "report.csv").read_text(encoding="utf-8"), "keep\n")

    # Compose definition

    def test_apply_installs_the_compose_with_dedicated_paths_and_a_local_management_port(self):
        self.assert_ok(self.apply())
        installed = self.platform / "docker-compose.yml"
        compose = yaml.safe_load(installed.read_text(encoding="utf-8"))
        kestra = compose["services"]["kestra"]
        self.assertEqual(kestra["ports"], ["127.0.0.1:8080:8080", "127.0.0.1:8081:8081"])
        self.assertIn(f"{self.data}/storage:/app/storage", kestra["volumes"])
        self.assertIn(f"{self.data}/reports:/reports", kestra["volumes"])
        self.assertIn(f"{self.data}/postgres:/var/lib/postgresql/data", compose["services"]["postgres"]["volumes"])
        self.assertIn("${SECRET_CREDIX_PASS}", installed.read_text(encoding="utf-8"))
        self.assertEqual(installed.stat().st_mode & 0o777, 0o644)

    # Verification

    def test_verify_fails_before_the_apply_and_passes_after_it(self):
        before = self.run_tasks(tasks="verify")
        self.assertNotEqual(before.returncode, 0, before.stdout + before.stderr)
        self.assertIn("must be a directory", before.stdout)
        self.assert_ok(self.apply())
        after = self.run_tasks(tasks="verify")
        self.assert_ok(after)
        self.assertIn("changed=0", after.stdout)

    def test_verify_detects_a_loosened_mode_and_a_wrong_link(self):
        self.assert_ok(self.apply())
        postgres = self.data / "postgres"
        postgres.chmod(0o755)
        loose = self.run_tasks(tasks="verify")
        self.assertNotEqual(loose.returncode, 0)
        self.assertIn("postgres must be a directory", loose.stdout)
        postgres.chmod(0o700)
        link = self.host / "opt/kestra/data"
        link.unlink()
        link.symlink_to(self.host / "elsewhere")
        wrong = self.run_tasks(tasks="verify")
        self.assertNotEqual(wrong.returncode, 0)
        self.assertIn("must be a link to", wrong.stdout)

    def test_verify_detects_a_compose_edited_by_hand(self):
        self.assert_ok(self.apply())
        installed = self.platform / "docker-compose.yml"
        installed.write_text(installed.read_text(encoding="utf-8").replace("127.0.0.1:8081", "0.0.0.0:8081"),
                             encoding="utf-8")
        edited = self.run_tasks(tasks="verify")
        self.assertNotEqual(edited.returncode, 0)
        self.assertIn("differs from the reviewed template", edited.stdout)
        self.assertIn("0.0.0.0:8081", installed.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
