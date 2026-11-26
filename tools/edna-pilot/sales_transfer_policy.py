"""Inspect or apply the production VENTAS CRM transfer policy. Never transfers a chat."""

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

import requests


SETTING = "CRM_TRANSFER_CHANGE"
DERIVED = {"DATE_MODIFY", "MODIFY_USER_ID", "QUEUE_ONLINE", "QUEUE_USERS_FIELDS"}


def stable_config(config):
    # Per-user display data and instantaneous online counts are not line settings.
    # The full queue, member types, IDs and order remain in the fingerprint.
    return {k: v for k, v in config.items() if k not in DERIVED and k != SETTING}


def fingerprint(config):
    canonical = json.dumps(stable_config(config), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def read_config(call):
    config = call("imopenlines.config.get", {"CONFIG_ID": 1, "WITH_QUEUE": "Y"})
    if not isinstance(config, dict) or str(config.get("ID")) != "1" or config.get("LINE_NAME") != "Canal Abierto VENTAS":
        raise RuntimeError("VENTAS line identity mismatch")
    if config.get("ACTIVE") != "Y" or config.get("CRM") != "Y" or config.get(SETTING) not in {"Y", "N"}:
        raise RuntimeError("Unexpected channel settings")
    if [str(user) for user in config.get("QUEUE", [])] != ["74827"]:
        raise RuntimeError("Unexpected VENTAS routing queue")
    return config


def inspect_or_apply(call, expected=None):
    before = read_config(call)
    digest = fingerprint(before)
    receipt = {"utc": datetime.now(timezone.utc).isoformat(), "config_id": 1, "queue": [74827],
               "before": before[SETTING], "unrelated_config_sha256": digest, "write_attempted": False}
    if expected is None:
        return receipt
    if expected != digest:
        raise RuntimeError("Preflight mismatch; run status and review the current settings")
    if before[SETTING] == "Y":
        receipt["write_attempted"] = True
        try:
            ack = call("imopenlines.config.update", {"CONFIG_ID": 1, "PARAMS": {SETTING: "N"}})
            receipt["acknowledged"] = ack is True or (isinstance(ack, (str, int)) and str(ack) == "1")
        except RuntimeError:
            receipt["acknowledged"] = False
        # A lost ACK is reconciled against the live configuration, never replayed.
    after = read_config(call)
    previous, current = stable_config(before), stable_config(after)
    changed = sorted(k for k in previous.keys() | current.keys()
                     if k not in previous or k not in current or previous[k] != current[k])
    if after[SETTING] != "N" or fingerprint(after) != digest:
        raise RuntimeError("Postflight mismatch; stop activation. Changed unrelated fields: " + ",".join(changed))
    return {**receipt, "after": after[SETTING], "unrelated_changes": changed,
            "derived_fields_changed": sorted(k for k in DERIVED if before.get(k) != after.get(k))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["status", "apply"])
    parser.add_argument("--expected-config", help="Unrelated configuration SHA-256 from a reviewed status")
    args = parser.parse_args()
    if args.action == "apply" and not re.fullmatch(r"[0-9a-f]{64}", args.expected_config or ""):
        parser.error("apply requires --expected-config from status")
    base = os.environ.get("BITRIX_WEBHOOK_URL", "").strip().rstrip("/")
    if not re.fullmatch(r"https://redunisol\.bitrix24\.es/rest/[0-9]+/[A-Za-z0-9_-]+", base):
        raise RuntimeError("Configure the canonical production Bitrix webhook")

    def call(method, params):
        try:
            response = requests.post(f"{base}/{method}.json", json=params, allow_redirects=False, timeout=(4, 18))
            payload = response.json()
        except (requests.RequestException, ValueError):
            raise RuntimeError("Bitrix response unavailable") from None
        if response.status_code != 200 or not isinstance(payload, dict) or "error" in payload or "result" not in payload:
            raise RuntimeError(f"Bitrix did not acknowledge {method}")
        return payload["result"]

    print(json.dumps(inspect_or_apply(call, args.expected_config if args.action == "apply" else None)))


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
