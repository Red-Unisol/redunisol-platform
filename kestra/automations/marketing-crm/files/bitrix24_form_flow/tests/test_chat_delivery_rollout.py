from bitrix24_form_flow.form_processor.chat_delivery_rollout import chat_delivery_mode


def test_previous_flow_revision_and_unconfigured_namespace_stay_in_legacy_mode():
    assert chat_delivery_mode({}) == "legacy"
    assert chat_delivery_mode({"SALES_CHAT_DELIVERY_MODE": "legacy"}) == "legacy"


def test_explicit_opt_in_and_rollback_pause_are_distinct_from_legacy():
    assert chat_delivery_mode({"SALES_CHAT_DELIVERY_MODE": "durable"}) == "durable"
    for mode in ("paused", "", "true", "Durable", "invalid"):
        assert chat_delivery_mode({"SALES_CHAT_DELIVERY_MODE": mode}) == "paused"
