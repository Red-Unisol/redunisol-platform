from __future__ import annotations

import base64
from dataclasses import dataclass
import json
import os
import re
import sys
import time
from typing import Any, TYPE_CHECKING

import requests

if TYPE_CHECKING:
    from playwright.sync_api import APIResponse, Frame, Page


BOTON_INGRESAR_SELECTOR = "#dAceptar"
LOGIN_INPUT_SELECTORS = ("#user", "#password", "#txtCaptcha")
LOGIN_FRAME_DISCOVERY_TIMEOUT_MS = 8_000
LOGIN_FRAME_POLL_INTERVAL_MS = 250
MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr"
MISTRAL_OCR_PROMPT = (
    "Lee este captcha y responde unicamente con 6 digitos exactos. "
    "No agregues texto, espacios, saltos de linea ni simbolos. "
    "Si algun caracter es ambiguo, devuelve tu mejor opcion para completar 6 digitos."
)
MISTRAL_OCR_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "captcha_resultado",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "captcha": {
                    "type": "string",
                    "pattern": "^[0-9]{6}$",
                }
            },
            "required": ["captcha"],
            "additionalProperties": False,
        },
    },
}


class InvalidRequestError(ValueError):
    """Raised when the webhook caller sends an invalid request."""


class CuadTechnicalError(RuntimeError):
    """Raised when the CUAD integration fails for technical reasons."""

    def __init__(
        self,
        message: str,
        *,
        status: str = "error",
        captcha_attempts: int = 0,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.captcha_attempts = captcha_attempts


class ConfigurationError(CuadTechnicalError):
    """Raised when the flow runtime configuration is invalid."""


class SessionInvalidError(CuadTechnicalError):
    """Raised when the CUAD session is invalid after login."""

    def __init__(self, message: str, *, captcha_attempts: int = 0) -> None:
        super().__init__(
            message,
            status="sesion_invalida",
            captcha_attempts=captcha_attempts,
        )


class UnexpectedResponseError(CuadTechnicalError):
    """Raised when the CUAD HTML response cannot be parsed as expected."""

    def __init__(self, message: str, *, captcha_attempts: int = 0) -> None:
        super().__init__(
            message,
            status="respuesta_no_reconocida",
            captcha_attempts=captcha_attempts,
        )


@dataclass(frozen=True)
class SearchRequest:
    cuil: str


@dataclass(frozen=True)
class CuadConfig:
    usuario: str
    password: str
    mistral_api_key: str
    login_url: str
    movimiento_url: str
    emr_nombre: str
    emr_id: str
    timeout_seconds: float
    timeout_ms: int
    max_intentos: int
    captcha_len: int
    ocr_model: str
    pre_submit_delay_ms: int
    post_submit_wait_ms: int
    debug_enabled: bool


def parse_search_request(payload: Any) -> SearchRequest:
    if isinstance(payload, dict):
        raw_cuil = (
            payload.get("cuil")
            or payload.get("cuit")
            or payload.get("cuit_cuil")
            or payload.get("emp_cod")
        )
    elif payload is None:
        raise InvalidRequestError("Missing request body.")
    elif isinstance(payload, (list, tuple)):
        raise InvalidRequestError("Body must be an object or string.")
    else:
        raw_cuil = payload

    cuil = normalize_cuil(raw_cuil)
    return SearchRequest(cuil=cuil)


def normalize_cuil(value: Any) -> str:
    digits = re.sub(r"\D+", "", str(value or ""))
    if len(digits) != 11:
        raise InvalidRequestError("Expected a CUIT/CUIL with exactly 11 digits.")
    return digits


def load_config_from_env() -> CuadConfig:
    usuario = os.getenv("CUAD_USUARIO", "").strip()
    password = os.getenv("CUAD_PASSWORD", "").strip()
    mistral_api_key = os.getenv("MISTRAL_API_KEY", "").strip()
    login_url = os.getenv("CUAD_LOGIN_URL", "https://www.santafe.gov.ar/cuad/").strip()
    movimiento_url = os.getenv(
        "CUAD_MOVIMIENTO_URL",
        "https://www.santafe.gov.ar/cuad/movimiento.asp",
    ).strip()
    emr_nombre = os.getenv("CUAD_EMR_NOMBRE", "Santa Fe - ACTIVOS").strip()
    emr_id = os.getenv("CUAD_EMR_ID", "10").strip()
    ocr_model = os.getenv("CUAD_OCR_MODEL", "mistral-ocr-latest").strip()
    debug_raw = os.getenv("CUAD_DEBUG", "").strip().lower()

    if not usuario or not password:
        raise ConfigurationError("Missing CUAD_USUARIO or CUAD_PASSWORD.")
    if not mistral_api_key:
        raise ConfigurationError("Missing MISTRAL_API_KEY.")
    if not login_url or not movimiento_url:
        raise ConfigurationError("Missing CUAD_LOGIN_URL or CUAD_MOVIMIENTO_URL.")
    try:
        timeout_seconds = float((os.getenv("CUAD_TIMEOUT_SECONDS", "60") or "60").strip())
    except ValueError as exc:
        raise ConfigurationError("CUAD_TIMEOUT_SECONDS must be a valid number.") from exc
    try:
        max_intentos = int((os.getenv("CUAD_MAX_INTENTOS", "10") or "10").strip())
    except ValueError as exc:
        raise ConfigurationError("CUAD_MAX_INTENTOS must be a valid integer.") from exc
    try:
        captcha_len = int((os.getenv("CUAD_CAPTCHA_LEN", "6") or "6").strip())
    except ValueError as exc:
        raise ConfigurationError("CUAD_CAPTCHA_LEN must be a valid integer.") from exc
    try:
        pre_submit_delay_ms = int((os.getenv("CUAD_PRE_SUBMIT_DELAY_MS", "1500") or "1500").strip())
    except ValueError as exc:
        raise ConfigurationError("CUAD_PRE_SUBMIT_DELAY_MS must be a valid integer.") from exc
    try:
        post_submit_wait_ms = int((os.getenv("CUAD_POST_SUBMIT_WAIT_MS", "3000") or "3000").strip())
    except ValueError as exc:
        raise ConfigurationError("CUAD_POST_SUBMIT_WAIT_MS must be a valid integer.") from exc
    if timeout_seconds <= 0:
        raise ConfigurationError("CUAD_TIMEOUT_SECONDS must be greater than 0.")
    if max_intentos <= 0:
        raise ConfigurationError("CUAD_MAX_INTENTOS must be greater than 0.")
    if captcha_len <= 0:
        raise ConfigurationError("CUAD_CAPTCHA_LEN must be greater than 0.")
    if pre_submit_delay_ms < 0:
        raise ConfigurationError("CUAD_PRE_SUBMIT_DELAY_MS must be greater than or equal to 0.")
    if post_submit_wait_ms < 0:
        raise ConfigurationError("CUAD_POST_SUBMIT_WAIT_MS must be greater than or equal to 0.")

    return CuadConfig(
        usuario=usuario,
        password=password,
        mistral_api_key=mistral_api_key,
        login_url=login_url,
        movimiento_url=movimiento_url,
        emr_nombre=emr_nombre,
        emr_id=emr_id,
        timeout_seconds=timeout_seconds,
        timeout_ms=int(timeout_seconds * 1000),
        max_intentos=max_intentos,
        captcha_len=captcha_len,
        ocr_model=ocr_model,
        pre_submit_delay_ms=pre_submit_delay_ms,
        post_submit_wait_ms=post_submit_wait_ms,
        debug_enabled=debug_raw in {"1", "true", "yes"},
    )


def consultar_cuad(request: SearchRequest, config: CuadConfig) -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    log_event("consulta_cuad_start", cuil=request.cuil)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage"],
        )
        page = browser.new_page()
        page.set_default_timeout(config.timeout_ms)
        captcha_attempts = 0

        try:
            _iniciar_login(page, config)
            captcha_attempts = _resolver_login(page, config)
            log_event(
                "consulta_cuad_login_ok",
                cuil=request.cuil,
                captcha_attempts=captcha_attempts,
            )
            html = consultar_movimiento(page, request, config)

            if es_sesion_invalida(html):
                log_event(
                    "consulta_cuad_session_invalid",
                    cuil=request.cuil,
                    captcha_attempts=captcha_attempts,
                )
                raise SessionInvalidError(
                    "La sesion de CUAD no es valida o vencio",
                    captcha_attempts=captcha_attempts,
                )

            if es_respuesta_sin_resultado(html):
                log_event(
                    "consulta_cuad_not_found",
                    cuil=request.cuil,
                    captcha_attempts=captcha_attempts,
                )
                return build_not_found_result(request, captcha_attempts=captcha_attempts)

            totales = parsear_totales_cuad(html)
            if totales is None:
                log_event(
                    "consulta_cuad_unexpected_response",
                    cuil=request.cuil,
                    captcha_attempts=captcha_attempts,
                )
                raise UnexpectedResponseError(
                    "No se encontro setTotales en la respuesta",
                    captcha_attempts=captcha_attempts,
                )

            log_event(
                "consulta_cuad_success",
                cuil=request.cuil,
                captcha_attempts=captcha_attempts,
                disponible=totales.get("disponible") or "",
                deuda=totales.get("deuda") or "",
            )
            return build_success_result(
                request,
                totales,
                captcha_attempts=captcha_attempts,
            )
        except CuadTechnicalError:
            raise
        except Exception as exc:
            log_event(
                "consulta_cuad_technical_error",
                cuil=request.cuil,
                captcha_attempts=captcha_attempts,
                error=str(exc),
            )
            raise CuadTechnicalError(
                str(exc),
                captcha_attempts=captcha_attempts,
            ) from exc
        finally:
            browser.close()


