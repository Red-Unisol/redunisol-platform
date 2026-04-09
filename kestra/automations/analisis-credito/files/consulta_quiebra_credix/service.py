from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import os
import re
import sys
import time
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from playwright.sync_api import Locator, Page

RESULT_LINK_SELECTOR = "a.btn-sm.btn-info[data-href]"
RESULTS_ROW_SELECTOR = "table tbody tr"
NEXT_BUTTON_SELECTOR = "#btn_siguiente"
EDICTS_TABLE_SELECTOR = "table.table.table-sm.table-striped.table-bordered"
NO_RESULTS_SELECTOR = "text=No se encontraron"
EDICTS_TABLE_TEXT = "Edictos judiciales"


@dataclass(frozen=True)
class SearchRequest:
    cuit: str
    nombre: str


@dataclass(frozen=True)
class CredixConfig:
    cliente: str
    usuario: str
    password: str
    login_url: str
    timeout_ms: int
    debug_enabled: bool


@dataclass(frozen=True)
class CandidateRow:
    cuit: str
    nombre: str
    documento: str
    link: "Locator"


def parse_search_request(payload: Any) -> SearchRequest:
    if isinstance(payload, dict):
        cuit = normalize_cuit(payload.get("cuit"))
        nombre = normalize_name(payload.get("nombre"))
    elif payload is None:
        raise ValueError("Missing request body.")
    elif isinstance(payload, (list, tuple)):
        raise ValueError("Body must be an object or string.")
    else:
        cuit = normalize_cuit(payload)
        nombre = ""

    if not cuit and not nombre:
        raise ValueError("At least one of 'cuit' or 'nombre' is required.")

    return SearchRequest(cuit=cuit, nombre=nombre)


def load_config_from_env() -> CredixConfig:
    cliente = os.getenv("CREDIX_CLIENTE", "").strip()
    usuario = os.getenv("CREDIX_USER", "").strip()
    password = os.getenv("CREDIX_PASS", "").strip()
    login_url = os.getenv("CREDIX_LOGIN_URL", "https://www.credixsa.com/nuevo/login.php").strip()
    timeout_raw = os.getenv("CREDIX_TIMEOUT_SECONDS", "30").strip() or "30"
    debug_raw = os.getenv("CREDIX_DEBUG", "").strip().lower()

    if not cliente or not usuario or not password:
        raise ValueError("Missing CREDIX_CLIENTE, CREDIX_USER or CREDIX_PASS.")
    if not login_url:
        raise ValueError("Missing CREDIX_LOGIN_URL.")

    timeout_seconds = float(timeout_raw)
    if timeout_seconds <= 0:
        raise ValueError("CREDIX_TIMEOUT_SECONDS must be greater than 0.")

    return CredixConfig(
        cliente=cliente,
        usuario=usuario,
        password=password,
        login_url=login_url,
        timeout_ms=int(timeout_seconds * 1000),
        debug_enabled=debug_raw in {"1", "true", "yes"},
    )


def consultar_tabla(request: SearchRequest, config: CredixConfig) -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    _log_event("consulta_quiebra_start", cuit=request.cuit, nombre=request.nombre)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage"],
        )
        page = browser.new_page()
        page.set_default_timeout(config.timeout_ms)

        try:
            _login(page, config, request)
            _search(page, request)
            _wait_search_results(page, config)

            candidates = _extract_candidates(page)
            if not candidates:
                _debug_dump(page, config, "no_results", request)
                return build_none_result(request)

            if len(candidates) > 1:
                return build_multiple_result(request, candidates)

            selected_candidate = candidates[0]
            selected_candidate.link.click()
            page.wait_for_load_state("networkidle")
            _wait_next_ui_step(page, request)
            try:
                data = _extract_edicts(page, config, request)
            except TimeoutError:
                if _is_detail_summary_page(page):
                    data = []
                else:
                    raise
            return build_single_result(request, data, nombre=selected_candidate.nombre)
        finally:
            browser.close()


def build_none_result(request: SearchRequest) -> dict[str, Any]:
    return _base_result(request, status="none", rows=[], data=[], error="")


def build_multiple_result(
    request: SearchRequest,
    candidates: list[CandidateRow],
) -> dict[str, Any]:
    rows = [
        {
            "cuit": candidate.cuit,
            "nombre": candidate.nombre,
            "documento": candidate.documento,
        }
        for candidate in candidates
    ]
    return _base_result(request, status="multiple", rows=rows, data=[], error="")


def build_single_result(
    request: SearchRequest,
    data: list[dict[str, str]],
    *,
    nombre: str | None = None,
) -> dict[str, Any]:
    return _base_result(request, status="single", rows=[], data=data, error="", nombre=nombre)


def build_error_result(
    request: SearchRequest | None,
    error: str,
) -> dict[str, Any]:
    safe_request = request or SearchRequest(cuit="", nombre="")
    return _base_result(safe_request, status="error", rows=[], data=[], error=error, ok=False)


def build_output_payload(result: dict[str, Any]) -> dict[str, Any]:
    response_payload = build_legacy_response(result)
    return {
        "ok": bool(result.get("ok", False)),
        "status": str(result.get("status") or ""),
        "cuit": str(result.get("cuit") or ""),
        "nombre": str(result.get("nombre") or ""),
        "rows_json": json.dumps(result.get("rows") or [], ensure_ascii=True, separators=(",", ":")),
        "data_json": json.dumps(result.get("data") or [], ensure_ascii=True, separators=(",", ":")),
        "response_json": json.dumps(response_payload, ensure_ascii=True, separators=(",", ":")),
        "error": str(result.get("error") or ""),
    }


