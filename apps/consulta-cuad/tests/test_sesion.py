"""Tests del login por OCR.

Este modulo maneja un navegador y llama a una API paga, asi que testearlo de
verdad seria lento, caro y dependiente de que CUAD este arriba. La estrategia
es otra: se fabrica un Playwright de mentira que implementa solo la parte de
la API que el codigo usa (frames, locators, cookies), y se inyecta un
reemplazo del POST a Mistral.

Lo que queda cubierto es la logica: armado de la cookie, lectura de la
respuesta del OCR, reintentos del captcha, busqueda de frames y el ciclo de
vida de la sesion. Lo que NO queda cubierto es que los selectores de CUAD
sigan siendo los correctos: eso solo se sabe corriendo contra el sitio real.
"""

import io
import logging
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from consulta_cuad import sesion  # noqa: E402


def setUpModule():
    logging.disable(logging.CRITICAL)


def tearDownModule():
    logging.disable(logging.NOTSET)


def _png_de_prueba(ancho=10, alto=4):
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (ancho, alto), (255, 255, 255)).save(buffer, format="PNG")
    return buffer.getvalue()


IMAGEN_PNG = _png_de_prueba()

CONFIG = sesion.ConfigSesion(
    usuario="usuario_test",
    password="clave_test",
    mistral_api_key="key_test",
    pre_submit_delay_ms=0,
    post_submit_wait_ms=0,
)


# --------------------------------------------------------------------------
# Playwright de mentira
# --------------------------------------------------------------------------


class LocatorFalso:
    def __init__(self, cantidad=1, valor="", visible=True, imagen=IMAGEN_PNG, frame=None):
        self.cantidad = cantidad
        self.valor = valor
        self.visible = visible
        self.imagen = imagen
        self.frame = frame
        self.clicks = 0

    def count(self):
        return self.cantidad

    @property
    def first(self):
        return self

    def wait_for(self, **kwargs):
        pass

    def click(self, **kwargs):
        self.clicks += 1

    def press(self, tecla):
        pass

    def fill(self, texto):
        self.valor = texto

    def input_value(self):
        return self.valor

    def is_visible(self, timeout=None):
        # El campo del captcha desaparece cuando el login sale bien.
        if self.frame is not None and self.frame.page is not None:
            return self.frame.page.envios < self.frame.page.envios_para_entrar
        return self.visible

    def screenshot(self):
        return self.imagen


class FrameFalso:
    def __init__(self, name="", url="", selectores=(), page=None, evaluate_falla=False):
        self.name = name
        self.url = url
        self.page = page
        self.evaluate_falla = evaluate_falla
        self._locators = {}
        for selector in selectores:
            self._locators[selector] = LocatorFalso(frame=self)

    def poner(self, selector, locator):
        locator.frame = self
        self._locators[selector] = locator
        return self

    def locator(self, selector):
        return self._locators.get(selector, LocatorFalso(cantidad=0, frame=self))

    def wait_for_selector(self, selector):
        pass

    def evaluate(self, script):
        if self.evaluate_falla:
            raise RuntimeError("btnMouseClick no existe")
        if self.page is not None:
            self.page.envios += 1

    def click(self, selector):
        if self.page is not None:
            self.page.envios += 1


class ContextoFalso:
    def __init__(self, cookies):
        self._cookies = cookies

    def cookies(self):
        return self._cookies


class PageFalsa:
    def __init__(self, frames=None, cookies=None, envios_para_entrar=1):
        self._frames = frames if frames is not None else []
        self.context = ContextoFalso(cookies if cookies is not None else [])
        self.envios = 0
        self.envios_para_entrar = envios_para_entrar
        self.visitadas = []
        for frame in self._frames:
            frame.page = self

    @property
    def frames(self):
        return self._frames

    @property
    def main_frame(self):
        return self._frames[0] if self._frames else None

    def goto(self, url, **kwargs):
        self.visitadas.append(url)

    def wait_for_timeout(self, ms):
        pass

    def set_default_timeout(self, ms):
        pass


COOKIES_OK = [
    {"name": "usuario_CUAD", "value": "usuario_test", "domain": "www.santafe.gov.ar"},
    {"name": "ASPSESSIONIDABC", "value": "XYZ123", "domain": "www.santafe.gov.ar"},
]


