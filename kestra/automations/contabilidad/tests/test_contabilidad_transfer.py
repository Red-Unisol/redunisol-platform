from __future__ import annotations

import tempfile
import unittest
from datetime import date
from decimal import Decimal
from pathlib import Path

from contabilidad_transfer.cruce_mov_emp_vimarx import (
    ApiBundle,
    Movement,
    build_report_rows,
    load_movements,
)


class ContabilidadTransferTest(unittest.TestCase):
    def test_load_movements_keeps_rows_without_cuit_or_valid_amount(self) -> None:
        content = "\n".join(
            [
                "fechaBanco;fechaBancoReal;tipoTransaccion;origenTransaccion;idOrigenTransaccion;importe;valor;nroTransaccion;cuitTercero;titularTercero",
                "2026-08-25;2026-08-25 08:00:00;D;TRANSFERENCIA;1;1000,50;-1000,50;TX-1;20-12345678-9;Persona",
                "2026-08-25;2026-08-25 08:01:00;D;LEY 25413 S/DEBITO;2;6,00;-6,00;TX-2;;Cuenta",
                "2026-08-25;2026-08-25 08:02:00;D;AJUSTE;3;sin-importe;;TX-3;;Cuenta",
            ]
        )

        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "mov_emp_431_test.txt"
            source.write_text(content, encoding="utf-8")
            movements = load_movements(Path(tmp), "mov_emp_431*.txt")

        self.assertEqual(len(movements), 3)
        self.assertEqual(movements[0].cuit_tercero, "20123456789")
        self.assertEqual(movements[1].cuit_tercero, "")
        self.assertEqual(movements[1].monto, Decimal("6.00"))
        self.assertIsNone(movements[2].monto)

    def test_movement_without_cuit_is_exported_without_vimarx_data(self) -> None:
        movement = self._movement(cuit="")

        rows = build_report_rows([movement], {}, date_window_days=120)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["nroTransaccion"], "TX-1")
        self.assertEqual(rows[0]["MatchEstado"], "sin_cuit_para_consultar")
        self.assertEqual(rows[0]["Nombre"], "")
        self.assertEqual(rows[0]["NroPrestamo"], "")

    def test_unreliable_candidate_does_not_fill_vimarx_columns(self) -> None:
        movement = self._movement(cuit="20123456789")
        bundle = ApiBundle(
            socio={
                "NombreCompleto": "Persona Vimarx",
                "NroSocio": "99",
                "NroDoc": "12345678",
                "CUIT": "20123456789",
            },
            solicitudes=[
                {
                    "Oid": "SOL-1",
                    "NroSolicitud": "10",
                    "Fecha": "2025-01-01",
                    "MontoADesembolsar": "999999",
                }
            ],
            prestamos=[],
            errors=[],
        )

        rows = build_report_rows(
            [movement], {movement.cuit_tercero: bundle}, date_window_days=120
        )

        self.assertEqual(rows[0]["MatchEstado"], "sin_match_confiable")
        self.assertEqual(rows[0]["Nombre"], "")
        self.assertEqual(rows[0]["NroSolicitud"], "")
        self.assertIsNone(rows[0]["MatchScore"])

    def test_reliable_candidate_still_fills_vimarx_columns(self) -> None:
        movement = self._movement(cuit="20123456789")
        bundle = ApiBundle(
            socio={
                "NombreCompleto": "Persona Vimarx",
                "NroSocio": "99",
                "NroDoc": "12345678",
                "CUIT": "20123456789",
            },
            solicitudes=[
                {
                    "Oid": "SOL-1",
                    "NroSolicitud": "10",
                    "Fecha": "2026-08-24",
                    "MontoADesembolsar": "1000",
                }
            ],
            prestamos=[],
            errors=[],
        )

        rows = build_report_rows(
            [movement], {movement.cuit_tercero: bundle}, date_window_days=120
        )

        self.assertEqual(rows[0]["MatchEstado"], "alto")
        self.assertEqual(rows[0]["Nombre"], "Persona Vimarx")
        self.assertEqual(rows[0]["NroSolicitud"], "10")

    @staticmethod
    def _movement(cuit: str) -> Movement:
        return Movement(
            source_file="mov_emp_431_test.txt",
            fecha_movimiento=date(2026, 8, 25),
            fecha_banco_real=None,
            tipo_transaccion="D",
            origen_transaccion="TRANSFERENCIA",
            id_origen_transaccion="1",
            monto=Decimal("1000"),
            valor_firmado=Decimal("-1000"),
            nro_transaccion="TX-1",
            cuit_tercero=cuit,
            titular_tercero="Cuenta",
        )


if __name__ == "__main__":
    unittest.main()
