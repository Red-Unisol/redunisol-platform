from datetime import date
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest
import zipfile

from bcra_deudores.process import (
    ControlContext,
    CriticalProcessError,
    Loan,
    ProcessConfig,
    RawQuota,
    amount_to_miles,
    build_informacion_zip,
    build_unique_loans,
    calculate_mora,
    classify_situation,
    consolidate_by_cuit,
    filter_loans_by_linea_prestamo,
    filter_loans,
    format_situacion_bcra,
    normalizar_texto_bcra,
    parse_rows,
    prepare_tasa_result,
    process_rows,
    run,
    validate_detalle_xml,
    validate_final_artifacts,
    validate_proveedores_txt_content,
    validate_tasa_txt,
    validate_output_records,
    write_detalle_xml,
    write_deudores_excel,
    write_prestamos_unicos_report,
    write_tasa,
)


def quota(
    *,
    nro_cuenta="P1",
    linea="COMUN",
    cuit="20123456789",
    nombre="Persona Uno",
    saldo=Decimal("100000"),
    fecha=date(2026, 4, 1),
    fecha_cobro=None,
    nro_cuota=1,
    monto=Decimal("1000"),
    tna=Decimal("80"),
    linea_prestamo="",
):
    return RawQuota(
        row=1,
        nro_cuenta=nro_cuenta,
        linea_descripcion=linea,
        cuit=cuit,
        cuit_valid=True,
        nombre_completo=nombre,
        saldo_prestamo=saldo,
        fecha=fecha,
        fecha_cobro=fecha_cobro,
        nro_cuota=nro_cuota,
        monto_total=monto,
        tna=tna,
        tna_valid=tna is not None,
        linea_prestamo_descripcion=linea_prestamo,
    )


def loan(**kwargs):
    q = quota(**kwargs)
    return Loan(
        nro_cuenta=q.nro_cuenta,
        linea_descripcion=q.linea_descripcion,
        cuit=q.cuit,
        cuit_valid=q.cuit_valid,
        nombre_completo=q.nombre_completo,
        saldo_prestamo=q.saldo_prestamo,
        tna=q.tna,
        tna_valid=q.tna_valid,
        quotas=[q],
        linea_prestamo_descripcion=q.linea_prestamo_descripcion,
    )


