"""Explicit production wiring; importing this module never performs network IO."""
import os

from pago360.portal import PortalClient
from pago360.adapters import Legacy, Provider, Repository
from pago360_cuotas.processor import Processor


def build_processor() -> Processor:
    client = PortalClient(os.environ.get("PAGO360_PORTAL_API_URL", ""),
                          os.environ.get("PAGO360_PORTAL_API_SECRET", ""))
    legacy = Legacy(os.environ.get("VIMARX_EVAL_BASE_URL", ""))
    return Processor(Repository(client, legacy), Provider(client), legacy,
                     contracts_verified=True, apply_collected_amount=True)
