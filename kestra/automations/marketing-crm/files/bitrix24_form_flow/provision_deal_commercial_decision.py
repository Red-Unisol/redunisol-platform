"""Provision the decision field explicitly, using the usual Bitrix environment."""
from .form_processor.bitrix_client import BitrixClient
from .form_processor.config import load_config
from .form_processor.deal_commercial_decision import ensure_decision_field
from .form_processor.logger import create_logger


if __name__ == "__main__":
    field_id = ensure_decision_field(BitrixClient(load_config(), create_logger()))
    print(f"Commercial decision field ready: {field_id}")
