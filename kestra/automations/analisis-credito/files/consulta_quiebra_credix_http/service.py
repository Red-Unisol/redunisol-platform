from __future__ import annotations

from dataclasses import dataclass
import json
import os
import re
import sys
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup, Tag

NO_RESULTS_SELECTOR = "No se encontraron"
EDICTS_TABLE_TEXT = "Edictos judiciales"
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"


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
    link_url: str


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
    _log_event("consulta_quiebra_http_start", cuit=request.cuit, nombre=request.nombre)
    session = requests.Session()
    session.headers.update({"User-Agent": DEFAULT_USER_AGENT, "Accept": "text/html,application/xhtml+xml"})
    timeout_seconds = config.timeout_ms / 1000

    login_page = session.get(config.login_url, timeout=timeout_seconds)
    _ensure_success(login_page, "Fetch login page")
    _debug_dump_html(config, "login", login_page.text)

    login_payload, login_action = _build_login_payload(login_page.text, login_page.url, config)
    login_response = session.post(login_action, data=login_payload, timeout=timeout_seconds, allow_redirects=False)
    if login_response.status_code not in {200, 301, 302, 303}:
        raise RuntimeError(f"Login failed with {login_response.status_code}.")

    current_response = _follow_possible_redirect(session, login_response, login_action, timeout_seconds)
    _debug_dump_html(config, "post_login", current_response.text)

    search_response = session.post(
        _resolve_relative(config.login_url, "con_cuit.php"),
        data={"cuit": request.cuit, "nombre": request.nombre},
        timeout=timeout_seconds,
    )
    _ensure_success(search_response, "Search Credix table")
    _debug_dump_html(config, "search_results", search_response.text)

    candidates = _extract_candidates(search_response.text, search_response.url)
    if not candidates:
        return build_none_result(request)

    if len(candidates) > 1:
        return build_multiple_result(request, candidates)

    selected_candidate = candidates[0]
    detail_entry = session.get(selected_candidate.link_url, timeout=timeout_seconds)
    _ensure_success(detail_entry, "Open detail page")
    _debug_dump_html(config, "detail_entry", detail_entry.text)

    final_detail = _advance_detail_step(session, detail_entry, timeout_seconds)
    _debug_dump_html(config, "detail_final", final_detail.text)

    data = _extract_edicts(final_detail.text)
    if not data and not _is_detail_summary_page(final_detail.text, final_detail.url):
        raise RuntimeError("Timed out waiting for the 'Edictos judiciales' table.")

    return build_single_result(request, data, nombre=selected_candidate.nombre)


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


def _build_login_payload(html: str, response_url: str, config: CredixConfig) -> tuple[dict[str, str], str]:
    soup = BeautifulSoup(html, "html.parser")
    form = soup.select_one("form")
    if form is None:
        raise RuntimeError("Credix login form not found.")

    payload: dict[str, str] = {}
    for field in form.select("input[name]"):
        if not isinstance(field, Tag):
            continue
        name = (field.get("name") or "").strip()
        if not name:
            continue
        payload[name] = field.get("value", "")

    payload["cdxcliente"] = config.cliente
    payload["cdxusername"] = config.usuario
    payload["cdxpassword"] = config.password
    payload.setdefault("fphash", "")
    payload.setdefault("fpplug", "")
    payload.setdefault("fpcomp", "")

    action = (form.get("action") or "").strip()
    return payload, urljoin(response_url, action or config.login_url)


def _follow_possible_redirect(
    session: requests.Session,
    response: requests.Response,
    request_url: str,
    timeout_seconds: float,
) -> requests.Response:
    if response.is_redirect or response.is_permanent_redirect:
        location = response.headers.get("Location", "")
        target_url = urljoin(request_url, location)
        return session.get(target_url, timeout=timeout_seconds)
    return response


def _extract_candidates(html: str, base_url: str) -> list[CandidateRow]:
    soup = BeautifulSoup(html, "html.parser")
    if NO_RESULTS_SELECTOR in soup.get_text(" ", strip=True):
        return []

    candidates: list[CandidateRow] = []
    for row in soup.select("table tbody tr"):
        cells = row.select("td")
        if not cells:
            continue

        link = row.select_one("a[data-href], a[href]")
        if link is None:
            continue

        raw_href = (link.get("data-href") or link.get("href") or "").strip()
        if not raw_href:
            continue

        cuit = normalize_name(link.get_text(" ", strip=True))
        nombre = normalize_name(cells[1].get_text(" ", strip=True) if len(cells) >= 2 else "")
        documento = normalize_name(cells[2].get_text(" ", strip=True) if len(cells) >= 3 else "")
        candidates.append(
            CandidateRow(
                cuit=cuit,
                nombre=nombre,
                documento=documento,
                link_url=urljoin(base_url, raw_href),
            )
        )

    return candidates


def _advance_detail_step(
    session: requests.Session,
    detail_entry: requests.Response,
    timeout_seconds: float,
) -> requests.Response:
    if "con_cuit3.php" in detail_entry.url or _extract_edicts(detail_entry.text):
        return detail_entry

    next_url = _strip_query(detail_entry.url)
    response = session.post(next_url, data={"siguiente": ""}, timeout=timeout_seconds, allow_redirects=False)
    if response.status_code in {301, 302, 303}:
        redirect_url = urljoin(next_url, response.headers.get("Location", ""))
        return session.get(redirect_url, timeout=timeout_seconds)
    return response


def _extract_edicts(html: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    table = _find_edicts_table(soup)
    if table is None:
        return []

    data: list[dict[str, str]] = []
    for row in table.select("tbody tr"):
        cells = row.select("td")
        if len(cells) < 4:
            continue
        data.append(
            {
                "fecha": normalize_name(cells[0].get_text(" ", strip=True)),
                "fuente": normalize_name(cells[1].get_text(" ", strip=True)),
                "id": normalize_name(cells[2].get_text(" ", strip=True)),
                "resumen": normalize_name(cells[3].get_text(" ", strip=True)),
            }
        )
    return data


def _find_edicts_table(soup: BeautifulSoup) -> Tag | None:
    for table in soup.select("table"):
        text = table.get_text(" ", strip=True)
        if EDICTS_TABLE_TEXT in text:
            return table
    return None


def _is_detail_summary_page(html: str, url: str) -> bool:
    text = normalize_name(BeautifulSoup(html, "html.parser").get_text(" ", strip=True))
    if "Datos Filiatorios" in text:
        return True
    if "Resumen (*)" in text or "Resumen (*)".replace(" ", "") in text.replace(" ", ""):
        return True
    return "con_cuit3.php" in url


def _resolve_relative(login_url: str, target_name: str) -> str:
    return urljoin(login_url, target_name)


def _strip_query(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def _ensure_success(response: requests.Response, action: str) -> None:
    if response.status_code >= 400:
        raise RuntimeError(f"{action} failed with {response.status_code}.")


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


def _debug_dump_html(config: CredixConfig, prefix: str, html: str) -> None:
    if not config.debug_enabled:
        return
    safe_prefix = re.sub(r"[^A-Za-z0-9_.-]+", "_", prefix)
    with open(f"credixsa_http_{safe_prefix}.html", "w", encoding="utf-8") as handle:
        handle.write(html)


def _log_event(event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    sys.stderr.write(json.dumps(payload, ensure_ascii=True) + "\n")