class ProcessRulesTest(unittest.TestCase):
    def test_calculate_mora_uses_oldest_unpaid_positive_ordinary_quota(self):
        cutoff = date(2026, 4, 30)
        l = loan()
        l.quotas = [
            quota(nro_cuota=0, fecha=date(2026, 1, 1), monto=Decimal("5000")),
            quota(nro_cuota=1, fecha=date(2026, 4, 10), fecha_cobro=date(2026, 4, 20)),
            quota(nro_cuota=2, fecha=date(2026, 4, 15), fecha_cobro=None),
            quota(nro_cuota=3, fecha=date(2026, 4, 1), monto=Decimal("0")),
            quota(nro_cuota=4, fecha=date(2026, 3, 1), monto=Decimal("-10")),
        ]

        self.assertEqual(calculate_mora(l, cutoff), 15)

    def test_calculate_mora_same_day_unpaid_is_zero(self):
        cutoff = date(2026, 4, 30)
        l = loan(fecha=cutoff, fecha_cobro=None)

        self.assertEqual(calculate_mora(l, cutoff), 0)

    def test_calculate_mora_paid_after_cutoff_is_unpaid_at_cutoff(self):
        cutoff = date(2026, 4, 30)
        l = loan(fecha=date(2026, 4, 1), fecha_cobro=date(2026, 5, 1))

        self.assertEqual(calculate_mora(l, cutoff), 29)

    def test_standard_classification_thresholds(self):
        special = {"HABERES DESCUENTO POLICIA CBA"}

        self.assertEqual(classify_situation(0, "COMUN", special), "01")
        self.assertEqual(classify_situation(31, "COMUN", special), "01")
        self.assertEqual(classify_situation(32, "COMUN", special), "21")
        self.assertEqual(classify_situation(90, "COMUN", special), "21")
        self.assertEqual(classify_situation(91, "COMUN", special), "03")
        self.assertEqual(classify_situation(180, "COMUN", special), "03")
        self.assertEqual(classify_situation(181, "COMUN", special), "04")
        self.assertEqual(classify_situation(365, "COMUN", special), "04")
        self.assertEqual(classify_situation(366, "COMUN", special), "05")

    def test_special_classification_haberes_policia_threshold(self):
        special = {"HABERES DESCUENTO POLICIA CBA"}

        self.assertEqual(
            classify_situation(66, "HABERES DESCUENTO POLICIA CBA", special), "01"
        )
        self.assertEqual(
            classify_situation(67, "HABERES DESCUENTO POLICIA CBA", special), "21"
        )

    def test_consolidation_sums_by_cuit_and_uses_worst_situation(self):
        controls = ControlContext()
        cutoff = date(2026, 4, 30)
        loans = [
            loan(
                nro_cuenta="P1",
                cuit="20123456789",
                saldo=Decimal("100000"),
                fecha=date(2026, 4, 1),
            ),
            loan(
                nro_cuenta="P2",
                cuit="20123456789",
                saldo=Decimal("50000"),
                fecha=date(2025, 1, 1),
            ),
        ]

        debtors = consolidate_by_cuit(loans, cutoff, set(), controls)

        debtor = debtors["20123456789"]
        self.assertEqual(debtor.total_deuda, Decimal("150000"))
        self.assertEqual(debtor.situacion, "05")
        self.assertEqual(len(debtor.prestamos), 2)

    def test_amount_to_miles_uses_round_half_up(self):
        self.assertEqual(amount_to_miles(Decimal("1935890.14")), 1936)
        self.assertEqual(amount_to_miles(Decimal("1935500")), 1936)
        self.assertEqual(amount_to_miles(Decimal("1935499.99")), 1935)

    def test_filter_loans_excludes_configured_lines_after_api_response(self):
        included, excluded = filter_loans(
            [
                loan(nro_cuenta="P1", linea="COMUN"),
                loan(nro_cuenta="P2", linea="LINEA EXCLUIDA"),
            ],
            {"LINEA EXCLUIDA"},
        )

        self.assertEqual([l.nro_cuenta for l in included], ["P1"])
        self.assertEqual([l.nro_cuenta for l in excluded], ["P2"])

    def test_filter_linea_prestamo_excludes_only_matching_child_line(self):
        included, excluded = filter_loans_by_linea_prestamo(
            [
                loan(nro_cuenta="P1", linea="SUPERIOR", linea_prestamo="LINEA A"),
                loan(nro_cuenta="P2", linea="SUPERIOR", linea_prestamo="LINEA B"),
                loan(nro_cuenta="P3", linea="OTRO SUPERIOR", linea_prestamo="LINEA A"),
            ],
            {("SUPERIOR", "LINEA A")},
        )

        self.assertEqual([l.nro_cuenta for l in included], ["P2", "P3"])
        self.assertEqual([l.nro_cuenta for l in excluded], ["P1"])

    def test_parse_and_mora_ignore_cuota_zero_and_non_positive_amounts(self):
        rows = [
            ["P1", "COMUN", "20123456789", "Persona Uno", "100000", "2025-01-01", None, 0, "1000", "80"],
            ["P1", "COMUN", "20123456789", "Persona Uno", "100000", "2025-01-01", None, 1, "0", "80"],
            ["P1", "COMUN", "20123456789", "Persona Uno", "100000", "2025-01-01", None, 2, "-1", "80"],
            ["P1", "COMUN", "20123456789", "Persona Uno", "100000", "2026-04-30", None, 3, "100", "80"],
        ]
        controls = ControlContext()
        parsed = parse_rows(rows, controls)
        loans = build_unique_loans(parsed, controls)

        self.assertEqual(calculate_mora(loans["P1"], date(2026, 4, 30)), 0)

    def test_parse_rows_accepts_linea_prestamo_descripcion(self):
        rows = [
            [
                "P1",
                "SUPERIOR",
                "LINEA HIJA",
                "20123456789",
                "Persona Uno",
                "100000",
                "2026-04-01",
                None,
                1,
                "1000",
                "80",
            ]
        ]
        controls = ControlContext()

        parsed = parse_rows(rows, controls)

        self.assertEqual(parsed[0].linea_descripcion, "SUPERIOR")
        self.assertEqual(parsed[0].linea_prestamo_descripcion, "LINEA HIJA")
        self.assertEqual(parsed[0].cuit, "20123456789")
        self.assertEqual(parsed[0].nombre_completo, "Persona Uno")
        self.assertEqual(controls.errors, [])

    def test_prestamos_unicos_report_incluye_linea_prestamo(self):
        q = quota(linea="SUPERIOR", linea_prestamo="LINEA HIJA")
        loans = {
            "P1": Loan(
                nro_cuenta=q.nro_cuenta,
                linea_descripcion=q.linea_descripcion,
                cuit=q.cuit,
                cuit_valid=q.cuit_valid,
                nombre_completo=q.nombre_completo,
                saldo_prestamo=q.saldo_prestamo,
                tna=q.tna,
                tna_valid=q.tna_valid,
                quotas=[q],
                linea_prestamo_descripcion=q.linea_prestamo_descripcion,
            )
        }
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "prestamos_unicos.csv"

            write_prestamos_unicos_report(path, loans)

            text = path.read_text(encoding="utf-8-sig")
        self.assertIn("LineaPrestamoDescripcion", text.splitlines()[0])
        self.assertIn("LINEA HIJA", text)

    def test_normalizar_texto_bcra_limpia_caracteres_invalidos(self):
        self.assertEqual(normalizar_texto_bcra("Muñoz"), "MUNOZ")
        self.assertEqual(normalizar_texto_bcra("Créditos S.A."), "CREDITOS S.A.")
        self.assertEqual(normalizar_texto_bcra("José\tPérez\nNº 123 @"), "JOSE PEREZ N 123")

    def test_normalizar_texto_bcra_trunca_y_reporta(self):
        controls = ControlContext()

        value = normalizar_texto_bcra(
            "ABCDEFGHIJ",
            longitud_maxima=4,
            campo="Denominacion",
            controls=controls,
            cuit="20123456789",
        )

        self.assertEqual(value, "ABCD")
        self.assertEqual({issue.code for issue in controls.warnings}, {"BCRA_TEXT_TRUNCATED"})

    def test_format_situacion_bcra_para_archivo_final(self):
        self.assertEqual(format_situacion_bcra("01"), "1")
        self.assertEqual(format_situacion_bcra("21"), "21")
        self.assertEqual(format_situacion_bcra("03"), "3")
        self.assertEqual(format_situacion_bcra("04"), "4")
        self.assertEqual(format_situacion_bcra("05"), "5")

    def test_validate_proveedores_txt_detecta_caracteres_no_permitidos(self):
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "PROVEEDORES.TXT"
            path.write_bytes("11;20123456789;José\tPérez;1;100;0;0;0;0\r\n".encode("cp1252"))
            controls = ControlContext()

            self.assertFalse(validate_proveedores_txt_content(path, controls))

            codes = {issue.code for issue in controls.errors}
            self.assertIn("INVALID_PROVEEDORES_TEXT_CHARSET", codes)
            self.assertIn("INVALID_PROVEEDORES_ACCENT_OR_ENYE", codes)

    def test_output_consistency_validation_passes_for_matching_records(self):
        controls = ControlContext()
        proveedores = [["11", "20123456789", "PERSONA UNO", "1", "100", "0", "0", "0", "0"]]
        importes = [["11", "20123456789", "09", "100"]]

        validate_output_records(proveedores, importes, [], set(), controls)

        self.assertEqual(controls.errors, [])

    def test_output_validation_rejects_old_situacion_format(self):
        controls = ControlContext()
        proveedores = [["11", "20123456789", "PERSONA UNO", "01", "100", "0", "0", "0", "0"]]
        importes = [["11", "20123456789", "09", "100"]]

        validate_output_records(proveedores, importes, [], set(), controls)

        self.assertIn("INVALID_PROVEEDORES_FIELD_FORMAT", {issue.code for issue in controls.errors})

    def test_output_validation_rejects_old_situacion_sin_reclasificar(self):
        controls = ControlContext()
        proveedores = [["11", "20123456789", "PERSONA UNO", "1", "100", "0", "0", "0", "00"]]
        importes = [["11", "20123456789", "09", "100"]]

        validate_output_records(proveedores, importes, [], set(), controls)

        codes = {issue.code for issue in controls.errors}
        self.assertIn("INVALID_PROVEEDORES_FIELD_FORMAT", codes)
        self.assertIn("INVALID_FIELD_9", codes)

    def test_process_rows_generates_one_record_per_cuit_and_importes_match(self):
        rows = [
            ["P1", "COMUN", "20123456789", "Persona Uno", "100000", "2026-04-01", None, 1, "1000", "80"],
            ["P1", "COMUN", "20123456789", "Persona Uno", "100000", "2026-05-01", None, 2, "1000", "80"],
            ["P2", "COMUN", "20123456789", "Persona Uno", "50000", "2026-04-01", None, 1, "1000", "70"],
        ]
        config = ProcessConfig(fecha_corte=date(2026, 4, 30), max=200)

        result = process_rows(rows, config)

        self.assertEqual(
            result["proveedores_records"],
            [["11", "20123456789", "PERSONA UNO", "1", "150", "0", "0", "0", "0"]],
        )
        self.assertEqual(result["importes_records"], [["11", "20123456789", "09", "150"]])
        self.assertEqual(result["report"]["cantidad_prestamos_unicos"], 2)
        self.assertEqual(result["report"]["cantidad_deudores_informados"], 1)

    def test_excluir_cuit_configurado(self):
        rows = [
            ["P1", "COMUN", "23109026034", "Nombre Uno", "100000", "2026-04-01", None, 1, "1000", "80"],
            ["P2", "COMUN", "20123456789", "Persona Uno", "50000", "2026-04-01", None, 1, "1000", "70"],
        ]
        config = ProcessConfig(
            fecha_corte=date(2026, 4, 30),
            max=200,
            cuits_excluidos={"23109026034"},
        )

        result = process_rows(rows, config)

        self.assertNotIn("23109026034", {record[1] for record in result["proveedores_records"]})
        self.assertNotIn("23109026034", {record[1] for record in result["importes_records"]})
        self.assertEqual(result["report"]["cantidad_prestamos_excluidos_por_cuit"], 1)

    def test_excluir_nro_cuenta_configurada(self):
        rows = [
            ["P_BAD", None, "27355742046", "Persona Dos", "100000", "2026-04-01", None, 1, "1000", "80"],
            ["P_OK", "COMUN", "27355742046", "Persona Dos", "50000", "2026-04-01", None, 1, "1000", "70"],
        ]
        config = ProcessConfig(
            fecha_corte=date(2026, 4, 30),
            max=200,
            nro_cuentas_excluidas={"P_BAD"},
        )

        result = process_rows(rows, config)

        self.assertEqual(result["proveedores_records"][0][4], "50")
        self.assertEqual(result["report"]["cantidad_prestamos_excluidos_por_nro_cuenta"], 1)

    def test_excluir_linea_prestamo_configurada_sin_excluir_superior(self):
        rows = [
            [
                "P1",
                "SUPERIOR",
                "LINEA A",
                "20123456789",
                "Persona Uno",
                "100000",
                "2026-04-01",
                None,
                1,
                "1000",
                "80",
            ],
            [
                "P2",
                "SUPERIOR",
                "LINEA B",
                "20123456789",
                "Persona Uno",
                "50000",
                "2026-04-01",
                None,
                1,
                "1000",
                "80",
            ],
        ]
        config = ProcessConfig(
            fecha_corte=date(2026, 4, 30),
            max=200,
            lineas_prestamo_excluidas={("SUPERIOR", "LINEA A")},
        )

        result = process_rows(rows, config)

        self.assertEqual(result["proveedores_records"][0][4], "50")
        self.assertEqual(
            result["report"]["cantidad_prestamos_excluidos_por_linea_prestamo"],
            1,
        )
        self.assertEqual([loan.nro_cuenta for loan in result["included_loans"]], ["P2"])

    def test_exclusion_manual_no_genera_error_invalido(self):
        rows = [
            ["P_BAD", None, "27355742046", "Persona Dos", "100000", "2026-04-01", None, 1, "1000", "80"],
            ["P1", "COMUN", "23109026034", "Nombre Uno", "100000", "2026-04-01", None, 1, "1000", "80"],
            ["P2", "COMUN", "23109026034", "Nombre Dos", "100000", "2026-04-01", None, 1, "1000", "80"],
        ]
        config = ProcessConfig(
            fecha_corte=date(2026, 4, 30),
            max=200,
            cuits_excluidos={"23109026034"},
            nro_cuentas_excluidas={"P_BAD"},
        )

        result = process_rows(rows, config)
        codes = {issue.code for issue in result["controls"].errors + result["controls"].warnings}

        self.assertNotIn("INVALID_LOAN_FOR_OUTPUT", codes)
        self.assertNotIn("INCONSISTENT_DEBTOR_NAME", codes)

    def test_tasa_manual_sin_otorgamientos_genera_0_000_00(self):
        config = ProcessConfig(fecha_corte=date(2026, 4, 30))
        result = prepare_tasa_result(config, ControlContext())

        self.assertEqual(result.line, "0;000,00")

    def test_tasa_manual_con_otorgamientos_genera_1_tasa(self):
        config = ProcessConfig(fecha_corte=date(2026, 4, 30))
        config.tasa.otorgadas_sin_garantia_real_mes = 1
        config.tasa.tasa_promedio_manual = "123,45"
        result = prepare_tasa_result(config, ControlContext())

        self.assertEqual(result.line, "1;123,45")

    def test_tasa_formato_con_coma_decimal(self):
        config = ProcessConfig(fecha_corte=date(2026, 4, 30))
        config.tasa.otorgadas_sin_garantia_real_mes = 1
        config.tasa.tasa_promedio_manual = "123.45"

        with self.assertRaises(CriticalProcessError):
            prepare_tasa_result(config, ControlContext())

    def test_detalle_xml_normal(self):
        with TemporaryDirectory() as tmp:
            config = ProcessConfig(fecha_corte=date(2026, 4, 30))
            path = Path(tmp) / "detalle.xml"

            write_detalle_xml(path, config)
            text = path.read_text(encoding="utf-8")

            self.assertEqual(text.splitlines()[0], '<?xml version="1.0"?>')
            self.assertNotIn("encoding", text.splitlines()[0].lower())
            self.assertNotIn("cp1252", text.lower())
            self.assertIn('tipo="NORMAL"', text)
            self.assertIn('periodo="2026-04-30"', text)
            self.assertIn('ruta="/20260430/IMPORTES.TXT"', text)
            self.assertIn('ruta="/20260430/PROVEEDORES.TXT"', text)
            self.assertIn('ruta="/20260430/TASA.TXT"', text)
            self.assertIn('<ARCHIVO ruta="/20260430/IMPORTES.TXT"/>', text)
            self.assertNotIn('<ARCHIVO ruta="/20260430/IMPORTES.TXT" />', text)

    def test_detalle_xml_rectificativa(self):
        with TemporaryDirectory() as tmp:
            config = ProcessConfig(
                fecha_corte=date(2026, 4, 30),
                tipo_presentacion="RECTIFICATIVA",
            )
            path = Path(tmp) / "detalle.xml"

            write_detalle_xml(path, config)

            text = path.read_text(encoding="utf-8")
            self.assertEqual(text.splitlines()[0], '<?xml version="1.0"?>')
            self.assertNotIn("encoding", text.splitlines()[0].lower())
            self.assertNotIn("cp1252", text.lower())
            self.assertIn('tipo="RECTIFICATIVA"', text)

    def test_detalle_xml_rechaza_cp1252(self):
        with TemporaryDirectory() as tmp:
            config = ProcessConfig(fecha_corte=date(2026, 4, 30))
            path = Path(tmp) / "detalle.xml"
            path.write_text(
                "<?xml version='1.0' encoding='cp1252'?><PRESENTACION />",
                encoding="cp1252",
            )
            controls = ControlContext()

            self.assertFalse(validate_detalle_xml(path, config, controls))
            self.assertIn("INVALID_DETALLE_ENCODING", {issue.code for issue in controls.errors})

    def test_zip_contiene_detalle_en_raiz_y_txt_en_carpeta_periodo(self):
        with TemporaryDirectory() as tmp:
            output = Path(tmp)
            config = ProcessConfig(fecha_corte=date(2026, 4, 30), output_dir=output)
            write_detalle_xml(output / "detalle.xml", config)
            for name in ["PROVEEDORES.TXT", "IMPORTES.TXT", "TASA.TXT"]:
                (output / name).write_text("x", encoding="cp1252")

            zip_path = build_informacion_zip(output, fecha_corte=config.fecha_corte)

            with zipfile.ZipFile(zip_path) as archive:
                self.assertEqual(
                    archive.namelist(),
                    [
                        "detalle.xml",
                        "20260430/IMPORTES.TXT",
                        "20260430/PROVEEDORES.TXT",
                        "20260430/TASA.TXT",
                    ],
                )

    def test_zip_no_contiene_reportes_control(self):
        with TemporaryDirectory() as tmp:
            output = Path(tmp)
            config = ProcessConfig(fecha_corte=date(2026, 4, 30), output_dir=output)
            write_detalle_xml(output / "detalle.xml", config)
            for name in ["PROVEEDORES.TXT", "IMPORTES.TXT", "TASA.TXT"]:
                (output / name).write_text("x", encoding="cp1252")
            (output / "errores.csv").write_text("no", encoding="utf-8")

            zip_path = build_informacion_zip(output, fecha_corte=config.fecha_corte)

            with zipfile.ZipFile(zip_path) as archive:
                self.assertNotIn("errores.csv", archive.namelist())
                self.assertNotIn("reporte_control.json", archive.namelist())

    def test_validacion_final_detecta_archivo_faltante(self):
        with TemporaryDirectory() as tmp:
            config = ProcessConfig(
                fecha_corte=date(2026, 4, 30),
                output_dir=Path(tmp),
            )
            controls = ControlContext()

            self.assertFalse(validate_final_artifacts(config, controls))
            self.assertIn("MISSING_FINAL_ARTIFACT", {issue.code for issue in controls.errors})

    def test_no_generar_zip_si_truncamiento(self):
        rows = [
            ["P1", "COMUN", "20123456789", "Persona Uno", "100000", "2026-04-01", None, 1, "1000", "80"],
        ]
        with TemporaryDirectory() as tmp:
            output = Path(tmp) / "output"
            control = Path(tmp) / "control"
            config = ProcessConfig(
                fecha_corte=date(2026, 4, 30),
                max=1,
                output_dir=output,
                control_dir=control,
            )

            with patch("bcra_deudores.process.fetch_api", return_value=rows):
                with self.assertRaises(CriticalProcessError):
                    run(config)

            self.assertFalse((output / "informacion.zip").exists())
            self.assertTrue((control / "reporte_control.json").exists())

    def test_excel_deudores_irregulares_generado(self):
        cutoff = date(2026, 4, 30)
        loans = [
            loan(
                nro_cuenta="P1",
                linea="LINEA A",
                cuit="20123456789",
                nombre="Persona Uno",
                saldo=Decimal("100000"),
                fecha=date(2026, 4, 1),
            ),
            loan(
                nro_cuenta="P2",
                linea="LINEA B",
                cuit="20987654321",
                nombre="Persona Dos",
                saldo=Decimal("250000"),
                fecha=date(2026, 1, 1),
            ),
        ]
        debtors = consolidate_by_cuit(loans, cutoff, set(), ControlContext())

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "deudores_por_superior.xlsx"
            write_deudores_excel(path, debtors, cutoff)

            self.assertTrue(path.exists())
            with zipfile.ZipFile(path) as archive:
                self.assertIn("xl/workbook.xml", archive.namelist())
                self.assertIn("xl/worksheets/sheet2.xml", archive.namelist())
                workbook = archive.read("xl/workbook.xml").decode("utf-8")
                sheet = archive.read("xl/worksheets/sheet2.xml").decode("utf-8")
            self.assertIn("Irregulares", workbook)
            self.assertIn("20987654321", sheet)
            self.assertNotIn("20123456789", sheet)

    def test_excel_no_entra_en_informacion_zip(self):
        with TemporaryDirectory() as tmp:
            output = Path(tmp)
            config = ProcessConfig(fecha_corte=date(2026, 4, 30), output_dir=output)
            write_detalle_xml(output / "detalle.xml", config)
            for name in ["PROVEEDORES.TXT", "IMPORTES.TXT", "TASA.TXT"]:
                (output / name).write_text("x", encoding="cp1252")
            (output / "deudores_por_superior.xlsx").write_bytes(b"xlsx")

            zip_path = build_informacion_zip(output, fecha_corte=config.fecha_corte)

            with zipfile.ZipFile(zip_path) as archive:
                self.assertNotIn("deudores_por_superior.xlsx", archive.namelist())


if __name__ == "__main__":
    unittest.main()
