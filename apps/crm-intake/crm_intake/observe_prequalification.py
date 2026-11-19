"""Offline replay of minimized web declarations and recorded web decisions."""

from collections import Counter
from dataclasses import asdict
from datetime import datetime
import json
from pathlib import Path
import sys

from .kestra_policy import commercial
from .normalize import normalize_document
from .prequalification import evaluate


def compare(record):
    ref = record["submission_id"]
    fields = record["fields"]
    observed = record.get("observed")
    at = datetime.fromisoformat(observed["evaluated_at"] if observed else record["received_at"])
    profile = normalize_document("web", "web-loan-v1", fields, ())
    decision = evaluate(profile, profile_ref=ref, evaluated_at=at, scope="public_web")
    direct = commercial.prequalify_commercial_fields(fields, evaluated_at=at)
    comparison = {"draft": asdict(decision), "recorded": observed, "kestra_current_direct": {
        key: direct[key] for key in ("ok", "prequalified", "route_to_whatsapp", "reason", "rule_version")
    }}
    if not observed or not observed["available"]:
        group = "reference_unavailable"
    elif decision.outcome == "pending":
        group = "draft_pending"
    elif (decision.measurement_qualified, decision.permits_whatsapp, decision.reason) == (
        observed["qualified"], observed["route_to_whatsapp"], observed["reason"],
    ):
        group = "matches_recorded"
    elif observed["rule_version"] and observed["rule_version"] != decision.policy_version:
        group = "difference_with_other_rule_version"
    else:
        group = "difference_without_confirmed_version_change"
    return {"submission_id": ref, "comparison": group, **comparison}


def main():
    document = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    rows = [compare(record) for record in document["records"]]
    print(json.dumps({
        "window_utc": document["window_utc"],
        "sources": document["sources"],
        "totals": dict(Counter(row["comparison"] for row in rows)),
        "results": rows,
    }, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