def build_legacy_response(result: dict[str, Any]) -> dict[str, Any]:
    status = str(result.get("status") or "")
    if status == "single":
        return {"status": "single", "data": result.get("data") or []}
    if status in {"none", "multiple"}:
        return {"status": status, "rows": result.get("rows") or []}
    return {"status": "error", "error": str(result.get("error") or "Unknown error")}


def normalize_cuit(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def normalize_name(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def _login(page: "Page", config: CredixConfig, request: SearchRequest) -> None:
    page.goto(config.login_url, wait_until="domcontentloaded")
    page.fill("#cdxcliente", config.cliente)
    page.fill("#cdxusername", config.usuario)
    page.fill("#cdxpassword", config.password)
    page.locator("#btnSubmit").click()
    page.wait_for_load_state("networkidle")
    _debug_log(page, config, "post_login", request)


def _search(page: "Page", request: SearchRequest) -> None:
    page.fill("#cuit", request.cuit)
    page.fill("#nombre", request.nombre)
    page.locator("text=Siguiente").click()
    page.wait_for_load_state("networkidle")


def _wait_search_results(page: "Page", config: CredixConfig) -> None:
    page.locator(RESULT_LINK_SELECTOR).or_(page.locator(NO_RESULTS_SELECTOR)).first.wait_for(
        timeout=config.timeout_ms
    )


def _extract_candidates(page: "Page") -> list[CandidateRow]:
    candidates: list[CandidateRow] = []
    rows = page.locator(RESULTS_ROW_SELECTOR)

    for index in range(rows.count()):
        row = rows.nth(index)
        link = row.locator(RESULT_LINK_SELECTOR)
        if link.count() == 0:
            continue

        cells = row.locator("td")
        candidates.append(
            CandidateRow(
                cuit=link.first.inner_text().strip(),
                nombre=cells.nth(1).inner_text().strip() if cells.count() >= 2 else "",
                documento=cells.nth(2).inner_text().strip() if cells.count() >= 3 else "",
                link=link.first,
            )
        )

    return candidates


def _wait_next_ui_step(page: "Page", request: SearchRequest) -> None:
    deadline = time.monotonic() + 8.0
    button = page.locator(NEXT_BUTTON_SELECTOR)
    table = page.locator(EDICTS_TABLE_SELECTOR).filter(has_text=EDICTS_TABLE_TEXT)

    while time.monotonic() < deadline:
        try:
            if table.count() > 0 and table.first.is_visible():
                return
        except Exception:
            pass
        try:
            if button.count() > 0 and button.first.is_visible():
                button.first.click()
                page.wait_for_load_state("networkidle")
                return
        except Exception:
            pass
        time.sleep(0.2)

    raise TimeoutError(
        f"Timed out waiting for '{NEXT_BUTTON_SELECTOR}' or the final edicts table. "
        f"cuit={request.cuit!r} nombre={request.nombre!r}"
    )


def _extract_edicts(
    page: "Page",
    config: CredixConfig,
    request: SearchRequest,
) -> list[dict[str, str]]:
    try:
        page.wait_for_selector(
            f'{EDICTS_TABLE_SELECTOR}:has-text("{EDICTS_TABLE_TEXT}")',
            timeout=config.timeout_ms,
        )
    except Exception as exc:
        _debug_dump(page, config, "edicts_timeout", request)
        raise TimeoutError("Timed out waiting for the 'Edictos judiciales' table.") from exc

    table = page.locator(EDICTS_TABLE_SELECTOR).filter(has_text=EDICTS_TABLE_TEXT)
    rows = table.locator("tbody tr")
    data: list[dict[str, str]] = []

    for index in range(rows.count()):
        row = rows.nth(index)
        cells = row.locator("td")
        if cells.count() < 4:
            continue
        data.append(
            {
                "fecha": cells.nth(0).inner_text().strip(),
                "fuente": cells.nth(1).inner_text().strip(),
                "id": cells.nth(2).inner_text().strip(),
                "resumen": cells.nth(3).inner_text().strip(),
            }
        )

    return data


def _is_detail_summary_page(page: "Page") -> bool:
    body_text = page.locator("body").inner_text(timeout=5000)
    if "Datos Filiatorios" in body_text:
        return True
    if "Resumen (*)" in body_text:
        return True
    return "con_cuit3.php" in page.url


def _base_result(
    request: SearchRequest,
    *,
    status: str,
    rows: list[dict[str, str]],
    data: list[dict[str, str]],
    error: str,
    ok: bool = True,
    nombre: str | None = None,
) -> dict[str, Any]:
    return {
        "ok": ok,
        "status": status,
        "cuit": request.cuit,
        "nombre": request.nombre if nombre is None else nombre,
        "rows": rows,
        "data": data,
        "error": error,
    }


def _debug_log(page: "Page", config: CredixConfig, stage: str, request: SearchRequest) -> None:
    if not config.debug_enabled:
        return

    details = {
        "event": "consulta_quiebra_debug",
        "stage": stage,
        "url": page.url,
        "cuit": request.cuit,
        "nombre": request.nombre,
    }
    sys.stderr.write(json.dumps(details, ensure_ascii=True) + "\n")


def _debug_dump(page: "Page", config: CredixConfig, prefix: str, request: SearchRequest) -> None:
    if not config.debug_enabled:
        return

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_name = f"credixsa_{prefix}_{timestamp}"
    try:
        page.screenshot(path=f"{base_name}.png", full_page=True)
        html = page.content()
        with open(f"{base_name}.html", "w", encoding="utf-8") as handle:
            handle.write(html)
    except Exception as exc:
        _log_event(
            "consulta_quiebra_debug_dump_error",
            cuit=request.cuit,
            nombre=request.nombre,
            error=str(exc),
        )


def _log_event(event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    sys.stderr.write(json.dumps(payload, ensure_ascii=True) + "\n")
