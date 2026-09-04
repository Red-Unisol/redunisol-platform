"""Tests del CLI.

No abren navegador ni tocan CUAD: se reemplaza SesionCuad por un doble y se
verifica lo que el CLI decide antes y despues de correr, que es donde se
equivoca un programa de linea de comandos.
"""

import contextlib
import io
import json
import logging
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from openpyxl import Workbook

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from consulta_cuad import __main__ as cli  # noqa: E402
from consulta_cuad import corrida  # noqa: E402

CUIL_A = "20111111112"
CUIL_B = "27222222223"

ENTORNO = {
    "CUAD_USUARIO": "u",
    "CUAD_PASSWORD": "p",
    "MISTRAL_API_KEY": "k",
}


def main_silencioso(argv):
    """main() sin imprimir: el CLI escribe a stdout y ensucia los tests."""
    with contextlib.redirect_stdout(io.StringIO()):
        with contextlib.redirect_stderr(io.StringIO()):
            return cli.main(argv)


def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


class SesionFalsa:
    def __init__(self, config, **kwargs):
        self.config = config
        self.cantidad_de_logins = 0
        self.intentos_ultimo_login = 1

    def cookie(self):
        self.cantidad_de_logins = max(self.cantidad_de_logins, 1)
        return "usuario_CUAD=x; ASPSESSIONID=y"

    def renovar(self):
        self.cantidad_de_logins += 1
        return self.cookie()


