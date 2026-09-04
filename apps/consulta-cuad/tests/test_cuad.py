"""Tests del cliente HTTP de CUAD.

Nada de esto toca la red: se reemplazan _enviar_post y _enviar_get por funciones
que devuelven HTML de mentira. Lo que se prueba es la maquina de estados que
hay arriba del transporte, que es donde vive la logica que importa: cuando cae
a PASIVOS, que estados son reintentables y cuantas paginas de grilla pide.
"""

import logging
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from consulta_cuad import cuad  # noqa: E402
from fixtures import (  # noqa: E402
    HTML_GRILLA,
    HTML_MOVIMIENTO,
    HTML_SESION_VENCIDA,
    HTML_SIN_RESULTADO,
)

HTML_VACIO = "<html><body>nada reconocible</body></html>"
CUIL = "20111111112"
COOKIE = "usuario_CUAD=test"


class TransporteNavegadorFalso:
    def __init__(self):
        self.posts = []
        self.gets = []

    def post_form(self, url, payload, headers):
        self.posts.append((url, payload, headers))
        return "post desde navegador"

    def get(self, url, params, headers):
        self.gets.append((url, params, headers))
        return "get desde navegador"


def setUpModule():
    # Los reintentos loguean en WARNING; sin esto la salida de los tests queda
    # tapada de avisos esperados.
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


# pausa en cero para que los reintentos no esperen de verdad
CONFIG = cuad.ConfigCuad(pausa_reintento_segundos=0)


class _CuadFalso:
    """Responde a los POST segun un guion, y siempre lo mismo a los GET."""

    def __init__(self, respuestas_post, respuesta_get=HTML_GRILLA):
        self.respuestas_post = list(respuestas_post)
        self.respuesta_get = respuesta_get
        self.posts = 0
        self.gets = 0
        self.paginas_pedidas = []
        self.cookies_vistas = []

    def post(self, url, payload, cookie, config):
        self.posts += 1
        self.cookies_vistas.append(cookie)
        indice = min(self.posts - 1, len(self.respuestas_post) - 1)
        item = self.respuestas_post[indice]
        if isinstance(item, Exception):
            raise item
        return item

    def get(self, url, params, cookie, config):
        self.gets += 1
        self.paginas_pedidas.append(params["Pag"])
        if isinstance(self.respuesta_get, Exception):
            raise self.respuesta_get
        return self.respuesta_get


def _consultar(falso, funcion=None, **kwargs):
    funcion = funcion or cuad.consultar
    with patch.object(cuad, "_enviar_post", falso.post), \
         patch.object(cuad, "_enviar_get", falso.get):
        return funcion(CUIL, COOKIE, CONFIG, **kwargs)


class TestConsultaExitosa(unittest.TestCase):
    def setUp(self):
        self.falso = _CuadFalso([HTML_MOVIMIENTO])
        self.resultado = _consultar(self.falso)

    def test_marca_el_resultado_como_ok(self):
        self.assertTrue(self.resultado["ok"])
        self.assertEqual(self.resultado["status"], "ok")

    def test_no_reconsulta_en_pasivos_si_lo_encontro(self):
        self.assertFalse(self.resultado["reconsultado_en_pasivos"])
        self.assertEqual(self.falso.posts, 1)

    def test_adjunta_los_movimientos_que_faltaban(self):
        # parsear_respuesta_cuad deja tabla_movimientos en None; el cliente es
        # quien la completa yendo a buscar la grilla.
        movimientos = self.resultado["parsed"]["tabla_movimientos"]
        self.assertIsNotNone(movimientos)
        self.assertEqual(movimientos["cantidad_registros"], 4)

    def test_pide_tantas_paginas_como_diga_la_respuesta(self):
        # El fixture declara Pags = 2.
        self.assertEqual(self.falso.gets, 2)
        self.assertEqual(self.falso.paginas_pedidas, [1, 2])
        self.assertEqual(
            self.resultado["parsed"]["tabla_movimientos"]["paginas_consultadas"], 2
        )

    def test_manda_la_cookie_que_le_pasaron(self):
        self.assertEqual(self.falso.cookies_vistas, [COOKIE])

    def test_conserva_el_html_crudo_en_memoria(self):
        self.assertIn("html", self.resultado)

    def test_solo_cupo_no_pide_la_grilla(self):
        falso = _CuadFalso([HTML_MOVIMIENTO])
        config = cuad.ConfigCuad(incluir_movimientos=False)
        with patch.object(cuad, "_enviar_post", falso.post), \
             patch.object(cuad, "_enviar_get", falso.get):
            resultado = cuad.consultar(CUIL, COOKIE, config)

        self.assertTrue(resultado["ok"])
        self.assertEqual(falso.gets, 0)
        self.assertEqual(resultado["parsed"]["tabla_totales"]["cupo"], "40000,00")


