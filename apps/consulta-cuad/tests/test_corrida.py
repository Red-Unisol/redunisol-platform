"""Tests de la ejecucion de una corrida.

Todo lo que toca disco corre contra un directorio temporal. Nada escribe en
corridas/ ni lee datos reales.
"""

import json
import logging
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from consulta_cuad import corrida  # noqa: E402


def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


def resultado(cuil, status="ok", ok=None, nombre="PEREZ JUAN"):
    """Un registro con la forma que produce cuad.py."""
    return {
        "cuil": cuil,
        "status": status,
        "ok": status == "ok" if ok is None else ok,
        "emr_nombre": "Santa Fe - ACTIVOS",
        "error": None if status == "ok" else f"falla {status}",
        "parsed": {
            "empleado": {"parsed": {"apellido_nombre": nombre}},
            "emp_id": "999",
        },
    }


class SesionFalsa:
    """Lo unico que procesar_reanudable le pide a una sesion."""

    def __init__(self, cookie="cookie=1", falla_al_renovar=False):
        self._cookie = cookie
        self.falla_al_renovar = falla_al_renovar
        self.renovaciones = 0

    def cookie(self):
        return self._cookie

    def renovar(self):
        self.renovaciones += 1
        if self.falla_al_renovar:
            raise RuntimeError("no se pudo abrir el navegador")
        self._cookie = f"cookie={self.renovaciones + 1}"
        return self._cookie


