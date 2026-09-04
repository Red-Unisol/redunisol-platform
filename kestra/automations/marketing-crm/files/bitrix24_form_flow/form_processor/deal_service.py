from __future__ import annotations

from dataclasses import dataclass
import unicodedata
from typing import Any

from .bitrix_client import BitrixClient
from .config import AppConfig
from .logger import Logger
from .receipt_file import build_bitrix_file_data


DEAL_ENTITY_TYPE_ID = 2
LEAD_ENTITY_TYPE_ID = 1
CONTACT_ENTITY_TYPE_ID = 3
OPEN_LINE_ACTIVITY_PROVIDER_ID = "IMOPENLINES_SESSION"


class NoOnlineSellersError(RuntimeError):
    """Raised when a configured routing pool has no currently available seller."""

    def __init__(self, configured_pool: tuple[int, ...]) -> None:
        super().__init__("No hay vendedores online disponibles para asignar la negociacion.")
        self.configured_pool = configured_pool


DEAL_DIRECT_FIELD_MAPPINGS = {
    "cuil": "ufCrm_64FF4F9B5C195",
    "bcra_status": "ufCrm_69E0D50649FEB",
    "bcra_result": "ufCrm_69E0D5066A068",
    "bcra_data_raw": "ufCrm_69E0F0E38EB6C",
    "bcra_checked_at": "ufCrm_69E0D5067FD95",
    "contact_birthdate": "ufCrm_6A3942DDF006B",
    "vimarx_nro_socio": "ufCrm_6A34379BB89A9",
    "vimarx_creditos_activos_count": "ufCrm_6A34379BDE41B",
    "vimarx_creditos_activos_detail": "ufCrm_6A34379BEF025",
    "vimarx_creditos_activos_raw": "ufCrm_6A34379C0D920",
    "credixsa_status": "ufCrm_6A43D31E6DC9E",
    "credixsa_checked_at": "ufCrm_6A43D31E9C6D7",
    "credixsa_employer_name": "ufCrm_6A43D31EBC847",
    "credixsa_employer_cuit": "ufCrm_6A43D31ED9E56",
    "credixsa_employer_count": "ufCrm_6A43D31F06C90",
    "credixsa_employer_periods": "ufCrm_6A43D31F1D7D1",
    "credixsa_alerts": "ufCrm_6A43D31F38377",
    "receipt": "ufCrm_1692197958",
}

DEAL_ENUM_FIELD_MAPPINGS = {
    "province": "ufCrm_1684346013612",
    "employment_status": "ufCrm_662B9D2685477",
    "payment_bank": "ufCrm_6602D534A38CF",
    "source": "ufCrm_66A93764BFF96",
    "processing_policy": "ufCrm_69CA882AB72B7",
    "commercial_owner": "ufCrm_6A4698BDAB8EA",
    "es_socio": "ufCrm_670E6D6216DD4",
}

DEAL_SOCIO_NUEVO_FIELD = "ufCrm_1727360234"


@dataclass(frozen=True)
class AssignmentResolution:
    assigned_by_id: int
    strategy: str
    configured_pool: tuple[int, ...]
    online_pool: tuple[int, ...]


@dataclass(frozen=True)
class ChatTransferResult:
    found_chat_ids: tuple[int, ...]
    transferred_chat_ids: tuple[int, ...]
    skipped_chats: tuple[tuple[int, str], ...]

    @property
    def transferred_count(self) -> int:
        return len(self.transferred_chat_ids)

    @property
    def skipped_non_distributable_count(self) -> int:
        return sum(
            reason == "non_distributable_open_line"
            for _chat_id, reason in self.skipped_chats
        )

    @property
    def status(self) -> str:
        if not self.found_chat_ids:
            return "no_chats_found"
        if self.transferred_chat_ids and self.skipped_chats:
            return "partially_transferred"
        if self.transferred_chat_ids:
            return "transferred"
        if self.skipped_chats and all(
            reason == "non_distributable_open_line"
            for _chat_id, reason in self.skipped_chats
        ):
            return "non_distributable_open_line"
        return "no_transferable_session"


def ensure_won_lead_deal(
    client: BitrixClient,
    config: AppConfig,
    lead: dict[str, Any],
    *,
    lead_id: int,
    contact_id: int | None,
    logger: Logger,
    stage_id: str | None = None,
    assigned_by_id: int | None = None,
) -> int:
    existing_deal = find_deal_by_lead(client, lead_id=lead_id, logger=logger)
    if existing_deal is not None:
        deal_id = _required_int(existing_deal.get("id") or existing_deal.get("ID"), "id")
        logger.info(f"Lead {lead_id} ya tiene negociacion {deal_id}.")
        return deal_id

    effective_assigned_by_id = assigned_by_id or _required_int(
        lead.get("ASSIGNED_BY_ID"),
        "ASSIGNED_BY_ID",
    )
    fields = _build_deal_fields(
        client,
        config,
        lead,
        lead_id=lead_id,
        contact_id=contact_id,
        assigned_by_id=effective_assigned_by_id,
        stage_id=stage_id,
        logger=logger,
    )

    logger.info(
        f"Creando negociacion para lead {lead_id} "
        f"con responsable {effective_assigned_by_id}."
    )
    result = client.call(
        "crm.item.add",
        {
            "entityTypeId": DEAL_ENTITY_TYPE_ID,
            "fields": fields,
        },
    )
    item = result.get("item") if isinstance(result, dict) else None
    if not isinstance(item, dict):
        raise RuntimeError("crm.item.add devolvio un payload invalido al crear la negociacion.")

    return _required_int(item.get("id") or item.get("ID"), "id")


