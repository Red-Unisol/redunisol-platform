"""Cheap read-only scheduler gate; start the queue worker only for eligible work."""

import json
import os
from datetime import datetime, timezone
from urllib.request import Request, urlopen

from .form_processor._routing_cutover import new_routing_enabled
from .form_processor.config import load_routing_settings
from .form_processor._sales_opening import queue_marker_sleeping, sales_closed_window


def ready_count(fetch_page, settings, reason_field, bucket_field, now):
    start = 0
    held = set()
    while True:
        page = fetch_page(start)
        result = page.get("result")
        rows = result.get("items") if isinstance(result, dict) else None
        total = page.get("total")
        if not isinstance(rows, list) or not isinstance(total, int):
            return 1
        for row in rows:
            raw = row.get(reason_field)
            if not new_routing_enabled(row.get("createdTime")) or not queue_marker_sleeping(raw, now):
                return max(1, total)
            held.add((row.get(bucket_field), raw.split("|", 3)[2]))
        next_page = page.get("next", result.get("next"))
        if next_page is None:
            if start + len(rows) < total:
                return 1
            break
        if not isinstance(next_page, int) or next_page <= start:
            return 1
        start = next_page

    if not held:
        return 0
    # An administrator may have changed a pool or the calendar since closing.
    # One settings read covers every held row and never queries seller presence.
    pools, calendar = settings()
    window = sales_closed_window(now, calendar)
    for bucket, expected_opening in held:
        if not window or window["window_end"] != expected_opening or len(pools.get(bucket, ())) < 2:
            return 1
    return 0


def main():
    reason_field = os.environ["QUEUE_REASON_FIELD"]
    bucket_field = os.environ["ROUTING_BUCKET_FIELD"]

    def fetch_page(start):
        params = {
            "entityTypeId": 2,
            "filter": {"=categoryId": os.environ["BITRIX24_DEAL_CATEGORY_ID"],
                       "=stageId": os.environ["BITRIX24_DEAL_ASSIGNMENT_QUEUE_STAGE_ID"]},
            "select": ["id", "createdTime", reason_field, bucket_field],
            "order": {"id": "ASC"}, "start": start,
        }
        request = Request(os.environ["BITRIX24_LIST_URL"], data=json.dumps(params).encode(),
                          headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=15) as response:
                return json.load(response)
        except OSError:
            raise RuntimeError("No se pudo consultar la cola comercial de Bitrix.") from None

    total = ready_count(fetch_page, lambda: load_routing_settings(os.environ), reason_field, bucket_field,
                        datetime.now(timezone.utc))
    print("::" + json.dumps({"outputs": {"total": total}}) + "::")


if __name__ == "__main__":
    main()
