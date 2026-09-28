from __future__ import annotations

import json

from .form_processor.bitrix_client import BitrixClient
from .form_processor.config import load_config
from .form_processor.deal_chat_response import PacedReadClient, reconcile_sales_chats
from .form_processor.logger import create_logger


def main():
    from kestra import Kestra

    client = PacedReadClient(BitrixClient(load_config(), create_logger()))
    try:
        result = reconcile_sales_chats(client)
    except Exception as exc:
        result = {"ok": False, "error_type": type(exc).__name__}
    Kestra.outputs({"ok": result["ok"], "result_json": json.dumps(result, ensure_ascii=True)})
    print(json.dumps(result, ensure_ascii=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
