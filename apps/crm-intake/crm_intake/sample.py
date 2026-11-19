"""Synthetic inputs used to verify the installation without opening an intake."""

import json
from datetime import datetime, timezone

from .capture import capture
from .normalize import normalize
from .prequalification import CuadEvidence, evaluate


def sample(channel="web"):
    answers = {
        "province": "Catamarca", "employment_status": "Jubilado Nacional", "payment_bank": "Banco Nación",
    } if channel == "web" else {
        "provincia": "catamarca", "situacion_catamarca": "jubilado", "organismo_catamarca": "anses",
        "banco_catamarca": "nacion", "organismo": "caja_cordoba",
    }
    return {
        "channel": channel,
        "source_scope": "synthetic",
        "source_id": f"sample-{channel}",
        "form_version": "web-loan-v1" if channel == "web" else "whatsapp-intake-v3",
        "declared_at": "2026-09-14T01:04:42-03:00",
        "original_body": json.dumps(answers, ensure_ascii=False, indent=2),
        "source_metadata": {"example": True, "transport_extension": ["present", None]},
        "answers_path": [],
        "form": {
            "id": f"sample-{channel}-form",
            "revision": "sample-publication-1",
            "definition": {
                "title": "Synthetic request",
                "options": {"provider_option": "Example label"},
            },
        },
    }


def main():
    now = datetime(2026, 11, 19, tzinfo=timezone.utc)
    web = normalize(capture(sample(), now=now))
    whatsapp = normalize(capture(sample("whatsapp"), now=now))
    expected = {"province": "catamarca", "benefit_kind": "retirement", "paying_organization": "anses", "payment_bank": "nacion"}
    for result in (web, whatsapp):
        actual = {name: result["fields"][name].get("value") for name in expected}
        if actual != expected:
            raise SystemExit("web and WhatsApp normalization check failed")
    web_decision = evaluate(web, profile_ref="synthetic-web", evaluated_at=now, scope="public_web")
    whatsapp_decision = evaluate(
        whatsapp, profile_ref="synthetic-whatsapp", evaluated_at=now, scope="crm_lead",
        cuad=CuadEvidence("not_found", "synthetic-registry"),
    )
    if not all(result.commercially_qualified for result in (web_decision, whatsapp_decision)):
        raise SystemExit("web and WhatsApp prequalification check failed")
    print("web + WhatsApp snapshot, normalization and prequalification OK (synthetic)")


if __name__ == "__main__":
    main()