def ensure_deal_timeline_comment(
    client: BitrixClient,
    config: AppConfig,
    lead: dict[str, Any],
    *,
    lead_id: int,
    deal_id: int,
    logger: Logger,
) -> int:
    deal_url = _deal_url(config.base_url, deal_id)
    comments = client.call(
        "crm.timeline.comment.list",
        {
            "filter": {"ENTITY_ID": lead_id, "ENTITY_TYPE": "lead"},
            "select": ["ID", "COMMENT"],
        },
    )
    if not isinstance(comments, list):
        raise RuntimeError("crm.timeline.comment.list devolvio un payload invalido.")

    for comment in comments:
        if deal_url not in str(comment.get("COMMENT") or ""):
            continue
        comment_id = _required_int(comment.get("ID"), "timeline_comment_id")
        logger.info(f"El lead {lead_id} ya tiene comentario para el deal {deal_id}.")
        return comment_id

    deal_title = _deal_title(lead, lead_id)
    comment_text = (
        "[B]Negociación creada a partir del prospecto[/B]\n"
        f"[URL={deal_url}]{deal_title}[/URL]"
    )
    result = client.call(
        "crm.timeline.comment.add",
        {
            "fields": {
                "ENTITY_ID": lead_id,
                "ENTITY_TYPE": "lead",
                "COMMENT": comment_text,
            }
        },
    )
    comment_id = _required_int(result, "timeline_comment_id")
    logger.info(f"Comentario {comment_id} agregado al lead {lead_id} para el deal {deal_id}.")
    return comment_id


def find_deal_by_lead(
    client: BitrixClient,
    *,
    lead_id: int,
    logger: Logger,
) -> dict[str, Any] | None:
    logger.info(f"Buscando negociacion existente para lead {lead_id}.")
    deals = _list_deals(
        client,
        filter_={"=leadId": lead_id},
        order={"id": "DESC"},
        select=["id", "leadId", "contactId", "assignedById", "stageId"],
    )
    return deals[0] if deals else None


def resolve_round_robin_assignee(
    client: BitrixClient,
    config: AppConfig,
    *,
    contact_id: int | None,
    lead_id: int,
    bucket_key: str,
    bucket_field: str,
    pool: tuple[int, ...],
    legacy_province_label: str | None,
    logger: Logger,
) -> AssignmentResolution:
    if not pool:
        raise RuntimeError("No hay vendedores configurados para round-robin de negociaciones.")

    online_pool = _online_pool_users(client, pool=pool, logger=logger)
    if not online_pool:
        raise NoOnlineSellersError(pool)

    legacy_filter = _legacy_bucket_filter(client, province_label=legacy_province_label)
    if contact_id is not None:
        previous_assignment = _latest_pool_assignee_for_contact(
            client,
            pool=online_pool,
            contact_id=contact_id,
            lead_id=lead_id,
            bucket_key=bucket_key,
            bucket_field=bucket_field,
            legacy_filter=legacy_filter,
            logger=logger,
        )
        if previous_assignment is not None:
            assigned_by_id, strategy = previous_assignment
            return AssignmentResolution(
                assigned_by_id=assigned_by_id,
                strategy=strategy,
                configured_pool=pool,
                online_pool=online_pool,
            )

    deals = _list_deals(
        client,
        filter_={
            "=categoryId": config.deal.category_id,
            "@assignedById": list(pool),
            f"={bucket_field}": bucket_key,
        },
        order={"createdTime": "DESC", "id": "DESC"},
        select=["id", "assignedById", "categoryId", "createdTime", bucket_field],
        max_items=1,
    )
    round_robin_strategy = "round_robin"
    if not deals and legacy_filter:
        deals = _list_deals(
            client,
            filter_={
                "=categoryId": config.deal.category_id,
                "@assignedById": list(pool),
                **legacy_filter,
            },
            order={"createdTime": "DESC", "id": "DESC"},
            select=[
                "id",
                "assignedById",
                "categoryId",
                "createdTime",
                *(field.lstrip("=") for field in legacy_filter),
            ],
            max_items=1,
        )
        if deals:
            round_robin_strategy = "legacy_round_robin"
    pool_set = set(pool)
    for deal in deals:
        raw_assignee = deal.get("assignedById")
        if not _is_positive_int(raw_assignee):
            continue
        previous = int(str(raw_assignee))
        if previous not in pool_set:
            continue
        previous_index = pool.index(previous)
        for offset in range(1, len(pool) + 1):
            candidate = pool[(previous_index + offset) % len(pool)]
            if candidate in online_pool:
                return AssignmentResolution(
                    assigned_by_id=candidate,
                    strategy=(
                        "single_seller"
                        if len(pool) == 1
                        else round_robin_strategy
                    ),
                    configured_pool=pool,
                    online_pool=online_pool,
                )

    return AssignmentResolution(
        assigned_by_id=online_pool[0],
        strategy="single_seller" if len(pool) == 1 else "round_robin_initial",
        configured_pool=pool,
        online_pool=online_pool,
    )


