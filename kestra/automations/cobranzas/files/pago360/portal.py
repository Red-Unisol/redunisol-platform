"""Portal v1 transport, not wired into the disabled financial executor.

Only the portal service is contacted. No Vimarx endpoint, automatic retry or
implicit claim is performed by a read. Keep transport errors distinct from
business state; a failed POST must be reconciled by reading the snapshot.
"""
from __future__ import annotations

import json
import re
from datetime import date
from decimal import Decimal
from urllib.parse import urlsplit
from uuid import UUID

import requests

from pago360_cuotas.domain import ContractError, Installment, Operation, cents, legacy_id


class PortalError(RuntimeError):
    def __init__(self, status: int | None, code: str, *, uncertain: bool = False):
        self.status, self.code, self.uncertain = status, code, uncertain
        super().__init__(f"Portal {code}" + (f" (HTTP {status})" if status else ""))


def uuid_text(value: object) -> str:
    if not isinstance(value, str):
        raise ContractError("UUID required")
    try:
        parsed = UUID(value)
    except ValueError:
        raise ContractError("Invalid UUID") from None
    if str(parsed) != value.lower():
        raise ContractError("Canonical UUID required")
    return str(parsed)


def normalize_operation(snapshot: dict) -> Operation:
    """Normalize wire names/units only; this is NOT provider verification."""
    try:
        op = snapshot["operacion"]
        if op["tipo_operacion"] != "cuotas_vencidas" or op.get("imputacion_manual") is not False:
            raise ContractError("Operation is outside the automatic circuit")
        environment = {"sandbox": "sandbox", "live": "production"}[op["ambiente"]]
        items = []
        for row in snapshot["cuotas"]:
            uuid_text(row["pago_cuota_id"])
            number = row["nro_cuota"]
            if not isinstance(number, str) or not number.isascii() or not number.isdecimal():
                raise ContractError("Invalid installment number")
            items.append(Installment(
                legacy_id(row["prestamo_id"]), legacy_id(row["cuota_prestamo_id"]),
                int(number), date.fromisoformat(row["fecha_vencimiento"]), cents(row["importe"]),
            ))
        reference = op["proveedor_ref"]
        if not isinstance(reference, str) or not reference.isascii() or not reference.isdecimal():
            raise ContractError("Invalid provider reference")
        return Operation(uuid_text(op["id"]), reference, environment,
                         cents(op["monto_total"]), tuple(items))
    except (KeyError, TypeError, ValueError, AttributeError):
        raise ContractError("Invalid or ineligible portal snapshot") from None