def build_success_result(
    request: SearchRequest,
    totales: dict[str, str],
    *,
    captcha_attempts: int,
) -> dict[str, Any]:
    return {
        "ok": True,
        "found": True,
        "status": "ok",
        "cuil": request.cuil,
        "captcha_attempts": captcha_attempts,
        "error": "",
        **totales,
    }


def build_not_found_result(
    request: SearchRequest,
    *,
    captcha_attempts: int,
) -> dict[str, Any]:
    return {
        "ok": True,
        "found": False,
        "status": "sin_resultado",
        "cuil": request.cuil,
        "captcha_attempts": captcha_attempts,
        "bruto": "",
        "neto": "",
        "cupo": "",
        "afectado": "",
        "porcentaje_afectado": "",
        "precancelado": "",
        "porcentaje_precancelado": "",
        "disponible": "",
        "porcentaje_disponible": "",
        "deuda": "",
        "error": "",
    }


def build_error_result(
    request: SearchRequest | None,
    status: str,
    error: str,
    *,
    captcha_attempts: int = 0,
) -> dict[str, Any]:
    return {
        "ok": False,
        "found": False,
        "status": status,
        "cuil": request.cuil if request else "",
        "captcha_attempts": captcha_attempts,
        "bruto": "",
        "neto": "",
        "cupo": "",
        "afectado": "",
        "porcentaje_afectado": "",
        "precancelado": "",
        "porcentaje_precancelado": "",
        "disponible": "",
        "porcentaje_disponible": "",
        "deuda": "",
        "error": error,
    }