def _online_pool_users(
    client: BitrixClient,
    *,
    pool: tuple[int, ...],
    logger: Logger,
) -> tuple[int, ...]:
    users = client.call(
        "user.get",
        {
            "FILTER": {
                "ID": list(pool),
                "ACTIVE": True,
                "IS_ONLINE": "Y",
            }
        },
    )
    if not isinstance(users, list):
        raise RuntimeError("user.get devolvio un payload invalido.")

    online_ids: set[int] = set()
    for user in users:
        if not isinstance(user, dict) or not _is_positive_int(user.get("id") or user.get("ID")):
            continue
        user_id = int(str(user.get("id") or user.get("ID")))
        active = user.get("active", user.get("ACTIVE", True))
        absent = user.get("absent") or user.get("ABSENT")
        is_online = user.get("IS_ONLINE", user.get("is_online", "Y"))
        if active not in (False, "N", "n", 0) and is_online in (True, "Y", "y", 1) and not absent:
            online_ids.add(user_id)

    online_pool = tuple(user_id for user_id in pool if user_id in online_ids)
    logger.info(f"Vendedores online para distribucion: {list(online_pool)}.")
    return online_pool


def _latest_pool_assignee_for_contact(
    client: BitrixClient,
    *,
    pool: tuple[int, ...],
    contact_id: int,
    lead_id: int,
    bucket_key: str,
    bucket_field: str,
    legacy_filter: dict[str, Any],
    logger: Logger,
) -> tuple[int, str] | None:
    logger.info(f"Buscando vendedor recurrente para contacto {contact_id}.")
    deals = _list_deals(
        client,
        filter_={"=contactId": contact_id, f"={bucket_field}": bucket_key},
        order={"createdTime": "DESC", "id": "DESC"},
        select=["id", "leadId", "contactId", "assignedById", "createdTime", bucket_field],
    )
    pool_set = {str(user_id) for user_id in pool}
    for deal in deals:
        if str(deal.get("leadId") or "") == str(lead_id):
            continue
        assigned_by_id = str(deal.get("assignedById") or "")
        if assigned_by_id in pool_set:
            logger.info(f"Contacto {contact_id} reutiliza vendedor {assigned_by_id}.")
            return int(assigned_by_id), "contact_history"
    if legacy_filter:
        legacy_deals = _list_deals(
            client,
            filter_={"=contactId": contact_id, **legacy_filter},
            order={"createdTime": "DESC", "id": "DESC"},
            select=[
                "id",
                "leadId",
                "contactId",
                "assignedById",
                "createdTime",
                *(field.lstrip("=") for field in legacy_filter),
            ],
        )
        for deal in legacy_deals:
            if str(deal.get("leadId") or "") == str(lead_id):
                continue
            assigned_by_id = str(deal.get("assignedById") or "")
            if assigned_by_id in pool_set:
                logger.info(
                    f"Contacto {contact_id} reutiliza vendedor historico {assigned_by_id}."
                )
                return int(assigned_by_id), "legacy_contact_history"
    return None


def _legacy_bucket_filter(
    client: BitrixClient,
    *,
    province_label: str | None,
) -> dict[str, Any]:
    if not province_label:
        return {}
    response = client.call("crm.item.fields", {"entityTypeId": DEAL_ENTITY_TYPE_ID})
    fields = response.get("fields", {}) if isinstance(response, dict) else {}
    province_field = DEAL_ENUM_FIELD_MAPPINGS["province"]
    province_value = _enum_id_for_label(fields.get(province_field, {}), province_label)
    if province_value is None:
        return {}
    return {f"={province_field}": province_value}


