"""Single website-origin WhatsApp intake. No web-form continuation branches."""
import re

from .assistance import valid_cuil
from .receiver import SEGMENTS

VERSION = "website-intake-v1"
SUBFLOW = "website_single_intake"
PROVINCES = {"cordoba": "Cordoba", "catamarca": "Catamarca", "caba": "CABA", "otra": "Otros"}
EMPLOYMENT = {
    "empleado_publico": "Empleado Publico Provincial", "policia_cordoba": "Policia",
    "policia": "Policia", "docente": "Docente", "salud": "Personal de Salud",
    "unc": "Empleado de la UNC", "pfa": "Policía Federal",
}
BANKS = {"bancor": "Banco de la Provincia de Cordoba S.A.",
         "nacion": "Banco de la Nacion Argentina", "otro": "Otros"}


def normalize_answer(data):
    if not isinstance(data, dict):
        raise ValueError("Invalid WhatsApp intake answer.")
    province = data.get("provincia")
    if not isinstance(province, str) or province not in PROVINCES:
        raise ValueError("Invalid intake province.")
    situation = "otra" if province == "otra" else data.get("situacion_" + province)
    if not isinstance(situation, str) or (province != "otra" and situation not in SEGMENTS[province]):
        raise ValueError("Invalid intake situation.")
    cuil = data.get("cuil")
    cuil = re.sub(r"[\s.-]", "", cuil.strip()) if isinstance(cuil, str) and len(cuil) <= 32 else ""
    if not valid_cuil(cuil):
        raise ValueError("A valid CUIL is required.")
    email = data.get("email")
    if email is not None and not isinstance(email, str):
        raise ValueError("Invalid optional email.")
    email = (email or "").strip().lower()
    if email and (len(email) > 254 or re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) is None):
        raise ValueError("Invalid optional email.")
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
    automatic = bool(employment) and (organism == "caja_cordoba" or bank in BANKS)
    return {"version": VERSION, "province": PROVINCES[province], "province_key": province,
            "segment": segment, "organism": organism, "employment_status": employment,
            "bank": bank, "payment_bank": BANKS.get(bank, ""), "continuity": "whatsapp",
            "action": "intake" if automatic else "review", "cuil": cuil, "email": email or None,
            "cuil_status": "valid", "email_status": "valid" if email else "missing"}
