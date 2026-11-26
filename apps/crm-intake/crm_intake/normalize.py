"""Interpret declared intake fields without selecting a product or seller."""

import re
import unicodedata

from .capture import decode_json
from .contract import NORMALIZER_VERSION as VERSION
from .kestra_policy import catalogs

SUPPORTED = {("web", "web-loan-v1"), ("whatsapp", "whatsapp-intake-v3"), ("whatsapp", "whatsapp-intake-v3.1"),
             ("whatsapp", "whatsapp-grouped-v1")}

PROVINCES = {
    "cordoba": "cordoba", "catamarca": "catamarca", "buenos aires": "buenos_aires",
    "santa fe": "santa_fe", "neuquen": "neuquen", "caba": "caba",
    "otros": "other", "otra": "other",
}
BANKS = {
    "banco de la provincia de cordoba s.a.": "bancor", "bancor": "bancor",
    "banco de la nacion argentina": "nacion", "banco nacion": "nacion", "nacion": "nacion",
    "banco de la provincia de buenos aires": "provincia_bsas", "provincia bsas": "provincia_bsas",
    "nuevo banco de santa fe sociedad anonima": "santa_fe", "santa fe": "santa_fe",
    "banco provincia del neuquen sociedad anonima": "bpn", "bpn": "bpn",
    "otros": "other", "otro": "other",
}
EMPLOYMENT = {
    "empleado publico provincial": "public_employee_provincial", "empleado publico": "public_employee_provincial",
    "empleado publico municipal": "public_employee_municipal", "policia": "police", "policia cordoba": "police",
    "policia federal": "federal_police", "pfa": "federal_police", "docente": "teacher",
    "personal de salud": "health_worker", "salud": "health_worker", "empleado de la unc": "unc", "unc": "unc",
    "daspu": "daspu", "otra": "other",
}


def token(value):
    if not isinstance(value, str):
        return ""
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_value.casefold().replace("_", " ").split())


def fact(status, *fields, value=None, alternatives=None):
    result = {"status": status, "source_fields": list(fields)}
    if value is not None:
        result["value"] = value
    if alternatives is not None:
        result["alternatives"] = alternatives
    return result


def choice(payload, field, options):
    raw = payload.get(field)
    if raw is None or raw == "":
        return fact("missing", field)
    value = options.get(token(raw))
    return fact("declared", field, value=value) if value is not None else fact("unmapped", field)


def catalog_choice(payload, field, aliases, catalog, *, key_aliases=None):
    """Interpret known aliases and exact catalog options without guessing."""
    result = choice(payload, field, aliases)
    if result["status"] != "unmapped":
        return result
    raw = payload[field]
    if not isinstance(raw, str):
        return result
    try:
        key = catalog.resolve(raw, field).key
    except ValueError:
        return result
    return fact("declared", field, value=(key_aliases or {}).get(key, key))


def bank_choice(raw, field):
    return catalog_choice(
        {field: raw}, field, BANKS, catalogs.BANCOS,
        key_aliases={
            "banco_de_la_provincia_de_cordoba_s_a": "bancor", "banco_de_la_nacion_argentina": "nacion",
            "banco_de_la_provincia_de_buenos_aires": "provincia_bsas",
            "nuevo_banco_de_santa_fe_sociedad_anonima": "santa_fe",
            "banco_provincia_del_neuquen_sociedad_anonima": "bpn", "otros": "other",
        },
    )


def bank(payload, field):
    # CRM catalog fields sometimes serialize a single chosen bank as a list.
    raw = payload.get(field)
    if not isinstance(raw, list):
        return bank_choice(raw, field)
    if not raw:
        return fact("missing", field)
    mapped = {bank_choice(item, field).get("value") for item in raw}
    if None in mapped:
        return fact("unmapped", field)
    if len(mapped) == 1:
        return fact("inferred", field, value=next(iter(mapped)))
    return fact("ambiguous", field, alternatives=sorted(mapped))


