"""Login automatico en CUAD, resolviendo el captcha con un modelo de vision.

Es la unica pieza que no viene de main2.py: sale de la automatizacion de
Kestra (kestra/automations/analisis-credito/files/consulta_cuad/service.py),
que ya resolvia el login para consultas de a un CUIL.

QUE HACE Y QUE NO
-----------------
Produce un string de cookie valido para CUAD. Nada mas. El resto del programa
(cuad.py) habla HTTP plano con esa cookie y no sabe que existe un navegador.

Por eso el navegador es transitorio: se abre, se loguea, se saca la cookie del
contexto y se cierra. Una corrida de 1000 socios usa Playwright unos 20
segundos y despues son horas de urllib. Dejar Chromium abierto todo ese tiempo
seria pagar memoria por algo que no se usa.

POR QUE ESTO IMPORTA
--------------------
En main2.py la cookie se pegaba a mano y, cuando vencia, la corrida se
frenaba hasta que alguien estuviera disponible para renovarla. En la corrida
de julio eso paso 7 veces: 10 horas de trabajo tardaron dos dias. Con esto,
renovar la sesion es una llamada a renovar().

EL LOGIN DE CUAD, POR SI HAY QUE DEBUGGEARLO
--------------------------------------------
La pantalla esta armada con frames y no siempre son los mismos ni tienen los
mismos nombres, asi que hay que salir a buscarlos:

- el frame de login  : tiene #user, #password y #txtCaptcha
- el frame de captcha: tiene un <img> con la imagen a resolver

La busqueda intenta por URL, despues por nombre y por ultimo por presencia de
selectores. Es fragil por naturaleza —depende del HTML de un sitio de
terceros— y por eso describir_frames() existe: cuando falla, deja en el log
que frames habia y que tenia cada uno.
"""

import base64
import io
import json
import logging
import os
import time
from contextlib import contextmanager
from dataclasses import dataclass

import requests
from PIL import Image

logger = logging.getLogger(__name__)

LOGIN_URL = "https://www.santafe.gov.ar/cuad/"
DOMINIO_COOKIES = "santafe.gov.ar"

BOTON_INGRESAR_SELECTOR = "#dAceptar"
LOGIN_INPUT_SELECTORS = ("#user", "#password", "#txtCaptcha")
LOGIN_FRAME_DISCOVERY_TIMEOUT_MS = 8_000
LOGIN_FRAME_POLL_INTERVAL_MS = 250

# NO USAR https://api.mistral.ai/v1/ocr PARA ESTO.
#
# La automatizacion de Kestra usa ese endpoint con mistral-ocr-latest, y esta
# roto para captchas: medido el 2026-08-31, TODAS las versiones (ocr-latest,
# ocr-4-1, ocr-4, ocr-3, ocr-2512) devuelven texto alucinado en japones o
# chino ('• **ヒューマン**', '# 相關詞') en lugar de los digitos. Es un modelo
# de OCR de documentos y un captcha no es un documento.
#
# Peor: la automatizacion le pasa un json_schema con pattern ^[0-9]{6}$, que
# obliga al modelo a devolver seis digitos igual. Asi la alucinacion sale
# disfrazada de lectura valida ('100000', '111111') y el login falla diez
# veces sin decir por que.
#
# Lo que si funciona es un modelo de vision por chat. Verificado con un login
# real contra CUAD.
MISTRAL_CHAT_URL = "https://api.mistral.ai/v1/chat/completions"
MODELO_CAPTCHA = "pixtral-12b-latest"

# La imagen del captcha viene de 86x21 px: unos 14 px por digito. A ese tamano
# ningun modelo acierta. Medido sobre el mismo captcha (valor real 637333):
#
#   escala   pixtral-12b   ministral-8b
#   1x       667393        607303
#   2x       603733        603763
#   4x       637333 OK     163733
#   8x       637333 OK     637333 OK
#
# Por eso se amplia antes de mandarla. Es el parametro que decide si esto
# funciona o no.
ESCALA_CAPTCHA = 8

