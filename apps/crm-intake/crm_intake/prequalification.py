"""Pure observation of commercial prequalification from normalized facts."""

from dataclasses import dataclass
from datetime import datetime

from .contract import NORMALIZER_VERSION
from .kestra_policy import POLICY_SHA256, commercial, input_parser, rules

ADAPTER_VERSION = "prequalification-2"
SUPPORTED_NORMALIZERS = {"intake-2", NORMALIZER_VERSION}
BANKS = {
    "bancor": "Banco de la Provincia de Cordoba S.A.",
    "nacion": "Banco de la Nacion Argentina",
    "provincia_bsas": "Banco de la Provincia de Buenos Aires",
    "santa_fe": "Nuevo Banco de Santa Fe Sociedad Anonima",
    "bpn": "Banco Provincia del Neuquen Sociedad Anonima",
    "other": "Otros",
}
EMPLOYMENT = {
    "public_employee_provincial": "empleado_publico_provincial",
    "public_employee_municipal": "empleado_publico_municipal",
    "police": "policia",
    "federal_police": "policia_federal",
    "teacher": "docente",
    "health_worker": "personal_de_salud",
    "unc": "empleado_de_la_unc",
    "daspu": "daspu",
    "public_employee_national": "empleado_publico_nacional",
    "private_employee": "empleado_privado",
    "self_employed": "autonomo_independiente",
    "monotax": "monotributista",
    "social_plan_beneficiary": "beneficiario_de_plan_social",
}


@dataclass(frozen=True)
class CuadEvidence:
    status: str
    reference: str | None = None


@dataclass(frozen=True)
class Decision:
    profile_ref: str
    normalizer_version: str
    policy_version: str
    policy_sha256: str
    adapter_version: str
    evaluated_at: str
    scope: str
    cuad_reference: str | None
    cuad_status: str | None
    outcome: str
    reason: str
    commercially_qualified: bool | None = None
    measurement_qualified: bool | None = None
    permits_whatsapp: bool | None = None
    rejection_label: str | None = None
    missing_facts: tuple[str, ...] = ()
    applied_rule: str | None = None


def fact_value(fields, name):
    item = fields.get(name, {})
    value = item.get("value")
    return value if item.get("status") in {"declared", "inferred"} and isinstance(value, str) else None


def is_cordoba_fund_benefit(fields):
    if (fact_value(fields, "province") != "cordoba"
            or fact_value(fields, "paying_organization") != "provincial_fund"
            or fields.get("employment_kind", {}).get("status") != "not_applicable"
            or fact_value(fields, "benefit_regime") == "municipal"):
        return False
    if fact_value(fields, "benefit_kind") in {"retirement", "pension"}:
        return True
    # The older grouped question proves membership in the eligible pair
    # without identifying which of the two benefits the person receives.
    benefit = fields.get("benefit_kind", {})
    return (benefit.get("status") == "ambiguous"
            and set(benefit.get("alternatives", ())) == {"retirement", "pension"})


def employment_key(fields):
    occupation = fact_value(fields, "employment_kind")
    benefit = fact_value(fields, "benefit_kind")
    if occupation and benefit:
        return None
    if benefit == "pension":
        return "pensionado"
    if benefit == "retirement":
        if fact_value(fields, "benefit_regime") == "municipal":
            return "jubilado_municipal" if not fact_value(fields, "paying_organization") else None
        return {"anses": "jubilado_nacional", "provincial_fund": "jubilado_provincial"}.get(
            fact_value(fields, "paying_organization")
        )
    return EMPLOYMENT.get(occupation)


def evaluate(
    profile: dict, *, profile_ref: str, evaluated_at: datetime, scope: str,
    cuad: CuadEvidence | None = None,
) -> Decision:
    """Return a decision with versioned provenance. No IO or business actions."""
    if evaluated_at.utcoffset() is None or not profile_ref:
        raise ValueError("An aware evaluation time and stable normalized profile reference are required")
    if scope not in {"public_web", "crm_lead"} or (scope == "public_web" and cuad is not None):
        raise ValueError("CUAD evidence is only applicable to CRM lead evaluation")
    normalizer_version = profile.get("version")
    if not isinstance(normalizer_version, str):
        raise ValueError("An exact normalizer version is required")
    context = dict(
        profile_ref=profile_ref, normalizer_version=normalizer_version,
        policy_version=commercial.RULE_VERSION, policy_sha256=POLICY_SHA256,
        adapter_version=ADAPTER_VERSION, scope=scope,
        evaluated_at=evaluated_at.astimezone(rules.BUENOS_AIRES_TIMEZONE).isoformat(),
        cuad_reference=cuad.reference if cuad else None, cuad_status=cuad.status if cuad else None,
    )

    def completed(result):
        return Decision(
            **context, outcome=result.outcome, reason=result.reason,
            commercially_qualified=result.qualified,
            measurement_qualified=result.is_measurement_qualified,
            permits_whatsapp=result.should_route_to_whatsapp,
            rejection_label=result.rejection_label,
        )

    if normalizer_version not in SUPPORTED_NORMALIZERS or profile.get("status") != "interpreted":
        return Decision(**context, outcome="pending", reason="unsupported_normalized_profile")
    if scope == "crm_lead":
        if cuad is None or not cuad.reference or cuad.status not in {"matched", "not_found", "incomplete_identity"}:
            return Decision(**context, outcome="pending", reason="cuad_evidence_required")
        if cuad.status == "matched":
            return completed(rules.haberes_cuad_referral_result())

    fields = profile["fields"]
    if is_cordoba_fund_benefit(fields):
        return Decision(
            **context, applied_rule="cordoba_caja_benefit_any_bank",
            outcome="qualified", reason="qualified", commercially_qualified=True,
            measurement_qualified=True, permits_whatsapp=True,
        )
    employment = employment_key(fields)
    if employment is None:
        return Decision(
            **context, outcome="pending", reason="missing_policy_input", missing_facts=("employment_status",),
        )

    province = fact_value(fields, "province")
    bank_code = fact_value(fields, "payment_bank")
    bank = BANKS.get(bank_code, bank_code)
    if province == "no_contesta":
        province = None
    try:
        normalized = input_parser.normalize_prequalification_input({
            "province": "otros" if province == "other" else province,
            "employment_status": employment,
            "payment_bank": bank,
        })
    except ValueError:
        missing_facts = tuple(
            name for name, value in (("province", province), ("payment_bank", bank)) if value is None
        )
        return Decision(
            **context, outcome="pending", reason="missing_policy_input" if missing_facts else "invalid_policy_input",
            missing_facts=missing_facts,
        )
    return completed(rules.evaluate_prequalification(normalized, evaluated_at=evaluated_at))