def pagina_de_login(envios_para_entrar=1, cookies=None):
    """Arma una pagina con el frame de login y el del captcha, como CUAD."""
    principal = FrameFalso(name="", url="https://www.santafe.gov.ar/cuad/")
    login = FrameFalso(
        name="iContenido",
        url="https://www.santafe.gov.ar/cuad/login.asp?Modo=M",
        selectores=("#user", "#password", "#txtCaptcha"),
    )
    captcha = FrameFalso(name="iCaptcha", url="Captcha/aspcaptcha.asp")
    captcha.poner("img", LocatorFalso(cantidad=1))

    return PageFalsa(
        frames=[principal, login, captcha],
        cookies=cookies if cookies is not None else COOKIES_OK,
        envios_para_entrar=envios_para_entrar,
    )


class RespuestaFalsa:
    def __init__(self, cuerpo, status_code=200, texto=""):
        self._cuerpo = cuerpo
        self.status_code = status_code
        self.text = texto

    def json(self):
        return self._cuerpo


class RespuestaHttpFalsa:
    def __init__(self, contenido):
        self._contenido = contenido

    def body(self):
        return self._contenido


class RequestContextFalso:
    def __init__(self, contenido):
        self.contenido = contenido

    def post(self, *args, **kwargs):
        return RespuestaHttpFalsa(self.contenido)

    def get(self, *args, **kwargs):
        return RespuestaHttpFalsa(self.contenido)


def respuesta_de_chat(contenido):
    """Imita lo que devuelve /v1/chat/completions."""
    return {"choices": [{"message": {"content": contenido}}]}


def ocr_que_devuelve(digitos, status_code=200):
    def enviar_ocr(payload, headers, timeout):
        return RespuestaFalsa(respuesta_de_chat(digitos), status_code=status_code)

    return enviar_ocr


# --------------------------------------------------------------------------
# Tests
# --------------------------------------------------------------------------


class TestConstruirCookie(unittest.TestCase):
    def test_arma_el_header_a_partir_de_las_cookies_del_navegador(self):
        self.assertEqual(
            sesion.construir_cookie(COOKIES_OK),
            "usuario_CUAD=usuario_test; ASPSESSIONIDABC=XYZ123",
        )

    def test_descarta_cookies_de_otros_dominios(self):
        cookies = COOKIES_OK + [
            {"name": "_ga_google", "value": "1", "domain": "google.com"},
        ]
        self.assertNotIn("_ga_google", sesion.construir_cookie(cookies))

    def test_acepta_el_dominio_con_punto_adelante(self):
        cookies = [{"name": "a", "value": "1", "domain": ".santafe.gov.ar"}]
        self.assertEqual(sesion.construir_cookie(cookies), "a=1")

    def test_acepta_subdominios(self):
        cookies = [{"name": "a", "value": "1", "domain": "www.santafe.gov.ar"}]
        self.assertEqual(sesion.construir_cookie(cookies), "a=1")

    def test_no_confunde_un_dominio_que_solo_termina_parecido(self):
        cookies = [{"name": "a", "value": "1", "domain": "falsosantafe.gov.ar"}]
        self.assertEqual(sesion.construir_cookie(cookies), "")

    def test_lista_vacia_da_cadena_vacia(self):
        self.assertEqual(sesion.construir_cookie([]), "")
        self.assertEqual(sesion.construir_cookie(None), "")

    def test_ignora_cookies_sin_nombre(self):
        cookies = [{"value": "1", "domain": "santafe.gov.ar"}] + COOKIES_OK
        self.assertEqual(sesion.construir_cookie(cookies).count("="), 2)

    def test_conserva_cookies_de_valor_vacio(self):
        cookies = [{"name": "a", "value": "", "domain": "santafe.gov.ar"}]
        self.assertEqual(sesion.construir_cookie(cookies), "a=")