class TestTransporteNavegador(unittest.TestCase):
    def test_post_usa_el_contexto_del_navegador_sin_copiar_cookie(self):
        transporte = TransporteNavegadorFalso()

        respuesta = cuad._enviar_post("https://cuad.test/movimiento", {"Emp_Cod": CUIL}, transporte, CONFIG)

        self.assertEqual(respuesta, "post desde navegador")
        self.assertEqual(transporte.posts[0][1], {"Emp_Cod": CUIL})
        self.assertNotIn("Cookie", transporte.posts[0][2])

    def test_get_usa_el_contexto_del_navegador_sin_copiar_cookie(self):
        transporte = TransporteNavegadorFalso()

        respuesta = cuad._enviar_get("https://cuad.test/grilla", {"Pag": 1}, transporte, CONFIG)

        self.assertEqual(respuesta, "get desde navegador")
        self.assertEqual(transporte.gets[0][1], {"Pag": 1})
        self.assertNotIn("Cookie", transporte.gets[0][2])


class TestCaidaAPasivos(unittest.TestCase):
    def test_reconsulta_en_pasivos_si_activos_no_lo_tiene(self):
        falso = _CuadFalso([HTML_SIN_RESULTADO, HTML_MOVIMIENTO])
        resultado = _consultar(falso)

        self.assertEqual(falso.posts, 2)
        self.assertTrue(resultado["ok"])
        self.assertTrue(resultado["reconsultado_en_pasivos"])
        self.assertEqual(resultado["emr_nombre"], CONFIG.emr_nombre_pasivos)
        self.assertEqual(resultado["emr_id"], "11")

    def test_guarda_la_consulta_previa_a_activos(self):
        falso = _CuadFalso([HTML_SIN_RESULTADO, HTML_MOVIMIENTO])
        resultado = _consultar(falso)

        previa = resultado["consulta_activos_previa"]
        self.assertEqual(previa["status"], "sin_resultado")
        self.assertEqual(previa["emr_nombre"], CONFIG.emr_nombre_activos)
        self.assertNotIn("html", previa)

    def test_si_no_esta_en_ninguno_el_error_nombra_los_dos_regimenes(self):
        falso = _CuadFalso([HTML_SIN_RESULTADO])
        resultado = _consultar(falso)

        self.assertEqual(falso.posts, 2)
        self.assertFalse(resultado["ok"])
        self.assertEqual(resultado["status"], "sin_resultado")
        self.assertIn(CONFIG.emr_nombre_activos, resultado["error"])
        self.assertIn(CONFIG.emr_nombre_pasivos, resultado["error"])

    def test_no_pide_la_grilla_si_no_encontro_al_socio(self):
        falso = _CuadFalso([HTML_SIN_RESULTADO])
        _consultar(falso)
        self.assertEqual(falso.gets, 0)


class TestRespuestasProblematicas(unittest.TestCase):
    def test_detecta_la_sesion_vencida(self):
        falso = _CuadFalso([HTML_SESION_VENCIDA])
        resultado = _consultar(falso)

        self.assertEqual(resultado["status"], "sesion_invalida")
        self.assertFalse(resultado["ok"])

    def test_la_sesion_vencida_no_dispara_la_caida_a_pasivos(self):
        # Si la sesion murio, reconsultar en PASIVOS con la misma cookie es
        # tirar un request al vacio.
        falso = _CuadFalso([HTML_SESION_VENCIDA])
        _consultar(falso)
        self.assertEqual(falso.posts, 1)

    def test_html_sin_datos_reconocibles(self):
        falso = _CuadFalso([HTML_VACIO])
        resultado = _consultar(falso)
        self.assertEqual(resultado["status"], "respuesta_no_reconocida")


class TestErroresDeRed(unittest.TestCase):
    def _status_para(self, excepcion, respuesta_get=HTML_GRILLA):
        falso = _CuadFalso([excepcion], respuesta_get)
        return _consultar(falso)["status"]

    def test_http_error(self):
        self.assertEqual(
            self._status_para(HTTPError("u", 500, "Server Error", {}, None)),
            "error_http",
        )

    def test_url_error(self):
        self.assertEqual(self._status_para(URLError("sin ruta")), "error_conexion")

    def test_timeout(self):
        self.assertEqual(self._status_para(TimeoutError()), "timeout")

    def test_error_al_pedir_la_grilla_marca_todo_el_registro(self):
        # El socio existe, pero la grilla fallo: el registro no sirve entero.
        falso = _CuadFalso([HTML_MOVIMIENTO], HTTPError("u", 503, "Unavailable", {}, None))
        resultado = _consultar(falso)

        self.assertEqual(resultado["status"], "error_http")
        self.assertFalse(resultado["ok"])
        self.assertIn("grilla de movimientos", resultado["error"])


