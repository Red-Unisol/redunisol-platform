"""Prueba que sesion.py y cuad.py encastren.

Es la afirmacion central del proyecto: el login por OCR produce un string de
cookie, y ese string es TODO el acoplamiento entre el navegador y el motor de
consultas. Si esto anda, el hibrido anda.

Tambien deja escrito, en codigo ejecutable, el ciclo que corrida.py va a
implementar despues: consultar, y si la sesion vencio, renovar y reintentar.
"""

import logging
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from consulta_cuad import cuad, sesion  # noqa: E402
from fixtures import HTML_GRILLA, HTML_MOVIMIENTO, HTML_SESION_VENCIDA  # noqa: E402
from test_sesion import CONFIG as CONFIG_SESION  # noqa: E402
from test_sesion import COOKIES_OK, ocr_que_devuelve, pagina_de_login  # noqa: E402

CUIL = "20111111112"
COOKIE_ESPERADA = "usuario_CUAD=usuario_test; ASPSESSIONIDABC=XYZ123"
CONFIG_CUAD = cuad.ConfigCuad(pausa_reintento_segundos=0)


def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


def sesion_falsa(cookies=None, envios_para_entrar=1):
    """Una SesionCuad que no abre navegador ni llama a Mistral."""
    contador = {"logins": 0}

    @contextmanager
    def abrir(config):
        contador["logins"] += 1
        yield pagina_de_login(
            envios_para_entrar=envios_para_entrar,
            cookies=cookies if cookies is not None else COOKIES_OK,
        )

    objeto = sesion.SesionCuad(
        CONFIG_SESION, abrir_navegador=abrir, enviar_ocr=ocr_que_devuelve("123456")
    )
    return objeto, contador


class _CuadFalso:
    def __init__(self, respuestas_post, respuesta_get=HTML_GRILLA):
        self.respuestas_post = list(respuestas_post)
        self.respuesta_get = respuesta_get
        self.posts = 0
        self.cookies_recibidas = []

    def post(self, url, payload, cookie, config):
        self.posts += 1
        self.cookies_recibidas.append(cookie)
        indice = min(self.posts - 1, len(self.respuestas_post) - 1)
        return self.respuestas_post[indice]

    def get(self, url, params, cookie, config):
        return self.respuesta_get


class TestLaCookieViaja(unittest.TestCase):
    def test_cuad_recibe_exactamente_la_cookie_que_produjo_el_login(self):
        objeto, _ = sesion_falsa()
        falso = _CuadFalso([HTML_MOVIMIENTO])

        with patch.object(cuad, "_enviar_post", falso.post), \
             patch.object(cuad, "_enviar_get", falso.get):
            resultado = cuad.consultar(CUIL, objeto.cookie(), CONFIG_CUAD)

        self.assertEqual(falso.cookies_recibidas, [COOKIE_ESPERADA])
        self.assertTrue(resultado["ok"])

    def test_muchas_consultas_reusan_un_solo_login(self):
        # El navegador se abre una vez y despues son horas de HTTP plano.
        objeto, contador = sesion_falsa()
        falso = _CuadFalso([HTML_MOVIMIENTO])

        with patch.object(cuad, "_enviar_post", falso.post), \
             patch.object(cuad, "_enviar_get", falso.get):
            for _ in range(20):
                cuad.consultar(CUIL, objeto.cookie(), CONFIG_CUAD)

        self.assertEqual(contador["logins"], 1)
        self.assertEqual(falso.posts, 20)
        self.assertEqual(set(falso.cookies_recibidas), {COOKIE_ESPERADA})


class TestRenovacionAnteSesionVencida(unittest.TestCase):
    def test_el_ciclo_completo_de_recuperacion(self):
        """Lo que en main2.py frenaba la corrida, aca la continua.

        El original hacia `return` ante sesion_invalida y esperaba a que
        alguien pegara una cookie nueva. Esto es el reemplazo.
        """
        objeto, contador = sesion_falsa()
        # Primero la sesion esta vencida; despues del re-login, anda.
        falso = _CuadFalso([HTML_SESION_VENCIDA, HTML_MOVIMIENTO])

        with patch.object(cuad, "_enviar_post", falso.post), \
             patch.object(cuad, "_enviar_get", falso.get):
            resultado = cuad.consultar(CUIL, objeto.cookie(), CONFIG_CUAD)

            if resultado["status"] == "sesion_invalida":
                resultado = cuad.consultar(CUIL, objeto.renovar(), CONFIG_CUAD)

        self.assertTrue(resultado["ok"])
        self.assertEqual(contador["logins"], 2)
        self.assertEqual(falso.posts, 2)

    def test_la_sesion_vencida_no_se_reintenta_con_la_misma_cookie(self):
        # Reintentar sin renovar es tirar requests al vacio: por eso
        # sesion_invalida no esta en ESTADOS_REINTENTABLES.
        objeto, _ = sesion_falsa()
        falso = _CuadFalso([HTML_SESION_VENCIDA])

        with patch.object(cuad, "_enviar_post", falso.post), \
             patch.object(cuad, "_enviar_get", falso.get):
            cuad.consultar_con_reintentos(
                CUIL, objeto.cookie(), CONFIG_CUAD, dormir=lambda s: None
            )

        self.assertEqual(falso.posts, 1)

    def test_renovar_entrega_una_cookie_nueva_a_las_consultas_siguientes(self):
        objeto, _ = sesion_falsa()
        primera = objeto.cookie()

        cookies_nuevas = [
            {"name": "usuario_CUAD", "value": "usuario_test", "domain": "santafe.gov.ar"},
            {"name": "ASPSESSIONIDABC", "value": "SESION_NUEVA", "domain": "santafe.gov.ar"},
        ]

        @contextmanager
        def abrir_con_cookie_nueva(config):
            yield pagina_de_login(cookies=cookies_nuevas)

        objeto._abrir_navegador = abrir_con_cookie_nueva
        segunda = objeto.renovar()

        self.assertNotEqual(primera, segunda)
        self.assertIn("SESION_NUEVA", segunda)

        falso = _CuadFalso([HTML_MOVIMIENTO])
        with patch.object(cuad, "_enviar_post", falso.post), \
             patch.object(cuad, "_enviar_get", falso.get):
            cuad.consultar(CUIL, objeto.cookie(), CONFIG_CUAD)

        self.assertEqual(falso.cookies_recibidas, [segunda])


class TestElContratoEntreModulos(unittest.TestCase):
    def test_cuad_no_sabe_nada_de_navegadores(self):
        # Si cuad.py alguna vez importa playwright o sesion, se rompio la
        # separacion que hace que todo esto sea testeable.
        fuente = (SRC_DIR / "consulta_cuad" / "cuad.py").read_text(encoding="utf-8")
        self.assertNotIn("playwright", fuente.lower())
        self.assertNotIn("import sesion", fuente)
        self.assertNotIn("from .sesion", fuente)

    def test_sesion_no_sabe_nada_de_consultar_socios(self):
        fuente = (SRC_DIR / "consulta_cuad" / "sesion.py").read_text(encoding="utf-8")
        self.assertNotIn("movimiento.asp", fuente)
        self.assertNotIn("import cuad", fuente)


if __name__ == "__main__":
    unittest.main()
