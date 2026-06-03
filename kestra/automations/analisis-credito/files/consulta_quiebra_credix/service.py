from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from datetime import timedelta
from datetime import timezone
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from playwright.sync_api import Locator, Page

RESULT_LINK_SELECTOR = "a.btn-sm.btn-info[data-href]"
RESULTS_ROW_SELECTOR = "table tbody tr"
NEXT_BUTTON_SELECTOR = "#btn_siguiente"
UPDATE_ALL_SELECTOR = "#procesar_todo_auto"
UPDATE_BUTTON_SELECTOR = "button.btn_actualizar.btn-info"
EDICTS_TABLE_SELECTOR = "table.table.table-sm.table-striped.table-bordered"
NO_RESULTS_SELECTOR = "text=No se encontraron"
EDICTS_TABLE_TEXT = "Edictos judiciales"
DETAIL_NEXT_TEXT = "Siguiente"
PROCESSING_TEXT = "Procesando"
CACHE_VERSION = 1
CACHE_TTL = "P8D"
CACHE_MAX_AGE_DAYS = 7
CACHE_DUMMY_KEY = "credixsa.cache.lookup.none"


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
    debug_dir: str
    cache_by_cuil: dict[str, Any] | None = None
    cache_by_name: dict[str, Any] | None = None
    cache_max_age_days: int = CACHE_MAX_AGE_DAYS


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
    debug_dir = os.getenv("CREDIX_DEBUG_DIR", "").strip()
    cache_max_age_raw = os.getenv("CREDIX_CACHE_MAX_AGE_DAYS", str(CACHE_MAX_AGE_DAYS)).strip()

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
        debug_dir=debug_dir,
        cache_by_cuil=decode_cache_env(os.getenv("CREDIX_CACHE_BY_CUIL_JSON", "")),
        cache_by_name=decode_cache_env(os.getenv("CREDIX_CACHE_BY_NAME_JSON", "")),
        cache_max_age_days=int(cache_max_age_raw or CACHE_MAX_AGE_DAYS),
    )


def consultar_tabla(request: SearchRequest, config: CredixConfig) -> dict[str, Any]:
    from playwright.sync_api import sync_playwright

    _log_event("consulta_quiebra_start", cuit=request.cuit, nombre=request.nombre)
    cached_result = find_cached_result(request, config)
    if cached_result is not None:
        return cached_result

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage"],
        )
        page = browser.new_page()
        page.set_default_timeout(config.timeout_ms)

        try:
            _login(page, config, request)
            _debug_dump(page, config, "01_post_login", request)
            _search(page, request)
            _wait_search_results(page, config)
            _debug_dump(page, config, "02_search_results", request)

            candidates = _extract_candidates(page)
            if not candidates:
                _debug_dump(page, config, "no_results", request)
                return build_none_result(request)

            if len(candidates) > 1:
                return build_multiple_result(request, candidates)

            selected_candidate = candidates[0]
            selected_candidate.link.click()
            page.wait_for_load_state("networkidle")
            _debug_dump(page, config, "03_detail_entry", request)
            _refresh_online_updates_if_available(page, config, request)
            _debug_dump(page, config, "06_after_updates", request)
            _wait_next_ui_step(page, request)
            _debug_dump(page, config, "07_after_next_step", request)
            _wait_report_tables_stable(page, config, request)
            _debug_dump(page, config, "08_report_tables_stable", request)
            data = _extract_report_sections(page, config, request)
            if not data and not _is_detail_summary_page(page):
                raise TimeoutError("Timed out waiting for CredixSA report sections.")
            return build_single_result(
                request,
                data,
                cuit=normalize_cuit(selected_candidate.cuit) or request.cuit,
                nombre=selected_candidate.nombre,
            )
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
    data: list[dict[str, Any]],
    *,
    cuit: str | None = None,
    nombre: str | None = None,
) -> dict[str, Any]:
    return _base_result(
        request,
        status="single",
        rows=[],
        data=data,
        error="",
        cuit=cuit,
        nombre=nombre,
    )


def build_error_result(
    request: SearchRequest | None,
    error: str,
) -> dict[str, Any]:
    safe_request = request or SearchRequest(cuit="", nombre="")
    return _base_result(safe_request, status="error", rows=[], data=[], error=error, ok=False)


def build_output_payload(result: dict[str, Any]) -> dict[str, Any]:
    normalized_payload = build_normalized_payload(result)
    response_payload = build_legacy_response(result)
    cache_entry = build_cache_entry(result)
    cuil_cache_key = cache_key_for_cuil(result.get("cuit")) if cache_entry else ""
    name_cache_key = cache_key_for_name(result.get("nombre")) if cache_entry else ""
    cache_value_json = (
        json.dumps(cache_entry, ensure_ascii=True, separators=(",", ":"))
        if cache_entry is not None
        else ""
    )
    return {
        "ok": bool(result.get("ok", False)),
        "status": str(result.get("status") or ""),
        "cuit": str(result.get("cuit") or ""),
        "nombre": str(result.get("nombre") or ""),
        "rows_json": json.dumps(result.get("rows") or [], ensure_ascii=True, separators=(",", ":")),
        "data_json": json.dumps(result.get("data") or [], ensure_ascii=True, separators=(",", ":")),
        "normalized_json": json.dumps(normalized_payload, ensure_ascii=True, separators=(",", ":")),
        "response_json": json.dumps(response_payload, ensure_ascii=True, separators=(",", ":")),
        "error": str(result.get("error") or ""),
        "cache_hit": bool(result.get("cache_hit", False)),
        "cached_at": str(result.get("cached_at") or ""),
        "cache_should_persist": cache_entry is not None,
        "cache_ttl": CACHE_TTL if cache_entry is not None else "",
        "cache_value_json": cache_value_json,
        "cuil_cache_key": cuil_cache_key,
        "name_cache_key": name_cache_key,
        "cuil_cache_should_persist": bool(cuil_cache_key and cache_entry is not None),
        "name_cache_should_persist": bool(name_cache_key and cache_entry is not None),
    }


