from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from consulta_cuad_masivo import kestra_entrypoint


class FakeSession:
    def __init__(self, _config: object) -> None:
        self.cantidad_de_logins = 2
        self.closed = False

    def cerrar(self) -> None:
        self.closed = True


class ConsultaCuadMasivoEntrypointTests(unittest.TestCase):
    def test_run_processes_uploaded_file_with_safe_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            input_path = base / "entrada.xlsx"
            input_path.touch()
            output_dir = base / "salida"
            source = {
                "cuiles": ["20111111112", "27222222223"],
                "cantidad_cuiles_unicos": 2,
                "cantidad_invalidos": 1,
            }
            summary = {
                "detenida": False,
                "completada": True,
                "motivo_corte": None,
                "consultadas_en_esta_corrida": 2,
                "archivo_resultados": str(output_dir / "resultados.ndjson"),
                "estado": {
                    "cantidad_ok": 1,
                    "cantidad_sin_resultado": 1,
                    "cantidad_pendientes_reintento": 0,
                },
            }
            env = {
                "CUAD_MASIVO_INPUT_FILE": str(input_path),
                "CUAD_MASIVO_OUTPUT_DIR": str(output_dir),
                "CUAD_MASIVO_LIMITE": "10",
                "CUAD_MASIVO_DEMORA_SECONDS": "12",
                "CUAD_MASIVO_PAUSA_CADA": "50",
                "CUAD_MASIVO_PAUSA_LARGA_SECONDS": "180",
                "CUAD_MASIVO_INCLUIR_MOVIMIENTOS": "false",
            }

            with (
                patch.dict(os.environ, env, clear=True),
                patch.object(kestra_entrypoint.entrada, "cargar", return_value=source),
                patch.object(kestra_entrypoint.sesion, "config_desde_entorno", return_value=object()),
                patch.object(kestra_entrypoint.sesion, "SesionCuad", FakeSession),
                patch.object(kestra_entrypoint.corrida, "procesar_reanudable", return_value=summary) as process,
                patch.object(
                    kestra_entrypoint.exportar,
                    "exportar",
                    return_value=(output_dir / "resultados_totales.xlsx", 2, 1),
                ),
            ):
                payload = kestra_entrypoint.run()

            self.assertTrue(payload["ok"])
            self.assertTrue(payload["completed"])
            self.assertEqual(payload["consulted_count"], 2)
            self.assertEqual(payload["login_count"], 2)
            self.assertEqual(process.call_args.kwargs["config"].limite, 10)
            self.assertFalse(process.call_args.kwargs["config"].config_cuad.incluir_movimientos)

    def test_run_rejects_missing_uploaded_file(self) -> None:
        with patch.dict(
            os.environ,
            {"CUAD_MASIVO_INPUT_FILE": "no-existe.xlsx"},
            clear=True,
        ):
            with self.assertRaisesRegex(ValueError, "No se encontro el Excel"):
                kestra_entrypoint.run()


if __name__ == "__main__":
    unittest.main()