def bind_open_line_activities_to_deal(
    client: BitrixClient,
    *,
    lead_id: int,
    contact_id: int | None,
    deal_id: int,
    logger: Logger,
) -> int:
    activity_ids = _list_open_line_activity_ids(
        client,
        owner_type_id=LEAD_ENTITY_TYPE_ID,
        owner_id=lead_id,
    )
    if contact_id is not None:
        activity_ids.extend(
            _list_open_line_activity_ids(
                client,
                owner_type_id=CONTACT_ENTITY_TYPE_ID,
                owner_id=contact_id,
            )
        )

    linked_count = 0
    seen_ids: set[int] = set()
    for activity_id in activity_ids:
        if activity_id in seen_ids:
            continue
        seen_ids.add(activity_id)

        try:
            client.call(
                "crm.activity.binding.add",
                {
                    "activityId": activity_id,
                    "entityTypeId": DEAL_ENTITY_TYPE_ID,
                    "entityId": deal_id,
                },
            )
        except RuntimeError as exc:
            error_text = str(exc)
            if (
                "ACTIVITY_IS_ALREADY_BOUND" in error_text
                or "already bound" in error_text.lower()
            ):
                logger.info(f"Actividad {activity_id} ya estaba vinculada al deal {deal_id}.")
                continue
            logger.error(f"No se pudo vincular actividad {activity_id} al deal {deal_id}: {exc}")
            continue

        linked_count += 1
        logger.info(f"Actividad Open Lines {activity_id} vinculada al deal {deal_id}.")

    return linked_count


def assign_open_line_chats_to_user(
    client: BitrixClient,
    *,
    lead_id: int,
    contact_id: int | None,
    deal_id: int,
    assigned_by_id: int,
    distributable_open_line_ids: tuple[int, ...],
    logger: Logger,
) -> ChatTransferResult:
    chat_ids: list[int] = []
    for entity_type, entity_id in (
        ("lead", lead_id),
        ("contact", contact_id),
        ("deal", deal_id),
    ):
        if entity_id is None:
            continue
        chats = client.call(
            "imopenlines.crm.chat.get",
            {"CRM_ENTITY_TYPE": entity_type, "CRM_ENTITY": entity_id, "ACTIVE_ONLY": "N"},
        )
        if not isinstance(chats, list):
            raise RuntimeError("imopenlines.crm.chat.get devolvio un payload invalido.")
        for chat in chats:
            if isinstance(chat, dict) and _is_positive_int(chat.get("CHAT_ID") or chat.get("chat_id")):
                chat_ids.append(int(str(chat.get("CHAT_ID") or chat.get("chat_id"))))

    found_chat_ids = tuple(dict.fromkeys(chat_ids))
    transferred_chat_ids: list[int] = []
    skipped_chats: list[tuple[int, str]] = []
    for chat_id in found_chat_ids:
        transferable, reason = _open_line_session_transferability(
            client,
            chat_id=chat_id,
            distributable_open_line_ids=distributable_open_line_ids,
            logger=logger,
        )
        if not transferable:
            skipped_chats.append((chat_id, reason))
            continue
        client.call(
            "imopenlines.operator.transfer",
            {"CHAT_ID": chat_id, "USER_ID": assigned_by_id},
        )
        transferred_chat_ids.append(chat_id)
        logger.info(f"Chat Open Lines {chat_id} transferido al vendedor {assigned_by_id}.")
    return ChatTransferResult(
        found_chat_ids=found_chat_ids,
        transferred_chat_ids=tuple(transferred_chat_ids),
        skipped_chats=tuple(skipped_chats),
    )


def _open_line_session_transferability(
    client: BitrixClient,
    *,
    chat_id: int,
    distributable_open_line_ids: tuple[int, ...],
    logger: Logger,
) -> tuple[bool, str]:
    try:
        dialog = client.call("imopenlines.dialog.get", {"CHAT_ID": chat_id})
    except RuntimeError as exc:
        logger.error(f"No se pudo inspeccionar el chat Open Lines {chat_id}: {exc}")
        return False, "inspection_error"
    if not isinstance(dialog, dict):
        logger.error(f"imopenlines.dialog.get devolvio un payload invalido para el chat {chat_id}.")
        return False, "invalid_dialog"

    open_line_id = _open_line_id(dialog)
    if open_line_id is None:
        logger.error(
            f"Chat Open Lines {chat_id} sin identificador de linea valido; "
            "se omite por seguridad."
        )
        return False, "non_distributable_open_line"
    if open_line_id not in distributable_open_line_ids:
        logger.info(
            f"Chat Open Lines {chat_id} omitido: linea {open_line_id} no habilitada "
            "para distribucion comercial."
        )
        return False, "non_distributable_open_line"

    entity_data = str(dialog.get("entity_data_1") or dialog.get("ENTITY_DATA_1") or "")
    parts = entity_data.split("|")
    session_id = parts[5] if len(parts) > 5 else ""
    text_enabled = dialog.get("text_field_enabled", dialog.get("TEXT_FIELD_ENABLED", False))
    has_session = _is_positive_int(session_id) and text_enabled in (True, "Y", "y", 1)
    if not has_session:
        logger.info(f"Chat Open Lines {chat_id} sin sesion actual transferible; se omite.")
        return False, "no_current_transferable_session"
    return True, "transferable"