# Cuantas veces reintentar el captcha antes de rendirse.
#
# El modelo acierta aproximadamente 1 de cada 6 captchas (medido contra CUAD
# real). Con lecturas independientes, 25 intentos dan ~99% de probabilidad de
# entrar, y cada intento cuesta unos 5 segundos.
#
# Se probo pedir acuerdo entre lecturas a 4x, 8x y 12x como medida de
# confianza. NO funciono: descarto 9 de cada 10 captchas porque las lecturas
# quedan cerca pero distintas ('473711' / '477771' / '472779'), y la unica que
# tuvo acuerdo igual fue rechazada. Reintentar sale mas barato.
MAX_INTENTOS_CAPTCHA = 25

PROMPT_CAPTCHA = (
    "Esta imagen es un captcha que contiene exactamente {largo} digitos numericos. "
    "Responde SOLO con los {largo} digitos, sin texto, espacios ni puntuacion."
)


class ErrorSesion(RuntimeError):
    """Falla al conseguir una sesion de CUAD."""


class ErrorConfiguracion(ErrorSesion):
    """Falta configuracion, o esta mal puesta."""


class ErrorLogin(ErrorSesion):
    """El login no se pudo completar."""


# Codigos que valen la pena reintentar: la API esta saturada o caida un rato,
# no hay nada mal de nuestro lado. Un 401 o un 403, en cambio, no se arreglan
# reintentando.
HTTP_TRANSITORIOS = {408, 425, 429, 500, 502, 503, 504}


class ErrorLecturaCaptcha(ErrorLogin):
    """El modelo no devolvio la cantidad de digitos esperada.

    Es RECUPERABLE: no significa que el login este mal, solo que esta lectura
    no sirve. Se pide otro captcha y se sigue. Que esto abortara la corrida
    entera era un defecto heredado de service.py.
    """


class ErrorModeloTransitorio(ErrorLecturaCaptcha):
    """La API del modelo contesto un error pasajero (429, 503...).

    Hereda de ErrorLecturaCaptcha para que el bucle de login lo reintente en
    vez de abandonar: una corrida de cinco horas no puede morirse porque la
    API estuvo saturada diez segundos.
    """


class TransporteNavegador:
    """HTTP de CUAD dentro del BrowserContext que hizo el login.

    `context.request` comparte el jar de cookies con la pagina de Playwright.
    Asi no se transforma una sesion de navegador en una cookie suelta usada por
    otro cliente HTTP, que algunos servidores antiguos invalidan rapidamente.
    """

    def __init__(self, page):
        self._request = page.context.request
        self._user_agent = page.evaluate("() => navigator.userAgent")

    def post_form(self, url, payload, headers):
        respuesta = self._request.post(
            url,
            form=payload,
            headers={**headers, "User-Agent": self._user_agent},
        )
        # CUAD no declara UTF-8. APIResponse.text() asume UTF-8 y falla con
        # acentos; el transporte historico siempre leyo estos bytes como latin-1.
        return respuesta.body().decode("latin-1", errors="replace")

    def get(self, url, params, headers):
        respuesta = self._request.get(
            url,
            params=params,
            headers={**headers, "User-Agent": self._user_agent},
        )
        return respuesta.body().decode("latin-1", errors="replace")


@dataclass(frozen=True)
class ConfigSesion:
    usuario: str
    password: str
    mistral_api_key: str
    modo_login: str = "vision"
    login_url: str = LOGIN_URL
    dominio_cookies: str = DOMINIO_COOKIES
    modelo_captcha: str = MODELO_CAPTCHA
    escala_captcha: int = ESCALA_CAPTCHA
    captcha_len: int = 6
    timeout_segundos: float = 60.0
    max_intentos: int = MAX_INTENTOS_CAPTCHA
    espera_api_segundos: float = 2.0
    pre_submit_delay_ms: int = 1500
    post_submit_wait_ms: int = 3000

    @property
    def timeout_ms(self) -> int:
        return int(self.timeout_segundos * 1000)


def _entero_de_entorno(nombre, defecto):
    crudo = (os.getenv(nombre, "") or "").strip() or str(defecto)
    try:
        return int(crudo)
    except ValueError as exc:
        raise ErrorConfiguracion(f"{nombre} tiene que ser un entero.") from exc


