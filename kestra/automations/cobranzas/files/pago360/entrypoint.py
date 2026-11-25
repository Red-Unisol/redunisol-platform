"""Kestra entry point shared by Pago360 notifications and pending jobs."""
import json
import os
import sys
from uuid import UUID

from pago360_cuotas.processor import Processor


def main():
    execution_id = os.environ["KESTRA_EXECUTION_ID"]
    if os.environ.get("PAGO360_MODE") == "enabled":
        from .runtime import build_processor
        processor = build_processor()
    else:
        processor = Processor()
    if sys.argv[1:] == ["recover"]:
        from .pending import pending_operations

        operations = pending_operations()
    else:
        operation_id = os.environ.get("OPERATION_ID")
        if not operation_id:
            body = json.loads(os.environ.get("TRIGGER_BODY_JSON", "{}"))
            operation_id = body.get("operacion_id")
        operations = [operation_id]

    failed = False
    for value in operations:
        try:
            operation_id = str(UUID(value))
        except (ValueError, TypeError, AttributeError):
            failed = True
            print(json.dumps({"result": "INVALID_OPERATION_ID"}))
            continue
        try:
            result = processor.run(operation_id, execution_id)
            print(json.dumps({"operation_id": operation_id, "result": result.status, "reason": result.reason}))
        except Exception:
            failed = True
            print(json.dumps({"operation_id": operation_id, "result": "RECOVERY_REQUIRED"}))
    if failed:
        raise RuntimeError("Some Pago360 operations require review")


if __name__ == "__main__":
    main()
