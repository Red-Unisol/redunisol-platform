from pathlib import Path
from tempfile import TemporaryDirectory
from contextlib import closing
import json
import sqlite3
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

from http.server import ThreadingHTTPServer

from bcra_deudores.panel import (
    RunCoordinator,
    build_config_json,
    build_manifest,
    create_handler,
    delete_presentation,
    enrich_control_error,
    ensure_linea_prestamo_campo,
    get_current_errors,
    get_lineas_prestamo_for_superior,
    get_panel_totals,
    get_superior_detail,
    ignore_error,
    init_db,
    month_to_cutoff,
    resolve_error,
    save_current_config,
    sync_lineas_prestamo_from_api,
    sync_superiores_from_csv,
    update_exclusion,
    update_linea_prestamo,
    update_superior_alias,
    validate_panel_config,
    write_run_snapshots,
    update_superior,
)


BASE_CONFIG = {
    "api_url": "https://example.invalid/api",
    "fecha_corte": "2026-04-30",
    "max": 1000000,
    "cmd": "Prestamo.SaldoPrestamo > 25000",
    "tipo": "F.Module.Cuentas.Prestamos.CuotaPrestamo",
    "campos": "Prestamo.NroCuenta",
    "headers": {"Content-Type": "application/json"},
    "timeout_seconds": 1800,
    "retries": 3,
    "backoff_seconds": 5,
    "verify_tls": True,
    "output_dir": "output",
    "control_dir": "control",
    "lineas_excluidas": [],
    "lineas_prestamo_excluidas": [],
    "cuits_excluidos": [],
    "nro_cuentas_excluidas": [],
    "lineas_situacion_01_hasta_66_dias": ["HABERES DESCUENTO POLICIA CBA"],
    "tipo_presentacion": "NORMAL",
    "regimen_codigo_xml": "2",
    "requerimiento_codigo_xml": "6",
    "generar_zip": True,
    "nombre_zip": "informacion.zip",
    "tasa": {
        "modo": "MANUAL",
        "otorgadas_sin_garantia_real_mes": 0,
        "tasa_promedio_manual": "000,00",
        "api": {
            "habilitada": False,
            "cmd": "",
            "tipo": "F.Module.Cuentas.Prestamos.CuotaPrestamo",
            "campos": "",
            "max": 1000000,
        },
        "campos": {},
        "lineas_sin_garantia_real": [],
        "lineas_con_garantia_real": [],
    },
}


def write_base_config(path: Path) -> None:
    path.write_text(json.dumps(BASE_CONFIG), encoding="utf-8")


def write_prestamos_csv(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "\n".join(
            [
                "NroCuenta;CUIT;NombreCompleto;LineaDescripcion;LineaPrestamoDescripcion;SaldoPrestamo;TNA;CantidadCuotas",
                "1;20123456789;Uno;Haberes CUAD Santa Fe;LINEA A;100;1;2",
                "2;20123456789;Uno;HABERES CUAD SANTA FE;LINEA B;100;1;2",
                "3;20123456789;Uno;HABERES DESCUENTO POLICIA CBA;CRUZ DEL EJE -premium-;100;1;2",
            ]
        ),
        encoding="utf-8-sig",
    )


