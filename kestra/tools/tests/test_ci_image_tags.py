import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import yaml

from kestra.tools.ci_image_tags import SUPPORTED_IMAGES, publication_tags


ROOT = Path(__file__).resolve().parents[3]
SHA = "a" * 40
WORKFLOWS = ROOT / ".github/workflows"
SCRIPT = ROOT / "kestra/tools/ci_image_tags.py"


def load_workflow(name):
    return yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))


class PublicationTagsTests(unittest.TestCase):
    def test_same_commit_on_dev_cannot_overwrite_any_main_tag(self):
        for image in SUPPORTED_IMAGES:
            with self.subTest(image=image):
                main = set(publication_tags(image, "refs/heads/main", SHA))
                dev = set(publication_tags(image, "refs/heads/dev", SHA))
                self.assertEqual(main, {f"{image}:latest", f"{image}:sha-{SHA}"})
                self.assertEqual(dev, {f"{image}:dev-latest", f"{image}:dev-{SHA}"})
                self.assertFalse(main & dev)

    def test_feature_refs_pr_refs_and_tags_cannot_publish(self):
        for ref in ("refs/heads/feature/test", "refs/pull/422/merge", "refs/tags/v1", ""):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                publication_tags(SUPPORTED_IMAGES[0], ref, SHA)

    def test_invalid_commit_or_image_cannot_inject_output(self):
        for image, sha in (
            (SUPPORTED_IMAGES[0], ""),
            (SUPPORTED_IMAGES[0], SHA + "\ntags=unexpected"),
            ("ghcr.io/red-unisol/another-image", SHA),
        ):
            with self.subTest(image=image, sha=sha), self.assertRaises(ValueError):
                publication_tags(image, "refs/heads/main", sha)

    def test_cli_writes_selected_tags_and_rejects_other_refs_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "github-output"
            output.write_text("existing=value\n", encoding="utf-8")
            for ref in ("refs/heads/main", "refs/heads/dev", "refs/heads/feature/test"):
                with self.subTest(ref=ref):
                    previous = output.read_text(encoding="utf-8")
                    result = subprocess.run(
                        [sys.executable, str(SCRIPT), "--image-name", SUPPORTED_IMAGES[0]],
                        env={
                            **os.environ,
                            "GITHUB_REF": ref,
                            "GITHUB_SHA": SHA,
                            "GITHUB_OUTPUT": str(output),
                        },
                        capture_output=True,
                        text=True,
                    )
                    current = output.read_text(encoding="utf-8")
                    if ref.endswith("/feature/test"):
                        self.assertNotEqual(result.returncode, 0)
                        self.assertEqual(current, previous)
                    else:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        expected = publication_tags(SUPPORTED_IMAGES[0], ref, SHA)
                        self.assertEqual(
                            current[len(previous):],
                            "tags<<IMAGE_TAGS\n" + "\n".join(expected) + "\nIMAGE_TAGS\n",
                        )


class WorkflowIsolationTests(unittest.TestCase):
    def test_publishers_use_only_the_checked_tag_output(self):
        for slug in ("arca-padron-a13", "consulta-cuad", "precalentar-cache-credixsa-v2"):
            with self.subTest(slug=slug):
                flow = load_workflow(f"publish-analisis-credito-{slug}-image.yml")
                events = flow.get("on", flow.get(True))
                self.assertEqual(set(events["push"]["branches"]), {"main", "dev"})
                self.assertIn("kestra/tools/ci_image_tags.py", events["push"]["paths"])
                job = flow["jobs"]["publish"]
                self.assertEqual(
                    job["if"],
                    "github.ref == 'refs/heads/main' || github.ref == 'refs/heads/dev'",
                )
                self.assertIn(job["env"]["IMAGE_NAME"], SUPPORTED_IMAGES)
                selection = next(step for step in job["steps"] if step.get("id") == "image_tags")
                self.assertIn("kestra/tools/ci_image_tags.py", selection["run"])
                self.assertIn('--image-name "$IMAGE_NAME"', selection["run"])
                publishers = [
                    step for step in job["steps"]
                    if step.get("uses", "").startswith("docker/build-push-action")
                ]
                self.assertEqual(len(publishers), 1)
                self.assertEqual(
                    publishers[0]["with"]["tags"], "${{ steps.image_tags.outputs.tags }}"
                )
                self.assertLess(job["steps"].index(selection), job["steps"].index(publishers[0]))

    def test_operational_metamap_is_main_only_and_preserves_its_runtime(self):
        flow = load_workflow("deploy-metamap-server-dev.yml")
        events = flow.get("on", flow.get(True))
        self.assertEqual(events["push"]["branches"], ["main"])
        job = flow["jobs"]["deploy-dev"]
        self.assertEqual(job["if"], "github.ref == 'refs/heads/main'")
        decrypt = next(step for step in job["steps"] if step.get("name") == "Decrypt runtime env")
        self.assertIn("metamap-platform-server.dev.env.enc", decrypt["run"])
        self.assertEqual(
            job["env"]["PUBLIC_HEALTHCHECK_URL"],
            "https://kestra.redunisol.com.ar/metamap-platform/health",
        )

    def test_manual_metamap_guard_rejects_dev_and_other_actors(self):
        bash = shutil.which("bash")
        if os.name == "nt":
            candidate = Path("C:/Program Files/Git/bin/bash.exe")
            if candidate.is_file():
                bash = str(candidate)
        self.assertIsNotNone(bash, "Bash is required to test the actual dispatch guard.")
        job = load_workflow("deploy-metamap-server-dev.yml")["jobs"]["deploy-dev"]
        guard = job["steps"][0]
        self.assertEqual(guard["if"], "github.event_name == 'workflow_dispatch'")
        for ref, actor, allowed in (
            ("refs/heads/main", "Nasst", True),
            ("refs/heads/main", "another-actor", False),
            ("refs/heads/dev", "Nasst", False),
            ("refs/heads/feature/test", "Nasst", False),
        ):
            with self.subTest(ref=ref, actor=actor):
                result = subprocess.run(
                    [bash, "-c", guard["run"]],
                    env={**os.environ, "GITHUB_REF": ref, "GITHUB_ACTOR": actor},
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(result.returncode == 0, allowed, result.stderr)

    def test_regression_suite_is_run_by_ci(self):
        job = load_workflow("validate.yml")["jobs"]["validate"]
        self.assertTrue(any(
            "kestra.tools.tests.test_ci_image_tags" in step.get("run", "")
            for step in job["steps"]
        ))


if __name__ == "__main__":
    unittest.main()