def config_desde_entorno(modo_login=None):
    """Arma la config desde variables de entorno.

    Las credenciales NUNCA se hardcodean: es exactamente lo que estaba mal en
    main2.py, que traia una cookie de sesion real escrita en el codigo.
    """
    usuario = os.getenv("CUAD_USUARIO", "").strip()
    password = os.getenv("CUAD_PASSWORD", "").strip()
    mistral_api_key = os.getenv("MISTRAL_API_KEY", "").strip()
    modo_login = (modo_login or os.getenv("CUAD_MODO_LOGIN", "vision")).strip().lower()

    if not usuario or not password:
        raise ErrorConfiguracion("Faltan CUAD_USUARIO o CUAD_PASSWORD.")
    if modo_login not in {"vision", "manual"}:
        raise ErrorConfiguracion("CUAD_MODO_LOGIN debe ser 'vision' o 'manual'.")
    if modo_login == "vision" and not mistral_api_key:
        raise ErrorConfiguracion("Falta MISTRAL_API_KEY.")

    try:
        timeout_segundos = float((os.getenv("CUAD_TIMEOUT_SECONDS", "") or "60").strip())
    except ValueError as exc:
        raise ErrorConfiguracion("CUAD_TIMEOUT_SECONDS tiene que ser un numero.") from exc

    if timeout_segundos <= 0:
        raise ErrorConfiguracion("CUAD_TIMEOUT_SECONDS tiene que ser mayor que 0.")

    config = ConfigSesion(
        usuario=usuario,
        password=password,
        mistral_api_key=mistral_api_key,
        modo_login=modo_login,
        login_url=(os.getenv("CUAD_LOGIN_URL", "") or LOGIN_URL).strip(),
        modelo_captcha=(os.getenv("CUAD_CAPTCHA_MODELO", "") or MODELO_CAPTCHA).strip(),
        escala_captcha=_entero_de_entorno("CUAD_CAPTCHA_ESCALA", ESCALA_CAPTCHA),
        captcha_len=_entero_de_entorno("CUAD_CAPTCHA_LEN", 6),
        timeout_segundos=timeout_segundos,
        max_intentos=_entero_de_entorno("CUAD_MAX_INTENTOS", MAX_INTENTOS_CAPTCHA),
        pre_submit_delay_ms=_entero_de_entorno("CUAD_PRE_SUBMIT_DELAY_MS", 1500),
        post_submit_wait_ms=_entero_de_entorno("CUAD_POST_SUBMIT_WAIT_MS", 3000),
    )

    if config.max_intentos <= 0:
        raise ErrorConfiguracion("CUAD_MAX_INTENTOS tiene que ser mayor que 0.")
    if config.captcha_len <= 0:
        raise ErrorConfiguracion("CUAD_CAPTCHA_LEN tiene que ser mayor que 0.")

    return config


# --------------------------------------------------------------------------
# Armado de la cookie: funcion pura, sin navegador de por medio.
# --------------------------------------------------------------------------


def construir_cookie(cookies, dominio=DOMINIO_COOKIES):
    """Convierte las cookies del contexto de Playwright en un header Cookie.

    Se filtra por dominio para no mandarle a CUAD cookies de otros sitios que
    hayan quedado en el contexto.
    """
    partes = []

    for cookie in cookies or []:
        nombre = cookie.get("name")
        if not nombre:
            continue

        if dominio:
            propio = (cookie.get("domain") or "").lstrip(".")
            if propio != dominio and not propio.endswith("." + dominio):
                continue

        partes.append(f"{nombre}={cookie.get('value', '')}")

    return "; ".join(partes)


# --------------------------------------------------------------------------
# OCR del captcha
# --------------------------------------------------------------------------


def _enviar_a_mistral(payload, headers, timeout):
    return requests.post(MISTRAL_CHAT_URL, headers=headers, json=payload, timeout=timeout)