def _open_line_id(dialog: dict[str, Any]) -> int | None:
    entity_id = str(dialog.get("entity_id") or dialog.get("ENTITY_ID") or "")
    parts = entity_id.split("|")
    if len(parts) < 2 or not _is_positive_int(parts[1]):
        return None
    return int(parts[1])


def notify_distribution_supervisor(
    client: BitrixClient,
    config: AppConfig,
    *,
    deal_id: int,
    deal_title: str,
    bucket_label: str,
    assigned_by_id: int,
    assigned_by_name: str | None = None,
    action: str,
    chat_transferred: bool,
    logger: Logger,
) -> bool:
    recipient_id = config.deal.distribution_notification_user_id
    deal_url = f"{_portal_base_url(config.base_url)}/crm/deal/details/{deal_id}/"
    safe_deal_title = _notification_text(deal_title) or f"Negociacion #{deal_id}"
    action_label = {
        "approved": "Aprobada",
        "manual_review": "Revisión manual",
        "rejected": "Rechazada",
    }.get(action, _notification_text(action))
    assignee_name = assigned_by_name or user_display_name(
        client, assigned_by_id=assigned_by_id, logger=logger
    )
    chat_label = "Sí" if chat_transferred else "No"
    message = (
        "[B]Nueva negociación comercial asignada[/B]\n"
        f"Nombre: {safe_deal_title}\n"
        f"Negociacion: [URL={deal_url}]#{deal_id}[/URL]\n"
        f"Bucket: {_notification_text(bucket_label)}\n"
        f"Resultado: {action_label}\n"
        f"Responsable: [USER={assigned_by_id}]{assignee_name}[/USER]\n"
        f"Chat transferido: {chat_label}"
    )
    message_out = (
        f"Nueva negociación comercial asignada. Nombre: {safe_deal_title}. "
        f"Negociacion #{deal_id}. Bucket: {_notification_text(bucket_label)}. "
        f"Resultado: {action_label}. "
        f"Responsable: {assignee_name}. Chat transferido: {chat_label}. {deal_url}"
    )
    try:
        notification_id = client.call(
            "im.notify.system.add",
            {
                "USER_ID": recipient_id,
                "MESSAGE": message,
                "MESSAGE_OUT": message_out,
            },
        )
    except RuntimeError as exc:
        logger.error(
            f"No se pudo notificar la distribucion de la negociacion {deal_id} "
            f"al usuario {recipient_id}: {exc}"
        )
        return False

    logger.info(
        f"Notificacion {notification_id} enviada al usuario {recipient_id} "
        f"por la negociacion {deal_id}."
    )
    return True


def notify_unmatched_routing(
    client: BitrixClient,
    config: AppConfig,
    *,
    deal_id: int,
    deal_title: str,
    province: str,
    reason: str,
    logger: Logger,
) -> bool:
    recipient_id = config.deal.distribution_notification_user_id
    deal_url = f"{_portal_base_url(config.base_url)}/crm/deal/details/{deal_id}/"
    safe_deal_title = _notification_text(deal_title) or f"Negociacion #{deal_id}"
    province_label = _notification_text(province) or "Sin datos"
    reason_label = {
        "no_matching_bucket": "No hay un bucket configurado para estos datos",
        "missing_routing_data": "Faltan datos para determinar el bucket",
    }.get(reason, _notification_text(reason))
    message = (
        "[B]Negociacion sin bucket de distribucion[/B]\n"
        f"Nombre: {safe_deal_title}\n"
        f"Negociacion: [URL={deal_url}]#{deal_id}[/URL]\n"
        f"Provincia: {province_label}\n"
        f"Motivo: {reason_label}\n"
        "No se asigno vendedor ni se transfirio el chat."
    )
    message_out = (
        f"Negociacion sin bucket de distribucion. Nombre: {safe_deal_title}. "
        f"Negociacion #{deal_id}. Provincia: {province_label}. Motivo: {reason_label}. "
        f"No se asigno vendedor ni se transfirio el chat. {deal_url}"
    )
    try:
        notification_id = client.call(
            "im.notify.system.add",
            {"USER_ID": recipient_id, "MESSAGE": message, "MESSAGE_OUT": message_out},
        )
    except RuntimeError as exc:
        logger.error(
            f"No se pudo notificar la falta de bucket de la negociacion {deal_id} "
            f"al usuario {recipient_id}: {exc}"
        )
        return False

    logger.info(
        f"Notificacion {notification_id} enviada al usuario {recipient_id} "
        f"por negociacion {deal_id} sin bucket."
    )
    return True


