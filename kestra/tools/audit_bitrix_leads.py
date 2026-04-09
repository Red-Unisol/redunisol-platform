from __future__ import annotations

import argparse
import base64
import json
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ENV_FILE = ROOT / "platform" / "infra" / "kestra-runtime.env"


@dataclass(frozen=True)
class AuditWindow:
    date_from: str
    date_to: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit Bitrix lead fields, dropdown values, and recent usage."
    )
    parser.add_argument(
        "--env-file",
        default=str(DEFAULT_ENV_FILE),
        help="Path to the plaintext runtime env file used to reach Bitrix.",
    )
    parser.add_argument(
        "--date-from",
        required=True,
        help="Start date in YYYY-MM-DD format, inclusive.",
    )
    parser.add_argument(
        "--date-to",
        required=True,
        help="End date in YYYY-MM-DD format, inclusive.",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path to the markdown file to generate.",
    )
    return parser.parse_args()


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


class BitrixClient:
    def __init__(self, base_url: str, webhook_path: str):
        self.base_url = base_url.rstrip("/")
        self.webhook_path = webhook_path.strip("/")

    def call_full(self, method: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}/{self.webhook_path}/{method}.json"
        request = Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))

        if "error" in data:
            description = data.get("error_description") or data["error"]
            raise RuntimeError(f"{method} failed: {description}")

        return data

    def call(self, method: str, payload: dict[str, Any]) -> Any:
        return self.call_full(method, payload).get("result")


def parse_window(date_from: str, date_to: str) -> AuditWindow:
    start = datetime.strptime(date_from, "%Y-%m-%d")
    end = datetime.strptime(date_to, "%Y-%m-%d")
    if end < start:
        raise ValueError("--date-to must be on or after --date-from")
    return AuditWindow(
        date_from=f"{date_from}T00:00:00-03:00",
        date_to=f"{date_to}T23:59:59-03:00",
    )


def fetch_all_leads(
    client: BitrixClient,
    *,
    window: AuditWindow,
    field_names: list[str],
) -> list[dict[str, Any]]:
    leads: list[dict[str, Any]] = []
    start = 0
    while True:
        payload = {
            "filter": {
                ">=DATE_CREATE": window.date_from,
                "<=DATE_CREATE": window.date_to,
            },
            "order": {"ID": "DESC"},
            "select": field_names,
            "start": start,
        }
        response = client.call_full("crm.lead.list", payload)
        result = response.get("result") or []
        if not isinstance(result, list):
            raise RuntimeError("crm.lead.list returned a non-list result.")
        leads.extend(result)

        next_page = response.get("next")
        if next_page is None:
            break
        start = int(next_page)

    return leads


def is_populated(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) > 0
    return True


def normalize_value(value: Any) -> str:
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=True, sort_keys=True)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=True, sort_keys=True)
    return str(value)