def identity(payload, phone_field):
    result = {}
    cuil = payload.get("cuil")
    cleaned = re.sub(r"[\s.-]", "", cuil) if isinstance(cuil, str) else ""
    if len(cleaned) == 11 and cleaned.isascii() and cleaned.isdigit() and len(set(cleaned)) > 1:
        total = sum(int(digit) * weight for digit, weight in zip(cleaned[:10], (5, 4, 3, 2, 7, 6, 5, 4, 3, 2)))
        valid = (11 - total % 11) % 11 == int(cleaned[-1])
    else:
        valid = False
    result["cuil"] = (
        fact("declared", "cuil", value=cleaned) if valid else
        fact("missing" if cuil is None or cuil == "" else "invalid", "cuil")
    )
    email = payload.get("email")
    if email is None or email == "":
        result["email"] = fact("missing", "email")
    elif isinstance(email, str) and len(email.strip()) <= 254 and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email.strip()):
        result["email"] = fact("declared", "email", value=email.strip().lower())
    else:
        result["email"] = fact("invalid", "email")
    if phone_field is None:
        result["phone"] = fact("not_in_form")
    else:
        value = payload.get(phone_field)
        if value is None or value == "":
            result["phone"] = fact("missing", phone_field)
        elif isinstance(value, str) and value.strip():
            result["phone"] = fact("declared", phone_field, value=value.strip())
        else:
            result["phone"] = fact("invalid", phone_field)
    return result


def municipal_benefit(field):
    return {
        "employment_kind": fact("not_applicable", field),
        "benefit_kind": fact("inferred", field, value="retirement"),
        "benefit_regime": fact("inferred", field, value="municipal"),
        "paying_organization": fact("missing", field),
    }


def web_fields(payload):
    situation = "employment_status"
    kind = token(payload.get(situation))
    if kind:
        try:
            kind = catalogs.SITUACIONES_LABORALES.resolve(payload[situation], situation).key.replace("_", " ")
        except ValueError:
            pass
    fields = {
        "province": catalog_choice(
            payload, "province", PROVINCES, catalogs.PROVINCIAS,
            key_aliases={"ciudad_autonoma_de_buenos_aires": "caba", "otros": "other"},
        ),
        "payment_bank": bank(payload, "payment_bank"),
        "employment_kind": fact("not_applicable", situation),
        "benefit_kind": fact("not_applicable", situation),
        "paying_organization": fact("not_applicable", situation),
    }
    if kind == "jubilado municipal":
        fields.update(municipal_benefit(situation))
    elif kind in {"jubilado nacional", "jubilado provincial", "pensionado", "jubilado o pensionado"}:
        if kind == "jubilado o pensionado":
            fields["benefit_kind"] = fact("ambiguous", situation, alternatives=["retirement", "pension"])
        else:
            fields["benefit_kind"] = fact(
                "declared" if kind == "pensionado" else "inferred",
                situation, value="pension" if kind == "pensionado" else "retirement",
            )
        organization = {"jubilado nacional": "anses", "jubilado provincial": "provincial_fund"}.get(kind)
        fields["paying_organization"] = (
            fact("inferred", situation, value=organization) if organization else fact("missing", situation)
        )
        if kind == "pensionado" and payload.get("organismo"):
            provincial = "caja cordoba" if fields["province"].get("value") == "cordoba" else "caja provincial"
            fields["paying_organization"] = choice(payload, "organismo", {"anses": "anses", provincial: "provincial_fund"})
    else:
        employment = catalog_choice(
            payload, situation, EMPLOYMENT, catalogs.SITUACIONES_LABORALES,
            key_aliases={
                "empleado_publico_provincial": "public_employee_provincial",
                "empleado_publico_municipal": "public_employee_municipal",
                "empleado_publico_nacional": "public_employee_national",
                "empleado_privado": "private_employee",
                "autonomo_independiente": "self_employed",
                "monotributista": "monotax",
                "beneficiario_de_plan_social": "social_plan_beneficiary",
                "policia": "police",
                "policia_federal": "federal_police",
                "docente": "teacher",
                "personal_de_salud": "health_worker",
                "empleado_de_la_unc": "unc",
            },
        )
        fields["employment_kind"] = employment
        if employment["status"] in {"missing", "unmapped"}:
            fields["benefit_kind"] = fact("undetermined", situation)
            fields["paying_organization"] = fact("undetermined", situation)
    return fields | identity(payload, "whatsapp")