def ampliar_captcha(contenido_img, factor):
    """Agranda la imagen antes de mandarla al modelo.

    Sin esto no funciona: ver la tabla de mediciones arriba, en ESCALA_CAPTCHA.
    """
    if factor <= 1:
        return contenido_img

    imagen = Image.open(io.BytesIO(contenido_img)).convert("RGB")
    ampliada = imagen.resize(
        (imagen.width * factor, imagen.height * factor), Image.LANCZOS
    )

    buffer = io.BytesIO()
    ampliada.save(buffer, format="PNG")
    return buffer.getvalue()


def _preguntar_al_modelo(contenido_img, escala, config, enviar_ocr):
    """Una lectura del captcha a una escala dada."""
    imagen = ampliar_captcha(contenido_img, escala)
    image_b64 = base64.b64encode(imagen).decode("ascii")

    payload = {
        "model": config.modelo_captcha,
        "temperature": 0,
        "max_tokens": 20,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": PROMPT_CAPTCHA.format(largo=config.captcha_len),
                    },
                    {
                        "type": "image_url",
                        "image_url": f"data:image/png;base64,{image_b64}",
                    },
                ],
            }
        ],
    }
    headers = {
        "Authorization": f"Bearer {config.mistral_api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    response = enviar_ocr(payload, headers, config.timeout_segundos)

    if response.status_code in HTTP_TRANSITORIOS:
        raise ErrorModeloTransitorio(
            f"El modelo de captcha contesto HTTP {response.status_code} "
            f"(pasajero): {response.text[:200]}"
        )

    if response.status_code >= 400:
        raise ErrorSesion(
            f"El modelo de captcha fallo con HTTP {response.status_code}: "
            f"{response.text[:300]}"
        )

    datos = response.json()

    try:
        contenido = datos["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise ErrorSesion(f"Respuesta inesperada del modelo de captcha: {error}") from error

    # El modelo suele contestar solo los digitos, pero a veces agrega texto o
    # confunde un digito con una letra ('8D3917'). Se queda con los digitos.
    return "".join(ch for ch in str(contenido) if ch.isdigit())[: config.captcha_len]


def leer_captcha(contenido_img, config, intento=1, enviar_ocr=_enviar_a_mistral):
    """Le pide a un modelo de vision que lea los digitos del captcha.

    Devuelve lo que haya leido, sin completar ni inventar. Si salen menos
    digitos de los esperados, capturar_y_resolver_captcha lo rechaza y se pide
    otro captcha. Inventar para llegar al largo fue justamente el error de la
    version de Kestra, que usaba un json_schema con pattern ^[0-9]{6}$.

    `enviar_ocr` se inyecta para poder testear sin llamar a la API.
    """
    if not contenido_img:
        raise ValueError("La imagen del captcha esta vacia.")

    digitos = _preguntar_al_modelo(
        contenido_img, config.escala_captcha, config, enviar_ocr
    )

    # Se loguea el valor a proposito: un captcha no es un secreto, y sin esto
    # no hay como distinguir "el modelo lee mal" de "las credenciales estan
    # mal", que es el pozo en el que cae la version de Kestra.
    logger.debug("Captcha intento %s: leyo %r", intento, digitos)
    return digitos


# --------------------------------------------------------------------------
# Busqueda de frames. Portado tal cual de service.py.
# --------------------------------------------------------------------------


def contar_selector(frame, selector):
    try:
        return frame.locator(selector).count()
    except Exception:
        return 0


def frame_tiene_selectores(frame, selectores):
    return all(contar_selector(frame, selector) > 0 for selector in selectores)


def frame_tiene_captcha(frame):
    return contar_selector(frame, "img") > 0


def buscar_frame_por_url(page, fragmento):
    for frame in page.frames:
        if fragmento in frame.url:
            return frame
    return None


def buscar_frame_por_nombre(page, nombre):
    for frame in page.frames:
        if frame.name == nombre:
            return frame
    return None


def buscar_frame_por_selectores(page, selectores):
    for frame in page.frames:
        if frame_tiene_selectores(frame, selectores):
            return frame
    return None


def obtener_main_frame(page):
    try:
        return page.main_frame
    except Exception:
        frames = list(page.frames)
        return frames[0] if frames else None


def buscar_frame_captcha(page, login_frame):
    if login_frame is not None and frame_tiene_captcha(login_frame):
        return login_frame

    main_frame = obtener_main_frame(page)
    candidatos = []

    for frame in page.frames:
        if login_frame is not None and frame == login_frame:
            continue
        if main_frame is not None and frame == main_frame:
            continue
        img_count = contar_selector(frame, "img")
        if img_count <= 0:
            continue
        # Se prefiere el frame de URL en blanco: el captcha se inyecta ahi.
        prefiere_url_vacia = 0 if frame.url in ("", "about:blank") else 1
        candidatos.append((prefiere_url_vacia, img_count, frame))

    if candidatos:
        candidatos.sort(key=lambda item: (item[0], item[1]))
        return candidatos[0][2]

    if main_frame is not None and frame_tiene_captcha(main_frame):
        return main_frame
    return None


def describir_frames(page):
    """Foto de los frames, para el log cuando la busqueda falla."""
    return [
        {
            "index": indice,
            "name": frame.name,
            "url": frame.url,
            "has_user": contar_selector(frame, "#user") > 0,
            "has_password": contar_selector(frame, "#password") > 0,
            "has_txtCaptcha": contar_selector(frame, "#txtCaptcha") > 0,
            "img_count": contar_selector(frame, "img"),
        }
        for indice, frame in enumerate(page.frames)
    ]


def obtener_frames(page):
    login_frame = buscar_frame_por_url(page, "login.asp?Modo=M")
    if login_frame is not None and not frame_tiene_selectores(login_frame, LOGIN_INPUT_SELECTORS):
        login_frame = None
    if login_frame is None:
        login_frame = buscar_frame_por_nombre(page, "iContenido")
    if login_frame is not None and not frame_tiene_selectores(login_frame, LOGIN_INPUT_SELECTORS):
        login_frame = None
    if login_frame is None:
        login_frame = buscar_frame_por_selectores(page, LOGIN_INPUT_SELECTORS)

    captcha_frame = buscar_frame_por_url(page, "Captcha/aspcaptcha.asp")
    if captcha_frame is not None and not frame_tiene_captcha(captcha_frame):
        captcha_frame = None
    if captcha_frame is None:
        captcha_frame = buscar_frame_captcha(page, login_frame)

    return login_frame, captcha_frame


def esperar_frames_login(page, timeout_ms):
    limite = time.monotonic() + max(timeout_ms, 0) / 1000
    while True:
        login_frame, captcha_frame = obtener_frames(page)
        if login_frame is not None and captcha_frame is not None:
            return login_frame, captcha_frame
        if time.monotonic() >= limite:
            return login_frame, captcha_frame
        page.wait_for_timeout(LOGIN_FRAME_POLL_INTERVAL_MS)


# --------------------------------------------------------------------------
# Manejo del formulario
# --------------------------------------------------------------------------


def cargar_input(frame, selector, texto, nombre_campo):
    """Escribe en un campo y verifica que haya quedado escrito.

    La verificacion no sobra: estos formularios viejos a veces tienen scripts
    que reescriben o limpian los campos, y sin el chequeo el login falla mas
    adelante por un motivo que no se entiende.
    """
    campo = frame.locator(selector)
    campo.wait_for(state="visible")
    campo.click()
    campo.press("Control+A")
    campo.press("Backspace")
    campo.fill(texto)

    valor = campo.input_value()
    if valor != texto:
        raise ErrorLogin(
            f"No se pudo cargar correctamente {nombre_campo}. "
            f"Esperado={texto!r} obtenido={valor!r}."
        )
    return valor


def enviar_formulario(login_frame):
    """Aprieta Ingresar, probando de la forma mas directa a la mas burda."""
    try:
        login_frame.evaluate("() => btnMouseClick(0)")
        return
    except Exception:
        pass

    for selector in ("#btntb_0_over", "#btntb_0_off", BOTON_INGRESAR_SELECTOR):
        boton = login_frame.locator(selector)
        if boton.count():
            boton.first.click(force=True)
            return

    login_frame.click("text=Ingresar")


def login_exitoso(page):
    """Si el campo del captcha ya no esta, es que entramos."""
    login_frame, _ = obtener_frames(page)
    if login_frame is None:
        return True

    try:
        return not login_frame.locator("#txtCaptcha").is_visible(timeout=1500)
    except Exception:
        return True


def capturar_y_resolver_captcha(captcha_frame, intento, config, enviar_ocr=_enviar_a_mistral):
    captcha_imagen = captcha_frame.locator("img").first
    captcha_imagen.wait_for(state="visible", timeout=5000)
    contenido_captcha = captcha_imagen.screenshot()

    texto_captcha = leer_captcha(contenido_captcha, config, intento, enviar_ocr)

    if len(texto_captcha) != config.captcha_len:
        raise ErrorLecturaCaptcha(
            f"Se esperaban {config.captcha_len} digitos y se leyo "
            f"{texto_captcha!r}. Suele pasar cuando el modelo confunde un "
            f"digito con una letra."
        )
    return texto_captcha


def iniciar_login(page, config):
    page.goto(config.login_url, wait_until="domcontentloaded")

    login_frame, captcha_frame = esperar_frames_login(
        page, timeout_ms=min(config.timeout_ms, LOGIN_FRAME_DISCOVERY_TIMEOUT_MS)
    )

    if login_frame is None:
        logger.error("No se encontro el frame de login. Frames: %s", describir_frames(page))
        raise ErrorLogin("No se encontro el frame del login.")
    if captcha_frame is None:
        logger.error("No se encontro el frame del captcha. Frames: %s", describir_frames(page))
        raise ErrorLogin("No se encontro el frame del captcha.")

    login_frame.wait_for_selector("#user")
    login_frame.wait_for_selector("#password")
    login_frame.wait_for_selector("#txtCaptcha")

    cargar_input(login_frame, "#user", config.usuario, "usuario")


def resolver_login(page, config, enviar_ocr=_enviar_a_mistral):
    """Reintenta el captcha hasta entrar. Devuelve cuantos intentos hicieron falta.

    Que haga falta mas de uno es normal: el OCR sobre un captcha no acierta
    siempre, y equivocarse no cuesta nada mas que pedir otra imagen.
    """
    lecturas_falladas = 0
    fallas_api = 0

    for intento in range(1, config.max_intentos + 1):
        login_frame, captcha_frame = obtener_frames(page)

        if login_frame is None or captcha_frame is None:
            logger.error(
                "Se perdio un frame durante el login (intento %s). Frames: %s",
                intento,
                describir_frames(page),
            )
            raise ErrorLogin("Se perdio el frame de login o captcha durante la autenticacion.")

        login_frame.wait_for_selector("#user")
        login_frame.wait_for_selector("#password")
        login_frame.wait_for_selector("#txtCaptcha")

        cargar_input(login_frame, "#password", config.password, "password")

        try:
            texto_captcha = capturar_y_resolver_captcha(
                captcha_frame, intento, config, enviar_ocr
            )
        except ErrorModeloTransitorio as error:
            # La API esta saturada: esperar sirve, insistir de inmediato no.
            espera = min(config.espera_api_segundos * (2 ** min(fallas_api, 4)), 60)
            fallas_api += 1
            logger.warning(
                "Intento %s: %s. Reintentando en %.0fs.", intento, error, espera
            )
            time.sleep(espera)
            iniciar_login(page, config)
            continue

        except ErrorLecturaCaptcha as error:
            # Lectura mala: no es motivo para abandonar, es para pedir otra.
            #
            # Hay que recargar si o si: sin eso el proximo intento le sacaria
            # foto al MISMO captcha y fallaria igual, hasta agotar los diez.
            # iniciar_login vuelve a la pantalla limpia y recarga el usuario.
            logger.debug("Intento %s descartado: %s", intento, error)
            lecturas_falladas += 1
            iniciar_login(page, config)
            continue

        cargar_input(login_frame, "#txtCaptcha", texto_captcha, "captcha")

        page.wait_for_timeout(config.pre_submit_delay_ms)
        enviar_formulario(login_frame)
        page.wait_for_timeout(config.post_submit_wait_ms)

        if login_exitoso(page):
            logger.info("Login de CUAD resuelto en %s intento(s).", intento)
            return intento

        logger.debug("El captcha del intento %s no fue aceptado.", intento)

    raise ErrorLogin(
        f"No se pudo completar el login despues de {config.max_intentos} intentos "
        f"({lecturas_falladas} lecturas del captcha con largo incorrecto)."
    )


def resolver_login_manual(page, config, esperar_input=input):
    """Espera que un operador autorizado complete el captcha en Chromium."""
    login_frame, _ = obtener_frames(page)
    if login_frame is None:
        raise ErrorLogin("No se encontro el frame del login manual.")

    cargar_input(login_frame, "#password", config.password, "password")
    logger.info("Resolve el captcha en la ventana de CUAD y presiona Ingresar.")
    esperar_input("Cuando CUAD haya respondido, presiona Enter para continuar... ")

    if not login_exitoso(page):
        raise ErrorLogin(
            "CUAD no confirmo el login manual. Revisa usuario, clave y captcha e intenta de nuevo."
        )
    logger.info("Login manual de CUAD resuelto.")
    return 1


# --------------------------------------------------------------------------
# Navegador
# --------------------------------------------------------------------------


@contextmanager
def navegador_playwright(config):
    """Abre Chromium visible solo para el login manual y lo cierra al salir."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=config.modo_login != "manual",
            args=["--disable-dev-shm-usage"],
        )
        try:
            page = browser.new_page()
            page.set_default_timeout(config.timeout_ms)
            yield page
        finally:
            browser.close()


class SesionCuad:
    """Consigue y renueva una cookie de CUAD.

    Uso tipico:

        sesion = SesionCuad(config)
        resultado = cuad.consultar(cuil, sesion.cookie())

        if resultado["status"] == "sesion_invalida":
            resultado = cuad.consultar(cuil, sesion.renovar())

    El navegador se abre y se cierra dentro de cada llamada, no queda vivo
    entre medio.
    """

    def __init__(self, config, abrir_navegador=navegador_playwright, enviar_ocr=_enviar_a_mistral):
        self.config = config
        self._abrir_navegador = abrir_navegador
        self._enviar_ocr = enviar_ocr
        self._cookie = None
        self._contexto_navegador = None
        self._page = None
        self._transporte = None
        self.intentos_ultimo_login = 0
        self.cantidad_de_logins = 0

    def cookie(self):
        """La cookie actual, abriendo sesion la primera vez."""
        if self._cookie is None:
            return self.renovar()
        return self._cookie

    def renovar(self):
        """Fuerza un login nuevo y devuelve la cookie fresca."""
        logger.info("Abriendo sesion en CUAD...")
        self.cerrar()

        try:
            self._contexto_navegador = self._abrir_navegador(self.config)
            page = self._contexto_navegador.__enter__()
            iniciar_login(page, self.config)
            if self.config.modo_login == "manual":
                self.intentos_ultimo_login = resolver_login_manual(page, self.config)
            else:
                self.intentos_ultimo_login = resolver_login(page, self.config, self._enviar_ocr)
            cookies = page.context.cookies()
            self._page = page
            # Los dobles de Playwright de los tests solo simulan cookies. En
            # produccion siempre existe context.request y se usa el transporte
            # compartido; el fallback conserva esas pruebas aisladas.
            if hasattr(page.context, "request"):
                self._transporte = TransporteNavegador(page)
        except Exception:
            self.cerrar()
            raise

        cookie = construir_cookie(cookies, self.config.dominio_cookies)

        if not cookie:
            self.cerrar()
            raise ErrorLogin("El login parecio funcionar pero no quedo ninguna cookie de CUAD.")

        self._cookie = cookie
        self.cantidad_de_logins += 1
        return cookie

    def transporte(self):
        """Devuelve el transporte ligado al navegador que autentico la sesion."""
        self.cookie()
        return self._transporte or self._cookie

    def cerrar(self):
        """Cierra el navegador persistente al terminar la corrida."""
        if self._contexto_navegador is not None:
            try:
                self._contexto_navegador.__exit__(None, None, None)
            finally:
                self._contexto_navegador = None
                self._page = None
                self._transporte = None

    def olvidar(self):
        """Marca la cookie como vencida sin ir a buscar otra todavia."""
        self._cookie = None
