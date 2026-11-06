from __future__ import annotations

import json
import os

from .form_processor.bitrix_client import BitrixClient
from .form_processor.config import load_config
from .form_processor.logger import create_logger
from .form_processor.chat_response_worker import QueueClient, run_batches


def main():
    logger = create_logger()
    try:
        result = run_batches(BitrixClient(load_config(), logger, log_api_calls=False),
            QueueClient(os.environ["CHAT_RESPONSE_QUEUE_URL"], os.environ["CHAT_RESPONSE_QUEUE_TOKEN"],
                        os.environ["CHAT_RESPONSE_SCOPE"]))
    except Exception as exc:
        result = {"ok": False, "error_type": type(exc).__name__}
    log = logger.info if result["ok"] else logger.error
    log(json.dumps({"event": "bitrix24_chat_response_worker_summary",
                    **{key: value for key, value in result.items() if key != "events"}}))
    print("::" + json.dumps({"outputs": {"ok": result["ok"], "result_json": json.dumps(result)}}) + "::")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