def build_output_payload(result: dict[str, Any]) -> dict[str, Any]:
    data_payload = {}
    if result.get("found"):
        data_payload = {
            "bruto": str(result.get("bruto") or ""),
            "neto": str(result.get("neto") or ""),
            "cupo": str(result.get("cupo") or ""),
            "afectado": str(result.get("afectado") or ""),
            "porcentaje_afectado": str(result.get("porcentaje_afectado") or ""),
            "precancelado": str(result.get("precancelado") or ""),
            "porcentaje_precancelado": str(result.get("porcentaje_precancelado") or ""),
            "disponible": str(result.get("disponible") or ""),
            "porcentaje_disponible": str(result.get("porcentaje_disponible") or ""),
            "deuda": str(result.get("deuda") or ""),
        }

    response_payload = {
        "ok": bool(result.get("ok", False)),
        "found": bool(result.get("found", False)),
        "status": str(result.get("status") or ""),
        "cuil": str(result.get("cuil") or ""),
        "captcha_attempts": int(result.get("captcha_attempts") or 0),
        "data": data_payload,
        "error": str(result.get("error") or ""),
        "source": "cuad_movimiento",
    }
    return {
        "ok": response_payload["ok"],
        "found": response_payload["found"],
        "status": response_payload["status"],
        "cuil": response_payload["cuil"],
        "bruto": str(result.get("bruto") or ""),
        "neto": str(result.get("neto") or ""),
        "cupo": str(result.get("cupo") or ""),
        "afectado": str(result.get("afectado") or ""),
        "disponible": str(result.get("disponible") or ""),
        "deuda": str(result.get("deuda") or ""),
        "captcha_attempts": response_payload["captcha_attempts"],
        "data_json": json.dumps(data_payload, ensure_ascii=True, separators=(",", ":")),
        "response_json": json.dumps(response_payload, ensure_ascii=True, separators=(",", ":")),
        "error": response_payload["error"],
    }


