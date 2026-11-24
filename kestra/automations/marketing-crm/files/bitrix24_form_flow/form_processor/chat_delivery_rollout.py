"""Routing mode supplied by the flow in its own namespace at task start."""

import os


def chat_delivery_mode(env=None):
    source = os.environ if env is None else env
    # In-flight pre-rollout YAML does not export the mode. Unknown explicit values stop effects.
    mode = source.get("SALES_CHAT_DELIVERY_MODE", "legacy")
    return mode if mode in ("legacy", "durable", "paused") else "paused"