def user_display_name(
    client: BitrixClient,
    *,
    assigned_by_id: int,
    logger: Logger,
) -> str:
    try:
        users = client.call("user.get", {"FILTER": {"ID": [assigned_by_id]}})
    except RuntimeError as exc:
        logger.error(f"No se pudo obtener el nombre del vendedor {assigned_by_id}: {exc}")
        return f"Usuario {assigned_by_id}"

    if isinstance(users, list) and users and isinstance(users[0], dict):
        user = users[0]
        full_name = " ".join(
            part.strip()
            for part in (str(user.get("NAME") or ""), str(user.get("LAST_NAME") or ""))
            if part.strip()
        )
        if full_name:
            return _notification_text(full_name)
    return f"Usuario {assigned_by_id}"


def _notification_text(value: object) -> str:
    return str(value or "").replace("[", "(").replace("]", ")").strip()


def _portal_base_url(api_base_url: str) -> str:
    base_url = api_base_url.rstrip("/")
    if base_url.lower().endswith("/rest"):
        return base_url[:-5]
    return base_url


def _list_open_line_activity_ids(
    client: BitrixClient,
    *,
    owner_type_id: int,
    owner_id: int,
) -> list[int]:
    activities: list[dict[str, Any]] = []
    start = 0

    while True:
        response = client.call_full(
            "crm.activity.list",
            {
                "filter": {
                    "OWNER_TYPE_ID": owner_type_id,
                    "OWNER_ID": owner_id,
                    "PROVIDER_ID": OPEN_LINE_ACTIVITY_PROVIDER_ID,
                },
                "select": ["ID", "PROVIDER_ID", "OWNER_TYPE_ID", "OWNER_ID"],
                "order": {"ID": "DESC"},
                "start": start,
            },
        )
        result = response.get("result") or []
        if not isinstance(result, list):
            raise RuntimeError("crm.activity.list devolvio un payload invalido.")
        activities.extend(activity for activity in result if isinstance(activity, dict))

        next_page = response.get("next")
        if next_page is None:
            break
        start = int(next_page)

    ids: list[int] = []
    for activity in activities:
        activity_id = activity.get("ID") or activity.get("id")
        if _is_positive_int(activity_id):
            ids.append(int(str(activity_id)))
    return ids


def _list_deals(
    client: BitrixClient,
    *,
    filter_: dict[str, Any],
    order: dict[str, str],
    select: list[str],
    max_items: int | None = None,
) -> list[dict[str, Any]]:
    deals: list[dict[str, Any]] = []
    start = 0

    while True:
        response = client.call_full(
            "crm.item.list",
            {
                "entityTypeId": DEAL_ENTITY_TYPE_ID,
                "filter": filter_,
                "order": order,
                "select": select,
                "start": start,
            },
        )
        result = response.get("result")
        if isinstance(result, dict):
            items = result.get("items") or []
        else:
            items = result or []
        if not isinstance(items, list):
            raise RuntimeError("crm.item.list devolvio un payload invalido.")
        deals.extend(item for item in items if isinstance(item, dict))
        if max_items is not None and len(deals) >= max_items:
            return deals[:max_items]

        next_page = response.get("next")
        if next_page is None and isinstance(result, dict):
            next_page = result.get("next")
        if next_page is None:
            break
        start = int(next_page)

    return deals


def _build_deal_fields(
    client: BitrixClient,
    config: AppConfig,
    lead: dict[str, Any],
    *,
    lead_id: int,
    contact_id: int | None,
    assigned_by_id: int,
    stage_id: str | None,
    logger: Logger,
) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "title": _deal_title(lead, lead_id),
        "categoryId": config.deal.category_id,
        "stageId": stage_id or config.deal.stage_id,
        "leadId": lead_id,
        "assignedById": assigned_by_id,
    }
    if contact_id is not None:
        fields["contactId"] = contact_id

    for lead_field, deal_field in (
        ("SOURCE_ID", "sourceId"),
        ("SOURCE_DESCRIPTION", "sourceDescription"),
        ("UTM_SOURCE", "utmSource"),
        ("UTM_MEDIUM", "utmMedium"),
        ("UTM_CAMPAIGN", "utmCampaign"),
        ("UTM_TERM", "utmTerm"),
        ("UTM_CONTENT", "utmContent"),
    ):
        value = lead.get(lead_field)
        if value:
            fields[deal_field] = value

    _copy_custom_lead_fields_to_deal(client, config, lead, fields)
    _copy_receipt_file_to_deal(client, config, lead, fields, lead_id=lead_id, logger=logger)
    return fields


