"""Prepare the financial block before publishing a CredixSA cache entry."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import json
import logging
import re
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .service import build_normalized_payload, normalize_cuit

BASE_URL = "https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas/"
MAX_ATTEMPTS = 3
RETRY_PAUSE_SECONDS = 12
TIMEOUT_SECONDS = 8
MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
logger = logging.getLogger(__name__)


def _timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _money(cents: int) -> str:
    whole, fraction = divmod(cents, 100)
    return "$ " + f"{whole:,}".replace(",", ".") + (f",{fraction:02d}" if fraction else "")


def _period_label(period: str) -> str:
    return f"{period[4:]}/{period[:4]}"


def _fetch(path: str) -> tuple[int, object]:
    request = Request(BASE_URL + path, headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.status, json.load(response)
    except HTTPError as exc:
        with exc:
            return exc.code, json.loads(exc.read())


def _periods(status: int, payload: object, cuit: str) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Invalid BCRA response")
    if status == 404 and payload.get("status") == 404:
        messages = payload.get("errorMessages")
        if isinstance(messages, list) and re.search(
            r"no se encontr.*datos.*identifica", " ".join(messages), re.I
        ):
            return {}
    results = payload.get("results")
    if (status != 200 or payload.get("status") != 200 or not isinstance(results, dict)
            or str(results.get("identificacion", "")) != cuit
            or not isinstance(results.get("periodos"), list)):
        raise ValueError("Invalid BCRA response or identity")
    periods = {}
    for period in results["periodos"]:
        label = str(period.get("periodo", ""))
        if (not re.fullmatch(r"\d{4}(0[1-9]|1[0-2])", label)
                or not isinstance(period.get("entidades"), list) or label in periods):
            raise ValueError("Invalid BCRA period")
        entities = {}
        for entity in period["entidades"]:
            name = str(entity.get("entidad") or "").strip()
            situation = str(entity.get("situacion", ""))
            amount = Decimal(str(entity.get("monto")))
            if (not name or situation not in {"1", "2", "3", "4", "5", "6"}
                    or not amount.is_finite() or amount < 0 or name in entities):
                raise ValueError("Invalid BCRA entity")
            entities[name] = {
                "situacion": situation,
                # The official API reports thousands of pesos. Store integer cents.
                "cents": int((amount * 100000).quantize(Decimal("1"), rounding=ROUND_HALF_UP)),
                "observacion": " · ".join(filter(None, [
                    "En revisión" if entity.get("enRevision") else "",
                    "Proceso judicial" if entity.get("procesoJud") else "",
                ])),
            }
        periods[label] = entities
    return dict(sorted(periods.items(), reverse=True))


def consult_bcra(cuit: str) -> dict | None:
    if not re.fullmatch(r"\d{11}", cuit):
        return None
    paths = {"current": cuit, "history": "Historicas/" + cuit}
    reports = {}
    for attempt in range(MAX_ATTEMPTS):
        with ThreadPoolExecutor(max_workers=2) as pool:
            pending = {key: pool.submit(_fetch, path) for key, path in paths.items() if key not in reports}
            for key, future in pending.items():
                try:
                    status, payload = future.result()
                    reports[key] = _periods(status, payload, cuit)
                except Exception:
                    # Retain successful endpoints, retry only the failed ones.
                    pass
        if len(reports) == 2:
            return _normalize(reports["current"], reports["history"])
        if attempt + 1 < MAX_ATTEMPTS:
            time.sleep(RETRY_PAUSE_SECONDS)
    logger.warning("BCRA unavailable after 3 attempts; caching CredixSA fallback.")
    return None


def _normalize(current: dict, history: dict) -> dict:
    active = set()
    debts = []
    total = negative = 0
    for period, entities in current.items():
        for name, entity in entities.items():
            if name in active:
                continue
            active.add(name)
            total += entity["cents"]
            if int(entity["situacion"]) >= 2:
                negative += entity["cents"]
            debts.append({"entidad": name, "periodo": _period_label(period),
                          "situacion": entity["situacion"], "monto": _money(entity["cents"]),
                          "observacion": entity["observacion"]})
    history = deepcopy(history)
    for period, entities in current.items():
        history.setdefault(period, {}).update(entities)
    periods, years, months = [], [], []
    if history:
        latest = max(history)
        year, month = int(latest[:4]), int(latest[4:])
        for _ in range(24):
            periods.append(f"{year:04d}{month:02d}")
            if years and years[-1]["anio"] == str(year):
                years[-1]["span"] += 1
            else:
                years.append({"anio": str(year), "span": 1})
            months.append(MONTHS[month - 1])
            month -= 1
            if not month:
                year, month = year - 1, 12
    names = {}
    for period in periods:
        for name, entity in history.get(period, {}).items():
            names.setdefault(name, entity)
    rows = [{"entidad": name,
             "situaciones": [history.get(period, {}).get(name, {}).get("situacion", "-") for period in periods],
             "ultimo_monto_informado": _money(latest["cents"]),
             "observacion": latest["observacion"], "activa": name in active}
            for name, latest in names.items()]
    evolution = []
    for period in periods:
        cells = []
        for name in names:
            entity = history.get(period, {}).get(name)
            cells.append({"entidad": name, "situacion": entity["situacion"] if entity else "",
                          "monto": _money(entity["cents"]) if entity else ""})
        evolution.append({"periodo": _period_label(period), "celdas": cells})
    return {
        "fuente": "BCRA", "consultado_en": _timestamp(), "consulta_directa_estado": "ok",
        "resumen": {}, "entidades": sorted(active), "deudas_vigentes": debts,
        "deuda_vigente_total": _money(total), "deuda_situacion_negativa_total": _money(negative),
        "mensaje": "" if debts else "Sin deudas vigentes informadas por BCRA.",
        "deudas_24_meses": {"fuente": "BCRA", "anios": years, "meses": months, "filas": rows},
        "evolucion_deuda_por_entidad": {"fuente": "BCRA", "entidades": list(names), "filas": evolution},
        "historial_por_entidad": [],
    }


def enrich_bcra(result: dict) -> dict:
    # Cache reads are read-only: neither a successful snapshot nor a fallback triggers retries.
    if result.get("cache_hit") or result.get("status") != "single" or not result.get("ok"):
        return result
    prepared = deepcopy(result)
    normalized = build_normalized_payload(prepared)
    cuit = normalize_cuit(normalized.get("persona", {}).get("cuit") or prepared.get("cuit"))
    fallback = normalized.setdefault("bcra", {})
    fallback["fuente"] = "CredixSA"
    fallback["consulta_directa_estado"] = "unavailable" if len(cuit) == 11 else "invalid_identity"
    fallback["consulta_directa_fecha"] = _timestamp()
    try:
        direct = consult_bcra(cuit)
        if direct is not None:
            normalized["bcra"] = direct
    except Exception:
        logger.warning("BCRA enrichment failed; caching CredixSA fallback.")
    prepared["normalized"] = normalized
    return prepared