class TestLecturaDelCaptcha(unittest.TestCase):
    def test_lee_los_digitos_que_contesta_el_modelo(self):
        digitos = sesion.leer_captcha(
            IMAGEN_PNG, CONFIG, enviar_ocr=ocr_que_devuelve("123456")
        )
        self.assertEqual(digitos, "123456")

    def test_arma_el_pedido_de_chat_con_la_imagen_y_la_api_key(self):
        capturado = {}

        def enviar_ocr(payload, headers, timeout):
            capturado["payload"] = payload
            capturado["headers"] = headers
            capturado["timeout"] = timeout
            return RespuestaFalsa(respuesta_de_chat("111111"))

        sesion.leer_captcha(IMAGEN_PNG, CONFIG, enviar_ocr=enviar_ocr)

        payload = capturado["payload"]
        self.assertEqual(payload["model"], CONFIG.modelo_captcha)
        self.assertEqual(payload["temperature"], 0)

        partes = payload["messages"][0]["content"]
        tipos = [parte["type"] for parte in partes]
        self.assertEqual(tipos, ["text", "image_url"])
        self.assertIn("data:image/png;base64,", partes[1]["image_url"])
        self.assertIn(str(CONFIG.captcha_len), partes[0]["text"])

        self.assertEqual(capturado["headers"]["Authorization"], "Bearer key_test")
        self.assertEqual(capturado["timeout"], CONFIG.timeout_segundos)

    def test_no_usa_el_endpoint_de_ocr_de_documentos(self):
        """Ese endpoint devuelve alucinaciones en japones para estos captchas.

        Medido el 2026-08-31 contra ocr-latest, ocr-4-1, ocr-4, ocr-3 y
        ocr-2512: todas devuelven texto CJK en vez de digitos. Este test existe
        para que nadie lo "restaure" pensando que es lo correcto.
        """
        self.assertIn("chat/completions", sesion.MISTRAL_CHAT_URL)

        fuente = (SRC_DIR / "consulta_cuad" / "sesion.py").read_text(encoding="utf-8")
        codigo = [
            linea for linea in fuente.splitlines() if not linea.lstrip().startswith("#")
        ]
        self.assertNotIn("api.mistral.ai/v1/ocr", chr(10).join(codigo))

    def test_descarta_el_texto_que_rodea_a_los_digitos(self):
        enviar_ocr = lambda p, h, t: RespuestaFalsa(  # noqa: E731
            respuesta_de_chat("El captcha dice 9 8 7 6 5 4.")
        )
        self.assertEqual(sesion.leer_captcha(IMAGEN_PNG, CONFIG, enviar_ocr=enviar_ocr), "987654")

    def test_recorta_al_largo_esperado(self):
        enviar_ocr = lambda p, h, t: RespuestaFalsa(  # noqa: E731
            respuesta_de_chat("12345678901234")
        )
        self.assertEqual(
            len(sesion.leer_captcha(IMAGEN_PNG, CONFIG, enviar_ocr=enviar_ocr)),
            CONFIG.captcha_len,
        )

    def test_devuelve_menos_digitos_si_el_modelo_leyo_de_menos(self):
        # No se completa ni se inventa: capturar_y_resolver_captcha lo rechaza
        # y se reintenta con otro captcha. Inventar digitos fue justamente el
        # error del json_schema de la automatizacion de Kestra.
        enviar_ocr = lambda p, h, t: RespuestaFalsa(respuesta_de_chat("123"))  # noqa: E731
        self.assertEqual(sesion.leer_captcha(IMAGEN_PNG, CONFIG, enviar_ocr=enviar_ocr), "123")

    def test_un_error_http_se_reporta_como_error_http(self):
        # El mensaje tiene que nombrar el codigo. Si solo se verificara el tipo
        # de excepcion, el test pasaria igual aunque no se mirara el status:
        # un cuerpo vacio explota despues, al buscar "choices", con la misma
        # clase de error y un mensaje que no ayuda a nadie.
        enviar_ocr = lambda p, h, t: RespuestaFalsa(  # noqa: E731
            {}, status_code=401, texto="unauthorized"
        )
        with self.assertRaises(sesion.ErrorSesion) as capturado:
            sesion.leer_captcha(IMAGEN_PNG, CONFIG, enviar_ocr=enviar_ocr)

        self.assertIn("401", str(capturado.exception))
        self.assertIn("unauthorized", str(capturado.exception))

    def test_una_respuesta_con_forma_inesperada_es_error_de_sesion(self):
        enviar_ocr = lambda p, h, t: RespuestaFalsa({"algo": "raro"})  # noqa: E731
        with self.assertRaises(sesion.ErrorSesion):
            sesion.leer_captcha(IMAGEN_PNG, CONFIG, enviar_ocr=enviar_ocr)

    def test_una_imagen_vacia_no_se_manda(self):
        with self.assertRaises(ValueError):
            sesion.leer_captcha(b"", CONFIG, enviar_ocr=ocr_que_devuelve("123456"))


