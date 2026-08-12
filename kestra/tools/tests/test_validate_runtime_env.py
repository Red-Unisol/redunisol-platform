from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from kestra.tools.validate_runtime_env import missing_variables, runtime_value_errors


class ValidateRuntimeEnvTests(unittest.TestCase):
    def test_reports_compose_variables_missing_from_encrypted_env(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            compose = root / "compose.yml"
            env = root / "runtime.env.enc"
            compose.write_text(
                "environment:\n  PRESENT: ${PRESENT}\n  MISSING: ${MISSING}\n",
                encoding="utf-8",
            )
            env.write_text("PRESENT=encrypted-value\n", encoding="utf-8")

            self.assertEqual(missing_variables(compose, env), ["MISSING"])

    def test_allows_explicitly_documented_exceptions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            compose = root / "compose.yml"
            env = root / "runtime.env.enc"
            compose.write_text("value: ${LEGACY_OPTIONAL}\n", encoding="utf-8")
            env.write_text("", encoding="utf-8")

            self.assertEqual(
                missing_variables(compose, env, {"LEGACY_OPTIONAL"}),
                [],
            )

    def test_accepts_expected_report_credentials_and_catamarca_pool(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "runtime.env"
            env.write_text(
                "\n".join(
                    [
                        "KESTRA_ADMIN_EMAIL=admin@kestra.local",
                        "KESTRA_ADMIN_PASSWORD=admin-password",
                        "SECRET_REPORTS_KESTRA_USERNAME=YWRtaW5Aa2VzdHJhLmxvY2Fs",
                        "SECRET_REPORTS_KESTRA_PASSWORD=YWRtaW4tcGFzc3dvcmQ=",
                        "ENV_BITRIX24_DEAL_ROUND_ROBIN_USER_IDS=68579,10451,29,90231,71159,113457,113455",
                    ]
                ),
                encoding="utf-8",
            )

            self.assertEqual(runtime_value_errors(env), [])

    def test_rejects_mismatched_credentials_and_incomplete_pool(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / "runtime.env"
            env.write_text(
                "\n".join(
                    [
                        "KESTRA_ADMIN_EMAIL=admin@kestra.local",
                        "KESTRA_ADMIN_PASSWORD=admin-password",
                        "SECRET_REPORTS_KESTRA_USERNAME=b3RoZXJAdXNlci5sb2NhbA==",
                        "SECRET_REPORTS_KESTRA_PASSWORD=b3RoZXItcGFzc3dvcmQ=",
                        "ENV_BITRIX24_DEAL_ROUND_ROBIN_USER_IDS=68579,10451",
                    ]
                ),
                encoding="utf-8",
            )

            self.assertEqual(
                runtime_value_errors(env),
                [
                    "report username must match KESTRA_ADMIN_EMAIL",
                    "report password must match KESTRA_ADMIN_PASSWORD",
                    "Catamarca round-robin pool does not match the approved seller set",
                ],
            )


if __name__ == "__main__":
    unittest.main()
