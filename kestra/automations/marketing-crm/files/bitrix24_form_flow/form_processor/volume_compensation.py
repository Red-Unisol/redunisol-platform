from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import AppConfig
from .logger import Logger


def apply_volume_compensation(
    config: AppConfig,
    *,
    deal_id: int,
    bucket_key: str,
    online_pool: tuple[int, ...],
    proposed_user_id: int,
    recurring: bool,
    logger: Logger,
) -> tuple[int, bool]:
    """Record today's opportunity and optionally replace a non-recurring proposal."""
    url = config.deal.volume_compensation_url
    token = config.deal.volume_compensation_token
    if not url or not token:
        return proposed_user_id, False

    request = Request(
        url,
        data=json.dumps(
            {
                "scope": config.deal.volume_compensation_scope,
                "bucket": bucket_key,
                "deal_id": deal_id,
                "online_user_ids": list(online_pool),
                "proposed_user_id": proposed_user_id,
                "recurring": recurring,
            }
        ).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        assigned_user_id = int(payload["assigned_user_id"])
        compensated = payload.get("compensated") is True
        if assigned_user_id not in online_pool:
            raise ValueError("el vendedor devuelto no pertenece al pool online")
        if recurring and assigned_user_id != proposed_user_id:
            raise ValueError("la API intentó reemplazar una recurrencia")
    except (HTTPError, URLError, OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        logger.error(
            "No se pudo registrar la compensación diaria; "
            f"se conserva la asignación normal: {exc}"
        )
        return proposed_user_id, False

    if compensated:
        logger.info(
            f"La compensación diaria cambió el vendedor {proposed_user_id} "
            f"por {assigned_user_id} en {bucket_key}."
        )
    return assigned_user_id, compensated