class TestAmpliadoDelCaptcha(unittest.TestCase):
    """El captcha viene de 86x21 px y a ese tamano ningun modelo lo lee.

    Ver la tabla de mediciones en sesion.ESCALA_CAPTCHA: a 1x y 2x fallan
    todos; a 8x aciertan. Ampliar no es un detalle, es lo que hace que el
    login funcione.
    """

    def _tamano(self, datos):
        from PIL import Image

        return Image.open(io.BytesIO(datos)).size

    def test_amplia_por_el_factor_pedido(self):
        self.assertEqual(self._tamano(IMAGEN_PNG), (10, 4))
        self.assertEqual(self._tamano(sesion.ampliar_captcha(IMAGEN_PNG, 8)), (80, 32))

    def test_factor_uno_no_toca_la_imagen(self):
        self.assertIs(sesion.ampliar_captcha(IMAGEN_PNG, 1), IMAGEN_PNG)

    def test_el_default_es_ocho(self):
        self.assertEqual(sesion.ESCALA_CAPTCHA, 8)
        self.assertEqual(CONFIG.escala_captcha, 8)

    def test_leer_captcha_manda_la_imagen_ya_ampliada(self):
        capturado = {}

        def enviar_ocr(payload, headers, timeout):
            import base64

            uri = payload["messages"][0]["content"][1]["image_url"]
            capturado["bytes"] = base64.b64decode(uri.split(",", 1)[1])
            return RespuestaFalsa(respuesta_de_chat("123456"))

        sesion.leer_captcha(IMAGEN_PNG, CONFIG, enviar_ocr=enviar_ocr)
        self.assertEqual(self._tamano(capturado["bytes"]), (80, 32))


class TestCapturaDelCaptcha(unittest.TestCase):
    def _frame_captcha(self):
        frame = FrameFalso(name="iCaptcha", url="Captcha/aspcaptcha.asp")
        frame.poner("img", LocatorFalso(cantidad=1))
        return frame

    def test_devuelve_los_digitos_cuando_el_largo_es_el_esperado(self):
        texto = sesion.capturar_y_resolver_captcha(
            self._frame_captcha(), 1, CONFIG, ocr_que_devuelve("123456")
        )
        self.assertEqual(texto, "123456")

    def test_rechaza_un_ocr_incompleto(self):
        # Mejor fallar y reintentar que mandar un captcha corto y comerse un
        # login fallido sin saber por que.
        with self.assertRaises(sesion.ErrorLogin):
            sesion.capturar_y_resolver_captcha(
                self._frame_captcha(), 1, CONFIG, ocr_que_devuelve("123")
            )


class TestBusquedaDeFrames(unittest.TestCase):
    def test_encuentra_los_dos_frames_en_una_pagina_normal(self):
        page = pagina_de_login()
        login, captcha = sesion.obtener_frames(page)

        self.assertEqual(login.name, "iContenido")
        self.assertEqual(captcha.name, "iCaptcha")

    def test_encuentra_el_login_aunque_no_tenga_url_ni_nombre_conocidos(self):
        # Ultimo recurso: buscar por presencia de los tres selectores.
        principal = FrameFalso(url="https://www.santafe.gov.ar/cuad/")
        raro = FrameFalso(
            name="otro_nombre",
            url="https://www.santafe.gov.ar/cuad/otra.asp",
            selectores=("#user", "#password", "#txtCaptcha"),
        )
        captcha = FrameFalso(name="x", url="about:blank")
        captcha.poner("img", LocatorFalso(cantidad=1))
        page = PageFalsa(frames=[principal, raro, captcha])

        login, encontrado = sesion.obtener_frames(page)
        self.assertIs(login, raro)
        self.assertIs(encontrado, captcha)

    def test_descarta_un_frame_que_tiene_la_url_pero_no_los_campos(self):
        principal = FrameFalso(url="https://www.santafe.gov.ar/cuad/")
        impostor = FrameFalso(name="iContenido", url="login.asp?Modo=M")  # sin selectores
        bueno = FrameFalso(
            name="otro",
            url="https://www.santafe.gov.ar/cuad/x.asp",
            selectores=("#user", "#password", "#txtCaptcha"),
        )
        page = PageFalsa(frames=[principal, impostor, bueno])

        login, _ = sesion.obtener_frames(page)
        self.assertIs(login, bueno)

    def test_el_frame_llamado_iContenido_le_gana_al_que_aparece_primero(self):
        """Por que hay DOS validaciones de selectores en obtener_frames.

        Si el frame hallado por URL no sirve, la primera validacion lo
        descarta a tiempo para que la busqueda POR NOMBRE tenga su turno. Sin
        ella se saltea el nombre y gana el primer frame del documento que
        tenga los tres campos, que no es necesariamente el correcto.
        """
        principal = FrameFalso(url="https://www.santafe.gov.ar/cuad/")
        por_url = FrameFalso(name="vacio", url="login.asp?Modo=M")  # sin campos
        primero_del_documento = FrameFalso(
            name="otroCualquiera",
            url="https://www.santafe.gov.ar/cuad/a.asp",
            selectores=("#user", "#password", "#txtCaptcha"),
        )
        el_correcto = FrameFalso(
            name="iContenido",
            url="https://www.santafe.gov.ar/cuad/b.asp",
            selectores=("#user", "#password", "#txtCaptcha"),
        )
        page = PageFalsa(
            frames=[principal, por_url, primero_del_documento, el_correcto]
        )

        login, _ = sesion.obtener_frames(page)
        self.assertIs(login, el_correcto)

    def test_para_el_captcha_prefiere_el_frame_de_url_en_blanco(self):
        principal = FrameFalso(url="https://www.santafe.gov.ar/cuad/")
        login = FrameFalso(
            name="iContenido",
            url="login.asp?Modo=M",
            selectores=("#user", "#password", "#txtCaptcha"),
        )
        con_url = FrameFalso(name="a", url="https://www.santafe.gov.ar/otra.asp")
        con_url.poner("img", LocatorFalso(cantidad=5))
        en_blanco = FrameFalso(name="b", url="about:blank")
        en_blanco.poner("img", LocatorFalso(cantidad=1))
        page = PageFalsa(frames=[principal, login, con_url, en_blanco])

        _, captcha = sesion.obtener_frames(page)
        self.assertIs(captcha, en_blanco)

    def test_describir_frames_deja_todo_lo_necesario_para_debuggear(self):
        page = pagina_de_login()
        descripcion = sesion.describir_frames(page)

        self.assertEqual(len(descripcion), 3)
        login = [f for f in descripcion if f["name"] == "iContenido"][0]
        self.assertTrue(login["has_user"])
        self.assertTrue(login["has_txtCaptcha"])
        captcha = [f for f in descripcion if f["name"] == "iCaptcha"][0]
        self.assertEqual(captcha["img_count"], 1)
        self.assertFalse(captcha["has_user"])

    def test_no_explota_si_un_locator_falla(self):
        class FrameRoto(FrameFalso):
            def locator(self, selector):
                raise RuntimeError("frame desconectado")

        self.assertEqual(sesion.contar_selector(FrameRoto(), "#user"), 0)


