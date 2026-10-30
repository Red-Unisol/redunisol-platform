"""Single website-origin WhatsApp intake. No web-form continuation branches."""
import json
import re

from .assistance import valid_cuil
from .receiver import SEGMENTS as ROUTER_SEGMENTS

VERSION = "website-intake-v1"
SUBFLOW = "website_single_intake"
LEGACY_GROUPED_FLOW_IDS = {"3298964390491520", "995212369590508"}
# The published legacy Router keeps its own options and landing routes. Only
# the single intake gains these employment categories in its next Flow version.
CORDOBA_EXTRA_SITUATIONS = {"daspu", "empleado_publico_municipal", "jubilado_municipal"}
INTAKE_SEGMENTS = {province: situations | (CORDOBA_EXTRA_SITUATIONS if province == "cordoba" else set())
                   for province, situations in ROUTER_SEGMENTS.items()}
# These are transport options, not commercial approval rules. The persisted
# catalog values continue through the same qualification as the website.
INTAKE_SEGMENTS.update({
    "buenos_aires": {"empleado_publico", "policia", "docente", "otra"},
    "santa_fe": {"empleado_publico", "policia", "docente", "salud", "otra"},
    "neuquen": {"empleado_publico", "empleado_publico_municipal", "policia", "docente", "salud", "otra"},
})
INTAKE_SEGMENTS = {province: situations | {"jubilado", "pensionado", "jubilado_pensionado"}
                   for province, situations in INTAKE_SEGMENTS.items()}
PROVINCES = {"cordoba": "Cordoba", "catamarca": "Catamarca", "caba": "CABA", "otra": "Otros",
             "buenos_aires": "Buenos Aires", "santa_fe": "Santa Fe", "neuquen": "Neuquen"}
EMPLOYMENT = {
    "empleado_publico": "Empleado Publico Provincial", "policia_cordoba": "Policia",
    "policia": "Policia", "docente": "Docente", "salud": "Personal de Salud",
    "unc": "Empleado de la UNC", "pfa": "Policía Federal",
    "daspu": "DASPU", "empleado_publico_municipal": "Empleado Publico Municipal",
    "jubilado_municipal": "Jubilado Municipal",
}
BANKS = {"bancor": "Banco de la Provincia de Cordoba S.A.",
         "nacion": "Banco de la Nacion Argentina", "otro": "Otros",
         "provincia_bsas": "Banco de la Provincia de Buenos Aires",
         "santa_fe": "Nuevo Banco de Santa Fe Sociedad Anonima",
         "bpn": "Banco Provincia del Neuquen Sociedad Anonima"}
REJECTION_LABELS = {
    "province_not_eligible": "OTRA PROVINCIA",
    "employment_status_not_eligible": "NO CUMPLE REQUISITOS PARA CONVENIO",
}


def normalize_answer(data, *, retain_invalid_identity=False, flow_id=None):
    if not isinstance(data, dict):
        raise ValueError("Invalid WhatsApp intake answer.")
    province = data.get("provincia")
    if not isinstance(province, str) or province not in PROVINCES:
        raise ValueError("Invalid intake province.")
    # Legacy "otra" answers do not include a situation. V3 can identify ANSES
    # here: province alone must not discard a nationally eligible retirement.
    situation = data.get("situacion_" + province, "otra" if province == "otra" else None)
    situations = INTAKE_SEGMENTS.get(province, {"otra", "jubilado", "pensionado", "jubilado_pensionado"})
    if not isinstance(situation, str) or situation not in situations:
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
    retired = situation in {"jubilado", "pensionado", "jubilado_pensionado"}
    if retired:
        organism = data.get("organismo" if province == "cordoba" else "organismo_" + province)
        organisms = {"anses", "ayuda", "caja_cordoba" if province == "cordoba" else "caja_provincial"}
        if not isinstance(organism, str) or organism not in organisms:
            raise ValueError("Invalid intake organism.")
        # Keep published Cordoba callbacks compatible. New grouped selections
        # cannot identify whether a person is a retiree or a pensioner: retain
        # them for review rather than extend the ANSES rule to pensioners.
        ambiguous_benefit = situation == "jubilado_pensionado" and (
            province != "cordoba" or flow_id is not None and flow_id not in LEGACY_GROUPED_FLOW_IDS)
        if organism != "ayuda" and not ambiguous_benefit:
            employment = "Pensionado" if situation == "pensionado" else (
                "Jubilado Nacional" if organism == "anses" else "Jubilado Provincial")
    # Meta includes hidden values: never use organism or bank from another branch.
    bank = ""
    if organism != "caja_cordoba":
        bank = data.get("banco_jubilado" if province == "cordoba" and retired else "banco_" + province)
        if not isinstance(bank, str) or bank not in {*BANKS, "ayuda"}:
            raise ValueError("Invalid intake bank.")
    segment = "cordoba_jubilado" if province == "cordoba" and situation in {"jubilado", "jubilado_pensionado"} else (
        "otra_provincia" if province == "otra" and not retired else province + "_" + situation)
    automatic = bool(cuil) and not email_invalid and bool(employment) and (organism == "caja_cordoba" or bank in BANKS)
    # Unresolved benefit/organism is manual even in another province; it may be
    # ANSES. Only an identified non-ANSES case keeps the provincial rejection.
    rejection = "province_not_eligible" if province == "otra" and (not retired or employment not in {"", "Jubilado Nacional"}) else (
        "employment_status_not_eligible" if situation == "otra" else "")
    return {"version": VERSION, "province": PROVINCES[province], "province_key": province,
            "segment": segment, "organism": organism, "employment_status": employment,
            "bank": bank, "payment_bank": BANKS.get(bank, ""), "continuity": "whatsapp",
            "action": "rejected" if rejection else "intake" if automatic else "review",
            "rejection_reason": rejection, "cuil": cuil, "email": email,
            "cuil_status": cuil_status, "email_status": email_status,
            "reported_cuil": _reported_value(reported_cuil) if cuil_status != "valid" else "",
            "reported_email": _reported_value(reported_email) if email_invalid else ""}


def _reported_value(value):
    return (value if isinstance(value, str) else json.dumps(value, ensure_ascii=False) if value is not None else "")[:255]