def _copy_custom_lead_fields_to_deal(
    client: BitrixClient,
    config: AppConfig,
    lead: dict[str, Any],
    fields: dict[str, Any],
) -> None:
    for lead_field, deal_field in _direct_custom_field_pairs(config):
        value = lead.get(lead_field or "")
        if _has_value(value):
            fields[deal_field] = value

    enum_pairs = [
        (lead_field, deal_field)
        for lead_field, deal_field in _enum_custom_field_pairs(config)
        if _has_value(lead.get(lead_field or ""))
    ]
    if not enum_pairs:
        return

    lead_fields = client.call("crm.lead.fields", {})
    deal_fields_response = client.call(
        "crm.item.fields",
        {"entityTypeId": DEAL_ENTITY_TYPE_ID},
    )
    deal_fields = (
        deal_fields_response.get("fields", {})
        if isinstance(deal_fields_response, dict)
        else {}
    )

    es_socio_label: str | None = None
    for lead_field, deal_field in enum_pairs:
        label = _enum_label_for_value(lead_fields.get(lead_field, {}), lead.get(lead_field))
        if label is None:
            continue
        deal_value = _enum_id_for_label(deal_fields.get(deal_field, {}), label)
        if deal_value is None:
            continue
        fields[deal_field] = _deal_field_value(deal_fields.get(deal_field, {}), deal_value)
        if deal_field == DEAL_ENUM_FIELD_MAPPINGS["es_socio"]:
            es_socio_label = label

    if es_socio_label is not None:
        socio_nuevo_label = _socio_nuevo_label(es_socio_label)
        if socio_nuevo_label is not None:
            socio_nuevo_id = _enum_id_for_label(
                deal_fields.get(DEAL_SOCIO_NUEVO_FIELD, {}),
                socio_nuevo_label,
            )
            if socio_nuevo_id is not None:
                fields[DEAL_SOCIO_NUEVO_FIELD] = _deal_field_value(
                    deal_fields.get(DEAL_SOCIO_NUEVO_FIELD, {}),
                    socio_nuevo_id,
                )


def _copy_receipt_file_to_deal(
    client: BitrixClient,
    config: AppConfig,
    lead: dict[str, Any],
    fields: dict[str, Any],
    *,
    lead_id: int,
    logger: Logger,
) -> None:
    lead_receipt_field = config.fields.lead_recibo_file
    if not lead_receipt_field or not _has_value(lead.get(lead_receipt_field)):
        return

    try:
        result = client.call(
            "crm.item.get",
            {
                "entityTypeId": LEAD_ENTITY_TYPE_ID,
                "id": lead_id,
            },
        )
        item = result.get("item") if isinstance(result, dict) else None
        if not isinstance(item, dict):
            raise RuntimeError("crm.item.get no devolvio el lead esperado.")

        dynamic_field = _dynamic_user_field_name(lead_receipt_field)
        descriptor = _first_file_descriptor(item.get(dynamic_field))
        machine_url = str(descriptor.get("urlMachine") or "").strip()
        if not machine_url:
            raise RuntimeError("Bitrix24 no devolvio urlMachine para el recibo.")

        file_data = build_bitrix_file_data(
            machine_url,
            timeout_seconds=config.timeout_seconds,
        )
        fields[DEAL_DIRECT_FIELD_MAPPINGS["receipt"]] = file_data["fileData"]
    except Exception as exc:
        logger.error(f"No se pudo copiar el recibo del lead {lead_id} al deal: {exc}")


def _direct_custom_field_pairs(config: AppConfig) -> tuple[tuple[str | None, str], ...]:
    return (
        (config.fields.lead_cuil, DEAL_DIRECT_FIELD_MAPPINGS["cuil"]),
        (config.fields.lead_bcra_status, DEAL_DIRECT_FIELD_MAPPINGS["bcra_status"]),
        (config.fields.lead_bcra_result, DEAL_DIRECT_FIELD_MAPPINGS["bcra_result"]),
        (config.fields.lead_bcra_data_raw, DEAL_DIRECT_FIELD_MAPPINGS["bcra_data_raw"]),
        (config.fields.lead_bcra_checked_at, DEAL_DIRECT_FIELD_MAPPINGS["bcra_checked_at"]),
        (config.fields.lead_contact_birthdate, DEAL_DIRECT_FIELD_MAPPINGS["contact_birthdate"]),
        (config.fields.lead_vimarx_nro_socio, DEAL_DIRECT_FIELD_MAPPINGS["vimarx_nro_socio"]),
        (
            config.fields.lead_vimarx_creditos_activos_count,
            DEAL_DIRECT_FIELD_MAPPINGS["vimarx_creditos_activos_count"],
        ),
        (
            config.fields.lead_vimarx_creditos_activos_detail,
            DEAL_DIRECT_FIELD_MAPPINGS["vimarx_creditos_activos_detail"],
        ),
        (
            config.fields.lead_vimarx_creditos_activos_raw,
            DEAL_DIRECT_FIELD_MAPPINGS["vimarx_creditos_activos_raw"],
        ),
        (config.fields.lead_credixsa_status, DEAL_DIRECT_FIELD_MAPPINGS["credixsa_status"]),
        (
            config.fields.lead_credixsa_checked_at,
            DEAL_DIRECT_FIELD_MAPPINGS["credixsa_checked_at"],
        ),
        (
            config.fields.lead_credixsa_employer_name,
            DEAL_DIRECT_FIELD_MAPPINGS["credixsa_employer_name"],
        ),
        (
            config.fields.lead_credixsa_employer_cuit,
            DEAL_DIRECT_FIELD_MAPPINGS["credixsa_employer_cuit"],
        ),
        (
            config.fields.lead_credixsa_employer_count,
            DEAL_DIRECT_FIELD_MAPPINGS["credixsa_employer_count"],
        ),
        (
            config.fields.lead_credixsa_employer_periods,
            DEAL_DIRECT_FIELD_MAPPINGS["credixsa_employer_periods"],
        ),
        (config.fields.lead_credixsa_alerts, DEAL_DIRECT_FIELD_MAPPINGS["credixsa_alerts"]),
    )