class TestFormulario(unittest.TestCase):
    def test_cargar_input_verifica_que_el_texto_haya_quedado(self):
        frame = FrameFalso(selectores=("#user",))
        self.assertEqual(sesion.cargar_input(frame, "#user", "pepe", "usuario"), "pepe")

    def test_cargar_input_falla_si_el_campo_se_limpia_solo(self):
        class LocatorQueSeLimpia(LocatorFalso):
            def fill(self, texto):
                self.valor = ""

        frame = FrameFalso()
        frame.poner("#user", LocatorQueSeLimpia())

        with self.assertRaises(sesion.ErrorLogin):
            sesion.cargar_input(frame, "#user", "pepe", "usuario")

    def test_enviar_formulario_usa_el_javascript_si_esta(self):
        page = PageFalsa(frames=[FrameFalso(name="iContenido")])
        sesion.enviar_formulario(page.frames[0])
        self.assertEqual(page.envios, 1)

    def test_enviar_formulario_cae_a_clickear_el_boton(self):
        frame = FrameFalso(name="iContenido", evaluate_falla=True)
        boton = LocatorFalso(cantidad=1)
        frame.poner("#btntb_0_over", boton)
        PageFalsa(frames=[frame])

        sesion.enviar_formulario(frame)
        self.assertEqual(boton.clicks, 1)

    def test_enviar_formulario_cae_al_texto_ingresar_si_no_hay_boton(self):
        frame = FrameFalso(name="iContenido", evaluate_falla=True)
        page = PageFalsa(frames=[frame])

        sesion.enviar_formulario(frame)
        self.assertEqual(page.envios, 1)  # se llamo a frame.click("text=Ingresar")