def _iniciar_login(page: "Page", config: CuadConfig) -> None:
    page.goto(config.login_url, wait_until="domcontentloaded")
    login_frame, captcha_frame = esperar_frames_login(
        page,
        timeout_ms=min(config.timeout_ms, LOGIN_FRAME_DISCOVERY_TIMEOUT_MS),
    )
    if login_frame is None:
        log_event(
            "consulta_cuad_login_frame_missing",
            page_url=page.url,
            frames=describir_frames(page),
        )
        raise RuntimeError("No se encontro el frame del login.")
    if captcha_frame is None:
        log_event(
            "consulta_cuad_captcha_frame_missing",
            page_url=page.url,
            frames=describir_frames(page),
        )
        raise RuntimeError("No se encontro el frame del captcha.")

    login_frame.wait_for_selector("#user")
    login_frame.wait_for_selector("#password")
    login_frame.wait_for_selector("#txtCaptcha")

    cargar_input(login_frame, "#user", config.usuario, "usuario")


def _resolver_login(page: "Page", config: CuadConfig) -> int:
    for intento in range(1, config.max_intentos + 1):
        login_frame, captcha_frame = obtener_frames(page)
        if login_frame is None or captcha_frame is None:
            captcha_attempts = max(0, intento - 1)
            log_event(
                "consulta_cuad_frames_lost_during_login",
                captcha_attempts=captcha_attempts,
                frames=describir_frames(page),
            )
            raise CuadTechnicalError(
                "Se perdio el frame de login o captcha durante la autenticacion.",
                captcha_attempts=captcha_attempts,
            )

        login_frame.wait_for_selector("#user")
        login_frame.wait_for_selector("#password")
        login_frame.wait_for_selector("#txtCaptcha")

        cargar_input(login_frame, "#password", config.password, "password")
        texto_captcha = capturar_y_resolver_captcha(captcha_frame, intento, config)
        cargar_input(login_frame, "#txtCaptcha", texto_captcha, "captcha")
        log_event(
            "consulta_cuad_login_attempt",
            intento=intento,
            captcha_len=len(texto_captcha),
        )

        page.wait_for_timeout(config.pre_submit_delay_ms)
        enviar_formulario(login_frame)
        page.wait_for_timeout(config.post_submit_wait_ms)

        if login_exitoso(page):
            return intento

    raise RuntimeError(f"No se pudo completar el login despues de {config.max_intentos} intentos.")


def buscar_frame_por_url(page: "Page", fragmento: str) -> "Frame | None":
    for frame in page.frames:
        if fragmento in frame.url:
            return frame
    return None


def buscar_frame_por_nombre(page: "Page", nombre: str) -> "Frame | None":
    for frame in page.frames:
        if frame.name == nombre:
            return frame
    return None


def contar_selector(frame: "Frame", selector: str) -> int:
    try:
        return frame.locator(selector).count()
    except Exception:
        return 0


def frame_tiene_selectores(frame: "Frame", selectores: tuple[str, ...]) -> bool:
    return all(contar_selector(frame, selector) > 0 for selector in selectores)


def buscar_frame_por_selectores(page: "Page", selectores: tuple[str, ...]) -> "Frame | None":
    for frame in page.frames:
        if frame_tiene_selectores(frame, selectores):
            return frame
    return None


def frame_tiene_captcha(frame: "Frame") -> bool:
    return contar_selector(frame, "img") > 0


def obtener_main_frame(page: "Page") -> "Frame | None":
    try:
        return page.main_frame
    except Exception:
        frames = list(page.frames)
        return frames[0] if frames else None


