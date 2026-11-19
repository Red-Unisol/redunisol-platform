"""Synthetic inputs used to verify the installation without opening an intake."""

from datetime import datetime, timezone

from .capture import capture
from .normalize import normalize


def sample(channel="web"):
    meta = {
        "channel": channel,
        "source_scope": "synthetic",
        "source_id": f"sample-{channel}",
        "form_version": "web-loan-v1" if channel == "web" else "whatsapp-intake-v3",
        "declared_at": "2026-09-14T01:04:42-03:00",
    }
    if channel == "web":
        return meta | {"payload": {
            "province": "Catamarca", "employment_status": "Jubilado Nacional", "payment_bank": "Banco Nación",
        }}
    return meta | {"payload": {
        "provincia": "catamarca", "situacion_catamarca": "jubilado", "organismo_catamarca": "anses",
        "banco_catamarca": "nacion", "organismo": "caja_cordoba",
    }}


def main():
    now = datetime(2026, 11, 19, tzinfo=timezone.utc)
    web = normalize(capture(sample(), now=now))
    whatsapp = normalize(capture(sample("whatsapp"), now=now))
    expected = {"province": "catamarca", "benefit_kind": "retirement", "paying_organization": "anses", "payment_bank": "nacion"}
    for result in (web, whatsapp):
        actual = {name: result["fields"][name].get("value") for name in expected}
        if actual != expected:
            raise SystemExit("web and WhatsApp normalization check failed")
    print("web + WhatsApp normalization OK (synthetic)")


if __name__ == "__main__":
    main()