class PanelDbTest(unittest.TestCase):
    def test_crea_schema_limpio(self):
        with TemporaryDirectory() as tmp:
            db = Path(tmp) / "panel.db"
            config = Path(tmp) / "config.json"
            write_base_config(config)

            init_db(db, config)

            with closing(sqlite3.connect(db)) as connection:
                tables = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    )
                }
            self.assertIn("superiores", tables)
            self.assertIn("presentaciones", tables)
            self.assertIn("settings", tables)

    def test_sync_superiores_no_duplica_y_policia_activa(self):
        with TemporaryDirectory() as tmp:
            db = Path(tmp) / "panel.db"
            config = Path(tmp) / "config.json"
            csv_path = Path(tmp) / "prestamos_unicos.csv"
            write_base_config(config)
            write_prestamos_csv(csv_path)
            init_db(db, config)

            count = sync_superiores_from_csv(db, csv_path)

            with closing(sqlite3.connect(db)) as connection:
                connection.row_factory = sqlite3.Row
                rows = connection.execute("SELECT * FROM superiores").fetchall()
                policia = connection.execute(
                    "SELECT * FROM superiores WHERE nombre_normalizado = ?",
                    ("HABERES DESCUENTO POLICIA CBA",),
                ).fetchone()
                santa_fe = connection.execute(
                    "SELECT * FROM superiores WHERE nombre_normalizado = ?",
                    ("HABERES CUAD SANTA FE",),
                ).fetchone()
            self.assertEqual(count, 2)
            self.assertEqual(len(rows), 2)
            self.assertEqual(policia["situacion_01_hasta_66"], 1)
            self.assertEqual(santa_fe["cantidad_prestamos"], 2)
            self.assertEqual(santa_fe["clasificacion_tasa"], "SIN_GARANTIA_REAL")

    def test_sync_lineas_prestamo_desde_csv(self):
        with TemporaryDirectory() as tmp:
            db = Path(tmp) / "panel.db"
            config = Path(tmp) / "config.json"
            csv_path = Path(tmp) / "prestamos_unicos.csv"
            write_base_config(config)
            write_prestamos_csv(csv_path)
            init_db(db, config)

            sync_superiores_from_csv(db, csv_path)

            with closing(sqlite3.connect(db)) as connection:
                connection.row_factory = sqlite3.Row
                superior = connection.execute(
                    "SELECT id FROM superiores WHERE nombre_normalizado = ?",
                    ("HABERES CUAD SANTA FE",),
                ).fetchone()
            lines = get_lineas_prestamo_for_superior(db, int(superior["id"]))

            self.assertEqual({line["linea_display"] for line in lines}, {"LINEA A", "LINEA B"})
            self.assertEqual(sum(line["cantidad_prestamos"] for line in lines), 2)

    def test_excluir_linea_prestamo_genera_config_especifica(self):
        with TemporaryDirectory() as tmp:
            db = Path(tmp) / "panel.db"
            config = Path(tmp) / "config.json"
            csv_path = Path(tmp) / "prestamos_unicos.csv"
            write_base_config(config)
            write_prestamos_csv(csv_path)
            init_db(db, config)
            sync_superiores_from_csv(db, csv_path)
            with closing(sqlite3.connect(db)) as connection:
                connection.row_factory = sqlite3.Row
                superior = connection.execute(
                    "SELECT id FROM superiores WHERE nombre_normalizado = ?",
                    ("HABERES CUAD SANTA FE",),
                ).fetchone()
            lines = get_lineas_prestamo_for_superior(db, int(superior["id"]))
            target = next(line for line in lines if line["linea_display"] == "LINEA A")

            update_linea_prestamo(
                db,
                {"id": target["id"], "excluir": True, "notas": "No presentar"},
            )
            generated = build_config_json(
                db,
                config,
                month="2026-04",
                output_dir=Path(tmp) / "out",
                control_dir=Path(tmp) / "ctl",
            )

            self.assertEqual(
                generated["lineas_prestamo_excluidas"],
                [{"superior": "Haberes CUAD Santa Fe", "linea": "LINEA A"}],
            )

    def test_sync_lineas_prestamo_from_api_por_superior(self):
        with TemporaryDirectory() as tmp:
            db = Path(tmp) / "panel.db"
            config = Path(tmp) / "config.json"
            csv_path = Path(tmp) / "prestamos_unicos.csv"
            write_base_config(config)
            write_prestamos_csv(csv_path)
            init_db(db, config)
            sync_superiores_from_csv(db, csv_path)
            with closing(sqlite3.connect(db)) as connection:
                connection.row_factory = sqlite3.Row
                superior = connection.execute(
                    "SELECT id FROM superiores WHERE nombre_normalizado = ?",
                    ("HABERES CUAD SANTA FE",),
                ).fetchone()
            api_rows = [
                [
                    "P1",
                    "Haberes CUAD Santa Fe",
                    "LINEA NUEVA A",
                    "20123456789",
                    "Uno",
                    "100000",
                    "2026-04-01",
                    None,
                    1,
                    "1000",
                    "80",
                ],
                [
                    "P2",
                    "Haberes CUAD Santa Fe",
                    "LINEA NUEVA B",
                    "20123456789",
                    "Uno",
                    "100000",
                    "2026-04-01",
                    None,
                    1,
                    "1000",
                    "80",
                ],
            ]

            with patch("bcra_deudores.process.fetch_api_payload", return_value=api_rows):
                result = sync_lineas_prestamo_from_api(db, config, int(superior["id"]))

            self.assertEqual(result["lineas_detectadas"], 2)
            self.assertIn(
                "LINEA NUEVA A",
                {line["linea_display"] for line in result["lineas"]},
            )

    def test_ensure_linea_prestamo_campo_inserta_despues_de_superior(self):
        campos = (
            "Prestamo.NroCuenta;"
            "Prestamo.LineaPrestamo.Superior.Descripcion;"
            "Prestamo.SocioTitular.Socio.CUIT"
        )

        updated = ensure_linea_prestamo_campo(campos)

        self.assertEqual(
            updated,
            (
                "Prestamo.NroCuenta;"
                "Prestamo.LineaPrestamo.Superior.Descripcion;"
                "Prestamo.LineaPrestamo.Descripcion;"
                "Prestamo.SocioTitular.Socio.CUIT"
            ),
        )

    def test_panel_totals_suma_creditos_por_superior(self):
        with TemporaryDirectory() as tmp:
            db = Path(tmp) / "panel.db"
            config = Path(tmp) / "config.json"
            csv_path = Path(tmp) / "prestamos_unicos.csv"
            write_base_config(config)
            csv_path.write_text(
                "\n".join(
                    [
                        "NroCuenta;CUIT;NombreCompleto;LineaDescripcion;LineaPrestamoDescripcion;SaldoPrestamo;TNA;CantidadCuotas",
                        "1;20123456789;Uno;LINEA A;SUBLINEA 1;100;1;2",
                        "2;20123456789;Uno;LINEA A;SUBLINEA 2;100;1;2",
                        "3;20987654321;Dos;LINEA B;SUBLINEA 3;100;1;2",
                    ]
                ),
                encoding="utf-8-sig",
            )
            init_db(db, config)
            sync_superiores_from_csv(db, csv_path)

            totals = get_panel_totals(db)

            self.assertEqual(totals["superiores_total"], 3)
            self.assertEqual(totals["creditos_por_superiores"], 3)

    def test_build_config_desde_db(self):
        with TemporaryDirectory() as tmp:
            db = Path(tmp) / "panel.db"
            config = Path(tmp) / "config.json"
            csv_path = Path(tmp) / "prestamos_unicos.csv"
            write_base_config(config)
            write_prestamos_csv(csv_path)
            init_db(db, config)
            sync_superiores_from_csv(db, csv_path)
            update_superior(
                db,
                {
                    "nombre_normalizado": "HABERES CUAD SANTA FE",
                    "nombre_display": "Haberes CUAD Santa Fe",
                    "excluir": True,
                    "situacion_01_hasta_66": False,
                    "tasa_sin_garantia_real": True,
                    "tasa_con_garantia_real": False,
                    "activo": True,
                    "notas": "",
                },
            )
            update_exclusion(
                db,
                {
                    "tipo": "cuit",
                    "valor": "20-12345678-9",
                    "motivo": "test",
                    "activo": True,
                },
            )
            update_exclusion(
                db,
                {
                    "tipo": "nro_cuenta",
                    "valor": "1500825",
                    "motivo": "test",
                    "activo": True,
                },
            )

            generated = build_config_json(
                db,
                config,
                month="2026-04",
                output_dir=Path(tmp) / "out",
                control_dir=Path(tmp) / "ctl",
                tipo_presentacion="RECTIFICATIVA",
                tasa_otorgadas=1,
                tasa_manual="123,45",
            )

            self.assertEqual(month_to_cutoff("2026-04"), "2026-04-30")
            self.assertEqual(generated["fecha_corte"], "2026-04-30")
            self.assertEqual(generated["tipo_presentacion"], "RECTIFICATIVA")
            self.assertIn("Haberes CUAD Santa Fe", generated["lineas_excluidas"])
            self.assertIn(
                "HABERES DESCUENTO POLICIA CBA",
                generated["lineas_situacion_01_hasta_66_dias"],
            )
            self.assertEqual(generated["cuits_excluidos"], ["20123456789"])
            self.assertEqual(generated["nro_cuentas_excluidas"], ["1500825"])
            self.assertEqual(generated["tasa"]["tasa_promedio_manual"], "123,45")
            self.assertIn("Haberes CUAD Santa Fe", generated["tasa"]["lineas_sin_garantia_real"])

    def test_ignore_error_oculta_error_actual(self):
        with TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            db = workspace / "panel.db"
            config = workspace / "config.json"
            control = workspace / "control"
            write_base_config(config)
            init_db(db, config)
            control.mkdir()
            (control / "reporte_control.json").write_text(
                json.dumps(
                    {
                        "errores": [
                            {
                                "code": "INVALID_DATE",
                                "message": "Fecha vacío",
                                "row": 1,
                                "nro_cuenta": "991709",
                                "cuit": "20233782417",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            before = get_current_errors(db, workspace)
            ignore_error(db, before["visibles"][0] | {"motivo": "Revisado"})
            after = get_current_errors(db, workspace)

            self.assertEqual(len(before["visibles"]), 1)
            self.assertEqual(len(after["visibles"]), 0)
            self.assertEqual(len(after["ignorados"]), 1)

    def test_save_current_config_escribe_archivo(self):
        with TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            db = workspace / "panel.db"
            config = workspace / "config.json"
            write_base_config(config)
            init_db(db, config)

            result = save_current_config(
                db,
                config,
                workspace,
                {
                    "mes": "2026-04",
                    "tipo_presentacion": "NORMAL",
                    "tasa_promedio_manual": "000,00",
                },
            )

            saved_path = Path(result["path"])
            self.assertTrue(saved_path.exists())
            self.assertEqual(result["config"]["fecha_corte"], "2026-04-30")

    def test_prevalidacion_mes_requerido(self):
        with TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            db = workspace / "panel.db"
            config = workspace / "config.json"
            write_base_config(config)
            init_db(db, config)

            result = validate_panel_config(db, config, workspace, {"mes": ""})

            self.assertFalse(result["ejecutable"])
            self.assertEqual(result["errores"][0]["code"], "MES_REQUERIDO")

    def test_prevalidacion_tasa_manual_invalida(self):
        with TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            db = workspace / "panel.db"
            config = workspace / "config.json"
            write_base_config(config)
            init_db(db, config)

            result = validate_panel_config(
                db,
                config,
                workspace,
                {
                    "mes": "2026-04",
                    "tasa_otorgadas_sin_garantia_real_mes": 1,
                    "tasa_promedio_manual": "123.45",
                },
            )

            self.assertFalse(result["ejecutable"])
            self.assertIn(
                "TASA_MANUAL_INVALIDA",
                {error["code"] for error in result["errores"]},
            )

    def test_prevalidacion_habilita_ejecucion_sin_errores(self):
        with TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            db = workspace / "panel.db"
            config = workspace / "config.json"
            write_base_config(config)
            init_db(db, config)

            result = validate_panel_config(
                db,
                config,
                workspace,
                {
                    "mes": "2026-04",
                    "tipo_presentacion": "NORMAL",
                    "tasa_otorgadas_sin_garantia_real_mes": 0,
                    "tasa_promedio_manual": "000,00",
                },
            )

            self.assertTrue(result["ejecutable"])
            self.assertEqual(result["resumen"]["fecha_corte"], "2026-04-30")

    def test_snapshot_y_manifest_presentacion(self):
        with TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            db = workspace / "panel.db"
            config_path = workspace / "config.json"
            run_root = workspace / "runs" / "2026-04" / "x"
            write_base_config(config_path)
            init_db(db, config_path)
            prevalidation = validate_panel_config(
                db,
                config_path,
                workspace,
                {"mes": "2026-04"},
            )
            config_json = build_config_json(
                db,
                config_path,
                month="2026-04",
                output_dir=run_root / "output",
                control_dir=run_root / "control",
            )
            run_root.mkdir(parents=True)

            paths = write_run_snapshots(db, run_root, 7, config_json, prevalidation)
            manifest = build_manifest(
                run_id=7,
                config_json=config_json,
                run_root=run_root,
                estado="success",
                report={"cantidad_deudores_informados": 2, "total_proveedores_miles": 10},
                errors=[],
                warnings=[],
            )

            self.assertTrue(paths["config"].exists())
            self.assertTrue((run_root / "snapshot_superiores.csv").exists())
            self.assertTrue((run_root / "snapshot_lineas_prestamo.csv").exists())
            self.assertTrue((run_root / "snapshot_exclusiones_cuit.csv").exists())
            self.assertTrue((run_root / "snapshot_exclusiones_nro_cuenta.csv").exists())
            self.assertEqual(manifest["run_id"], 7)
            self.assertEqual(manifest["archivos_esperados_zip"][0], "detalle.xml")

    def test_superior_alias_no_modifica_nombre_api(self):
        with TemporaryDirectory() as tmp:
            db = Path(tmp) / "panel.db"
            config = Path(tmp) / "config.json"
            csv_path = Path(tmp) / "prestamos_unicos.csv"
            write_base_config(config)
            write_prestamos_csv(csv_path)
            init_db(db, config)
            sync_superiores_from_csv(db, csv_path)
            detail = get_superior_detail(db, 1)
            original = detail["nombre_api_original"]

            updated = update_superior_alias(db, detail["id"], "Alias operativo")

            self.assertEqual(updated["nombre_api_original"], original)
            self.assertEqual(updated["alias_usuario"], "Alias operativo")

    def test_error_invalid_loan_sugiere_excluir_nro_cuenta(self):
        issue = enrich_control_error(
            {"code": "INVALID_LOAN_FOR_OUTPUT", "nro_cuenta": "1500825"}
        )

        self.assertIn("EXCLUIR_NRO_CUENTA", issue["acciones_disponibles"])

    def test_error_resolution_guarda_motivo(self):
        with TemporaryDirectory() as tmp:
            db = Path(tmp) / "panel.db"
            config = Path(tmp) / "config.json"
            write_base_config(config)
            init_db(db, config)

            resolution = resolve_error(
                db,
                {
                    "run_id": 1,
                    "tipo_error": "INVALID_LOAN_FOR_OUTPUT",
                    "nro_cuenta": "1500825",
                    "accion": "EXCLUIR_NRO_CUENTA",
                    "motivo": "Dato incompleto en base",
                },
            )

            self.assertEqual(resolution["motivo"], "Dato incompleto en base")
            with closing(sqlite3.connect(db)) as connection:
                row = connection.execute(
                    "SELECT motivo FROM exclusiones_nro_cuenta WHERE nro_cuenta = '1500825'"
                ).fetchone()
            self.assertEqual(row[0], "Dato incompleto en base")


class PanelApiTest(unittest.TestCase):
    def test_post_runs_rechaza_si_hay_corrida_activa(self):
        with TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            db = workspace / "panel.db"
            config = workspace / "config.json"
            write_base_config(config)
            init_db(db, config)
            coordinator = RunCoordinator()
            coordinator.reserve(999)
            handler = create_handler(
                db_path=db,
                base_config_path=config,
                workspace=workspace,
                coordinator=coordinator,
            )
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            url = f"http://127.0.0.1:{server.server_address[1]}/api/runs"
            request = urllib.request.Request(
                url,
                data=json.dumps({"mes": "2026-04"}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            try:
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    urllib.request.urlopen(request, timeout=5)
                self.assertEqual(ctx.exception.code, 409)
                ctx.exception.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_files_solo_permite_archivos_de_corrida(self):
        with TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            db = workspace / "panel.db"
            config = workspace / "config.json"
            write_base_config(config)
            init_db(db, config)
            output_dir = workspace / "runs" / "2026-04" / "x" / "output"
            control_dir = workspace / "runs" / "2026-04" / "x" / "control"
            output_dir.mkdir(parents=True)
            control_dir.mkdir(parents=True)
            (output_dir / "informacion.zip").write_bytes(b"zip")
            (control_dir / "deudores_por_superior.xlsx").write_bytes(b"xlsx")
            config_path = workspace / "runs" / "2026-04" / "x" / "config.json"
            config_path.write_text("{}", encoding="utf-8")
            with closing(sqlite3.connect(db)) as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO presentaciones (
                      mes, fecha_corte, tipo_presentacion, tasa_modo, tasa_manual,
                      estado, output_dir, control_dir, config_path, zip_path, started_at
                    ) VALUES (
                      '2026-04', '2026-04-30', 'NORMAL', 'MANUAL', '000,00',
                      'success', ?, ?, ?, ?, 'now'
                    )
                    """,
                    (
                        str(output_dir),
                        str(control_dir),
                        str(config_path),
                        str(output_dir / "informacion.zip"),
                    ),
                )
                run_id = cursor.lastrowid
                connection.commit()
            handler = create_handler(db_path=db, base_config_path=config, workspace=workspace)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{server.server_address[1]}"

            try:
                ok = urllib.request.urlopen(
                    f"{base}/files/{run_id}/informacion.zip", timeout=5
                ).read()
                self.assertEqual(ok, b"zip")
                config_body = urllib.request.urlopen(
                    f"{base}/files/{run_id}/config.json", timeout=5
                ).read()
                self.assertEqual(config_body, b"{}")
                excel_body = urllib.request.urlopen(
                    f"{base}/files/{run_id}/deudores_por_superior.xlsx", timeout=5
                ).read()
                self.assertEqual(excel_body, b"xlsx")
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    urllib.request.urlopen(f"{base}/files/{run_id}/README.md", timeout=5)
                self.assertEqual(ctx.exception.code, 403)
                ctx.exception.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_delete_presentation_borra_historial_y_carpeta_run(self):
        with TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            db = workspace / "panel.db"
            config = workspace / "config.json"
            write_base_config(config)
            init_db(db, config)
            run_root = workspace / "runs" / "2026-04" / "x"
            output_dir = run_root / "output"
            control_dir = run_root / "control"
            output_dir.mkdir(parents=True)
            control_dir.mkdir(parents=True)
            (output_dir / "informacion.zip").write_bytes(b"zip")
            with closing(sqlite3.connect(db)) as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO presentaciones (
                      mes, fecha_corte, tipo_presentacion, tasa_modo, tasa_manual,
                      estado, output_dir, control_dir, config_path, zip_path, started_at
                    ) VALUES (
                      '2026-04', '2026-04-30', 'NORMAL', 'MANUAL', '000,00',
                      'error', ?, ?, ?, ?, 'now'
                    )
                    """,
                    (
                        str(output_dir),
                        str(control_dir),
                        str(run_root / "config_aplicada.json"),
                        str(output_dir / "informacion.zip"),
                    ),
                )
                run_id = cursor.lastrowid
                connection.commit()

            result = delete_presentation(db, run_id, workspace=workspace)

            self.assertTrue(result["deleted"])
            self.assertTrue(result["deleted_files"])
            self.assertFalse(run_root.exists())
            with closing(sqlite3.connect(db)) as connection:
                count = connection.execute(
                    "SELECT COUNT(*) FROM presentaciones WHERE id = ?",
                    (run_id,),
                ).fetchone()[0]
            self.assertEqual(count, 0)

    def test_delete_presentation_rechaza_corrida_running(self):
        with TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            db = workspace / "panel.db"
            config = workspace / "config.json"
            write_base_config(config)
            init_db(db, config)
            run_root = workspace / "runs" / "2026-04" / "x"
            output_dir = run_root / "output"
            control_dir = run_root / "control"
            output_dir.mkdir(parents=True)
            control_dir.mkdir(parents=True)
            with closing(sqlite3.connect(db)) as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO presentaciones (
                      mes, fecha_corte, tipo_presentacion, tasa_modo, tasa_manual,
                      estado, output_dir, control_dir, config_path, zip_path, started_at
                    ) VALUES (
                      '2026-04', '2026-04-30', 'NORMAL', 'MANUAL', '000,00',
                      'running', ?, ?, ?, ?, 'now'
                    )
                    """,
                    (
                        str(output_dir),
                        str(control_dir),
                        str(run_root / "config_aplicada.json"),
                        str(output_dir / "informacion.zip"),
                    ),
                )
                run_id = cursor.lastrowid
                connection.commit()

            with self.assertRaises(RuntimeError):
                delete_presentation(db, run_id, workspace=workspace)
            self.assertTrue(run_root.exists())

    def test_delete_run_endpoint(self):
        with TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            db = workspace / "panel.db"
            config = workspace / "config.json"
            write_base_config(config)
            init_db(db, config)
            run_root = workspace / "runs" / "2026-04" / "x"
            output_dir = run_root / "output"
            control_dir = run_root / "control"
            output_dir.mkdir(parents=True)
            control_dir.mkdir(parents=True)
            with closing(sqlite3.connect(db)) as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO presentaciones (
                      mes, fecha_corte, tipo_presentacion, tasa_modo, tasa_manual,
                      estado, output_dir, control_dir, config_path, zip_path, started_at
                    ) VALUES (
                      '2026-04', '2026-04-30', 'NORMAL', 'MANUAL', '000,00',
                      'error', ?, ?, ?, ?, 'now'
                    )
                    """,
                    (
                        str(output_dir),
                        str(control_dir),
                        str(run_root / "config_aplicada.json"),
                        str(output_dir / "informacion.zip"),
                    ),
                )
                run_id = cursor.lastrowid
                connection.commit()
            handler = create_handler(db_path=db, base_config_path=config, workspace=workspace)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{server.server_address[1]}"

            try:
                request = urllib.request.Request(
                    f"{base}/api/runs/{run_id}",
                    method="DELETE",
                )
                payload = json.loads(urllib.request.urlopen(request, timeout=5).read())
                self.assertTrue(payload["deleted"])
                runs = json.loads(urllib.request.urlopen(f"{base}/api/runs", timeout=5).read())
                self.assertEqual(runs, [])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