def buscar_frame_captcha(page: "Page", login_frame: "Frame | None") -> "Frame | None":
    if login_frame is not None and frame_tiene_captcha(login_frame):
        return login_frame

    main_frame = obtener_main_frame(page)
    candidates: list[tuple[int, int, "Frame"]] = []
    for frame in page.frames:
        if login_frame is not None and frame == login_frame:
            continue
        if main_frame is not None and frame == main_frame:
            continue
        img_count = contar_selector(frame, "img")
        if img_count <= 0:
            continue
        prefer_blank_url = 0 if (frame.url == "" or frame.url == "about:blank") else 1
        candidates.append((prefer_blank_url, img_count, frame))

    if candidates:
        candidates.sort(key=lambda item: (item[0], item[1]))
        return candidates[0][2]

    if main_frame is not None and frame_tiene_captcha(main_frame):
        return main_frame
    return None


def describir_frames(page: "Page") -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for index, frame in enumerate(page.frames):
        frames.append(
            {
                "index": index,
                "name": frame.name,
                "url": frame.url,
                "has_user": contar_selector(frame, "#user") > 0,
                "has_password": contar_selector(frame, "#password") > 0,
                "has_txtCaptcha": contar_selector(frame, "#txtCaptcha") > 0,
                "img_count": contar_selector(frame, "img"),
            }
        )
    return frames


def obtener_frames(page: "Page") -> tuple["Frame | None", "Frame | None"]:
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


def esperar_frames_login(page: "Page", timeout_ms: int) -> tuple["Frame | None", "Frame | None"]:
    deadline = time.monotonic() + max(timeout_ms, 0) / 1000
    while True:
        login_frame, captcha_frame = obtener_frames(page)
        if login_frame is not None and captcha_frame is not None:
            return login_frame, captcha_frame
        if time.monotonic() >= deadline:
            return login_frame, captcha_frame
        page.wait_for_timeout(LOGIN_FRAME_POLL_INTERVAL_MS)


def cargar_input(frame: "Frame", selector: str, texto: str, nombre_campo: str) -> str:
    campo = frame.locator(selector)
    campo.wait_for(state="visible")
    campo.click()
    campo.press("Control+A")
    campo.press("Backspace")
    campo.fill(texto)

    valor = campo.input_value()
    if valor != texto:
        raise RuntimeError(
            f"No se pudo cargar correctamente {nombre_campo}. "
            f"Esperado={texto!r} obtenido={valor!r}."
        )
    return valor


def enviar_formulario(login_frame: "Frame") -> None:
    try:
        login_frame.evaluate("() => btnMouseClick(0)")
        return
    except Exception:
        pass

    boton_click = login_frame.locator("#btntb_0_over")
    if boton_click.count():
        boton_click.first.click(force=True)
        return

    boton_off = login_frame.locator("#btntb_0_off")
    if boton_off.count():
        boton_off.first.click(force=True)
        return

    contenedor = login_frame.locator(BOTON_INGRESAR_SELECTOR)
    if contenedor.count():
        contenedor.first.click(force=True)
        return

    login_frame.click("text=Ingresar")


def login_exitoso(page: "Page") -> bool:
    login_frame, _ = obtener_frames(page)
    if login_frame is None:
        return True

    try:
        return not login_frame.locator("#txtCaptcha").is_visible(timeout=1500)
    except Exception:
        return True


def capturar_y_resolver_captcha(
    captcha_frame: "Frame",
    intento: int,
    config: CuadConfig,
) -> str:
    captcha_imagen = captcha_frame.locator("img").first
    captcha_imagen.wait_for(state="visible", timeout=5000)
    contenido_captcha = captcha_imagen.screenshot()
    texto_captcha = procesar_captcha_con_mistral(contenido_captcha, intento, config)

    if len(texto_captcha) != config.captcha_len:
        raise RuntimeError(
            f"OCR incompleto. Se esperaban {config.captcha_len} digitos y se obtuvo {texto_captcha!r}."
        )
    return texto_captcha