class TestResolverLogin(unittest.TestCase):
    def test_entra_al_primer_intento(self):
        page = pagina_de_login(envios_para_entrar=1)
        intentos = sesion.resolver_login(page, CONFIG, ocr_que_devuelve("123456"))
        self.assertEqual(intentos, 1)

    def test_reintenta_hasta_que_el_ocr_acierta(self):
        # Que el OCR falle algunas veces es normal y no es un error.
        page = pagina_de_login(envios_para_entrar=3)
        intentos = sesion.resolver_login(page, CONFIG, ocr_que_devuelve("123456"))
        self.assertEqual(intentos, 3)
        self.assertEqual(page.envios, 3)

    def test_se_rinde_despues_del_maximo(self):
        page = pagina_de_login(envios_para_entrar=999)
        config = sesion.ConfigSesion(
            usuario="u", password="p", mistral_api_key="k",
            max_intentos=4, pre_submit_delay_ms=0, post_submit_wait_ms=0,
        )

        with self.assertRaises(sesion.ErrorLogin):
            sesion.resolver_login(page, config, ocr_que_devuelve("123456"))

        self.assertEqual(page.envios, 4)

    def test_falla_claro_si_se_pierde_un_frame(self):
        page = PageFalsa(frames=[FrameFalso(url="https://www.santafe.gov.ar/cuad/")])

        with self.assertRaises(sesion.ErrorLogin) as capturado:
            sesion.resolver_login(page, CONFIG, ocr_que_devuelve("123456"))

        self.assertIn("frame", str(capturado.exception).lower())

    def test_carga_el_usuario_al_iniciar(self):
        page = pagina_de_login()
        sesion.iniciar_login(page, CONFIG)

        login = page.frames[1]
        self.assertEqual(login.locator("#user").input_value(), CONFIG.usuario)
        self.assertEqual(page.visitadas, [CONFIG.login_url])


class TestTransporteNavegador(unittest.TestCase):
    def test_decodifica_latin1_en_vez_de_usar_el_default_utf8_de_playwright(self):
        transporte = sesion.TransporteNavegador.__new__(sesion.TransporteNavegador)
        transporte._request = RequestContextFalso(b"Jos\xe9")
        transporte._user_agent = "test"

        texto_post = transporte.post_form("https://cuad.test", {}, {})
        texto_get = transporte.get("https://cuad.test", {}, {})

        self.assertEqual(texto_post, "Jos\xe9")
        self.assertEqual(texto_get, "Jos\xe9")


class TestResolverLoginManual(unittest.TestCase):
    def test_espera_al_operador_y_confirma_el_login(self):
        page = pagina_de_login(envios_para_entrar=1)

        def operador(_mensaje):
            page.envios = 1

        intentos = sesion.resolver_login_manual(page, CONFIG, esperar_input=operador)

        self.assertEqual(intentos, 1)
        self.assertEqual(page.frames[1].locator("#password").input_value(), CONFIG.password)

    def test_falla_si_el_operador_no_logro_entrar(self):
        page = pagina_de_login(envios_para_entrar=999)

        with self.assertRaises(sesion.ErrorLogin) as capturado:
            sesion.resolver_login_manual(page, CONFIG, esperar_input=lambda _mensaje: None)

        self.assertIn("manual", str(capturado.exception).lower())


class TestLecturaMalaEsRecuperable(unittest.TestCase):
    """Una lectura corta del captcha no puede matar el login.

    El modelo a veces confunde un digito con una letra y devuelve '8D3917',
    que al filtrar digitos queda en 5. Eso es un intento perdido, no un
    fracaso: se pide otro captcha. Heredado de service.py, antes abortaba
    todo, y por eso max_intentos no servia para nada.
    """

    def test_el_error_de_lectura_es_un_error_de_login(self):
        self.assertTrue(issubclass(sesion.ErrorLecturaCaptcha, sesion.ErrorLogin))

    def test_una_lectura_corta_se_rechaza(self):
        frame = FrameFalso(name="iCaptcha", url="Captcha/aspcaptcha.asp")
        frame.poner("img", LocatorFalso(cantidad=1))

        with self.assertRaises(sesion.ErrorLecturaCaptcha):
            sesion.capturar_y_resolver_captcha(frame, 1, CONFIG, ocr_que_devuelve("123"))

    def test_leer_captcha_no_completa_los_digitos_que_faltan(self):
        # Inventar para llegar al largo es lo que hacia la version de Kestra
        # con su json_schema, y por eso una alucinacion pasaba por lectura.
        enviar_ocr = lambda p, h, t: RespuestaFalsa(respuesta_de_chat("8D3917"))  # noqa: E731
        self.assertEqual(sesion.leer_captcha(IMAGEN_PNG, CONFIG, enviar_ocr=enviar_ocr), "83917")

    def test_el_login_reintenta_en_vez_de_abortar(self):
        lecturas = ["123", "12", "123456"]  # dos malas y despues una buena

        def enviar_ocr(payload, headers, timeout):
            return RespuestaFalsa(respuesta_de_chat(lecturas.pop(0)))

        page = pagina_de_login(envios_para_entrar=1)
        intentos = sesion.resolver_login(page, CONFIG, enviar_ocr)

        # Tres intentos: dos descartados por largo y el tercero entra.
        self.assertEqual(intentos, 3)
        self.assertEqual(page.envios, 1)  # solo se envio el formulario una vez

    def test_recarga_la_pagina_para_pedir_otro_captcha(self):
        # Sin recargar, el proximo intento le sacaria foto al MISMO captcha y
        # fallaria igual hasta agotar los intentos.
        lecturas = ["123", "123456"]

        def enviar_ocr(payload, headers, timeout):
            return RespuestaFalsa(respuesta_de_chat(lecturas.pop(0)))

        page = pagina_de_login(envios_para_entrar=1)
        sesion.resolver_login(page, CONFIG, enviar_ocr)

        self.assertEqual(len(page.visitadas), 1)  # se volvio al login una vez

    def test_se_rinde_si_todas_las_lecturas_son_malas(self):
        config = sesion.ConfigSesion(
            usuario="u", password="p", mistral_api_key="k",
            max_intentos=3, pre_submit_delay_ms=0, post_submit_wait_ms=0,
        )
        page = pagina_de_login(envios_para_entrar=1)

        with self.assertRaises(sesion.ErrorLogin) as capturado:
            sesion.resolver_login(page, config, ocr_que_devuelve("12"))

        self.assertIn("3 lecturas", str(capturado.exception))
        self.assertEqual(page.envios, 0)  # nunca se llego a enviar