def _enum_custom_field_pairs(config: AppConfig) -> tuple[tuple[str | None, str], ...]:
    return (
        (config.fields.lead_province, DEAL_ENUM_FIELD_MAPPINGS["province"]),
        (config.fields.lead_employment_status, DEAL_ENUM_FIELD_MAPPINGS["employment_status"]),
        (config.fields.lead_payment_bank, DEAL_ENUM_FIELD_MAPPINGS["payment_bank"]),
        (config.fields.lead_source, DEAL_ENUM_FIELD_MAPPINGS["source"]),
        (config.fields.lead_processing_policy, DEAL_ENUM_FIELD_MAPPINGS["processing_policy"]),
        (config.fields.lead_commercial_owner, DEAL_ENUM_FIELD_MAPPINGS["commercial_owner"]),
        (config.fields.lead_es_socio, DEAL_ENUM_FIELD_MAPPINGS["es_socio"]),
    )


def _enum_label_for_value(field_meta: dict[str, Any], raw_value: Any) -> str | None:
    value = _first_scalar(raw_value)
    if value is None:
        return None
    for item in field_meta.get("items") or []:
        if str(item.get("ID") or "") == str(value):
            label = str(item.get("VALUE") or "").strip()
            return label or None
    return None


def _enum_id_for_label(field_meta: dict[str, Any], label: str) -> str | None:
    normalized_label = _normalize_label(label)
    for item in field_meta.get("items") or []:
        item_label = str(item.get("VALUE") or "")
        if _normalize_label(item_label) == normalized_label:
            value = str(item.get("ID") or "").strip()
            return value or None
    return None


def _deal_field_value(field_meta: dict[str, Any], value: str) -> str | list[str]:
    if field_meta.get("isMultiple") is True:
        return [value]
    return value


def _socio_nuevo_label(es_socio_label: str) -> str | None:
    normalized_label = _normalize_label(es_socio_label)
    if normalized_label == "si":
        return "NO"
    if normalized_label == "no":
        return "SI"
    return None


def _normalize_label(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", str(value).strip().casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _first_scalar(raw_value: Any) -> Any | None:
    if isinstance(raw_value, (list, tuple)):
        for item in raw_value:
            if _has_value(item):
                return item
        return None
    return raw_value if _has_value(raw_value) else None


def _first_file_descriptor(raw_value: Any) -> dict[str, Any]:
    if isinstance(raw_value, dict):
        return raw_value
    if isinstance(raw_value, (list, tuple)):
        for value in raw_value:
            if isinstance(value, dict):
                return value
    raise RuntimeError("Bitrix24 devolvio un descriptor de archivo invalido.")


def _dynamic_user_field_name(field_name: str) -> str:
    normalized = str(field_name).strip()
    if normalized.startswith("UF_CRM_"):
        return f"ufCrm_{normalized[len('UF_CRM_'):]}"
    return normalized


def _has_value(raw_value: Any) -> bool:
    if raw_value is None:
        return False
    if isinstance(raw_value, str):
        return raw_value.strip() != ""
    if isinstance(raw_value, (list, tuple)):
        return any(_has_value(item) for item in raw_value)
    return True


def _deal_title(lead: dict[str, Any], lead_id: int) -> str:
    title = str(lead.get("TITLE") or "").strip()
    if title:
        return title

    full_name = " ".join(
        part
        for part in (
            str(lead.get("NAME") or "").strip(),
            str(lead.get("LAST_NAME") or "").strip(),
        )
        if part
    )
    return full_name or f"Lead {lead_id}"


def _deal_url(base_url: str, deal_id: int) -> str:
    normalized_base_url = str(base_url).rstrip("/")
    rest_index = normalized_base_url.find("/rest")
    portal_url = (
        normalized_base_url[:rest_index]
        if rest_index >= 0
        else normalized_base_url
    )
    return f"{portal_url}/crm/deal/details/{deal_id}/"


def _required_int(raw_value: Any, field_name: str) -> int:
    if not _is_positive_int(raw_value):
        raise RuntimeError(f'Bitrix24 devolvio un "{field_name}" invalido para la negociacion.')
    return int(str(raw_value))


def _is_positive_int(raw_value: Any) -> bool:
    try:
        return int(str(raw_value)) > 0
    except (TypeError, ValueError):
        return False
