"""Single website-origin WhatsApp intake. No web-form continuation branches."""
import json
import re

from .assistance import valid_cuil
from .receiver import SEGMENTS as ROUTER_SEGMENTS

VERSION = "website-intake-v1"
SUBFLOW = "website_single_intake"
# The published legacy Router keeps its own options and landing routes. Only
# the single intake gains these employment categories in its next Flow version.
CORDOBA_EXTRA_SITUATIONS = {"daspu", "empleado_publico_municipal", "jubilado_municipal"}
INTAKE_SEGMENTS = {province: situations | (CORDOBA_EXTRA_SITUATIONS if province == "cordoba" else set())
                   for province, situations in ROUTER_SEGMENTS.items()}
PROVINCES = {"cordoba": "Cordoba", "catamarca": "Catamarca", "caba": "CABA", "otra": "Otros"}
EMPLOYMENT = {
    "empleado_publico": "Empleado Publico Provincial", "policia_cordoba": "Policia",
    "policia": "Policia", "docente": "Docente", "salud": "Personal de Salud",
    "unc": "Empleado de la UNC", "pfa": "Policía Federal",
    "daspu": "DASPU", "empleado_publico_municipal": "Empleado Publico Municipal",
    "jubilado_municipal": "Jubilado Municipal",
}
BANKS = {"bancor": "Banco de la Provincia de Cordoba S.A.",
         "nacion": "Banco de la Nacion Argentina", "otro": "Otros"}


def normalize_answer(data, *, retain_invalid_identity=False):
    if not isinstance(data, dict):
        raise ValueError("Invalid WhatsApp intake answer.")
    province = data.get("provincia")
    if not isinstance(province, str) or province not in PROVINCES:
        raise ValueError("Invalid intake province.")
    situation = "otra" if province == "otra" else data.get("situacion_" + province)
    if not isinstance(situation, str) or (province != "otra" and situation not in INTAKE_SEGMENTS[province]):
        raise ValueError("Invalid intake situation.")
    reported_cuil = data.get("cuil")
    cuil = re.sub(r"[\s.-]", "", reported_cuil.strip()) if isinstance(reported_cuil, str) and len(reported_cuil) <= 32 else ""
    cuil_status = "valid" if valid_cuil(cuil) else "missing" if reported_cuil in (None, "") else "invalid"
    if cuil_status != "valid" and not retain_invalid_identity:
        raise ValueError("A valid CUIL is required.")
    cuil = cuil if cuil_status == "valid" else None
    email = data.get("email")
    reported_email = email
    email = email.strip().lower() if isinstance(email, str) else ""
    email_invalid = reported_email is not None and not isinstance(reported_email, str)
    email_invalid = email_invalid or bool(email and (len(email) > 254 or re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) is None))
    if email_invalid and not retain_invalid_identity:
        raise ValueError("Invalid optional email.")
    email_status = "invalid" if email_invalid else "valid" if email else "missing"
    email = None if email_invalid else email or None
    organism = ""
    employment = EMPLOYMENT.get(situation, "")
    if province == "cordoba" and situation == "jubilado_pensionado":
        organism = data.get("organismo")
        if not isinstance(organism, str) or organism not in {"caja_cordoba", "anses", "ayuda"}:
            raise ValueError("Invalid intake organism.")
        employment = {"caja_cordoba": "Jubilado Provincial", "anses": "Jubilado Nacional"}.get(organism, "")
    # Meta includes hidden values: never use organism or bank from another branch.
    bank = ""
    if organism != "caja_cordoba":
        bank = data.get("banco_jubilado" if organism else "banco_" + province)
        if not isinstance(bank, str) or bank not in {*BANKS, "ayuda"}:
            raise ValueError("Invalid intake bank.")
    segment = "cordoba_jubilado" if situation == "jubilado_pensionado" else (
        "otra_provincia" if province == "otra" else province + "_" + situation)
    automatic = bool(cuil) and not email_invalid and bool(employment) and (organism == "caja_cordoba" or bank in BANKS)
    return {"version": VERSION, "province": PROVINCES[province], "province_key": province,
            "segment": segment, "organism": organism, "employment_status": employment,
            "bank": bank, "payment_bank": BANKS.get(bank, ""), "continuity": "whatsapp",
            "action": "intake" if automatic else "review", "cuil": cuil, "email": email,
            "cuil_status": cuil_status, "email_status": email_status,
            "reported_cuil": _reported_value(reported_cuil) if cuil_status != "valid" else "",
            "reported_email": _reported_value(reported_email) if email_invalid else ""}


def _reported_value(value):
    return (value if isinstance(value, str) else json.dumps(value, ensure_ascii=False) if value is not None else "")[:255]