class TestSesionCuad(unittest.TestCase):
    def _sesion(self, page=None, **kwargs):
        page = page or pagina_de_login()

        @contextmanager
        def abrir(config):
            yield page

        return sesion.SesionCuad(
            CONFIG, abrir_navegador=abrir, enviar_ocr=ocr_que_devuelve("123456"), **kwargs
        ), page

    def test_la_primera_llamada_a_cookie_hace_login(self):
        objeto, _ = self._sesion()
        cookie = objeto.cookie()

        self.assertEqual(cookie, "usuario_CUAD=usuario_test; ASPSESSIONIDABC=XYZ123")
        self.assertEqual(objeto.cantidad_de_logins, 1)

    def test_las_siguientes_llamadas_reusan_la_cookie(self):
        objeto, _ = self._sesion()
        primera = objeto.cookie()
        segunda = objeto.cookie()

        self.assertEqual(primera, segunda)
        self.assertEqual(objeto.cantidad_de_logins, 1)

    def test_renovar_vuelve_a_loguearse(self):
        objeto, _ = self._sesion()
        objeto.cookie()
        objeto.renovar()

        self.assertEqual(objeto.cantidad_de_logins, 2)

    def test_olvidar_fuerza_un_login_en_la_proxima_lectura(self):
        objeto, _ = self._sesion()
        objeto.cookie()
        objeto.olvidar()
        objeto.cookie()

        self.assertEqual(objeto.cantidad_de_logins, 2)

    def test_registra_cuantos_intentos_costo_el_captcha(self):
        objeto, _ = self._sesion(page=pagina_de_login(envios_para_entrar=3))
        objeto.cookie()

        self.assertEqual(objeto.intentos_ultimo_login, 3)

    def test_falla_si_el_login_no_dejo_ninguna_cookie(self):
        # Sin esto la corrida seguiria con cookie vacia y fallaria 1000 veces
        # con "sesion_invalida" sin decir por que.
        objeto, _ = self._sesion(page=pagina_de_login(cookies=[]))

        with self.assertRaises(sesion.ErrorLogin):
            objeto.cookie()

    def test_ignora_cookies_que_no_son_de_cuad(self):
        page = pagina_de_login(
            cookies=[{"name": "otra", "value": "x", "domain": "google.com"}]
        )
        objeto, _ = self._sesion(page=page)

        with self.assertRaises(sesion.ErrorLogin):
            objeto.cookie()

    def test_el_navegador_se_cierra_aunque_el_login_falle(self):
        cerrado = []
        page = pagina_de_login(envios_para_entrar=999)

        @contextmanager
        def abrir(config):
            try:
                yield page
            finally:
                cerrado.append(True)

        config = sesion.ConfigSesion(
            usuario="u", password="p", mistral_api_key="k",
            max_intentos=2, pre_submit_delay_ms=0, post_submit_wait_ms=0,
        )
        objeto = sesion.SesionCuad(config, abrir_navegador=abrir, enviar_ocr=ocr_que_devuelve("123456"))

        with self.assertRaises(sesion.ErrorLogin):
            objeto.cookie()

        self.assertEqual(cerrado, [True])

    def test_el_modo_manual_no_llama_al_modelo(self):
        config = sesion.ConfigSesion(
            usuario="u", password="p", mistral_api_key="", modo_login="manual"
        )
        page = pagina_de_login()

        @contextmanager
        def abrir(_config):
            yield page

        objeto = sesion.SesionCuad(config, abrir_navegador=abrir)
        with patch.object(sesion, "resolver_login_manual", return_value=1) as manual, \
             patch.object(sesion, "resolver_login") as vision:
            objeto.cookie()

        manual.assert_called_once()
        vision.assert_not_called()


