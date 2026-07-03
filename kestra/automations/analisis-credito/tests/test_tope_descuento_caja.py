from __future__ import annotations

from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

FILES_ROOT = Path(__file__).resolve().parent.parent / "files"
if str(FILES_ROOT) not in sys.path:
    sys.path.insert(0, str(FILES_ROOT))

if "Crypto" not in sys.modules:
    crypto_module = types.ModuleType("Crypto")
    cipher_module = types.ModuleType("Crypto.Cipher")

    class DummyAES:
        MODE_CBC = 1

        @staticmethod
        def new(*args, **kwargs):  # pragma: no cover - not used in tests
            raise NotImplementedError

    cipher_module.AES = DummyAES
    crypto_module.Cipher = cipher_module
    sys.modules["Crypto"] = crypto_module
    sys.modules["Crypto.Cipher"] = cipher_module

from tope_descuento_caja import kestra_webhook_entrypoint as entrypoint  # noqa: E402


class TopeDescuentoCajaTests(unittest.TestCase):
    def test_flow_uses_inputs_when_trigger_body_is_not_available(self) -> None:
        flow_source = (
            Path(__file__).resolve().parent.parent
            / "flows"
            / "tope_descuento_caja.yaml"
        ).read_text(encoding="utf-8")

        self.assertIn("trigger is defined and trigger.body is defined", flow_source)
        self.assertIn("{'cuil': inputs.cuil ?? ''} | json", flow_source)

    def test_entrypoint_returns_success_for_invalid_request(self) -> None:
        with (
            patch.object(
                entrypoint,
                "_load_trigger_body",
                side_effect=entrypoint.InvalidRequestError("cuil requerido"),
            ),
            patch.object(entrypoint, "_emit_outputs_if_available") as emit_outputs,
            patch.object(entrypoint, "_log_event"),
            patch("sys.stdout.write"),
        ):
            exit_code = entrypoint.main()

        self.assertEqual(exit_code, 0)
        self.assertEqual(emit_outputs.call_args.args[1], "invalid_request")

    def test_entrypoint_returns_failed_for_technical_error(self) -> None:
        with (
            patch.object(entrypoint, "_load_trigger_body", return_value={"cuil": "20-12345678-3"}),
            patch.object(
                entrypoint,
                "login_cidi",
                side_effect=TimeoutError("CIDI timeout."),
            ),
            patch.object(entrypoint, "_emit_outputs_if_available") as emit_outputs,
            patch.object(entrypoint, "_log_event"),
            patch("sys.stdout.write"),
        ):
            exit_code = entrypoint.main()

        self.assertEqual(exit_code, 1)
        self.assertEqual(emit_outputs.call_args.args[1], "technical_error")


if __name__ == "__main__":
    unittest.main()