class _ConDirectorio(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.consultados = []

    def excel(self, cuiles, nombre="MEDICOS -A-.xlsx"):
        libro = Workbook()
        hoja = libro.active
        hoja.append(["Nombre", "CUIL"])
        for cuil in cuiles:
            hoja.append(["x", cuil])
        ruta = self.base / nombre
        libro.save(ruta)
        return ruta

    def correr(self, argv, respuesta="ok"):
        """Corre el CLI con la sesion y las consultas simuladas."""
        original = corrida.procesar_reanudable

        def procesar(cuiles, sesion_obj, rutas, config=None, consultar=None, dormir=None):
            def consultar_falso(cuil, cookie):
                self.consultados.append(cuil)
                return {
                    "cuil": cuil,
                    "status": respuesta,
                    "ok": respuesta == "ok",
                    "emr_nombre": "Santa Fe - ACTIVOS",
                    "error": None,
                    "parsed": {"empleado": {"parsed": {"apellido_nombre": "X"}}, "emp_id": "1"},
                }

            return original(
                cuiles, sesion_obj, rutas, config=config,
                consultar=consultar_falso, dormir=lambda s: None,
            )

        with patch.dict("os.environ", ENTORNO, clear=True), \
             patch.object(cli.sesion, "SesionCuad", SesionFalsa), \
             patch.object(cli.corrida, "procesar_reanudable", procesar):
            return main_silencioso(argv)


class TestValidacionDeArgumentos(unittest.TestCase):
    def test_sin_cuiles_no_arranca(self):
        with patch.dict("os.environ", ENTORNO, clear=True):
            with self.assertRaises(SystemExit) as capturado:
                main_silencioso([])
        self.assertNotEqual(capturado.exception.code, 0)

    def test_probar_login_no_necesita_cuiles(self):
        with patch.dict("os.environ", ENTORNO, clear=True), \
             patch.object(cli.sesion, "SesionCuad", SesionFalsa):
            self.assertEqual(main_silencioso(["--probar-login"]), 0)

    def test_login_manual_se_pasa_a_la_configuracion(self):
        config = object()
        with patch.dict("os.environ", ENTORNO, clear=True), \
             patch.object(cli.sesion, "config_desde_entorno", return_value=config) as configurar, \
             patch.object(cli.sesion, "SesionCuad", SesionFalsa):
            self.assertEqual(main_silencioso(["--probar-login", "--login-manual"]), 0)

        configurar.assert_called_once_with(modo_login="manual")

    def test_los_defaults_de_ritmo_son_los_de_produccion(self):
        args = cli.construir_parser().parse_args(["--cuiles", "x.xlsx"])
        self.assertEqual(args.demora, 12.0)
        self.assertEqual(args.pausa_cada, 50)
        self.assertEqual(args.pausa_larga, 180.0)


class TestErroresTempranos(_ConDirectorio):
    def test_sin_credenciales_avisa_y_no_sigue(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(main_silencioso(["--cuiles", "x.xlsx"]), 2)

    def test_un_archivo_inexistente_se_reporta_antes_de_tocar_cuad(self):
        # Que la planilla este mal no puede costar un login.
        with patch.dict("os.environ", ENTORNO, clear=True), \
             patch.object(cli.sesion, "SesionCuad", SesionFalsa) as doble:
            codigo = main_silencioso(["--cuiles", str(self.base / "fantasma.xlsx")])

        self.assertEqual(codigo, 2)
        self.assertEqual(self.consultados, [])
        del doble

    def test_un_excel_sin_cuiles_validos_corta(self):
        ruta = self.excel(["123", "abc"])
        with patch.dict("os.environ", ENTORNO, clear=True), \
             patch.object(cli.sesion, "SesionCuad", SesionFalsa):
            self.assertEqual(main_silencioso(["--cuiles", str(ruta)]), 2)


class TestCorridaCompleta(_ConDirectorio):
    def test_consulta_los_cuiles_del_excel(self):
        ruta = self.excel([CUIL_A, CUIL_B])
        codigo = self.correr(
            ["--cuiles", str(ruta), "--corridas", str(self.base / "corridas"),
             "--periodo", "2019-01"]
        )

        self.assertEqual(codigo, 0)
        self.assertEqual(self.consultados, [CUIL_A, CUIL_B])

    def test_nombra_los_archivos_segun_la_planilla(self):
        ruta = self.excel([CUIL_A], nombre="MEDICOS -A-.xlsx")
        self.correr(
            ["--cuiles", str(ruta), "--corridas", str(self.base / "corridas"),
             "--periodo", "2019-01"]
        )

        directorio = self.base / "corridas" / "2019-01"
        nombres = sorted(p.name for p in directorio.iterdir())
        self.assertEqual(nombres, ["cuiles_archivo_medicos_a.json", "resultados_medicos_a.ndjson"])

    def test_la_etiqueta_manual_manda(self):
        ruta = self.excel([CUIL_A])
        self.correr(
            ["--cuiles", str(ruta), "--etiqueta", "prueba mia",
             "--corridas", str(self.base / "corridas"), "--periodo", "2019-01"]
        )

        directorio = self.base / "corridas" / "2019-01"
        self.assertTrue((directorio / "resultados_prueba_mia.ndjson").exists())

    def test_guarda_la_lista_de_cuiles_usada(self):
        # Deja registro de que se consulto, aunque despues cambie la planilla.
        ruta = self.excel([CUIL_A, CUIL_B])
        self.correr(
            ["--cuiles", str(ruta), "--corridas", str(self.base / "corridas"),
             "--periodo", "2019-01"]
        )

        guardado = json.loads(
            (self.base / "corridas" / "2019-01" / "cuiles_archivo_medicos_a.json")
            .read_text(encoding="utf-8")
        )
        self.assertEqual(guardado, [CUIL_A, CUIL_B])

    def test_respeta_el_limite(self):
        ruta = self.excel([CUIL_A, CUIL_B])
        self.correr(
            ["--cuiles", str(ruta), "--limite", "1",
             "--corridas", str(self.base / "corridas"), "--periodo", "2019-01"]
        )
        self.assertEqual(self.consultados, [CUIL_A])

    def test_al_volver_a_correr_no_repite(self):
        ruta = self.excel([CUIL_A, CUIL_B])
        argv = ["--cuiles", str(ruta), "--corridas", str(self.base / "corridas"),
                "--periodo", "2019-01"]

        self.correr(argv)
        self.consultados.clear()
        self.correr(argv)

        self.assertEqual(self.consultados, [])

    def test_acepta_una_lista_json(self):
        ruta = self.base / "cuiles.json"
        ruta.write_text(json.dumps([CUIL_A]), encoding="utf-8")

        codigo = self.correr(
            ["--cuiles", str(ruta), "--corridas", str(self.base / "corridas"),
             "--periodo", "2019-01"]
        )
        self.assertEqual(codigo, 0)
        self.assertEqual(self.consultados, [CUIL_A])

    def test_devuelve_uno_si_la_corrida_se_detuvo(self):
        # Codigo de salida distinto de cero: sirve para encadenar o para una
        # tarea programada que avise.
        ruta = self.excel([CUIL_A])
        codigo = self.correr(
            ["--cuiles", str(ruta), "--corridas", str(self.base / "corridas"),
             "--periodo", "2019-01"],
            respuesta="sesion_invalida",
        )
        self.assertEqual(codigo, 1)


if __name__ == "__main__":
    unittest.main()