class TestReintentos(unittest.TestCase):
    def test_reintenta_las_fallas_de_red_hasta_agotar_los_intentos(self):
        falso = _CuadFalso([URLError("caida")])
        resultado = _consultar(
            falso, cuad.consultar_con_reintentos, dormir=lambda segundos: None
        )

        self.assertEqual(falso.posts, CONFIG.max_intentos)
        self.assertEqual(resultado["status"], "error_conexion")

    def test_se_planta_apenas_uno_sale_bien(self):
        falso = _CuadFalso([URLError("caida"), HTML_MOVIMIENTO])
        resultado = _consultar(
            falso, cuad.consultar_con_reintentos, dormir=lambda segundos: None
        )

        self.assertEqual(falso.posts, 2)
        self.assertTrue(resultado["ok"])

    def test_no_reintenta_la_sesion_vencida(self):
        # Reintentar no arregla una cookie muerta; hay que renovarla, y de eso
        # se ocupa quien llama.
        falso = _CuadFalso([HTML_SESION_VENCIDA])
        resultado = _consultar(
            falso, cuad.consultar_con_reintentos, dormir=lambda segundos: None
        )

        self.assertEqual(falso.posts, 1)
        self.assertEqual(resultado["status"], "sesion_invalida")

    def test_no_reintenta_al_socio_que_no_existe(self):
        falso = _CuadFalso([HTML_SIN_RESULTADO])
        resultado = _consultar(
            falso, cuad.consultar_con_reintentos, dormir=lambda segundos: None
        )

        self.assertEqual(falso.posts, 2)  # ACTIVOS + PASIVOS, sin reintentos
        self.assertEqual(resultado["status"], "sin_resultado")

    def test_espera_lo_que_dice_la_config_entre_intentos(self):
        esperas = []
        falso = _CuadFalso([URLError("caida")])
        config = cuad.ConfigCuad(max_intentos=3, pausa_reintento_segundos=15)

        with patch.object(cuad, "_enviar_post", falso.post), \
             patch.object(cuad, "_enviar_get", falso.get):
            cuad.consultar_con_reintentos(CUIL, COOKIE, config, dormir=esperas.append)

        self.assertEqual(esperas, [15, 15])  # 3 intentos = 2 esperas


class TestSerializacion(unittest.TestCase):
    def test_saca_el_html_crudo(self):
        falso = _CuadFalso([HTML_MOVIMIENTO])
        resultado = _consultar(falso)

        guardado = cuad.serializar_resultado(resultado)
        self.assertIn("html", resultado)
        self.assertNotIn("html", guardado)

    def test_conserva_todo_lo_demas(self):
        falso = _CuadFalso([HTML_MOVIMIENTO])
        resultado = _consultar(falso)

        guardado = cuad.serializar_resultado(resultado)
        self.assertEqual(set(resultado) - set(guardado), {"html"})
        self.assertEqual(guardado["parsed"], resultado["parsed"])


class TestConfiguracion(unittest.TestCase):
    def test_los_valores_por_defecto_son_los_de_produccion(self):
        config = cuad.ConfigCuad()
        self.assertEqual(config.emr_id_activos, "10")
        self.assertEqual(config.emr_id_pasivos, "11")
        self.assertEqual(config.max_intentos, 3)
        self.assertEqual(config.timeout_segundos, 180)
        self.assertIn("movimiento.asp", config.url_movimiento)
        self.assertIn("grilla.asp", config.url_grilla)

    def test_la_config_es_inmutable(self):
        # Frozen a proposito: que nadie la modifique a mitad de una corrida.
        config = cuad.ConfigCuad()
        with self.assertRaises(Exception):
            config.max_intentos = 99

    def test_respeta_un_maximo_de_intentos_distinto(self):
        falso = _CuadFalso([URLError("caida")])
        config = cuad.ConfigCuad(max_intentos=5, pausa_reintento_segundos=0)

        with patch.object(cuad, "_enviar_post", falso.post), \
             patch.object(cuad, "_enviar_get", falso.get):
            cuad.consultar_con_reintentos(CUIL, COOKIE, config, dormir=lambda s: None)

        self.assertEqual(falso.posts, 5)


class TestPayload(unittest.TestCase):
    def test_arma_el_formulario_que_espera_cuad(self):
        payload = cuad._construir_payload(CUIL, "Santa Fe - ACTIVOS", "10")
        self.assertEqual(
            payload,
            {
                "Modo": "BS",
                "Emr_Nombre": "Santa Fe - ACTIVOS",
                "Emr_Id": "10",
                "Emt_Nome": "",
                "Emt_Id": "",
                "Emp_Cod": CUIL,
                "Per_NroDoc": "",
                "none1": "",
            },
        )


