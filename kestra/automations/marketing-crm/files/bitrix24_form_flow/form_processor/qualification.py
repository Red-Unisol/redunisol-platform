from __future__ import annotations

from dataclasses import dataclass

from .input_parser import NormalizedInput


@dataclass(frozen=True)
class QualificationResult:
    qualified: bool
    reason: str
    message: str
    rejection_label: str | None = None


EXTERNAL_REFERRAL_PROVINCES = {
    "neuquen",
    "rio_negro",
    "santa_fe",
}


QUALIFICATION_RULES = {
    "cordoba": {
        "allowed_employment_statuses": {
            "empleado_publico_provincial",
            "empleado_publico_municipal",
            "policia",
            "docente",
            "jubilado_provincial",
            "jubilado_nacional",
            "pensionado",
        },
        "bank_optional_for": {"jubilado_provincial"},
        "allowed_banks_by_status": {
            "empleado_publico_provincial": {"banco_de_la_provincia_de_cordoba_s_a"},
            "empleado_publico_municipal": {"banco_de_la_provincia_de_cordoba_s_a"},
            "policia": {"banco_de_la_provincia_de_cordoba_s_a"},
            "docente": {"banco_de_la_provincia_de_cordoba_s_a"},
            "jubilado_nacional": {"banco_de_la_provincia_de_cordoba_s_a"},
            "pensionado": {"banco_de_la_provincia_de_cordoba_s_a"},
        },
    },
    "catamarca": {
        "allowed_employment_statuses": {
            "empleado_publico_provincial",
            "policia",
            "docente",
        }
    },
    "la_rioja": {
        "allowed_employment_statuses": {
            "empleado_publico_provincial",
            "empleado_publico_municipal",
            "policia",
            "docente",
        },
    },
}


def evaluate_qualification(submission: NormalizedInput) -> QualificationResult:
    if submission.province.key in EXTERNAL_REFERRAL_PROVINCES:
        return QualificationResult(
            qualified=False,
            reason="external_referral",
            message=(
                f'La provincia "{submission.province.label}" se deriva a vendedor externo y no se procesa automaticamente.'
            ),
            rejection_label="OTRA PROVINCIA",
        )

    rule = QUALIFICATION_RULES.get(submission.province.key)
    if not rule:
        return QualificationResult(
            qualified=False,
            reason="province_not_eligible",
            message=f'La provincia "{submission.province.label}" no califica.',
            rejection_label="OTRA PROVINCIA",
        )

    if submission.employment_status.key not in rule["allowed_employment_statuses"]:
        rejection_label = _employment_status_rejection_label(submission.employment_status.key)
        return QualificationResult(
            qualified=False,
            reason="employment_status_not_eligible",
            message=(
                f'La situacion laboral "{submission.employment_status.label}" '
                f"no califica para {submission.province.label}."
            ),
            rejection_label=rejection_label,
        )

    bank_optional_for = rule.get("bank_optional_for", set())
    if submission.employment_status.key in bank_optional_for:
        return QualificationResult(
            qualified=True,
            reason="qualified",
            message=f"La persona califica para {submission.province.label}.",
        )

    allowed_banks_by_status = rule.get("allowed_banks_by_status", {})
    allowed_banks = allowed_banks_by_status.get(submission.employment_status.key)
    if allowed_banks and submission.payment_bank.key not in allowed_banks:
        return QualificationResult(
            qualified=False,
            reason="payment_bank_not_eligible",
            message=f'El banco "{submission.payment_bank.label}" no califica para {submission.province.label}.',
            rejection_label="OTRO BANCO",
        )

    return QualificationResult(
        qualified=True,
        reason="qualified",
        message=f"La persona califica para {submission.province.label}.",
    )


def _employment_status_rejection_label(employment_status_key: str) -> str:
    mapping = {
        "autonomo_independiente": "AUTONOMO",
        "beneficiario_de_plan_social": "AUH (asignaciones)",
        "empleado_privado": "PRIVADOS",
        "empleado_publico_municipal": "MUNICIPAL",
        "empleado_publico_nacional": "PUBLICO NACIONAL",
        "jubilado_nacional": "JUBILADO NACIONAL",
        "jubilado_provincial": "JUBILADO PROVINCIAL",
        "pensionado": "PENSIONADO",
    }
    return mapping.get(employment_status_key, "NO CUMPLE REQUISITOS PARA CONVENIO")
