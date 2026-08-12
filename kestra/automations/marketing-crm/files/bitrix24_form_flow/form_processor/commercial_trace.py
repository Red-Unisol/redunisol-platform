from __future__ import annotations


TRACE_SCHEMA_VERSION = "deal-commercial-trace.v1"


REASON_LABELS = {
    "amejuca_premium": "Cumple las condiciones BCRA de AMEJUCA Premium.",
    "amejuca_special": "El perfil BCRA corresponde a la línea AMEJUCA Especial.",
    "amejuca_line_ambiguous_for_payment_bank_two": "Los datos no permiten elegir con certeza entre AMEJUCA Premium y Especial.",
    "bcra_more_than_four_high_risk_situations": "Tiene más de cuatro entidades con situación BCRA de riesgo.",
    "payment_bank_situation_above_two": "El banco de cobro está en situación BCRA mayor a 2.",
    "cordoba_bank_situation_above_one": "Bancor está en situación BCRA 2 o superior.",
    "cde_more_than_two_high_risk_situations": "Tiene más de dos entidades con situación BCRA entre 2 y 3.",
    "cde_premium": "Cumple las condiciones de la línea Cruz del Eje Premium.",
    "cde_special": "Cumple las condiciones de la línea Cruz del Eje Especial.",
    "cde_ren_premium": "Cumple las condiciones de renovación Cruz del Eje Premium.",
    "cde_ren_special": "Cumple las condiciones de renovación Cruz del Eje Especial.",
    "cde_parallel_requires_manual_review": "Tiene más de un préstamo activo de la familia Cruz del Eje.",
    "cde_active_loan_in_arrears": "Tiene un préstamo Cruz del Eje activo con días de atraso.",
    "cbu_more_than_five_entities": "Tiene más de cinco entidades informadas en BCRA.",
    "cbu_situation_above_one": "Tiene al menos una entidad en situación BCRA mayor a 1.",
    "cbu_passive_age_80_or_more": "La persona jubilada o pensionada tiene 80 años o más.",
    "cbu_gender_required_for_age_limit": "Falta el género necesario para aplicar el límite de edad de la línea CBU.",
    "cbu_approved": "Cumple las condiciones de edad y BCRA de la línea CBU.",
    "caja_age_80_or_more": "La persona tiene 80 años o más.",
    "caja_new_payment_bank_above_one": "Es cliente nuevo y el banco de cobro está en situación BCRA mayor a 1.",
    "caja_morosos_payment_bank_above_one": "El banco de cobro está en situación BCRA mayor a 1 para Caja Morosos.",
    "caja_morosos_excluded_entity": "Tiene una entidad excluida en situación BCRA 4 o 5; requiere revisión comercial.",
    "caja_morosos_parallel_minimum_not_met": "Tiene un préstamo Caja activo con menos de cuatro cuotas pagadas.",
    "caja_irregular_parallel_minimum_not_met": "Tiene un préstamo Caja activo con menos de cuatro cuotas pagadas.",
    "caja_general_parallel_minimum_not_met": "Tiene un préstamo Caja activo sin la primera cuota pagada.",
    "caja_morosos": "Cumple las condiciones de Caja Morosos.",
    "caja_irregulares": "Cumple las condiciones de Caja Irregulares.",
    "caja_general": "Cumple las condiciones de Caja General.",
    "caja_nuevo": "Cumple las condiciones de Caja para clientes nuevos.",
    "club_mutual_cbu": "Cumple las condiciones de Club Mutual CBU.",
    "unc_activity_not_verifiable": "No se pudo confirmar que sea socio activo de Club Mutual.",
    "unc_gender_required_for_age_limit": "Falta el género necesario para aplicar el límite de edad de la línea UNC.",
    "unc_more_than_three_high_risk_situations": "Tiene más de tres entidades con situación BCRA entre 2 y 3.",
    "unc_banco_nacion_irregular": "Banco Nación está en situación BCRA mayor a 1.",
    "daspu_form_691_or_limit_not_available": "Falta validar el formulario 691 o el límite disponible de DASPU.",
    "missing_birthdate": "No se pudo determinar la edad porque falta la fecha de nacimiento.",
    "missing_vimarx_credit_data": "Faltan datos de préstamos de Vimarx para decidir automáticamente.",
    "missing_bcra_snapshot": "No hay información BCRA suficiente para decidir automáticamente.",
    "bcra_snapshot_not_conclusive": "La consulta BCRA no produjo información concluyente.",
    "bcra_refresh_missing_cuil": "No se pudo actualizar BCRA porque falta el CUIL.",
    "bcra_refresh_failed": "No fue posible actualizar BCRA; el dato anterior no se utilizó.",
    "payment_bank_not_identifiable": "No se pudo identificar el banco de cobro dentro de la información BCRA.",
    "missing_recurrent_membership_data": "Falta información para evaluar la renovación automáticamente.",
    "missing_membership_data": "No se pudo confirmar si es socio nuevo o recurrente.",
    "missing_prequalification_data": "Faltan datos de la precalificación necesarios para evaluar la negociación.",
    "unsupported_cordoba_employment_status": "La situación laboral no tiene una regla comercial automática en Córdoba.",
    "province_not_supported_for_deal_classification": "La provincia no tiene clasificación comercial automática.",
    "missing_routing_data": "Faltan provincia o situación laboral para determinar el grupo de distribución.",
    "no_matching_bucket": "No existe un grupo de distribución configurado para esos datos.",
    "outside_business_hours": "La negociación ingresó fuera del horario de distribución automática.",
    "no_online_sellers": "No había vendedores del grupo conectados en Bitrix.",
    "deal_not_pending": "La negociación ya había salido de la etapa pendiente cuando Kestra la revisó.",
    "internal_error": "La ejecución no pudo completar el procesamiento.",
}


def business_decision(
    action: str,
    commercial_line: str | None,
    assigned_by_id: int | None,
) -> str:
    if action == "approved":
        return f"Asignado a la línea {commercial_line or 'comercial definida'}"
    if action in {"rejected", "commercial_rejected"}:
        return "Rechazado"
    if action == "manual_review":
        return "Enviado a revisión manual con Maru" if assigned_by_id == 57 else "Enviado a revisión manual"
    if action == "routing_review":
        return "Enviado a revisión de enrutamiento"
    if action == "error":
        return "Procesamiento incompleto"
    if action == "skipped":
        return "Sin cambios"
    if action == "selected":
        return "Seleccionado para procesamiento"
    return "Sin decisión comercial"


def business_reason(reason: str, message: str) -> str:
    return REASON_LABELS.get(reason) or message or (
        f"Motivo pendiente de descripción comercial: {reason}." if reason else "Sin información suficiente."
    )