def whatsapp_fields(payload, *, form_version):
    legacy_grouped = form_version == "whatsapp-grouped-v1"
    province = choice(payload, "provincia", PROVINCES)
    fields = {"province": province}
    province_code = province.get("value")
    if province_code is None:
        fields.update({key: fact("undetermined", "provincia") for key in (
            "employment_kind", "benefit_kind", "paying_organization", "payment_bank",
        )})
        return fields | identity(payload, None)
    branch = "otra" if province_code == "other" else province_code
    situation = f"situacion_{branch}"
    kind = token(payload.get(situation))
    if branch == "cordoba" and kind == "jubilado municipal":
        fields.update(municipal_benefit(situation))
        fields["payment_bank"] = bank(payload, "banco_cordoba")
    elif kind in {"jubilado", "pensionado"} or (legacy_grouped and kind == "jubilado pensionado"):
        fields["employment_kind"] = fact("not_applicable", situation)
        if kind == "jubilado pensionado":
            fields["benefit_kind"] = fact("ambiguous", situation, alternatives=["retirement", "pension"])
        else:
            fields["benefit_kind"] = fact("declared", situation, value="retirement" if kind == "jubilado" else "pension")
        org_field = "organismo" if branch == "cordoba" else f"organismo_{branch}"
        org_option = "caja cordoba" if branch == "cordoba" else "caja provincial"
        org = choice(payload, org_field, {"anses": "anses", org_option: "provincial_fund"})
        fields["paying_organization"] = org
        bank_field = "banco_jubilado" if branch == "cordoba" else f"banco_{branch}"
        if org.get("value") is None:
            fields["payment_bank"] = fact("undetermined", situation, org_field)
        elif branch == "cordoba" and org.get("value") == "provincial_fund" and (
            kind == "jubilado" or (kind == "pensionado" and form_version == "whatsapp-intake-v3.1")
        ):
            fields["payment_bank"] = fact("not_applicable", situation, org_field)
        elif branch == "cordoba" and kind == "jubilado pensionado" and org.get("value") == "provincial_fund":
            fields["payment_bank"] = fact("undetermined", situation, org_field)
        else:
            fields["payment_bank"] = bank(payload, bank_field)
    else:
        employment = choice(payload, situation, EMPLOYMENT)
        fields["employment_kind"] = employment
        status = "not_applicable" if employment["status"] == "declared" else "undetermined"
        fields["benefit_kind"] = fact(status, situation)
        fields["paying_organization"] = fact(status, situation)
        fields["payment_bank"] = (
            bank(payload, f"banco_{branch}") if employment["status"] == "declared" else fact("undetermined", situation)
        )
    return fields | identity(payload, None)


def response_at(payload, path):
    value = payload
    try:
        for key in path:
            if ((isinstance(value, dict) and isinstance(key, str))
                    or (isinstance(value, list) and type(key) is int)):
                value = value[key]
            else:
                return None
        if isinstance(value, str):
            value = decode_json(value)
    except (KeyError, IndexError, ValueError, RecursionError):
        return None
    return value if isinstance(value, dict) else None


def normalize_document(channel, form_version, payload, path):
    base = {"version": VERSION, "fields": {}}
    if (channel, form_version) not in SUPPORTED:
        return base | {"status": "unsupported_form_version"}
    answers = response_at(payload, path)
    if answers is None:
        return base | {"status": "unsupported_response_shape"}
    if channel == "web":
        fields = web_fields(answers)
    else:
        fields = whatsapp_fields(answers, form_version=form_version)
    return base | {"status": "interpreted", "fields": fields}


def normalize(submission):
    return normalize_document(
        submission.channel, submission.form_version, submission.payload, submission.answers_path,
    )
