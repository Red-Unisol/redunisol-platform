"""Sesion HTTP contra CUAD: login con captcha, peticiones y logout.

Todo es HTTP plano, sin navegador. El login es un formulario simple:
  1. GET login.asp?Modo=M   (sin esta visita el captcha sale vacio)
  2. GET Captcha/aspcaptcha.asp
  3. POST login.asp con Modo=L, user, password, txtCaptcha, hCadMac
  4. GET movimiento.asp: si muestra el formulario de login, no entro.
"""

import time

import requests

BASE = "https://www.santafe.gov.ar/cuad/"
URL_LOGIN = BASE + "login.asp"
URL_CAPTCHA = BASE + "Captcha/aspcaptcha.asp"
URL_MOVIMIENTO = BASE + "movimiento.asp"
URL_GRILLA = BASE + "grilla.asp"
URL_LOGOUT = BASE + "logout.asp"

TIMEOUT = 60
MAX_INTENTOS_LOGIN = 8
MAX_CAPTCHAS_DESCARTADOS = 40


class ErrorLogin(Exception):
    pass


class SesionVencida(Exception):
    pass


def decodificar(contenido):
    # CUAD mezcla: la plantilla viene en UTF-8 y algunos datos en latin-1.
    try:
        return contenido.decode("utf-8")
    except UnicodeDecodeError:
        return contenido.decode("cp1252", errors="replace")


def es_pantalla_login(html):
    h = html.lower()
    return "login.asp?modo=" in h or "txtcaptcha" in h


class SesionCuad:
    def __init__(self, alias, usuario, clave, lector):
        self.alias = alias
        self._usuario = usuario
        self._clave = clave
        self._lector = lector
        self._http = None

    def login(self):
        """Loguea y devuelve cuantos intentos y descartes de captcha costo."""
        descartes = 0
        for intento in range(1, MAX_INTENTOS_LOGIN + 1):
            http, lectura, d = self._captcha_legible()
            descartes += d
            http.post(
                URL_LOGIN,
                data={"Modo": "L", "user": self._usuario, "password": self._clave,
                      "txtCaptcha": lectura, "hCadMac": ""},
                headers={"Referer": URL_LOGIN + "?Modo=M"},
                timeout=TIMEOUT,
            )
            pagina = decodificar(http.get(URL_MOVIMIENTO, timeout=TIMEOUT).content)
            if not es_pantalla_login(pagina):
                self._http = http
                return {"intentos": intento, "captchas_descartados": descartes}
            time.sleep(3)
        raise ErrorLogin(
            f"[{self.alias}] {MAX_INTENTOS_LOGIN} logins fallidos seguidos. "
            "Si se repite, revisar usuario y clave."
        )

    def _captcha_legible(self):
        for descartes in range(MAX_CAPTCHAS_DESCARTADOS):
            http = requests.Session()
            http.headers.update({"User-Agent": "Mozilla/5.0", "Origin": "https://www.santafe.gov.ar"})
            http.get(URL_LOGIN, timeout=TIMEOUT)
            http.get(URL_LOGIN + "?Modo=M", timeout=TIMEOUT)
            imagen = http.get(URL_CAPTCHA, timeout=TIMEOUT).content
            lectura = self._lector.leer(imagen) if imagen else None
            if lectura:
                return http, lectura, descartes
            time.sleep(1)
        raise ErrorLogin(f"[{self.alias}] {MAX_CAPTCHAS_DESCARTADOS} captchas sin lectura confiable.")

    def post(self, url, datos):
        r = self._http.post(url, data=datos, headers={"Referer": URL_MOVIMIENTO}, timeout=TIMEOUT)
        return self._verificar(r)

    def get(self, url, params):
        r = self._http.get(url, params=params, headers={"Referer": URL_MOVIMIENTO}, timeout=TIMEOUT)
        return self._verificar(r)

    def _verificar(self, r):
        r.raise_for_status()
        html = decodificar(r.content)
        if es_pantalla_login(html):
            raise SesionVencida()
        return html

    def logout(self):
        if self._http is None:
            return
        try:
            self._http.get(URL_LOGOUT, timeout=TIMEOUT)
        except requests.RequestException:
            pass
        self._http = None