class _RespuestaFalsa:
    """Lo minimo que urlopen() devuelve y que el codigo usa."""

    def __init__(self, cuerpo):
        self._cuerpo = cuerpo

    def read(self):
        return self._cuerpo

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class TestTransporte(unittest.TestCase):
    """Prueba _enviar_post y _enviar_get de verdad, sin reemplazarlos.

    El resto de los tests los sustituye por dobles, asi que los headers y la
    decodificacion que arman adentro no se ejercitan en ningun otro lado.
    """

    def _capturar(self, funcion, *args, cuerpo=b"<html>ok</html>"):
        capturado = {}

        def falso_urlopen(request, timeout=None):
            capturado["request"] = request
            capturado["timeout"] = timeout
            return _RespuestaFalsa(cuerpo)

        with patch.object(cuad, "urlopen", falso_urlopen):
            capturado["cuerpo"] = funcion(*args)

        return capturado

    def _post(self, **kwargs):
        return self._capturar(
            cuad._enviar_post,
            cuad.URL_MOVIMIENTO,
            {"Emp_Cod": CUIL, "Modo": "BS"},
            COOKIE,
            CONFIG,
            **kwargs,
        )

    def _get(self, **kwargs):
        return self._capturar(
            cuad._enviar_get,
            cuad.URL_GRILLA,
            {"Modo": "SERVICIO", "Pag": 2, "ID": "MOVIMIENTOS"},
            COOKIE,
            CONFIG,
            **kwargs,
        )

    def test_el_post_manda_la_cookie(self):
        request = self._post()["request"]
        self.assertEqual(request.get_header("Cookie"), COOKIE)

    def test_el_get_manda_la_cookie(self):
        request = self._get()["request"]
        self.assertEqual(request.get_header("Cookie"), COOKIE)

    def test_el_post_manda_los_headers_que_cuad_exige(self):
        request = self._post()["request"]
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(
            request.get_header("Content-type"), "application/x-www-form-urlencoded"
        )
        self.assertEqual(request.get_header("Origin"), "https://www.santafe.gov.ar")
        self.assertIn("movimiento.asp", request.get_header("Referer"))
        self.assertIn("Mozilla", request.get_header("User-agent"))

    def test_el_post_codifica_el_formulario_en_el_cuerpo(self):
        request = self._post()["request"]
        self.assertIn(b"Emp_Cod=" + CUIL.encode(), request.data)
        self.assertIn(b"Modo=BS", request.data)

    def test_el_get_arma_la_query_string(self):
        request = self._get()["request"]
        self.assertEqual(request.get_method(), "GET")
        self.assertIn("Pag=2", request.full_url)
        self.assertIn("ID=MOVIMIENTOS", request.full_url)
        self.assertIn("Modo=SERVICIO", request.full_url)

    def test_usa_el_timeout_de_la_config(self):
        self.assertEqual(self._post()["timeout"], CONFIG.timeout_segundos)
        self.assertEqual(self._get()["timeout"], CONFIG.timeout_segundos)

    def test_decodifica_como_latin1(self):
        # 0xF3 es "o con tilde" en latin-1. Si se leyera como UTF-8, esto
        # explotaria o saldria roto.
        capturado = self._post(cuerpo=b"identificaci\xf3n")
        self.assertEqual(capturado["cuerpo"], "identificación")

    def test_asi_nace_el_mojibake_que_documenta_parsers(self):
        # Cuando CUAD manda UTF-8 sin declararlo, esos dos bytes leidos como
        # latin-1 dan la secuencia rara que busca es_sesion_invalida.
        capturado = self._post(cuerpo="identificación".encode("utf-8"))
        self.assertEqual(capturado["cuerpo"], "identificaciÃ³n")

    def test_no_explota_con_bytes_invalidos(self):
        capturado = self._post(cuerpo=b"\xff\xfe roto")
        self.assertIn("roto", capturado["cuerpo"])


class TestEstados(unittest.TestCase):
    def test_solo_las_fallas_de_red_son_reintentables(self):
        self.assertEqual(
            cuad.ESTADOS_REINTENTABLES,
            {"error_http", "error_conexion", "timeout"},
        )

    def test_los_pendientes_incluyen_a_los_reintentables(self):
        self.assertTrue(cuad.ESTADOS_REINTENTABLES < cuad.ESTADOS_PENDIENTES)
        self.assertIn("sesion_invalida", cuad.ESTADOS_PENDIENTES)

    def test_sin_resultado_no_deja_al_cuil_pendiente(self):
        # Que el socio no exista es una respuesta valida, no una falla.
        self.assertNotIn("sin_resultado", cuad.ESTADOS_PENDIENTES)


if __name__ == "__main__":
    unittest.main()