class PortalClient:
    def __init__(self, base_url: str, service_token: str):
        url = urlsplit(base_url)
        if (url.scheme != "https" or not url.hostname or url.username is not None
                or url.password is not None or url.query or url.fragment
                or not url.path.rstrip("/").endswith("/kestra-imputaciones/v1")
                or not isinstance(service_token, str) or len(service_token) < 32):
            raise ContractError("Portal HTTPS v1 base and service token required")
        self.base_url, self._token = base_url.rstrip("/"), service_token

    def _request(self, method: str, path: str, *, body: dict | None = None,
                 params: dict | None = None) -> dict:
        write = method == "POST"
        try:
            response = requests.request(
                method, self.base_url + "/" + path,
                headers={"Authorization": f"Bearer {self._token}", "Accept": "application/json"},
                json=body, params=params, timeout=(5, 20), allow_redirects=False, verify=True,
            )
        except requests.RequestException:
            raise PortalError(None, "UNAVAILABLE", uncertain=write) from None
        try:
            payload = json.loads(response.text, parse_float=Decimal)
        except (ValueError, TypeError):
            raise PortalError(response.status_code, "INVALID_RESPONSE", uncertain=write) from None
        if not isinstance(payload, dict):
            raise PortalError(response.status_code, "INVALID_RESPONSE", uncertain=write)
        if response.status_code not in (200, 201):
            allowed = {"no_existe", "no_encontrado", "no_autorizado", "ocupado", "terminal",
                       "fencing_invalido", "lease_vencido", "transicion_invalida", "bloqueado",
                       "cuota_reservada_en_otra_operacion", "cupo_acumulado_excedido",
                       "release_no_permitido", "aplicado_prematuro", "recibo_no_coincide",
                       "solicitud_invalida", "error_interno"}
            code = payload.get("error") or payload.get("resultado")
            raise PortalError(response.status_code, code if isinstance(code, str) and code in allowed else "REJECTED",
                              uncertain=write and (response.status_code >= 500 or response.status_code < 400))
        if type(payload.get("version")) is not int or payload.get("version") != 1:
            raise PortalError(response.status_code, "INVALID_VERSION", uncertain=write)
        return payload

    def snapshot(self, operation_id: str) -> dict:
        operation_id = uuid_text(operation_id)
        data = self._request("GET", f"trabajos/{operation_id}")
        snapshot = data.get("snapshot")
        if (not isinstance(snapshot, dict) or not isinstance(snapshot.get("operacion"), dict)
                or snapshot["operacion"].get("id") != operation_id):
            raise PortalError(200, "INVALID_SNAPSHOT")
        return snapshot

    def jobs(self, state: str = "pendiente", limit: int = 50) -> list:
        if state not in {"pendiente", "en_proceso", "aplicado", "a_conciliar"}:
            raise ContractError("Invalid job state")
        if type(limit) is not int or not 1 <= limit <= 200:
            raise ContractError("Invalid job limit")
        data = self._request("GET", "trabajos", params={"estado": state, "limit": limit})
        if not isinstance(data.get("trabajos"), list):
            raise PortalError(200, "INVALID_JOB_LIST")
        for job in data["trabajos"]:
            if not isinstance(job, dict) or job.get("estado") != state:
                raise PortalError(200, "INVALID_JOB_LIST")
            uuid_text(job.get("operacion_id"))
        return data["trabajos"]

    def claim(self, operation_id: str, executor_id: str) -> dict:
        if not isinstance(executor_id, str) or not 1 <= len(executor_id) <= 100:
            raise ContractError("Invalid executor")
        return self._request("POST", f"trabajos/{uuid_text(operation_id)}/claim",
                             body={"executor_id": executor_id, "lease_segundos": 300})

    @staticmethod
    def _lease(token: str, fencing: int) -> dict:
        if type(fencing) is not int or fencing < 1:
            raise ContractError("Invalid fencing")
        return {"token": uuid_text(token), "fencing": fencing}

    def begin(self, operation_id: str, item_id: str, token: str, fencing: int) -> dict:
        return self._request("POST", f"trabajos/{uuid_text(operation_id)}/cuotas/{uuid_text(item_id)}/begin",
                             body=self._lease(token, fencing))

    def record(self, operation_id: str, attempt_id: str, state: str, token: str, fencing: int,
               *, proof: dict | None = None, detail: str | None = None) -> dict:
        if state not in {"received", "verified", "uncertain", "rejected"}:
            raise ContractError("Invalid attempt transition")
        body = self._lease(token, fencing)
        if state in {"received", "verified"}:
            if not isinstance(proof, dict):
                raise ContractError("Explicit receipt or new verification required")
            legacy_id(proof.get("cuota_prestamo_id"))
            amount = proof.get("importe")
            if not isinstance(amount, str) or not re.fullmatch(r"[0-9]{1,15}\.[0-9]{2}", amount):
                raise ContractError("Exact receipt amount required")
            cents(amount)
            reference = proof.get("referencia")
            if not isinstance(reference, str) or not reference.strip():
                raise ContractError("Legacy receipt reference required")
            body["referencia_cobro"] = reference
            body["verificacion" if state == "verified" else "recibo"] = proof
        if detail is not None:
            if not isinstance(detail, str) or len(detail) > 300:
                raise ContractError("Invalid detail")
            body["detalle"] = detail
        return self._request("POST", f"trabajos/{uuid_text(operation_id)}/intentos/{uuid_text(attempt_id)}/{state}", body=body)

    def finish(self, operation_id: str, state: str, token: str, fencing: int,
               reason: str | None = None) -> dict:
        if state not in {"aplicado", "a_conciliar"} or (state == "a_conciliar" and not reason):
            raise ContractError("Only terminal states use finish; pending requires release")
        body = self._lease(token, fencing) | {"estado": state, "motivo": reason}
        return self._request("POST", f"trabajos/{uuid_text(operation_id)}/finish", body=body)

    def release(self, operation_id: str, token: str, fencing: int, reason: str) -> dict:
        if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 200:
            raise ContractError("Release reason required")
        return self._request("POST", f"trabajos/{uuid_text(operation_id)}/release",
                             body=self._lease(token, fencing) | {"motivo": reason})
