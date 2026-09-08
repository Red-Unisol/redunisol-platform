from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Sequence

from reporte_evaluacion_report.core import EvaluateApiClient, MonthlyReport, month_start_end

RULE_VERSION = "comisiones-2026-09-08-legajos"
MANUAL_RULES = {"sample_size": 30, "high_min": 28, "medium_min": 26, "high_rate": "0.005", "medium_rate": "0.003", "low_rate": "0.001", "require_complete_review": True}
EXCLUDED_SELLERS = (
    "Alvaro Pajon", "Gabriela Acosta", "Jorgelina Marin", "Karina Altamirano", "Martin Rodriguez",
)
LOAN_TYPE = "F.Module.Cuentas.Prestamos.Prestamo"
LOAN_FIELDS = (
    "ID;NroCuenta;FechaEmision;Solicitud.Oid;Solicitud.Estado.Descripcion;"
    "Vendedor.Nombre;MontoADesembolsar;Capital;LineaPrestamo.Descripcion"
)
METRICS = (
    ("first_response", "mediana_minutos", "Mediana de primera respuesta", Decimal("0.20")),
    ("first_response", "promedio_minutos", "Promedio de primera respuesta", Decimal("0.20")),
    ("transfer", "mediana_minutos", "Mediana de transferencia", Decimal("0.15")),
    ("transfer", "promedio_minutos", "Promedio de transferencia", Decimal("0.15")),
)
MANUAL_WEIGHT = Decimal("0.30")
CENT = Decimal("0.01")


def previous_months(month: str) -> list[str]:
    current, _ = month_start_end(month)
    result = []
    for _ in range(3):
        current = date(current.year - (current.month == 1), (current.month - 2) % 12 + 1, 1)
        result.insert(0, current.strftime("%Y-%m"))
    return result


def decimal_value(value: Any) -> Decimal:
    result = Decimal(str(value))
    if not result.is_finite() or result < 0:
        raise ValueError("Importe o metrica negativa/no finita en el Core.")
    return result


def reference_average(history: Sequence[Any]) -> Decimal | None:
    if len(history) != 3 or any(value is None for value in history):
        return None
    return sum(map(decimal_value, history)) / 3


def commission_rate(result: Decimal, reference: Decimal) -> Decimal | None:
    if not result.is_finite() or not reference.is_finite() or result < 0 or reference < 0:
        raise ValueError("Metricas invalidas para calcular comisiones.")
    if reference == 0:
        return None  # No inventar un porcentaje de cumplimiento sin referencia positiva.
    if result <= reference:
        return Decimal("0.005")
    if result <= reference * Decimal("1.10"):
        return Decimal("0.003")
    return Decimal("0.001")


def loan_filter(month: str) -> str:
    start, end = month_start_end(month)
    sellers = ",".join("'" + seller.replace("'", "''") + "'" for seller in EXCLUDED_SELLERS)
    return (
        f"[FechaEmision] >= #{start}# AND [FechaEmision] < #{end}# "
        f"AND Not ([Vendedor.Nombre] In ({sellers})) "
        "AND [Solicitud.Estado.Descripcion] = 'Pagada'"
    )


class CommissionApiClient(EvaluateApiClient):
    def evaluate_list(self, cmd: str, tipo: str, campos: str, max_rows: int = 20000) -> list[list]:
        rows = super().evaluate_list(cmd, tipo, campos, max_rows)
        if len(rows) >= max_rows:
            raise ValueError("Consulta Core alcanzo el limite de filas; no se publicara un reporte incompleto.")
        return rows


@dataclass(frozen=True)
class Loan:
    loan_id: int
    account: int
    issued_on: str
    application_id: int
    state: str
    seller: str
    amount: Decimal
    capital: Decimal
    line: str


def fetch_loans(client: EvaluateApiClient, month: str, max_rows: int = 20000) -> list[Loan]:
    criteria = loan_filter(month)
    # Un control independiente detecta limites/truncamiento silencioso del servidor.
    count_expression = f"[<{LOAN_TYPE}>][{criteria}].Count()"
    expected = client.evaluate(count_expression)
    if isinstance(expected, bool) or not isinstance(expected, int) or expected < 0:
        raise ValueError("El Core no devolvio una cantidad valida de prestamos.")
    if expected >= max_rows:
        raise ValueError("La colocacion supera el limite de consulta; ampliar limite antes de publicar.")
    rows = client.evaluate_list(criteria, LOAN_TYPE, LOAN_FIELDS, max_rows)
    if len(rows) != expected:
        raise ValueError("La cantidad de prestamos no coincide con el control del Core; reintentar la extraccion.")
    result = []
    seen = set()
    start, end = month_start_end(month)
    for row in rows:
        if not isinstance(row, list) or len(row) != 9:
            raise ValueError("Esquema inesperado de prestamos.")
        loan = Loan(
            int(row[0]), int(row[1]), str(row[2]), int(row[3]), str(row[4]), str(row[5]),
            decimal_value(row[6]), decimal_value(row[7]), str(row[8] or ""),
        )
        if (
            loan.loan_id in seen or loan.state != "Pagada" or row[5] is None
            or loan.seller in EXCLUDED_SELLERS or not start <= date.fromisoformat(loan.issued_on[:10]) < end
        ):
            raise ValueError("Prestamo duplicado o fuera de los filtros de colocacion.")
        seen.add(loan.loan_id)
        result.append(loan)
    if client.evaluate(count_expression) != expected:
        raise ValueError("La colocacion cambio durante la extraccion; reintentar.")
    return sorted(result, key=lambda loan: loan.loan_id)


def evaluate_commissions(
    reports: Sequence[MonthlyReport], loans: dict[str, list[Loan]], months: Sequence[str],
) -> list[dict[str, Any]]:
    by_month = {report.month_value: report for report in reports}
    result = []
    for month in months:
        report = by_month[month]
        baseline = previous_months(month)
        total = sum((loan.amount for loan in loans[month]), Decimal(0)).quantize(CENT)
        for group, statistic, label, weight in METRICS:
            value = report.summary[group][statistic]
            history = [by_month[m].summary[group][statistic] if m in by_month else None for m in baseline]
            reference = reference_average(history)
            metric = None if value is None else decimal_value(value)
            rate = None if metric is None or reference is None else commission_rate(metric, reference)
            amount = None if rate is None else (total * rate * weight).quantize(CENT, rounding=ROUND_HALF_UP)
            result.append({
                "month": month, "metric": label, "group": group, "statistic": statistic,
                "history": history, "reference_months": baseline, "reference": reference,
                "result": metric, "weight": weight, "rate": rate, "placement": total, "amount": amount,
                "status": "Calculado" if rate is not None else "Sin datos suficientes",
            })
    return result


def loan_snapshot(loans: dict[str, list[Loan]]) -> dict[str, list[dict[str, Any]]]:
    return {month: [asdict(loan) for loan in rows] for month, rows in loans.items()}