class _ConDirectorio(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.base = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def rutas(self, **kwargs):
        kwargs.setdefault("periodo", "2019-01")
        return corrida.RutasCorrida.para(directorio_base=self.base, **kwargs)


class TestNombres(unittest.TestCase):
    def test_slug_saca_tildes_y_espacios(self):
        self.assertEqual(corrida.slug_archivo("Médicos -A- - Córdoba"), "medicos_a_cordoba")

    def test_slug_nunca_devuelve_vacio(self):
        self.assertEqual(corrida.slug_archivo(""), "lista")
        self.assertEqual(corrida.slug_archivo("---"), "lista")

    def test_la_etiqueta_manual_gana_sobre_todo(self):
        self.assertEqual(
            corrida.construir_sufijo_salida(
                etiqueta_salida="mi etiqueta",
                archivo_cuiles="C:/x/MEDICOS.xlsx",
            ),
            "mi_etiqueta",
        )

    def test_sin_etiqueta_usa_el_nombre_del_archivo(self):
        self.assertEqual(
            corrida.construir_sufijo_salida(archivo_cuiles="C:/x/MEDICOS -A-.xlsx"),
            "medicos_a",
        )


class TestRutas(unittest.TestCase):
    def test_arma_las_rutas_del_periodo(self):
        rutas = corrida.RutasCorrida.para(directorio_base="corridas", periodo="2026-08")

        self.assertEqual(rutas.directorio, Path("corridas/2026-08"))
        self.assertEqual(rutas.archivo_resultados.name, "resultados.ndjson")
        self.assertEqual(rutas.archivo_cuiles.name, "cuiles_archivo.json")

    def test_el_sufijo_va_en_los_dos_archivos(self):
        rutas = corrida.RutasCorrida.para(sufijo="medicos_a", periodo="2026-08")

        self.assertEqual(rutas.archivo_resultados.name, "resultados_medicos_a.ndjson")
        self.assertEqual(rutas.archivo_cuiles.name, "cuiles_archivo_medicos_a.json")

    def test_desde_archivo_cambia_el_nombre_de_los_cuiles(self):
        rutas = corrida.RutasCorrida.para(
            sufijo="medicos_a", desde_archivo=True, periodo="2026-07"
        )
        self.assertEqual(rutas.archivo_cuiles.name, "cuiles_archivo_medicos_a.json")

    def test_el_periodo_se_congela_al_armar_las_rutas(self):
        # Una corrida de 8 horas que cruce fin de mes tiene que seguir
        # escribiendo donde arranco.
        #
        # El periodo de este test es viejo A PROPOSITO: si se usara el mes en
        # curso, el test pasaria aunque el codigo ignorara el parametro y
        # devolviera siempre la fecha de hoy.
        rutas = corrida.RutasCorrida.para(periodo="2019-01")
        self.assertEqual(rutas.periodo, "2019-01")
        self.assertIn("2019-01", str(rutas.directorio))
        self.assertNotEqual(rutas.periodo, corrida.periodo_actual())

    def test_sin_periodo_usa_el_mes_actual(self):
        rutas = corrida.RutasCorrida.para()
        self.assertEqual(rutas.periodo, datetime.now().strftime("%Y-%m"))

    def test_las_rutas_son_inmutables(self):
        rutas = corrida.RutasCorrida.para(periodo="2026-08")
        with self.assertRaises(Exception):
            rutas.periodo = "2026-09"


class TestPersistencia(_ConDirectorio):
    def test_append_y_relectura_dan_la_vuelta_completa(self):
        rutas = self.rutas()
        corrida.append_ndjson(rutas.archivo_resultados, resultado("111"))
        corrida.append_ndjson(rutas.archivo_resultados, resultado("222"))

        ultimos = corrida.cargar_ultimos_resultados(rutas.archivo_resultados)
        self.assertEqual(list(ultimos), ["111", "222"])

    def test_append_crea_el_directorio_si_no_existe(self):
        rutas = self.rutas()
        self.assertFalse(rutas.directorio.exists())
        corrida.append_ndjson(rutas.archivo_resultados, resultado("111"))
        self.assertTrue(rutas.archivo_resultados.exists())

    def test_si_un_cuil_se_repite_vale_el_ultimo(self):
        rutas = self.rutas()
        corrida.append_ndjson(rutas.archivo_resultados, resultado("111", "timeout"))
        corrida.append_ndjson(rutas.archivo_resultados, resultado("111", "ok"))

        ultimos = corrida.cargar_ultimos_resultados(rutas.archivo_resultados)
        self.assertEqual(len(ultimos), 1)
        self.assertEqual(ultimos["111"]["status"], "ok")

    def test_archivo_inexistente_da_estado_vacio(self):
        rutas = self.rutas()
        self.assertEqual(corrida.cargar_ultimos_resultados(rutas.archivo_resultados), {})

    def test_ignora_lineas_en_blanco(self):
        rutas = self.rutas()
        rutas.directorio.mkdir(parents=True)
        rutas.archivo_resultados.write_text(
            json.dumps(resultado("111")) + "\n\n\n" + json.dumps(resultado("222")) + "\n",
            encoding="utf-8",
        )
        self.assertEqual(len(corrida.cargar_ultimos_resultados(rutas.archivo_resultados)), 2)

    def test_sobrevive_a_una_linea_cortada_a_la_mitad(self):
        # Pasa si el proceso muere mientras escribe. Perder ese registro es
        # aceptable; perder la reanudacion entera no.
        rutas = self.rutas()
        rutas.directorio.mkdir(parents=True)
        rutas.archivo_resultados.write_text(
            json.dumps(resultado("111")) + '\n{"cuil": "222", "sta\n',
            encoding="utf-8",
        )

        ultimos = corrida.cargar_ultimos_resultados(rutas.archivo_resultados)
        self.assertEqual(list(ultimos), ["111"])

    def test_ignora_registros_sin_cuil(self):
        rutas = self.rutas()
        rutas.directorio.mkdir(parents=True)
        rutas.archivo_resultados.write_text(
            json.dumps({"status": "ok"}) + "\n" + json.dumps(resultado("111")) + "\n",
            encoding="utf-8",
        )
        self.assertEqual(list(corrida.cargar_ultimos_resultados(rutas.archivo_resultados)), ["111"])

    def test_json_da_la_vuelta_completa(self):
        path = self.base / "x" / "datos.json"
        corrida.guardar_json({"cuiles": ["1", "2"]}, path)
        self.assertEqual(corrida.leer_json(path), {"cuiles": ["1", "2"]})

    def test_el_json_conserva_los_acentos(self):
        path = self.base / "datos.json"
        corrida.guardar_json({"nombre": "MUÑOZ"}, path)
        self.assertIn("MUÑOZ", path.read_text(encoding="utf-8"))


class TestResumenDeEstado(unittest.TestCase):
    def _estado(self, *pares):
        ultimos = {cuil: resultado(cuil, status) for cuil, status in pares}
        return corrida.resumir_estado(ultimos)

    def test_cuenta_por_categoria(self):
        estado = self._estado(
            ("1", "ok"), ("2", "ok"), ("3", "sin_resultado"), ("4", "timeout")
        )
        self.assertEqual(estado["cantidad_ok"], 2)
        self.assertEqual(estado["cantidad_sin_resultado"], 1)
        self.assertEqual(estado["cantidad_pendientes_reintento"], 1)

    def test_lo_terminado_no_se_vuelve_a_consultar(self):
        estado = self._estado(("1", "ok"), ("2", "sin_resultado"))
        self.assertEqual(set(estado["procesados"]), {"1", "2"})

    def test_los_estados_pendientes_no_cuentan_como_procesados(self):
        for status in ("timeout", "error_http", "error_conexion", "sesion_invalida",
                       "respuesta_no_reconocida"):
            with self.subTest(status=status):
                estado = self._estado(("1", status))
                self.assertEqual(estado["procesados"], [])
                self.assertEqual(estado["cantidad_pendientes_reintento"], 1)

    def test_sin_resultado_cuenta_como_terminado(self):
        # Que el socio no exista en CUAD es una respuesta, no una falla.
        estado = self._estado(("1", "sin_resultado"))
        self.assertEqual(estado["procesados"], ["1"])

    def test_recuerda_el_ultimo_cuil_visto(self):
        estado = self._estado(("1", "ok"), ("2", "ok"), ("3", "timeout"))
        self.assertEqual(estado["ultimo_cuil"], "3")


class TestRespaldos(_ConDirectorio):
    def test_mueve_el_archivo_a_un_nombre_con_sello(self):
        archivo = self.base / "resultados.ndjson"
        archivo.write_text("datos", encoding="utf-8")

        respaldo = corrida.respaldar_archivo(archivo, "20260831_101500")

        self.assertFalse(archivo.exists())
        self.assertEqual(respaldo.name, "resultados_20260831_101500.ndjson")
        self.assertEqual(respaldo.read_text(encoding="utf-8"), "datos")

    def test_no_pisa_un_respaldo_del_mismo_segundo(self):
        archivo = self.base / "r.ndjson"
        archivo.write_text("primero", encoding="utf-8")
        corrida.respaldar_archivo(archivo, "SELLO")

        archivo.write_text("segundo", encoding="utf-8")
        segundo = corrida.respaldar_archivo(archivo, "SELLO")

        self.assertEqual(segundo.name, "r_SELLO_1.ndjson")
        self.assertEqual((self.base / "r_SELLO.ndjson").read_text(encoding="utf-8"), "primero")

    def test_archivo_inexistente_no_es_error(self):
        self.assertIsNone(corrida.respaldar_archivo(self.base / "no_esta.ndjson", "SELLO"))

    def test_respalda_directorios_tambien(self):
        carpeta = self.base / "2026-08"
        carpeta.mkdir()
        (carpeta / "x.txt").write_text("hola", encoding="utf-8")

        respaldo = corrida.respaldar_directorio(carpeta, "SELLO")

        self.assertEqual(respaldo.name, "2026-08_SELLO")
        self.assertEqual((respaldo / "x.txt").read_text(encoding="utf-8"), "hola")


class TestPrepararCorrida(_ConDirectorio):
    def test_crea_el_directorio_del_periodo(self):
        rutas = self.rutas()
        corrida.preparar_corrida(rutas)
        self.assertTrue(rutas.directorio.is_dir())

    def test_reanudando_no_toca_nada(self):
        rutas = self.rutas()
        corrida.append_ndjson(rutas.archivo_resultados, resultado("111"))

        respaldos = corrida.preparar_corrida(rutas, iniciar_nueva=False)

        self.assertEqual(respaldos, [])
        self.assertTrue(rutas.archivo_resultados.exists())

    def test_corrida_nueva_respalda_en_vez_de_borrar(self):
        # Nunca se borra: una corrida de 8 horas no se puede perder por un
        # flag mal puesto.
        rutas = self.rutas()
        corrida.append_ndjson(rutas.archivo_resultados, resultado("111"))
        corrida.guardar_json(["111"], rutas.archivo_cuiles)

        respaldos = corrida.preparar_corrida(rutas, iniciar_nueva=True)

        self.assertEqual(len(respaldos), 2)
        self.assertFalse(rutas.archivo_resultados.exists())
        for respaldo in respaldos:
            self.assertTrue(respaldo.exists())

    def test_corrida_nueva_sin_nada_previo_no_falla(self):
        rutas = self.rutas()
        self.assertEqual(corrida.preparar_corrida(rutas, iniciar_nueva=True), [])


class TestRitmo(unittest.TestCase):
    def test_espera_la_demora_normal_entre_consultas(self):
        esperas = []
        corrida.Ritmo().esperar(1, esperas.append)
        self.assertEqual(esperas, [12.0])

    def test_hace_la_pausa_larga_cada_n_consultas(self):
        esperas = []
        ritmo = corrida.Ritmo()
        for numero in range(1, 51):
            ritmo.esperar(numero, esperas.append)

        self.assertEqual(esperas.count(180.0), 1)
        self.assertEqual(esperas[49], 180.0)
        self.assertEqual(esperas.count(12.0), 49)

    def test_el_ritmo_por_defecto_es_el_que_venia_usandose(self):
        ritmo = corrida.Ritmo()
        self.assertEqual(ritmo.demora_entre_consultas, 12.0)
        self.assertEqual(ritmo.pausa_cada, 50)
        self.assertEqual(ritmo.pausa_larga_segundos, 180.0)

    def test_se_puede_acelerar(self):
        esperas = []
        corrida.Ritmo(demora_entre_consultas=4.0, pausa_cada=0).esperar(50, esperas.append)
        self.assertEqual(esperas, [4.0])

    def test_pausa_cada_cero_desactiva_la_pausa_larga(self):
        esperas = []
        ritmo = corrida.Ritmo(pausa_cada=0)
        for numero in range(1, 11):
            ritmo.esperar(numero, esperas.append)
        self.assertNotIn(180.0, esperas)


class TestProcesarReanudable(_ConDirectorio):
    def setUp(self):
        super().setUp()
        self.esperas = []
        self.config = corrida.ConfigCorrida(
            ritmo=corrida.Ritmo(demora_entre_consultas=0, pausa_cada=0)
        )

    def _correr(self, cuiles, respuestas, sesion=None, config=None):
        """`respuestas` mapea cuil -> lista de status a devolver, en orden."""
        pedidos = []
        restantes = {cuil: list(lista) for cuil, lista in respuestas.items()}

        def consultar(cuil, cookie):
            pedidos.append((cuil, cookie))
            lista = restantes.get(cuil) or ["ok"]
            status = lista.pop(0) if lista else "ok"
            return resultado(cuil, status)

        resumen = corrida.procesar_reanudable(
            cuiles,
            sesion or SesionFalsa(),
            self.rutas(),
            config=config or self.config,
            consultar=consultar,
            dormir=self.esperas.append,
        )
        return resumen, pedidos

    def test_consulta_todos_y_escribe_una_linea_por_cada_uno(self):
        resumen, pedidos = self._correr(["1", "2", "3"], {})

        self.assertEqual(resumen["consultadas_en_esta_corrida"], 3)
        self.assertEqual([c for c, _ in pedidos], ["1", "2", "3"])

        lineas = self.rutas().archivo_resultados.read_text(encoding="utf-8").strip().split("\n")
        self.assertEqual(len(lineas), 3)

    def test_no_vuelve_a_consultar_lo_ya_terminado(self):
        # El corazon de la reanudacion.
        rutas = self.rutas()
        corrida.append_ndjson(rutas.archivo_resultados, resultado("1", "ok"))
        corrida.append_ndjson(rutas.archivo_resultados, resultado("2", "sin_resultado"))

        _, pedidos = self._correr(["1", "2", "3"], {})

        self.assertEqual([c for c, _ in pedidos], ["3"])

    def test_si_vuelve_a_intentar_lo_que_habia_fallado(self):
        rutas = self.rutas()
        corrida.append_ndjson(rutas.archivo_resultados, resultado("1", "ok"))
        corrida.append_ndjson(rutas.archivo_resultados, resultado("2", "timeout"))

        _, pedidos = self._correr(["1", "2"], {})

        self.assertEqual([c for c, _ in pedidos], ["2"])

    def test_el_ndjson_guardado_no_trae_el_html(self):
        def consultar(cuil, cookie):
            registro = resultado(cuil)
            registro["html"] = "<html>enorme</html>"
            return registro

        corrida.procesar_reanudable(
            ["1"], SesionFalsa(), self.rutas(), config=self.config,
            consultar=consultar, dormir=self.esperas.append,
        )

        guardado = json.loads(self.rutas().archivo_resultados.read_text(encoding="utf-8"))
        self.assertNotIn("html", guardado)

    def test_respeta_el_limite(self):
        config = corrida.ConfigCorrida(
            ritmo=corrida.Ritmo(demora_entre_consultas=0, pausa_cada=0), limite=2
        )
        _, pedidos = self._correr(["1", "2", "3", "4"], {}, config=config)

        self.assertEqual(len(pedidos), 2)

    def test_espera_entre_consultas(self):
        config = corrida.ConfigCorrida(ritmo=corrida.Ritmo(demora_entre_consultas=7, pausa_cada=0))
        self._correr(["1", "2", "3"], {}, config=config)

        self.assertEqual(self.esperas, [7, 7, 7])

    def test_el_resumen_cuenta_lo_que_paso(self):
        resumen, _ = self._correr(["1", "2"], {"2": ["sin_resultado"]})

        self.assertTrue(resumen["completada"])
        self.assertFalse(resumen["detenida"])
        self.assertEqual(resumen["estado"]["cantidad_ok"], 1)
        self.assertEqual(resumen["estado"]["cantidad_sin_resultado"], 1)


class TestRenovacionDeSesion(_ConDirectorio):
    def setUp(self):
        super().setUp()
        self.config = corrida.ConfigCorrida(
            ritmo=corrida.Ritmo(demora_entre_consultas=0, pausa_cada=0)
        )

    def _correr(self, cuiles, respuestas, sesion, config=None):
        pedidos = []
        restantes = {cuil: list(lista) for cuil, lista in respuestas.items()}

        def consultar(cuil, cookie):
            pedidos.append((cuil, cookie))
            lista = restantes.get(cuil)
            status = lista.pop(0) if lista else "ok"
            return resultado(cuil, status)

        resumen = corrida.procesar_reanudable(
            cuiles, sesion, self.rutas(), config=config or self.config,
            consultar=consultar, dormir=lambda s: None,
        )
        return resumen, pedidos

    def test_renueva_y_reintenta_el_mismo_cuil(self):
        """Lo que antes frenaba la corrida ahora la continua."""
        sesion = SesionFalsa()
        resumen, pedidos = self._correr(["1", "2"], {"1": ["sesion_invalida", "ok"]}, sesion)

        self.assertEqual(sesion.renovaciones, 1)
        self.assertEqual(resumen["renovaciones_de_sesion"], 1)
        self.assertFalse(resumen["detenida"])
        # el CUIL 1 se pidio dos veces, la segunda con la cookie nueva
        self.assertEqual([c for c, _ in pedidos], ["1", "1", "2"])
        self.assertEqual(pedidos[1][1], "cookie=2")

    def test_renueva_si_la_respuesta_no_reconocida_anticipa_el_vencimiento(self):
        sesion = SesionFalsa()
        resumen, pedidos = self._correr(
            ["1"], {"1": ["respuesta_no_reconocida", "ok"]}, sesion
        )

        self.assertEqual(sesion.renovaciones, 1)
        self.assertFalse(resumen["detenida"])
        self.assertEqual([c for c, _ in pedidos], ["1", "1"])

    def test_guarda_un_solo_registro_por_cuil_reintentado(self):
        sesion = SesionFalsa()
        self._correr(["1"], {"1": ["sesion_invalida", "ok"]}, sesion)

        lineas = self.rutas().archivo_resultados.read_text(encoding="utf-8").strip().split("\n")
        self.assertEqual(len(lineas), 1)
        self.assertEqual(json.loads(lineas[0])["status"], "ok")

    def test_corta_la_corrida_si_renovar_no_alcanza(self):
        # Sin tope, esto abriria Chromium para siempre.
        sesion = SesionFalsa()
        resumen, pedidos = self._correr(
            ["1", "2", "3"], {"1": ["sesion_invalida"] * 20}, sesion
        )

        self.assertTrue(resumen["detenida"])
        self.assertIn("renovaciones", resumen["motivo_corte"])
        self.assertEqual(sesion.renovaciones, 3)
        self.assertEqual([c for c, _ in pedidos], ["1", "1", "1", "1"])

    def test_no_sigue_con_los_demas_cuiles_despues_de_cortar(self):
        sesion = SesionFalsa()
        _, pedidos = self._correr(["1", "2", "3"], {"1": ["sesion_invalida"] * 20}, sesion)

        self.assertNotIn("2", [c for c, _ in pedidos])

    def test_corta_si_el_login_mismo_falla(self):
        sesion = SesionFalsa(falla_al_renovar=True)
        resumen, _ = self._correr(["1", "2"], {"1": ["sesion_invalida"] * 5}, sesion)

        self.assertTrue(resumen["detenida"])
        self.assertIn("no se pudo renovar", resumen["motivo_corte"])
        self.assertEqual(sesion.renovaciones, 1)

    def test_deja_registrado_el_cuil_que_quedo_sin_resolver(self):
        # Tiene que quedar en el ndjson como pendiente para la proxima.
        sesion = SesionFalsa()
        self._correr(["1"], {"1": ["sesion_invalida"] * 20}, sesion)

        guardado = json.loads(self.rutas().archivo_resultados.read_text(encoding="utf-8"))
        self.assertEqual(guardado["status"], "sesion_invalida")

        estado = corrida.resumir_estado(
            corrida.cargar_ultimos_resultados(self.rutas().archivo_resultados)
        )
        self.assertEqual(estado["cantidad_pendientes_reintento"], 1)

    def test_un_tope_configurable(self):
        sesion = SesionFalsa()
        config = corrida.ConfigCorrida(
            ritmo=corrida.Ritmo(demora_entre_consultas=0, pausa_cada=0),
            max_renovaciones_seguidas=1,
        )
        self._correr(["1"], {"1": ["sesion_invalida"] * 20}, sesion, config=config)

        self.assertEqual(sesion.renovaciones, 1)


class TestDescribirResultado(unittest.TestCase):
    def test_un_resultado_ok_muestra_el_nombre(self):
        texto = corrida.describir_resultado(resultado("111", nombre="GOMEZ ANA"))
        self.assertIn("GOMEZ ANA", texto)
        self.assertIn("111", texto)
        self.assertIn("ok", texto)

    def test_un_error_muestra_el_motivo(self):
        texto = corrida.describir_resultado(resultado("111", "timeout"))
        self.assertIn("timeout", texto)

    def test_no_explota_si_falta_el_nombre(self):
        registro = resultado("111")
        registro["parsed"]["empleado"]["parsed"] = None
        self.assertIn("sin_nombre", corrida.describir_resultado(registro))


if __name__ == "__main__":
    unittest.main()