def build_legacy_response(result: dict[str, Any]) -> dict[str, Any]:
    status = str(result.get("status") or "")
    if status == "single":
        return {"status": "single", "data": result.get("data") or []}
    if status in {"none", "multiple"}:
        return {"status": status, "rows": result.get("rows") or []}
    return {"status": "error", "error": str(result.get("error") or "Unknown error")}


def build_normalized_payload(result: dict[str, Any]) -> dict[str, Any]:
    normalized = result.get("normalized")
    if isinstance(normalized, dict):
        _ensure_bcra_24_months_payload(normalized, result.get("data") or [])
        _ensure_bcra_entity_evolution_payload(normalized, result.get("data") or [])
        _ensure_previsional_employer_tables_payload(normalized, result.get("data") or [])
        return normalized

    payload = {
        "persona": {
            "cuit": str(result.get("cuit") or ""),
            "documento": "",
            "nombre_completo": str(result.get("nombre") or ""),
            "genero": "",
            "edad": "",
            "fecha_nacimiento": "",
            "domicilio": "",
            "localidad": "",
            "provincia": "",
        },
        "bcra": {
            "resumen": {
                "color": "",
                "detalle": "",
            },
            "deuda_vigente_total": "",
            "deudas_vigentes": [],
            "deudas_24_meses": {},
            "evolucion_deuda_por_entidad": {},
            "historial_por_entidad": [],
            "entidades": [],
        },
        "previsional": {
            "mensaje": "",
            "registraciones": [],
            "empleadores": [],
            "situaciones_por_empleador": [],
            "obra_sociales": [],
        },
        "aportes": {
            "mensaje": "",
            "registraciones": [],
            "empleadores": [],
            "obra_sociales": [],
        },
        "quiebras": {
            "edictos": [],
            "mensaje": "",
        },
    }

    sections = result.get("data") or []
    if not isinstance(sections, list):
        return payload

    for section in sections:
        if not isinstance(section, dict):
            continue

        title = normalize_name(section.get("title"))
        normalized_title = _normalized_label(title)
        match_title = normalize_name(normalized_title.replace("-", " "))
        key_values = _section_key_values(section)
        rows = _section_rows(section)

        if match_title.startswith("datos filiatorios"):
            payload["persona"].update(_normalize_persona_block(key_values))
            continue

        if match_title.startswith("resumen"):
            payload["bcra"]["resumen"].update(_normalize_bcra_summary(key_values))
            continue

        if match_title.startswith("deudas en el sistema financiero"):
            payload["bcra"]["deudas_24_meses"] = _normalize_bcra_24_months(section)
            continue

        if match_title.startswith("deudas vigentes sistema financiero"):
            deuda_vigente = _normalize_bcra_vigentes(rows)
            if deuda_vigente["deudas_vigentes"]:
                payload["bcra"]["deudas_vigentes"] = deuda_vigente["deudas_vigentes"]
            if deuda_vigente["deuda_vigente_total"]:
                payload["bcra"]["deuda_vigente_total"] = deuda_vigente["deuda_vigente_total"]
            continue

        if match_title.startswith("evolucion deuda sistema financiero por entidad"):
            payload["bcra"]["historial_por_entidad"] = _normalize_bcra_history(section)
            continue

        if match_title.startswith("datos entidades fuente"):
            payload["bcra"]["entidades"] = _normalize_bcra_entities(section)
            continue

        if match_title.startswith("situacion previsional empleador"):
            employer = _normalize_previsional_employer(title, key_values)
            if employer:
                payload["previsional"]["empleadores"].append(employer)
                payload["aportes"]["empleadores"].append(employer)
            continue

        if match_title.startswith("situacion previsional fuente") or match_title == "situacion previsional":
            previsional_payload = _normalize_previsional_message(rows)
            if previsional_payload:
                payload["previsional"]["mensaje"] = previsional_payload
                payload["aportes"]["mensaje"] = previsional_payload
            continue

        if match_title.startswith("registraciones"):
            registration = _normalize_registration(title, rows)
            if registration:
                payload["previsional"]["registraciones"].append(registration)
                payload["aportes"]["registraciones"].append(registration)
            continue

        if match_title.startswith("datos obra social"):
            obra_social = _normalize_obra_social(title, key_values, rows)
            if obra_social:
                payload["previsional"]["obra_sociales"].append(obra_social)
                payload["aportes"]["obra_sociales"].append(obra_social)
            continue

        if EDICTS_TABLE_TEXT.lower() in normalized_title:
            edicts = _normalize_edicts(rows)
            if edicts:
                payload["quiebras"]["edictos"].extend(edicts)
            elif not payload["quiebras"]["mensaje"]:
                payload["quiebras"]["mensaje"] = _single_value_row(rows)

    _mark_active_bcra_24_month_rows(
        payload["bcra"].get("deudas_24_meses"),
        payload["bcra"].get("deudas_vigentes") or [],
    )
    _ensure_bcra_entity_evolution_payload(payload, sections)
    _ensure_previsional_employer_tables_payload(payload, sections)
    result["normalized"] = payload
    return payload


