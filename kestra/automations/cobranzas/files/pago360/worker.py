"""One executor for webhooks, manual calls and recovery.

The portal owns the durable lease, intent and result. Never retry a Vimarx
write: any error after persisted intent is uncertain, including HTTP errors.
"""
from decimal import Decimal, InvalidOperation
from typing import Protocol


class Reconcile(Exception):
    pass


def cents(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0 or amount * 100 != (amount * 100).to_integral_value():
            raise ValueError()
        return int(amount * 100)
    except (InvalidOperation, ValueError):
        raise Reconcile("invalid_amount") from None


class Portal(Protocol):
    def call(self, action, operation_id=None, token=None, quota_id=None, data=None): ...


class Gateway(Protocol):
    enabled: bool
    def inspect(self, item): ...
    def write(self, intent): ...
    def verify(self, intent, response): ...


class UnverifiedVimarx:
    """Hard gate: no flag can enable an unverified financial contract.

    Replace in a subsequent reviewed change after endpoint, collector, account,
    date and operation-to-charge evidence are verified. No live POST exists here.
    """
    enabled = False

    def inspect(self, item):
        raise Reconcile("vimarx_contract_unverified")

    write = verify = inspect


class Executor:
    def __init__(self, portal: Portal, gateway: Gateway):
        self.portal, self.gateway = portal, gateway

    def process(self, operation_id):
        if not self.gateway.enabled:
            return "writes_disabled"
        job = self.portal.call("tomar", operation_id)
        if job.get("resultado") != "ok":
            return job["resultado"]
        token = job["token"]

        def call(action, item=None, data=None):
            return self.portal.call(action, operation_id, token, item["cuota_id"] if item else None, data)

        items = job["cuotas"]
        if not items or sum(cents(i["saldo"]) for i in items) != cents(job["total"]):
            call("conciliar", data={"motivo": "invalid_selection"})
            return "conciliacion"
        for item in items:
            if item["estado"] == "confirmado":
                continue
            if item["estado"] == "respondido":
                intent, response = item["intencion"], item["respuesta"]
            elif item["estado"] == "pendiente":
                try:
                    snapshot = self.gateway.inspect(item)
                    if (str(snapshot["prestamoId"]) != item["prestamo_id"] or
                        str(snapshot["nroCuota"]) != item["nro_cuota"] or
                        not str(snapshot["idCuota"]).isdigit() or int(snapshot["idCuota"]) <= 0 or
                        snapshot["vencida"] is not True or snapshot["pagada"] is not False or
                        cents(snapshot["saldo"]) != cents(item["saldo"]) or cents(item["saldo"]) <= 0):
                        raise Reconcile("debt_changed_or_paid_elsewhere")
                except Reconcile as exc:
                    call("conciliar", item, {"motivo": str(exc)})
                    return "conciliacion"
                except Exception:
                    call("liberar")  # No write intent exists; a read can be retried.
                    raise
                intent = {"operacionId": operation_id, "proveedorRef": job["proveedorRef"],
                          "recibidoAt": job.get("recibidoAt"),
                          "idCuota": str(snapshot["idCuota"]), "prestamoId": item["prestamo_id"],
                          "nroCuota": item["nro_cuota"], "importe": item["saldo"]}
                # Commit intent before even attempting the external write. If this
                # response is lost, stop; the lease recovery will reconcile it.
                call("iniciar", item, intent)
                try:
                    response = self.gateway.write(intent)
                    if (not str(response["cobroId"]).isdigit() or int(response["cobroId"]) <= 0 or
                        cents(response["importe"]) != cents(intent["importe"])):
                        raise Reconcile("invalid_charge_response")
                except Exception:
                    call("conciliar", item, {"motivo": "write_uncertain"})
                    return "conciliacion"
                # Failure here leaves the durable intent uncertain. Never write
                # again, even when we saw a successful response in this process.
                call("respuesta", item, response)
            else:
                call("conciliar", item, {"motivo": "write_uncertain"})
                return "conciliacion"
            try:
                evidence = self.gateway.verify(intent, response)
                if (evidence.get("vinculoVerificado") is not True or
                    evidence.get("operacionId") != operation_id or
                    str(evidence.get("idCuota")) != intent["idCuota"] or
                    str(evidence.get("cobroId")) != str(response["cobroId"]) or
                    cents(evidence.get("importe")) != cents(intent["importe"]) or
                    cents(evidence.get("saldo")) != 0):
                    raise Reconcile("charge_link_not_proven")
            except Reconcile as exc:
                call("conciliar", item, {"motivo": str(exc)})
                return "conciliacion"
            except Exception:
                call("liberar")  # Response is durable: next run only re-reads it.
                raise
            call("confirmar", item, evidence)
        call("finalizar")
        return "aplicado"
