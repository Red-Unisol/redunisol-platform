from __future__ import annotations

from collections import Counter
import json
import os
import time

from .form_processor.bitrix_client import ApiCallSummaryClient, BitrixClient
from .form_processor.config import load_config
from .form_processor.deal_chat_response import PacedReadClient, reconcile_sales_chats
from .form_processor.logger import create_logger


def main():
    from kestra import Kestra

    logger = create_logger()
    started = time.monotonic()
    api = None
    try:
        verbose = os.environ.get("BITRIX24_LOG_API_CALLS", "").lower() in ("1", "true", "yes")
        api = ApiCallSummaryClient(BitrixClient(load_config(), logger, log_api_calls=verbose))
        result = reconcile_sales_chats(PacedReadClient(api))
    except Exception as exc:
        result = {"ok": False, "error_type": type(exc).__name__}
    summary = {
        "event": "bitrix24_deal_chat_response_summary",
        "ok": result["ok"],
        "duration_seconds": round(time.monotonic() - started, 3),
        **(api.summary() if api is not None else {"api_calls": {}, "api_failed_attempts": {}}),
    }
    for key in ("checked", "counts", "error_type"):
        if key in result:
            summary[key] = result[key]
    error_types = Counter(
        event["error_type"] for event in result.get("events", []) if event.get("error_type")
    )
    if error_types:
        summary["error_types"] = dict(error_types)
    log = logger.info if result["ok"] else logger.error
    log(json.dumps(summary, ensure_ascii=True))
    Kestra.outputs({"ok": result["ok"], "result_json": json.dumps(result, ensure_ascii=True)})
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