class TestConfiguracion(unittest.TestCase):
    ENTORNO_MINIMO = {
        "CUAD_USUARIO": "u",
        "CUAD_PASSWORD": "p",
        "MISTRAL_API_KEY": "k",
    }

    def test_toma_las_credenciales_del_entorno(self):
        with patch.dict("os.environ", self.ENTORNO_MINIMO, clear=True):
            config = sesion.config_desde_entorno()

        self.assertEqual(config.usuario, "u")
        self.assertEqual(config.password, "p")
        self.assertEqual(config.mistral_api_key, "k")

    def test_los_defaults(self):
        with patch.dict("os.environ", self.ENTORNO_MINIMO, clear=True):
            config = sesion.config_desde_entorno()

        self.assertEqual(config.captcha_len, 6)
        # 25 y no 10 como la automatizacion de Kestra: medido contra CUAD
        # real, el modelo acierta ~1 de cada 6 captchas, y con 10 intentos el
        # login falla seguido. Cada intento cuesta unos 5 segundos.
        self.assertEqual(config.max_intentos, 25)
        self.assertEqual(config.timeout_segundos, 60.0)
        self.assertEqual(config.pre_submit_delay_ms, 1500)
        self.assertEqual(config.post_submit_wait_ms, 3000)
        self.assertEqual(config.modelo_captcha, "pixtral-12b-latest")
        self.assertEqual(config.escala_captcha, 8)

    def test_timeout_ms_se_deriva_de_los_segundos(self):
        self.assertEqual(CONFIG.timeout_ms, 60_000)

    def test_falla_si_faltan_las_credenciales_de_cuad(self):
        with patch.dict("os.environ", {"MISTRAL_API_KEY": "k"}, clear=True):
            with self.assertRaises(sesion.ErrorConfiguracion):
                sesion.config_desde_entorno()

    def test_falla_si_falta_la_key_de_mistral(self):
        entorno = {"CUAD_USUARIO": "u", "CUAD_PASSWORD": "p"}
        with patch.dict("os.environ", entorno, clear=True):
            with self.assertRaises(sesion.ErrorConfiguracion):
                sesion.config_desde_entorno()

    def test_el_modo_manual_no_requiere_key_de_mistral(self):
        entorno = {"CUAD_USUARIO": "u", "CUAD_PASSWORD": "p", "CUAD_MODO_LOGIN": "manual"}
        with patch.dict("os.environ", entorno, clear=True):
            config = sesion.config_desde_entorno()

        self.assertEqual(config.modo_login, "manual")
        self.assertEqual(config.mistral_api_key, "")

    def test_rechaza_un_modo_de_login_desconocido(self):
        entorno = dict(self.ENTORNO_MINIMO, CUAD_MODO_LOGIN="otro")
        with patch.dict("os.environ", entorno, clear=True):
            with self.assertRaises(sesion.ErrorConfiguracion):
                sesion.config_desde_entorno()

    def test_falla_si_un_numero_no_es_numero(self):
        entorno = dict(self.ENTORNO_MINIMO, CUAD_MAX_INTENTOS="muchos")
        with patch.dict("os.environ", entorno, clear=True):
            with self.assertRaises(sesion.ErrorConfiguracion):
                sesion.config_desde_entorno()

    def test_falla_si_el_timeout_es_cero(self):
        entorno = dict(self.ENTORNO_MINIMO, CUAD_TIMEOUT_SECONDS="0")
        with patch.dict("os.environ", entorno, clear=True):
            with self.assertRaises(sesion.ErrorConfiguracion):
                sesion.config_desde_entorno()

    def test_una_variable_vacia_cae_al_default(self):
        entorno = dict(self.ENTORNO_MINIMO, CUAD_MAX_INTENTOS="")
        with patch.dict("os.environ", entorno, clear=True):
            config = sesion.config_desde_entorno()

        self.assertEqual(config.max_intentos, 25)

    def test_la_config_es_inmutable(self):
        with self.assertRaises(Exception):
            CONFIG.usuario = "otro"


if __name__ == "__main__":
    unittest.main()