def summarize_field_usage(
    fields: dict[str, dict[str, Any]],
    leads: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    usage: dict[str, dict[str, Any]] = {}
    for field_name, field in fields.items():
        used_values: Counter[str] = Counter()
        non_empty_count = 0
        for lead in leads:
            value = lead.get(field_name)
            if is_populated(value):
                non_empty_count += 1
                used_values[normalize_value(value)] += 1

        usage[field_name] = {
            "non_empty_count": non_empty_count,
            "distinct_values": len(used_values),
            "value_counts": used_values,
            "top_values": used_values.most_common(10),
        }
    return usage


def get_dropdown_options(
    client: BitrixClient,
    fields: dict[str, dict[str, Any]],
) -> dict[str, list[dict[str, str]]]:
    options: dict[str, list[dict[str, str]]] = {}
    status_cache: dict[str, list[dict[str, Any]]] = {}

    for field_name, field in fields.items():
        field_type = field.get("type")
        if field_type == "enumeration":
            items = field.get("items") or []
            options[field_name] = [
                {"id": str(item.get("ID", "")), "label": str(item.get("VALUE", ""))}
                for item in items
            ]
            continue

        if field_type == "crm_status":
            status_type = field.get("statusType")
            if not status_type:
                options[field_name] = []
                continue

            if status_type not in status_cache:
                result = client.call(
                    "crm.status.list",
                    {"filter": {"ENTITY_ID": status_type}},
                )
                if not isinstance(result, list):
                    raise RuntimeError(f"crm.status.list returned invalid data for {status_type}.")
                status_cache[status_type] = result

            options[field_name] = [
                {
                    "id": str(item.get("STATUS_ID", "")),
                    "label": str(item.get("NAME", "")),
                }
                for item in status_cache[status_type]
            ]

    return options


def field_sort_key(item: tuple[str, dict[str, Any]]) -> tuple[int, str]:
    field_name, _ = item
    return (0 if not field_name.startswith("UF_") else 1, field_name)


def collect_automation_fields(env: dict[str, str]) -> set[str]:
    configured = {
        env["ENV_BITRIX24_LEAD_CUIL_FIELD"],
        env["ENV_BITRIX24_LEAD_EMPLOYMENT_STATUS_FIELD"],
        env["ENV_BITRIX24_LEAD_PAYMENT_BANK_FIELD"],
        env["ENV_BITRIX24_LEAD_PROVINCE_FIELD"],
        env["ENV_BITRIX24_LEAD_SOURCE_FIELD"],
        env["ENV_BITRIX24_LEAD_REJECTION_REASON_FIELD"],
    }
    standard = {
        "TITLE",
        "NAME",
        "EMAIL",
        "PHONE",
        "CONTACT_ID",
        "STATUS_ID",
    }
    return configured | standard


def render_dropdown_values(
    field_name: str,
    options: list[dict[str, str]],
    usage: dict[str, Any],
) -> str:
    if not options:
        return "Sin opciones expuestas por metadata."

    used_counter = usage["value_counts"]
    rendered: list[str] = []
    for option in options:
        option_id = option["id"]
        count = used_counter.get(option_id, 0)
        rendered.append(f"- `{option_id}`: {option['label']} | usados: {count}")
    return "\n".join(rendered)


def render_field_table(
    fields: dict[str, dict[str, Any]],
    usage: dict[str, dict[str, Any]],
    automation_fields: set[str],
) -> str:
    lines = [
        "| Campo API | Label | Tipo | Custom | Usado en flujo | Leads con valor | Distintos |",
        "| --- | --- | --- | --- | --- | ---: | ---: |",
    ]

    for field_name, field in sorted(fields.items(), key=field_sort_key):
        field_usage = usage[field_name]
        label = str(field.get("formLabel") or field.get("title") or "")
        field_type = str(field.get("type") or "")
        lines.append(
            "| "
            + " | ".join(
                [
                    f"`{field_name}`",
                    label.replace("|", "\\|"),
                    field_type,
                    "si" if field_name.startswith("UF_") else "no",
                    "si" if field_name in automation_fields else "no",
                    str(field_usage["non_empty_count"]),
                    str(field_usage["distinct_values"]),
                ]
            )
            + " |"
        )

    return "\n".join(lines)


def render_dropdown_section(
    fields: dict[str, dict[str, Any]],
    usage: dict[str, dict[str, Any]],
    dropdown_options: dict[str, list[dict[str, str]]],
) -> str:
    chunks: list[str] = []
    dropdown_names = [
        field_name
        for field_name, field in fields.items()
        if field.get("type") in {"enumeration", "crm_status"}
    ]
    for field_name in sorted(dropdown_names):
        field = fields[field_name]
        label = str(field.get("formLabel") or field.get("title") or "")
        field_usage = usage[field_name]
        chunks.append(f"### `{field_name}` - {label}")
        chunks.append("")
        chunks.append(f"- tipo: `{field.get('type', '')}`")
        chunks.append(f"- leads con valor: `{field_usage['non_empty_count']}`")
        chunks.append(f"- valores distintos usados: `{field_usage['distinct_values']}`")
        chunks.append("- opciones posibles:")
        chunks.append(render_dropdown_values(field_name, dropdown_options.get(field_name, []), field_usage))
        chunks.append("")
    return "\n".join(chunks).rstrip()


def render_unused_section(
    fields: dict[str, dict[str, Any]],
    usage: dict[str, dict[str, Any]],
) -> str:
    unused = [
        field_name
        for field_name in fields
        if usage[field_name]["non_empty_count"] == 0
    ]
    lines = [f"- total sin uso en la ventana: `{len(unused)}`"]
    for field_name in unused:
        field = fields[field_name]
        label = str(field.get("formLabel") or field.get("title") or "")
        lines.append(f"- `{field_name}` - {label}")
    return "\n".join(lines)


def render_used_custom_section(
    fields: dict[str, dict[str, Any]],
    usage: dict[str, dict[str, Any]],
) -> str:
    used_custom = [
        (field_name, usage[field_name]["non_empty_count"])
        for field_name in fields
        if field_name.startswith("UF_") and usage[field_name]["non_empty_count"] > 0
    ]
    used_custom.sort(key=lambda item: (-item[1], item[0]))
    lines: list[str] = []
    for field_name, count in used_custom:
        label = str(fields[field_name].get("formLabel") or fields[field_name].get("title") or "")
        lines.append(f"- `{field_name}` - {label}: `{count}` leads")
    return "\n".join(lines)


def label_for(fields: dict[str, dict[str, Any]], field_name: str) -> str:
    field = fields.get(field_name, {})
    return str(field.get("formLabel") or field.get("title") or field_name)


def render_cleanup_section(
    fields: dict[str, dict[str, Any]],
    usage: dict[str, dict[str, Any]],
    automation_fields: set[str],
    leads: list[dict[str, Any]],
) -> str:
    total_leads = len(leads)
    lines: list[str] = []

    constant_custom = [
        field_name
        for field_name in fields
        if field_name.startswith("UF_")
        and field_name not in automation_fields
        and usage[field_name]["non_empty_count"] == total_leads
        and usage[field_name]["distinct_values"] == 1
    ]
    if constant_custom:
        rendered = ", ".join(
            f"`{field_name}` ({label_for(fields, field_name)})"
            for field_name in sorted(constant_custom)[:8]
        )
        lines.append(
            "1. Ocultar o revisar campos custom con valor fijo/default en toda la ventana. "
            f"Ejemplos: {rendered}. Estos campos hoy agregan ruido, no señal."
        )

    duplicate_candidates = [
        ("UF_CRM_1714071903", "UF_CRM_1716466733"),
        ("UF_CRM_64E65D2B2136C", "UF_CRM_1716466829"),
        ("UF_CRM_LEAD_1711458190312", "UF_CRM_1716466790"),
        ("UF_CRM_LEAD_1711458190312", "UF_CRM_LEAD_1706273705244"),
    ]
    present_duplicates = [
        pair
        for pair in duplicate_candidates
        if pair[0] in fields and pair[1] in fields
    ]
    if present_duplicates:
        duplicate_text = "; ".join(
            f"`{left}` ({label_for(fields, left)}) vs `{right}` ({label_for(fields, right)})"
            for left, right in present_duplicates
        )
        lines.append(
            "2. Consolidar duplicados de negocio entre campos enumerados vigentes y variantes legacy/string. "
            f"Pares detectados: {duplicate_text}."
        )

    if "UF_CRM_REJECTION_REASON" in fields and usage["UF_CRM_REJECTION_REASON"]["non_empty_count"] == 0:
        lines.append(
            "3. Unificar el rechazo en una etapa perdida unica y usar `UF_CRM_REJECTION_REASON` para el motivo. "
            "Hoy el campo de motivo no tiene uso en la ventana, mientras la etapa absorbe muchos motivos de negocio."
        )

    if (
        "SOURCE_ID" in fields
        and "UF_CRM_1722365051" in fields
        and usage["SOURCE_ID"]["value_counts"].get("CALL", 0) >= int(total_leads * 0.8)
        and usage["UF_CRM_1722365051"]["non_empty_count"] >= int(total_leads * 0.8)
    ):
        lines.append(
            "4. Normalizar la estrategia de origen. `SOURCE_ID` esta dominado por `CALL`, mientras el canal real vive en "
            "`UF_CRM_1722365051` (`origenFormulario`). Definir si `SOURCE_ID` sera macro-origen y el custom subcanal, "
            "o si se migra toda la semantica a un solo contrato."
        )

    unused_custom = [
        field_name
        for field_name in fields
        if field_name.startswith("UF_") and usage[field_name]["non_empty_count"] == 0
    ]
    if unused_custom:
        rendered = ", ".join(f"`{field_name}`" for field_name in sorted(unused_custom)[:12])
        lines.append(
            "5. Depurar campos custom sin uso real en la ventana. "
            f"Hay `{len(unused_custom)}` candidatos; primeros ejemplos: {rendered}."
        )

    if not lines:
        lines.append("1. No surgieron candidatos obvios de cleanup con esta heuristica.")

    lines.append(
        "6. Versionar como contrato minimo de integracion los campos que el webhook escribe hoy, "
        "para que futuras automatizaciones no vuelvan a depender de campos manuales o legacy."
    )
    return "\n".join(lines)


def render_summary(
    fields: dict[str, dict[str, Any]],
    usage: dict[str, dict[str, Any]],
    dropdown_options: dict[str, list[dict[str, str]]],
    automation_fields: set[str],
    leads: list[dict[str, Any]],
    date_from: str,
    date_to: str,
) -> str:
    total_fields = len(fields)
    total_dropdowns = sum(
        1 for field in fields.values() if field.get("type") in {"enumeration", "crm_status"}
    )
    used_fields = sum(1 for field_name in fields if usage[field_name]["non_empty_count"] > 0)
    unused_fields = total_fields - used_fields

    lines = [
        "# Auditoria de Leads en Bitrix24",
        "",
        f"- fecha de generacion: `{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}`",
        f"- ventana analizada: `{date_from}` a `{date_to}` inclusive",
        f"- leads analizados: `{len(leads)}`",
        f"- campos totales en `crm.lead.fields`: `{total_fields}`",
        f"- campos tipo desplegable (`enumeration` o `crm_status`): `{total_dropdowns}`",
        f"- campos con al menos un valor en la ventana: `{used_fields}`",
        f"- campos sin uso en la ventana: `{unused_fields}`",
        "",
        "## Campos usados por la automatizacion de formulario",
        "",
    ]
    for field_name in sorted(automation_fields):
        field = fields.get(field_name)
        if not field:
            lines.append(f"- `{field_name}` - no encontrado en metadata")
            continue
        label = str(field.get("formLabel") or field.get("title") or "")
        lines.append(f"- `{field_name}` - {label}")

    lines.extend(
        [
            "",
            "## Campos custom efectivamente usados en la ventana",
            "",
            render_used_custom_section(fields, usage),
            "",
            "## Inventario completo de campos",
            "",
            render_field_table(fields, usage, automation_fields),
            "",
            "## Desplegables y valores posibles",
            "",
            render_dropdown_section(fields, usage, dropdown_options),
            "",
            "## Campos sin uso en la ventana",
            "",
            render_unused_section(fields, usage),
            "",
            "## Observaciones operativas",
            "",
            "- `SOURCE_ID` es nativo, pero en los leads recientes del webhook aparece mayormente como `CALL`, por lo que hoy no diferencia bien el origen real de captura.",
            "- El canal de marketing real hoy queda en el custom `origenFormulario` (`UF_CRM_1722365051`).",
            "- El flujo de Kestra usa un subconjunto chico de campos y no gobierna el resto de la superficie del lead.",
            "",
            "## Propuesta de cleanup",
            "",
            render_cleanup_section(fields, usage, automation_fields, leads),
        ]
    )

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    args = parse_args()
    env_path = Path(args.env_file)
    output_path = Path(args.output)

    env = load_env_file(env_path)
    webhook_path = base64.b64decode(env["SECRET_BITRIX24_WEBHOOK_PATH"]).decode("utf-8")
    client = BitrixClient(env["ENV_BITRIX24_BASE_URL"], webhook_path)

    window = parse_window(args.date_from, args.date_to)
    fields = client.call("crm.lead.fields", {})
    if not isinstance(fields, dict):
        raise RuntimeError("crm.lead.fields returned invalid data.")

    field_names = sorted(fields.keys())
    leads = fetch_all_leads(client, window=window, field_names=field_names)
    usage = summarize_field_usage(fields, leads)
    dropdown_options = get_dropdown_options(client, fields)
    automation_fields = collect_automation_fields(env)

    markdown = render_summary(
        fields=fields,
        usage=usage,
        dropdown_options=dropdown_options,
        automation_fields=automation_fields,
        leads=leads,
        date_from=args.date_from,
        date_to=args.date_to,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(markdown, encoding="utf-8", newline="\n")
    print(f"Audit written to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