def normalize_cuit(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def normalize_name(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def cache_key_for_cuil(value: Any) -> str:
    digits = normalize_cuit(value)
    if len(digits) != 11:
        return ""
    return f"credixsa.cuil.{digits}"


def normalize_name_for_cache(value: Any) -> str:
    normalized = normalize_name(value).lower()
    normalized = "".join(
        char
        for char in unicodedata.normalize("NFD", normalized)
        if unicodedata.category(char) != "Mn"
    )
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return normalize_name(normalized)


def cache_key_for_name(value: Any) -> str:
    normalized = normalize_name_for_cache(value)
    if not normalized:
        return ""
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]
    return f"credixsa.name.{digest}"


def build_cache_lookup(payload: Any) -> dict[str, Any]:
    request = parse_search_request(payload)
    cuil_key = cache_key_for_cuil(request.cuit)
    name_key = cache_key_for_name(request.nombre)
    return {
        "cuit": request.cuit,
        "nombre": request.nombre,
        "cuil_cache_key": cuil_key,
        "name_cache_key": name_key,
        "cuil_cache_lookup_key": cuil_key or CACHE_DUMMY_KEY,
        "name_cache_lookup_key": name_key or CACHE_DUMMY_KEY,
    }


def decode_cache_env(value: str) -> dict[str, Any] | None:
    raw_value = (value or "").strip()
    if not raw_value or raw_value == "null":
        return None
    payload = json.loads(raw_value)
    if not isinstance(payload, dict):
        return None
    return payload


def find_cached_result(request: SearchRequest, config: CredixConfig) -> dict[str, Any] | None:
    return find_cached_result_in_payloads(
        request,
        config.cache_by_cuil,
        config.cache_by_name,
        config.cache_max_age_days,
    )


def find_cached_result_in_payloads(
    request: SearchRequest,
    cache_by_cuil: dict[str, Any] | None,
    cache_by_name: dict[str, Any] | None,
    max_age_days: int = CACHE_MAX_AGE_DAYS,
) -> dict[str, Any] | None:
    for cache_payload, cache_source in (
        (cache_by_cuil, "cuil"),
        (cache_by_name, "name"),
    ):
        result = cached_result_if_fresh(cache_payload, max_age_days)
        if result is None:
            continue
        if cache_source == "name" and request.cuit:
            cached_cuil = normalize_cuit(result.get("cuit"))
            if cached_cuil and cached_cuil != request.cuit:
                continue
        result["cache_hit"] = True
        result["cache_source"] = cache_source
        result["cached_at"] = str(cache_payload.get("cached_at") or "")
        return result
    return None


def cached_result_if_fresh(
    cache_payload: dict[str, Any] | None,
    max_age_days: int = CACHE_MAX_AGE_DAYS,
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    if not isinstance(cache_payload, dict):
        return None
    if int(cache_payload.get("version") or 0) != CACHE_VERSION:
        return None
    cached_at = parse_datetime(cache_payload.get("cached_at"))
    if cached_at is None:
        return None
    effective_now = now or utc_now()
    if effective_now - cached_at > timedelta(days=max_age_days):
        return None
    result = cache_payload.get("result")
    if not isinstance(result, dict):
        return None
    return dict(result)


def build_cache_entry(result: dict[str, Any]) -> dict[str, Any] | None:
    if result.get("cache_hit"):
        return None
    if result.get("status") != "single" or not result.get("ok", False):
        return None
    if not result.get("data"):
        return None

    cached_at = utc_now()
    normalized_payload = build_normalized_payload(result)
    clean_result = {
        "ok": True,
        "status": "single",
        "cuit": str(result.get("cuit") or ""),
        "nombre": str(result.get("nombre") or ""),
        "rows": [],
        "data": result.get("data") or [],
        "normalized": normalized_payload,
        "error": "",
    }
    return {
        "version": CACHE_VERSION,
        "cached_at": cached_at.isoformat(),
        "expires_at": (cached_at + timedelta(days=CACHE_MAX_AGE_DAYS)).isoformat(),
        "result": clean_result,
    }


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def parse_datetime(value: Any) -> datetime | None:
    raw_value = str(value or "").strip()
    if not raw_value:
        return None
    if raw_value.endswith("Z"):
        raw_value = f"{raw_value[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(raw_value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


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
    deadline = time.monotonic() + 30.0

    while time.monotonic() < deadline:
        try:
            if _is_final_detail_step(page):
                return
        except Exception:
            pass
        try:
            next_control = _find_detail_next_control(page)
            if next_control is not None:
                next_control.click()
                page.wait_for_load_state("networkidle")
                continue
        except Exception:
            pass
        time.sleep(0.2)

    _log_event(
        "consulta_quiebra_wait_next_timeout",
        cuit=request.cuit,
        nombre=request.nombre,
        url=page.url,
    )
    raise TimeoutError(
        f"Timed out waiting for '{NEXT_BUTTON_SELECTOR}' or the final edicts table. "
        f"cuit={request.cuit!r} nombre={request.nombre!r}"
    )


def _refresh_online_updates_if_available(
    page: "Page",
    config: CredixConfig,
    request: SearchRequest,
) -> None:
    deadline = time.monotonic() + (config.timeout_ms / 1000)
    while time.monotonic() < deadline:
        if _is_detail_summary_page(page):
            _log_event(
                "consulta_quiebra_update_all_skipped_detail_summary",
                cuit=request.cuit,
                nombre=request.nombre,
                url=page.url,
            )
            _debug_dump(page, config, "04_update_all_skipped_detail_summary", request)
            return

        update_all = page.locator(UPDATE_ALL_SELECTOR)
        try:
            if update_all.count() > 0 and update_all.first.is_visible():
                _log_event("consulta_quiebra_update_all_start", cuit=request.cuit, nombre=request.nombre)
                _debug_dump(page, config, "04_before_update_all", request)
                update_all.first.click()
                page.wait_for_load_state("networkidle")
                _debug_dump(page, config, "05_after_update_all_click", request)
                _wait_online_updates_finished(page, config, request)
                _log_event("consulta_quiebra_update_all_done", cuit=request.cuit, nombre=request.nombre)
                return

            update_buttons = page.locator(UPDATE_BUTTON_SELECTOR)
            update_button_count = update_buttons.count()
            if update_button_count > 0:
                _log_event(
                    "consulta_quiebra_individual_update_requests_start",
                    cuit=request.cuit,
                    nombre=request.nombre,
                    button_count=update_button_count,
                )
                _debug_dump(page, config, "04_before_individual_updates", request)
                update_results = _run_visible_online_update_requests(page)
                _log_event(
                    "consulta_quiebra_individual_update_requests_done",
                    cuit=request.cuit,
                    nombre=request.nombre,
                    button_count=update_button_count,
                    results=update_results,
                )
                _debug_dump(page, config, "05_after_individual_update_requests", request)
                return
        except Exception:
            _debug_dump(page, config, "update_all_error", request)
            raise

        if _find_detail_next_control(page) is not None:
            _log_event(
                "consulta_quiebra_update_all_not_available",
                cuit=request.cuit,
                nombre=request.nombre,
                url=page.url,
            )
            _debug_dump(page, config, "04_update_all_not_available", request)
            return

        time.sleep(0.2)


def _wait_online_updates_finished(
    page: "Page",
    config: CredixConfig,
    request: SearchRequest,
) -> None:
    deadline = time.monotonic() + max(60.0, (config.timeout_ms / 1000) * 3)

    while time.monotonic() < deadline:
        if _is_detail_summary_page(page):
            return

        body_text = page.locator("body").inner_text(timeout=5000)
        next_control = page.locator(NEXT_BUTTON_SELECTOR)
        next_enabled = False
        try:
            next_enabled = next_control.count() > 0 and next_control.first.is_enabled()
        except Exception:
            next_enabled = False

        if PROCESSING_TEXT not in body_text and next_enabled:
            return

        time.sleep(1.0)

    _debug_dump(page, config, "update_all_timeout", request)
    raise TimeoutError(
        f"Timed out waiting for CredixSA online updates to finish. "
        f"cuit={request.cuit!r} nombre={request.nombre!r}"
    )


def _run_visible_online_update_requests(page: "Page") -> list[dict[str, Any]]:
    return page.evaluate(
        """
        async () => {
            const updates = [
                {
                    selector: '#actualizar_anses',
                    name: 'anses',
                    url: 'fns_anses_ajax.php',
                    params: {process_anses: '1', anses_captcha_value: ''},
                },
                {
                    selector: '#actualizar_afip_aportes',
                    name: 'afip_aportes',
                    url: 'fns_afip_aportes_ajax.php',
                    params: {get_afipma_auto: '1', manual_update: '1'},
                },
                {
                    selector: '#actualizar_afip_pa',
                    name: 'afip_pa',
                    url: 'get_afippa_captcha.php',
                    params: {get_afippa_captcha: '1'},
                },
                {
                    selector: '#actualizar_afip',
                    name: 'afip',
                    url: 'fns_afip_ajax.php',
                    params: {get_afip_captcha: '1'},
                },
                {
                    selector: '#actualizar_bcra',
                    name: 'bcra',
                    url: 'fns_bcra_ajax.php',
                    params: {get_bcra_captcha: '1'},
                },
                {
                    selector: '#actualizar_negativa',
                    name: 'negativa',
                    url: 'fns_negativa_ajax.php',
                    params: {process_negativa: '1'},
                },
            ].filter((update) => document.querySelector(update.selector));

            const results = [];
            for (const update of updates) {
                try {
                    const response = await fetch(update.url, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                            'X-Requested-With': 'XMLHttpRequest',
                        },
                        body: new URLSearchParams(update.params).toString(),
                    });
                    const text = await response.text();
                    let payload = null;
                    try {
                        payload = JSON.parse(text);
                    } catch (error) {
                        payload = text.slice(0, 200);
                    }
                    results.push({
                        name: update.name,
                        ok: response.ok,
                        status: response.status,
                        payload,
                    });
                } catch (error) {
                    results.push({
                        name: update.name,
                        ok: false,
                        error: String(error),
                    });
                }
            }
            return results;
        }
        """
    )


def _extract_report_sections(
    page: "Page",
    config: CredixConfig,
    request: SearchRequest,
) -> list[dict[str, Any]]:
    try:
        page.wait_for_selector("table", timeout=config.timeout_ms)
    except Exception as exc:
        _debug_dump(page, config, "report_tables_timeout", request)
        raise TimeoutError("Timed out waiting for CredixSA report tables.") from exc

    raw_sections = page.evaluate(
        """
        () => {
            const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
            return Array.from(document.querySelectorAll('table')).map((table, index) => {
                const rows = Array.from(table.rows).map((row) => {
                    const cells = Array.from(row.cells).map((cell) => ({
                        text: normalize(cell.innerText),
                        header: cell.tagName.toLowerCase() === 'th',
                    })).filter((cell) => cell.text !== '');
                    return {
                        cells,
                        has_header: cells.some((cell) => cell.header),
                        all_header: cells.length > 0 && cells.every((cell) => cell.header),
                    };
                }).filter((row) => row.cells.length > 0);

                return {
                    index,
                    text: normalize(table.innerText),
                    rows,
                };
            }).filter((table) => table.text !== '' && table.rows.length > 0);
        }
        """
    )
    return [_normalize_report_section(section) for section in raw_sections]


def _wait_report_tables_stable(page: "Page", config: CredixConfig, request: SearchRequest) -> None:
    deadline = time.monotonic() + max(30.0, config.timeout_ms / 1000)
    started_at = time.monotonic()
    previous_count = -1
    stable_since: float | None = None

    while time.monotonic() < deadline:
        if not _is_detail_summary_page(page):
            time.sleep(0.5)
            continue

        try:
            current_count = page.locator("table").count()
            body_text = page.locator("body").inner_text(timeout=5000)
        except Exception:
            time.sleep(0.5)
            continue

        is_stable = current_count == previous_count and PROCESSING_TEXT not in body_text
        if is_stable:
            stable_since = stable_since or time.monotonic()
            if time.monotonic() - stable_since >= 2.0 and time.monotonic() - started_at >= 5.0:
                return
        else:
            stable_since = None
            previous_count = current_count

        time.sleep(1.0)

    _log_event(
        "consulta_quiebra_report_stability_timeout",
        cuit=request.cuit,
        nombre=request.nombre,
        url=page.url,
    )


def _normalize_report_section(section: dict[str, Any]) -> dict[str, Any]:
    raw_rows = [
        [str(cell.get("text") or "") for cell in row.get("cells", [])]
        for row in section.get("rows", [])
    ]
    raw_rows = [row for row in raw_rows if any(cell for cell in row)]
    header_rows = [
        index
        for index, row in enumerate(section.get("rows", []))
        if row.get("all_header")
    ]
    title = _section_title(raw_rows)
    source = _section_source(title)
    column_headers = _section_column_headers(raw_rows, header_rows)
    records = _section_records(raw_rows, column_headers)

    return {
        "index": int(section.get("index") or 0),
        "title": title,
        "source": source,
        "headers": column_headers,
        "rows": raw_rows,
        "records": records,
        "text": normalize_name(section.get("text")),
    }


def _section_title(rows: list[list[str]]) -> str:
    for row in rows:
        for cell in row:
            value = normalize_name(cell)
            if value:
                return value
    return ""


def _section_source(title: str) -> str:
    match = re.search(r"\bFuente:\s*(.+)$", title, flags=re.IGNORECASE)
    return normalize_name(match.group(1)) if match else ""


def _section_column_headers(rows: list[list[str]], header_rows: list[int]) -> list[str]:
    for index in header_rows:
        row = rows[index]
        if len(row) > 1:
            return [_deduplicate_header(value, position) for position, value in enumerate(row)]

    widest = max(rows, key=len, default=[])
    if len(widest) > 2:
        return [_deduplicate_header(value, position) for position, value in enumerate(widest)]

    return []


def _deduplicate_header(value: str, position: int) -> str:
    normalized = normalize_name(value)
    return normalized or f"columna_{position + 1}"


def _section_records(rows: list[list[str]], headers: list[str]) -> list[dict[str, str]]:
    if not rows:
        return []

    if headers:
        records: list[dict[str, str]] = []
        for row in rows:
            if row == headers:
                continue
            if len(row) != len(headers):
                continue
            records.append(dict(zip(headers, row, strict=True)))
        if records:
            return records

    key_value_rows = [
        {normalize_name(row[0]): normalize_name(row[1])}
        for row in rows
        if len(row) == 2 and normalize_name(row[0])
    ]
    return key_value_rows


def _section_rows(section: dict[str, Any]) -> list[list[str]]:
    rows = section.get("rows")
    if not isinstance(rows, list):
        return []
    return [
        [normalize_name(cell) for cell in row if normalize_name(cell)]
        for row in rows
        if isinstance(row, list)
    ]


def _section_key_values(section: dict[str, Any]) -> dict[str, str]:
    values: dict[str, str] = {}

    records = section.get("records")
    if isinstance(records, list):
        for record in records:
            if not isinstance(record, dict):
                continue
            for key, value in record.items():
                clean_key = normalize_name(key)
                clean_value = normalize_name(value)
                if clean_key and clean_value:
                    values[clean_key] = clean_value

    for row in _section_rows(section):
        if len(row) == 2 and row[0].lower() != normalize_name(section.get("title")).lower():
            values.setdefault(row[0], row[1])

    return values


def _normalized_label(value: Any) -> str:
    normalized = normalize_name(value).lower()
    normalized = "".join(
        char
        for char in unicodedata.normalize("NFD", normalized)
        if unicodedata.category(char) != "Mn"
    )
    normalized = normalized.replace("(*)", "").replace("*", "")
    normalized = normalized.replace("fuente:", "fuente ")
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = re.sub(r"[^a-z0-9:./\\ -]+", " ", normalized)
    return normalize_name(normalized)


def _normalize_persona_block(values: dict[str, str]) -> dict[str, str]:
    persona = {
        "documento": values.get("Documento", ""),
        "genero": values.get("Sexo", ""),
        "nombre_completo": values.get("Nombre", ""),
        "domicilio": values.get("Domicilio", ""),
    }
    age_info = _parse_age_and_birthdate(values.get("Edad", ""))
    persona.update(age_info)
    persona.update(_extract_locality(values.get("Domicilio", "")))
    return {key: value for key, value in persona.items() if value}


def _parse_age_and_birthdate(value: str) -> dict[str, str]:
    match = re.search(r"(?P<age>\d+)\s*\((?P<birthdate>[^)]+)\)", normalize_name(value))
    if match:
        return {
            "edad": match.group("age"),
            "fecha_nacimiento": match.group("birthdate"),
        }
    if value:
        return {"edad": normalize_name(value)}
    return {}


def _extract_locality(value: str) -> dict[str, str]:
    parts = [normalize_name(part) for part in str(value or "").split(" - ") if normalize_name(part)]
    if len(parts) < 2:
        return {}

    province = parts[-1]
    locality = ""
    if len(parts) >= 4:
        locality = parts[-3]
    elif len(parts) >= 3:
        locality = parts[-2]

    locality = re.sub(r"^\(\d+\)\s*", "", locality).strip()
    return {
        "localidad": locality,
        "provincia": province,
    }


def _normalize_bcra_summary(values: dict[str, str]) -> dict[str, str]:
    summary = {
        "color": values.get("Resumen (*)", ""),
        "detalle": "",
    }
    for key, value in values.items():
        if "detalle" in _normalized_label(key):
            summary["detalle"] = value
            break
    return {key: value for key, value in summary.items() if value}


def _normalize_bcra_vigentes(rows: list[list[str]]) -> dict[str, Any]:
    entities: list[dict[str, Any]] = []
    total = ""
    for row in rows[2:]:
        if not row:
            continue
        if row[0].upper().startswith("TOTAL"):
            total = row[-1]
            continue

        period_index = next((index for index, cell in enumerate(row) if re.fullmatch(r"\d{2}\s*/\s*\d{4}", cell) or re.fullmatch(r"\d{2}/\d{4}", cell)), None)
        share = row[-1] if row and row[-1].endswith("%") else ""
        amount_index = None
        for index in range(len(row) - 1, -1, -1):
            cell = row[index]
            if cell.endswith("%"):
                continue
            if period_index is not None and index == period_index:
                continue
            if cell.startswith("$") or re.fullmatch(r"[\d.]+", cell):
                amount_index = index
                break

        if period_index is None or amount_index is None:
            continue

        entity_start = 0
        situacion = ""
        participacion = ""
        if period_index >= 2 and re.fullmatch(r"\d+", row[0]):
            situacion = row[0]
            if row[1].endswith("%"):
                participacion = row[1]
                entity_start = 2
            else:
                entity_start = 1

        entity_end = min(period_index, amount_index)
        entidad = " ".join(row[entity_start:entity_end]).strip()
        entities.append(
            {
                "situacion": situacion,
                "participacion": participacion,
                "entidad": entidad,
                "periodo": row[period_index],
                "monto": row[amount_index],
                "porcentaje": share if share != participacion else "",
                "raw": row,
            }
        )

    return {
        "deudas_vigentes": entities,
        "deuda_vigente_total": total,
    }


def _ensure_bcra_24_months_payload(payload: dict[str, Any], sections: Any) -> None:
    bcra = payload.get("bcra")
    if not isinstance(bcra, dict):
        return
    if isinstance(bcra.get("deudas_24_meses"), dict) and bcra["deudas_24_meses"]:
        _mark_active_bcra_24_month_rows(
            bcra.get("deudas_24_meses"),
            bcra.get("deudas_vigentes") or [],
        )
        return
    if not isinstance(sections, list):
        return

    for section in sections:
        if not isinstance(section, dict):
            continue
        title = normalize_name(section.get("title"))
        match_title = normalize_name(_normalized_label(title).replace("-", " "))
        if not match_title.startswith("deudas en el sistema financiero"):
            continue
        matrix = _normalize_bcra_24_months(section)
        if matrix:
            bcra["deudas_24_meses"] = matrix
            _mark_active_bcra_24_month_rows(matrix, bcra.get("deudas_vigentes") or [])
        return


def _ensure_previsional_employer_tables_payload(payload: dict[str, Any], sections: Any) -> None:
    previsional = payload.get("previsional")
    if not isinstance(previsional, dict):
        return
    if isinstance(previsional.get("situaciones_por_empleador"), list) and previsional["situaciones_por_empleador"]:
        return
    if not isinstance(sections, list):
        return

    situations: list[dict[str, Any]] = []
    for index, section in enumerate(sections):
        if not isinstance(section, dict):
            continue

        title = normalize_name(section.get("title"))
        match_title = normalize_name(_normalized_label(title).replace("-", " "))
        if not match_title.startswith("situacion previsional empleador"):
            continue

        employer = _normalize_previsional_employer(title, _section_key_values(section))
        employer = _existing_previsional_employer(
            previsional.get("empleadores"),
            employer.get("indice", ""),
        ) or employer
        next_section = sections[index + 1] if index + 1 < len(sections) else None
        periods = _normalize_previsional_period_table(next_section) if isinstance(next_section, dict) else []
        if not employer or not periods:
            continue

        situations.append(
            {
                "indice": employer.get("indice", ""),
                "fuente": normalize_name(section.get("source")),
                "empleador": employer,
                "periodos": periods,
            }
        )

    previsional["situaciones_por_empleador"] = situations


def _ensure_bcra_entity_evolution_payload(payload: dict[str, Any], sections: Any) -> None:
    bcra = payload.get("bcra")
    if not isinstance(bcra, dict):
        return
    if isinstance(bcra.get("evolucion_deuda_por_entidad"), dict) and bcra["evolucion_deuda_por_entidad"]:
        return
    if not isinstance(sections, list):
        return

    for section in sections:
        if not isinstance(section, dict):
            continue
        title = normalize_name(section.get("title"))
        match_title = normalize_name(_normalized_label(title).replace("-", " "))
        if not match_title.startswith("evolucion deuda sistema financiero por entidad"):
            continue
        matrix = _normalize_bcra_entity_evolution(section, bcra.get("deudas_24_meses"))
        if matrix:
            bcra["evolucion_deuda_por_entidad"] = matrix
        return


def _normalize_bcra_24_months(section: dict[str, Any]) -> dict[str, Any]:
    rows = _section_rows(section)
    if len(rows) < 4:
        return {}

    year_labels = [
        value
        for value in rows[1]
        if re.fullmatch(r"\d{4}", value)
    ]
    months = rows[2]
    if not year_labels or not months:
        return {}

    years = _build_bcra_year_groups(year_labels, months)
    entities = []
    for row in rows[3:]:
        if len(row) < len(months) + 2:
            continue
        entity = row[0]
        situations = row[1 : 1 + len(months)]
        amount_index = 1 + len(months)
        entities.append(
            {
                "entidad": entity,
                "situaciones": situations,
                "ultimo_monto_informado": row[amount_index] if amount_index < len(row) else "",
                "observacion": row[amount_index + 1] if amount_index + 1 < len(row) else "",
                "activa": False,
            }
        )

    if not entities:
        return {}

    return {
        "titulo": normalize_name(section.get("title")),
        "fuente": normalize_name(section.get("source")),
        "anios": years,
        "meses": months,
        "filas": entities,
    }


def _build_bcra_year_groups(year_labels: list[str], months: list[str]) -> list[dict[str, Any]]:
    if not months:
        return []

    groups: list[dict[str, Any]] = []
    label_index = 0
    span = 1
    previous_month = _month_number(months[0])

    for month in months[1:]:
        current_month = _month_number(month)
        is_new_year = current_month > previous_month if current_month and previous_month else False
        if is_new_year and label_index < len(year_labels):
            groups.append({"anio": year_labels[label_index], "span": span})
            label_index += 1
            span = 1
        else:
            span += 1
        previous_month = current_month

    label = year_labels[min(label_index, len(year_labels) - 1)]
    groups.append({"anio": label, "span": span})
    return groups


def _month_number(value: str) -> int:
    return {
        "ene": 1,
        "feb": 2,
        "mar": 3,
        "abr": 4,
        "may": 5,
        "jun": 6,
        "jul": 7,
        "ago": 8,
        "set": 9,
        "sep": 9,
        "oct": 10,
        "nov": 11,
        "dic": 12,
    }.get(normalize_name(value).lower(), 0)


def _mark_active_bcra_24_month_rows(matrix: Any, active_debts: Any) -> None:
    if not isinstance(matrix, dict):
        return
    rows = matrix.get("filas")
    if not isinstance(rows, list):
        return
    active_entities = {
        _normalized_label(debt.get("entidad"))
        for debt in active_debts
        if isinstance(debt, dict) and normalize_name(debt.get("entidad"))
    }
    for row in rows:
        if not isinstance(row, dict):
            continue
        row["activa"] = _normalized_label(row.get("entidad")) in active_entities


def _normalize_bcra_history(section: dict[str, Any]) -> list[dict[str, Any]]:
    history: list[dict[str, Any]] = []
    records = section.get("records")
    if not isinstance(records, list):
        return history

    for record in records:
        if not isinstance(record, dict):
            continue
        period = normalize_name(record.get("Período"))
        if not period:
            continue
        entities = {
            normalize_name(key): normalize_name(value)
            for key, value in record.items()
            if normalize_name(key) and normalize_name(key) != "Período" and normalize_name(value)
        }
        history.append({"periodo": period, "entidades": entities})
    return history


def _normalize_bcra_entity_evolution(section: dict[str, Any], monthly_matrix: Any) -> dict[str, Any]:
    rows = _section_rows(section)
    if len(rows) < 3 or len(rows[1]) < 2:
        return {}

    entities = rows[1][1:]
    if not entities:
        return {}

    matrix_rows = monthly_matrix.get("filas") if isinstance(monthly_matrix, dict) else []
    period_situations = _build_bcra_period_situations(monthly_matrix)
    matched_rows = {
        entity: _match_bcra_entity_row(entity, matrix_rows)
        for entity in entities
    }

    history_rows: list[dict[str, Any]] = []
    for row in rows[2:]:
        if len(row) < 2 or not re.fullmatch(r"\d{2}/\d{4}", row[0]):
            continue

        period = row[0]
        amounts = row[1:]
        active_entities = [
            entity
            for entity in entities
            if period_situations.get(period, {}).get(_normalized_label(matched_rows.get(entity, {}).get("entidad")))
            not in {"", "-"}
        ]

        amount_by_entity: dict[str, str] = {}
        if len(amounts) == len(entities):
            amount_by_entity = dict(zip(entities, amounts))
        elif len(active_entities) == len(amounts):
            amount_by_entity = dict(zip(active_entities, amounts))
        else:
            amount_by_entity = dict(zip(active_entities or entities, amounts))

        cells = []
        for entity in entities:
            matched_entity = _normalized_label(matched_rows.get(entity, {}).get("entidad"))
            situation = period_situations.get(period, {}).get(matched_entity, "")
            cells.append(
                {
                    "entidad": entity,
                    "monto": amount_by_entity.get(entity, ""),
                    "situacion": situation,
                }
            )
        history_rows.append({"periodo": period, "celdas": cells})

    if not history_rows:
        return {}

    return {
        "titulo": normalize_name(section.get("title")),
        "fuente": normalize_name(section.get("source")),
        "entidades": entities,
        "filas": history_rows,
    }


def _build_bcra_period_situations(matrix: Any) -> dict[str, dict[str, str]]:
    if not isinstance(matrix, dict):
        return {}

    months = matrix.get("meses")
    years = matrix.get("anios")
    rows = matrix.get("filas")
    if not isinstance(months, list) or not isinstance(years, list) or not isinstance(rows, list):
        return {}

    period_labels: list[str] = []
    month_index = 0
    for year in years:
        if not isinstance(year, dict):
            continue
        label = normalize_name(year.get("anio"))
        span = int(year.get("span") or 0)
        for month in months[month_index : month_index + span]:
            month_number = _month_number(month)
            if label and month_number:
                period_labels.append(f"{month_number:02d}/{label}")
            month_index += 1

    situations: dict[str, dict[str, str]] = {period: {} for period in period_labels}
    for row in rows:
        if not isinstance(row, dict):
            continue
        entity = _normalized_label(row.get("entidad"))
        row_situations = row.get("situaciones")
        if not entity or not isinstance(row_situations, list):
            continue
        for index, period in enumerate(period_labels):
            if index < len(row_situations):
                situations[period][entity] = normalize_name(row_situations[index])
    return situations


def _match_bcra_entity_row(entity: str, rows: Any) -> dict[str, Any]:
    if not isinstance(rows, list):
        return {}

    normalized_entity = _normalized_label(entity)
    best_row: dict[str, Any] = {}
    best_score = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        normalized_candidate = _normalized_label(row.get("entidad"))
        if not normalized_candidate:
            continue
        if normalized_entity == normalized_candidate:
            return row
        if normalized_entity in normalized_candidate or normalized_candidate in normalized_entity:
            score = max(len(normalized_entity.split()), len(normalized_candidate.split()))
        else:
            score = len(set(normalized_entity.split()) & set(normalized_candidate.split()))
        if score > best_score:
            best_row = row
            best_score = score
    return best_row if best_score > 0 else {}


def _normalize_bcra_entities(section: dict[str, Any]) -> list[dict[str, str]]:
    entities: list[dict[str, str]] = []
    records = section.get("records")
    if not isinstance(records, list):
        return entities

    for record in records:
        if not isinstance(record, dict):
            continue
        entity = {
            "entidad": normalize_name(record.get("Entidad")),
            "cuit": normalize_name(record.get("Cuit")),
            "marca": normalize_name(record.get("Marca")),
            "domicilio": normalize_name(record.get("Domicilio")),
            "contacto": normalize_name(record.get("Contacto")),
        }
        if any(entity.values()):
            entities.append(entity)
    return entities


def _normalize_previsional_message(rows: list[list[str]]) -> str:
    return _single_value_row(rows)


def _normalize_previsional_employer(title: str, values: dict[str, str]) -> dict[str, str]:
    employer_value = values.get("Empleador", "")
    cuit = ""
    employer_name = employer_value
    match = re.match(r"(?P<cuit>\d{2}-\d{8}-\d)\s*-\s*(?P<name>.+)$", employer_value)
    if match:
        cuit = normalize_cuit(match.group("cuit"))
        employer_name = normalize_name(match.group("name"))

    employer_index_match = re.search(r"Empleador\s+(\d+)", title)
    employer_index = employer_index_match.group(1) if employer_index_match else ""

    employer = {
        "indice": employer_index,
        "cuit": cuit,
        "nombre": employer_name,
        "actividad": values.get("Actividad", ""),
        "domicilio": values.get("Domicilio", ""),
    }
    return {key: value for key, value in employer.items() if value}


def _existing_previsional_employer(employers: Any, employer_index: str) -> dict[str, str]:
    if not isinstance(employers, list) or not employer_index:
        return {}
    for employer in employers:
        if not isinstance(employer, dict):
            continue
        if str(employer.get("indice") or "") == employer_index:
            return employer
    return {}


def _normalize_previsional_period_table(section: dict[str, Any] | None) -> list[dict[str, str]]:
    if not isinstance(section, dict):
        return []

    rows = _section_rows(section)
    header_index = next(
        (
            index
            for index, row in enumerate(rows)
            if len(row) >= 5 and row and _normalized_label(row[0]) == "periodo"
        ),
        None,
    )
    if header_index is None:
        return []

    periods: list[dict[str, str]] = []
    for row in rows[header_index + 1 :]:
        if len(row) < 5 or not re.fullmatch(r"\d{2}/\d{4}", row[0]):
            continue
        periods.append(
            {
                "periodo": row[0],
                "incluido_declaracion_jurada": row[1],
                "aportes_seguridad_social": row[2],
                "aportes_obra_social": row[3],
                "contribucion_patronal_obra_social": row[4],
            }
        )
    return periods


def _normalize_registration(title: str, rows: list[list[str]]) -> dict[str, str]:
    period_match = re.search(r"Per[ií]odo:\s*(.+?)\s+Fuente:", title)
    period = normalize_name(period_match.group(1)) if period_match else ""
    message = _single_value_row(rows)
    registration = {
        "periodo": period,
        "mensaje": message,
    }
    return {key: value for key, value in registration.items() if value}


def _normalize_obra_social(title: str, values: dict[str, str], rows: list[list[str]]) -> dict[str, str]:
    updated_at_match = re.search(r"Actualizados? al\s+(.+?)\s*(?:\(\*\))?\s*Fuente:", title)
    obra_social = {
        "fecha_actualizacion": normalize_name(updated_at_match.group(1)) if updated_at_match else "",
        "obra_social": values.get("Obra Social", ""),
        "situacion_laboral": values.get("Situacion Laboral", ""),
        "empleador": values.get("Empleador", ""),
        "actividad_empleador": values.get("Actividad Empleador", ""),
        "domicilio_empleador": values.get("Domicilio Empleador", ""),
        "mensaje": "",
    }
    if not any(value for key, value in obra_social.items() if key != "fecha_actualizacion"):
        obra_social["mensaje"] = _single_value_row(rows)
    return {key: value for key, value in obra_social.items() if value}


def _normalize_edicts(rows: list[list[str]]) -> list[dict[str, str]]:
    edicts: list[dict[str, str]] = []
    for row in rows[1:]:
        if len(row) == 1:
            continue
        if len(row) < 3:
            continue
        if not re.search(r"\d{2}/\d{2}/\d{4}", row[0]):
            continue
        if len(row) >= 4:
            edict_id = row[2]
            summary = row[3]
        else:
            edict_id = ""
            summary = row[2]
        edicts.append(
            {
                "fecha": row[0],
                "fuente": row[1],
                "id": edict_id,
                "resumen": summary,
            }
        )
    return edicts


def _single_value_row(rows: list[list[str]]) -> str:
    for row in rows[1:]:
        if len(row) == 1:
            return row[0]
    return ""


def _is_detail_summary_page(page: "Page") -> bool:
    body_text = page.locator("body").inner_text(timeout=5000)
    if "Datos Filiatorios" in body_text:
        return True
    if "Resumen (*)" in body_text:
        return True
    return "con_cuit3.php" in page.url


def _is_final_detail_step(page: "Page") -> bool:
    table = page.locator(EDICTS_TABLE_SELECTOR).filter(has_text=EDICTS_TABLE_TEXT)
    if table.count() > 0 and table.first.is_visible():
        return True
    return _is_detail_summary_page(page)


def _find_detail_next_control(page: "Page") -> "Locator | None":
    candidates = [
        page.locator(NEXT_BUTTON_SELECTOR),
        page.locator("button", has_text=DETAIL_NEXT_TEXT),
        page.locator("input[type='submit'][value='Siguiente']"),
        page.locator("input[type='button'][value='Siguiente']"),
        page.locator("a", has_text=DETAIL_NEXT_TEXT),
        page.locator("text=Siguiente"),
    ]

    for locator in candidates:
        try:
            if locator.count() > 0 and locator.first.is_visible():
                return locator.first
        except Exception:
            continue

    return None


def _base_result(
    request: SearchRequest,
    *,
    status: str,
    rows: list[dict[str, str]],
    data: list[dict[str, Any]],
    error: str,
    ok: bool = True,
    cuit: str | None = None,
    nombre: str | None = None,
) -> dict[str, Any]:
    return {
        "ok": ok,
        "status": status,
        "cuit": request.cuit if cuit is None else cuit,
        "nombre": request.nombre if nombre is None else nombre,
        "rows": rows,
        "data": data,
        "error": error,
        "cache_hit": False,
        "cached_at": "",
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
    lookup = request.cuit or request.nombre or "sin_criterio"
    safe_lookup = re.sub(r"[^A-Za-z0-9_.-]+", "_", lookup).strip("_")[:80] or "sin_criterio"
    base_name = f"credixsa_{prefix}_{safe_lookup}_{timestamp}"
    debug_dir = getattr(config, "debug_dir", "") or "."
    screenshot_path = os.path.join(debug_dir, f"{base_name}.png")
    html_path = os.path.join(debug_dir, f"{base_name}.html")
    try:
        os.makedirs(debug_dir, exist_ok=True)
        page.screenshot(path=screenshot_path, full_page=True)
        html = page.content()
        with open(html_path, "w", encoding="utf-8") as handle:
            handle.write(html)
        _log_event(
            "consulta_quiebra_debug_dump",
            cuit=request.cuit,
            nombre=request.nombre,
            stage=prefix,
            screenshot_path=screenshot_path,
            html_path=html_path,
            url=page.url,
        )
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
