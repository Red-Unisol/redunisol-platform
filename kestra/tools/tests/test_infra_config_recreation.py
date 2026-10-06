from pathlib import Path
import copy
import hashlib
import os
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[3]
INFRA = ROOT / "kestra/platform/infra"
LABEL = "io.redunisol.kestra-config-sha256"


class InfraConfigRecreationTests(unittest.TestCase):
    def setUp(self):
        self.compose = yaml.safe_load((INFRA / "docker-compose.yml").read_text())
        workflow = yaml.safe_load((ROOT / ".github/workflows/deploy-infra.yml").read_text())
        self.script = next(s["run"] for s in workflow["jobs"]["deploy-infra"]["steps"]
                           if s["name"] == "Apply infra on VPS")

    def test_only_kestra_tracks_config_content(self):
        self.assertEqual(self.compose["services"]["kestra"]["labels"][LABEL],
                         "${KESTRA_CONFIG_SHA256:-unmanaged}")
        self.assertNotIn(LABEL, self.compose["services"]["postgres"].get("labels", {}))

    def test_checksum_is_computed_before_compose_and_mounted_file_is_checked(self):
        self.assertLess(self.script.index("export KESTRA_CONFIG_SHA256="),
                        self.script.index("config -q"))
        self.assertIn('test "$loaded_config_sha" = "$KESTRA_CONFIG_SHA256"', self.script)
        self.assertGreater(self.script.index("loaded_config_sha="), self.script.index("up -d"))
        self.assertNotIn("--force-recreate", self.script)

    def test_real_shell_hash_is_stable_and_changes_with_content(self):
        git_bash = Path("C:/Program Files/Git/bin/bash.exe")
        bash = str(git_bash) if os.name == "nt" and git_bash.exists() else shutil.which("bash")
        if not bash:
            self.skipTest("bash unavailable")
        command = next(line.strip() for line in self.script.splitlines()
                       if line.strip().startswith("export KESTRA_CONFIG_SHA256="))
        with tempfile.TemporaryDirectory() as folder:
            config = Path(folder) / "application.yaml"
            env = dict(os.environ, staging_dir=Path(folder).as_posix())
            digests = []
            for content in [b"config: old\n", b"config: old\n", b"config: new\n"]:
                config.write_bytes(content)
                digest = subprocess.check_output(
                    [bash, "-c", 'set -euo pipefail\n' + command + '\nprintf "%s" "$KESTRA_CONFIG_SHA256"'],
                    env=env, text=True).strip()
                self.assertEqual(digest, hashlib.sha256(content).hexdigest())
                digests.append(digest)
            self.assertEqual(digests[0], digests[1])
            self.assertNotEqual(digests[0], digests[2])

    def test_real_compose_changes_only_kestra_when_config_digest_changes(self):
        docker = shutil.which("docker")
        if not docker:
            self.skipTest("Docker Compose CLI unavailable")
        import json
        configs = []
        for digest in ["a" * 64, "b" * 64]:
            result = subprocess.run(
                [docker, "compose", "--env-file", str(INFRA / ".env.example"),
                 "-f", str(INFRA / "docker-compose.yml"), "config", "--format", "json"],
                env=dict(os.environ, KESTRA_CONFIG_SHA256=digest),
                text=True, capture_output=True, check=True)
            configs.append(json.loads(result.stdout)["services"])
        self.assertEqual(configs[0]["postgres"], configs[1]["postgres"])
        self.assertNotEqual(configs[0]["kestra"], configs[1]["kestra"])
        first = copy.deepcopy(configs[0]["kestra"])
        second = copy.deepcopy(configs[1]["kestra"])
        first["labels"].pop(LABEL)
        second["labels"].pop(LABEL)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