def procesar_captcha_con_mistral(contenido_img: bytes, intento: int, config: CuadConfig) -> str:
    if not contenido_img:
        raise ValueError("La imagen del captcha esta vacia.")

    image_b64 = base64.b64encode(contenido_img).decode("ascii")
    payload = {
        "model": config.ocr_model,
        "document": {
            "type": "image_url",
            "image_url": f"data:image/png;base64,{image_b64}",
        },
        "document_annotation_format": MISTRAL_OCR_FORMAT,
        "document_annotation_prompt": MISTRAL_OCR_PROMPT,
    }
    headers = {
        "Authorization": f"Bearer {config.mistral_api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    response = requests.post(
        MISTRAL_OCR_URL,
        headers=headers,
        json=payload,
        timeout=config.timeout_seconds,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Mistral OCR failed with HTTP {response.status_code}: {response.text[:300]}")

    data = response.json()
    document_annotation = data.get("document_annotation")
    if document_annotation:
        try:
            parsed = json.loads(document_annotation)
            digits = str(parsed.get("captcha") or "").strip()
            if digits:
                log_event("consulta_cuad_ocr", intento=intento, captcha=digits)
                return digits
        except json.JSONDecodeError:
            pass

    pages = data.get("pages") or []
    markdown = "\n".join(str(page.get("markdown") or "").strip() for page in pages).strip()
    digits = "".join(ch for ch in markdown if ch.isdigit())[: config.captcha_len]
    log_event("consulta_cuad_ocr_fallback", intento=intento, captcha=digits, markdown=markdown[:80])
    return digits


def consultar_movimiento(page: "Page", request: SearchRequest, config: CuadConfig) -> str:
    log_event(
        "consulta_cuad_movimiento_request",
        cuil=request.cuil,
        emr_id=config.emr_id,
    )
    payload = {
        "Modo": "BS",
        "Emr_Nombre": config.emr_nombre,
        "Emr_Id": config.emr_id,
        "Emt_Nome": "",
        "Emt_Id": "",
        "Emp_Cod": request.cuil,
        "Per_NroDoc": "",
        "none1": "",
    }

    response = page.context.request.post(
        config.movimiento_url,
        form=payload,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://www.santafe.gov.ar",
            "Referer": config.movimiento_url,
        },
        timeout=config.timeout_ms,
    )
    log_event(
        "consulta_cuad_movimiento_response",
        cuil=request.cuil,
        status=obtener_response_status(response),
    )
    if not obtener_response_ok(response):
        raise RuntimeError(f"HTTP {obtener_response_status(response)} al consultar movimiento.asp")
    return decodificar_respuesta_http(response)


def obtener_response_ok(response: "APIResponse") -> bool:
    ok = getattr(response, "ok", False)
    return bool(ok() if callable(ok) else ok)


def obtener_response_status(response: "APIResponse") -> int:
    status = getattr(response, "status", 0)
    return int(status() if callable(status) else status)


def obtener_response_headers(response: "APIResponse") -> dict[str, str]:
    headers = getattr(response, "headers", {})
    raw_headers = headers() if callable(headers) else headers
    return dict(raw_headers)


def decodificar_respuesta_http(response: "APIResponse") -> str:
    cuerpo = response.body()
    headers = obtener_response_headers(response)
    content_type = headers.get("content-type", "").lower()

    if "charset=" in content_type:
        charset = content_type.split("charset=", 1)[1].split(";", 1)[0].strip()
        try:
            return cuerpo.decode(charset, errors="replace")
        except LookupError:
            pass

    for encoding in ("utf-8", "cp1252", "latin-1"):
        try:
            return cuerpo.decode(encoding)
        except UnicodeDecodeError:
            continue

    return cuerpo.decode("latin-1", errors="replace")


def parsear_totales_cuad(html: str) -> dict[str, str] | None:
    coincidencia = re.search(r"parent\.setTotales\((.*?)\);", html, re.DOTALL)
    if not coincidencia:
        return None

    valores = re.findall(r"'(.*?)'", coincidencia.group(1))
    if len(valores) < 10:
        return None

    return {
        "bruto": valores[0],
        "neto": valores[1],
        "cupo": valores[2],
        "afectado": valores[3],
        "porcentaje_afectado": valores[4],
        "precancelado": valores[5],
        "porcentaje_precancelado": valores[6],
        "disponible": valores[7],
        "porcentaje_disponible": valores[8],
        "deuda": valores[9],
    }


def es_respuesta_sin_resultado(html: str) -> bool:
    return "parent.Emp_Id = -1" in html and "parent.Display('N')" in html


def es_sesion_invalida(html: str) -> bool:
    html_lower = html.lower()
    return (
        "login.asp?modo=e" in html_lower
        or "login.asp?modo=m" in html_lower
        or "identificacion - cuad" in html_lower
        or "identificaci" in html_lower and "cuad" in html_lower
    )


def log_event(event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    sys.stderr.write(json.dumps(payload, ensure_ascii=True) + "\n")
