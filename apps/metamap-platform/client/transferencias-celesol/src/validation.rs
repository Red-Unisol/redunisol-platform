use rust_decimal::Decimal;

use crate::cancellations;
use crate::models::{
    CoinagTransferGuard, CoreSnapshot, MetamapSnapshot, TransferAmountOutcome, ValidationReport,
    ValidationSnapshot,
};

pub fn normalize_digits(value: impl AsRef<str>) -> Option<String> {
    let digits: String = value
        .as_ref()
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    if digits.is_empty() {
        None
    } else {
        Some(digits)
    }
}

pub fn parse_decimal(value: &str) -> Option<Decimal> {
    let raw = value.trim();
    if raw.is_empty() {
        return None;
    }
    let mut filtered: String = raw
        .chars()
        .filter(|ch| ch.is_ascii_digit() || matches!(ch, ',' | '.'))
        .collect();
    if filtered.is_empty() {
        return None;
    }
    if filtered.contains(',') && filtered.contains('.') {
        filtered = filtered.replace('.', "");
        filtered = filtered.replace(',', ".");
    } else if filtered.matches('.').count() > 1 && !filtered.contains(',') {
        let mut parts = filtered.split('.').collect::<Vec<_>>();
        let decimals = parts.pop()?;
        filtered = format!("{}.{}", parts.join(""), decimals);
    } else if filtered.matches(',').count() > 1 && !filtered.contains('.') {
        let mut parts = filtered.split(',').collect::<Vec<_>>();
        let decimals = parts.pop()?;
        filtered = format!("{}.{}", parts.join(""), decimals);
    } else if filtered.contains(',') && !filtered.contains('.') {
        filtered = filtered.replace(',', ".");
    }
    Decimal::from_str_exact(&filtered).ok()
}

pub fn format_money(value: Decimal) -> String {
    let amount = value.round_dp(2);
    let negative = amount.is_sign_negative();
    let normalized = amount.abs().to_string();
    let mut parts = normalized.split('.').collect::<Vec<_>>();
    let integer_part = parts.remove(0);
    let decimal_part = parts.first().copied().unwrap_or("00");
    let decimal_part = format!("{decimal_part:0<2}");
    let mut groups = Vec::new();
    let mut remaining = integer_part.to_owned();
    while !remaining.is_empty() {
        let split_at = remaining.len().saturating_sub(3);
        groups.push(remaining[split_at..].to_owned());
        remaining.truncate(split_at);
    }
    groups.reverse();
    let prefix = if negative { "-$" } else { "$" };
    format!("{prefix} {},{}", groups.join("."), &decimal_part[..2])
}

pub fn has_third_party_destination(core: &CoreSnapshot) -> bool {
    let needs_destination = !cancellations::is_candidate(core)
        || core
            .cash_in_hand_amount
            .is_some_and(|amount| !amount.is_zero());
    needs_destination
        && matches!(
            (
                core.request_cuil.as_deref().and_then(normalize_digits),
                core.coinag_cuil.as_deref().and_then(normalize_digits),
            ),
            (Some(request), Some(holder)) if request != holder
        )
}

pub fn build_validation_report(
    server_validation: &ValidationSnapshot,
    metamap: &MetamapSnapshot,
    core: &CoreSnapshot,
    transfer_guard: &CoinagTransferGuard,
) -> ValidationReport {
    let mut blockers = Vec::new();
    let mut warnings = Vec::new();
    let has_metamap_validation = server_validation.has_completed_validation();
    let is_cancellation = cancellations::is_candidate(core);
    let transfer_amount_resolution = core.transfer_amount_resolution();

    match transfer_guard {
        CoinagTransferGuard::Unknown | CoinagTransferGuard::NotFound => {}
        CoinagTransferGuard::YaTransferida => blockers.push("YA TRANSFERIDA".to_owned()),
        CoinagTransferGuard::EnProceso => blockers.push("EN PROCESO".to_owned()),
        CoinagTransferGuard::Error { .. } => blockers.push("ERROR".to_owned()),
    }

    if !has_metamap_validation {
        warnings.push("No existe validacion MetaMap completed asociada en el server.".to_owned());
    }

    if has_metamap_validation && server_validation.match_count > 1 {
        warnings.push(format!(
            "El server devolvio {} validaciones completed para esta solicitud; se usa la mas reciente.",
            server_validation.match_count
        ));
    }

    if has_metamap_validation {
        if metamap.request_number.is_none() {
            blockers
                .push("La validacion MetaMap del server no expone numero de solicitud.".to_owned());
        }
        if metamap.document.is_none() {
            blockers
                .push("La validacion MetaMap del server no expone numero de documento.".to_owned());
        }
        if metamap.amount.is_none() {
            blockers
                .push("La validacion MetaMap del server no expone monto interpretable.".to_owned());
        }
    }

    match core.request_status.as_deref() {
        Some("A Transferir") => {}
        Some(other) => blockers.push(format!(
            "Estado.Descripcion en core financiero es '{other}', no 'A Transferir'."
        )),
        None => blockers
            .push("No se pudo obtener Estado.Descripcion desde el core financiero.".to_owned()),
    }

    if core.transfer_cbu.is_none()
        && (!is_cancellation
            || core
                .cash_in_hand_amount
                .is_some_and(|amount| !amount.is_zero()))
    {
        blockers.push("No existe Prestamo.[CBU transferencia] en el core financiero.".to_owned());
    }

    if is_cancellation {
        blockers.extend(cancellations::build_plan(core).blockers);
    } else {
        match transfer_amount_resolution.outcome {
            TransferAmountOutcome::Exact => {}
            TransferAmountOutcome::Renovacion => {
                if let Some(detail) = transfer_amount_resolution.detail {
                    warnings.push(detail);
                }
            }
            TransferAmountOutcome::Error => {
                if let Some(detail) = transfer_amount_resolution.detail {
                    blockers.push(detail);
                }
            }
        }
    }

    if has_metamap_validation {
        if let Some(validation_request_number) = server_validation.request_number.as_deref() {
            if validation_request_number.trim() != core.request_oid.trim() {
                blockers.push(format!(
                    "La validacion del server corresponde a la solicitud {}, no a {}.",
                    validation_request_number.trim(),
                    core.request_oid.trim()
                ));
            }
        }

        if let Some(metamap_request_number) = metamap.request_number.as_deref() {
            if metamap_request_number.trim() != core.request_oid.trim() {
                blockers.push(format!(
                    "Numero de solicitud inconsistente entre MetaMap ({}) y core ({}).",
                    metamap_request_number.trim(),
                    core.request_oid.trim()
                ));
            }
        }

        match (
            metamap.document.as_deref().and_then(normalize_digits),
            core.request_document.as_deref().and_then(normalize_digits),
        ) {
            (Some(metamap_document), Some(core_document)) if metamap_document == core_document => {}
            (Some(metamap_document), Some(core_document)) => blockers.push(format!(
                "Documento no coincide entre MetaMap ({metamap_document}) y core ({core_document})."
            )),
            _ => blockers.push(
                "No se pudo validar el documento entre MetaMap y core financiero.".to_owned(),
            ),
        }

        match (metamap.amount, core.request_amount) {
            (Some(metamap_amount), Some(core_amount)) if metamap_amount == core_amount => {}
            (Some(metamap_amount), Some(core_amount)) => blockers.push(format!(
                "Monto no coincide entre MetaMap ({}) y core ({}).",
                format_money(metamap_amount),
                format_money(core_amount),
            )),
            _ => blockers.push("No se pudo validar el monto contra el core financiero.".to_owned()),
        }
    }

    let document_cuil = core.document_cuil.as_deref().and_then(normalize_digits);
    let request_cuil = core.request_cuil.as_deref().and_then(normalize_digits);
    let coinag_cuil = core.coinag_cuil.as_deref().and_then(normalize_digits);

    if document_cuil.is_none() {
        blockers.push("No se pudo obtener CUIL/CUIT del core por DNI.".to_owned());
    }
    if request_cuil.is_none() {
        blockers.push("No se pudo obtener CUIL/CUIT del core por solicitud.".to_owned());
    }
    let needs_member_destination = !is_cancellation
        || core
            .cash_in_hand_amount
            .is_some_and(|amount| !amount.is_zero());
    if needs_member_destination && coinag_cuil.as_ref().is_none_or(|cuit| cuit.len() != 11) {
        blockers.push("No se pudo validar titularidad del CBU en Coinag via CUIL.".to_owned());
    }
    if needs_member_destination && core.transfer_cbu.is_some() {
        match core.coinag_account_type_is_pesos_transfer_compatible() {
            Some(true) => {}
            Some(false) => {
                let account_type = core
                    .coinag_account_type_display()
                    .unwrap_or_else(|| "N/D".to_owned());
                blockers.push(format!(
                    "Tipo de cuenta Coinag no compatible con transferencia en pesos: {account_type}."
                ));
            }
            None => blockers
                .push("No se pudo validar moneda/tipo de cuenta del CBU en Coinag.".to_owned()),
        }
    }

    if let (Some(document_cuil), Some(request_cuil)) = (&document_cuil, &request_cuil) {
        if document_cuil != request_cuil {
            blockers.push(format!(
                "CUIL/CUIT inconsistente entre lookup por DNI ({document_cuil}) y por solicitud ({request_cuil})."
            ));
        }
    }

    if needs_member_destination
        && let (Some(request_cuil), Some(coinag_cuil)) = (&request_cuil, &coinag_cuil)
    {
        if request_cuil != coinag_cuil {
            warnings.push(format!(
                "El CBU pertenece a un tercero: solicitante {request_cuil}, titular de la cuenta {coinag_cuil}. Transferencia automatica bloqueada; requiere confirmacion manual escribiendo TRANSFERIR."
            ));
        }
    }

    ValidationReport {
        disabled: false,
        blockers,
        warnings,
    }
}

#[cfg(test)]
mod tests {
    use rust_decimal::Decimal;

    use super::build_validation_report;
    use crate::models::{CoinagTransferGuard, CoreSnapshot, MetamapSnapshot, ValidationSnapshot};

    fn valid_core_snapshot() -> CoreSnapshot {
        CoreSnapshot {
            request_oid: "123".to_owned(),
            request_status: Some("A Transferir".to_owned()),
            request_amount: Some(Decimal::new(1000, 0)),
            bank_cmf_amount: Some(Decimal::new(1000, 0)),
            request_document: Some("30111222".to_owned()),
            request_cuil: Some("20-30111222-3".to_owned()),
            document_cuil: Some("20-30111222-3".to_owned()),
            transfer_cbu: Some("2850590940090418135201".to_owned()),
            coinag_cuil: Some("20-30111222-3".to_owned()),
            coinag_account_type_code: Some("10".to_owned()),
            coinag_account_type_label: Some("CA Pesos".to_owned()),
            ..Default::default()
        }
    }

    fn completed_validation() -> ValidationSnapshot {
        ValidationSnapshot {
            verification_id: Some("mm-123".to_owned()),
            normalized_status: Some("completed".to_owned()),
            request_number: Some("123".to_owned()),
            ..Default::default()
        }
    }

    #[test]
    fn third_party_owner_warns_but_does_not_remove_other_blockers() {
        let mut core = valid_core_snapshot();
        core.coinag_cuil = Some("27-33444555-6".to_owned());
        let report = build_validation_report(
            &ValidationSnapshot::default(),
            &MetamapSnapshot::default(),
            &core,
            &CoinagTransferGuard::NotFound,
        );
        assert!(super::has_third_party_destination(&core));
        assert!(report.can_transfer());
        assert!(
            report
                .warnings
                .iter()
                .any(|warning| warning.contains("tercero") && warning.contains("TRANSFERIR"))
        );
        core.document_cuil = Some("20-99888777-1".to_owned());
        let blocked = build_validation_report(
            &ValidationSnapshot::default(),
            &MetamapSnapshot::default(),
            &core,
            &CoinagTransferGuard::NotFound,
        );
        assert!(!blocked.can_transfer());
        assert!(
            blocked
                .blockers
                .iter()
                .any(|reason| reason.contains("lookup por DNI"))
        );
    }

    #[test]
    fn unavailable_owner_still_blocks_and_names_do_not_override_cuit_identity() {
        let mut core = valid_core_snapshot();
        core.coinag_holder_name = Some("Nombre con otra ortografia".to_owned());
        assert!(!super::has_third_party_destination(&core));
        core.coinag_cuil = Some("0".to_owned());
        let invalid_owner = build_validation_report(
            &ValidationSnapshot::default(),
            &MetamapSnapshot::default(),
            &core,
            &CoinagTransferGuard::NotFound,
        );
        assert!(!invalid_owner.can_transfer());
        core.coinag_cuil = None;
        let report = build_validation_report(
            &ValidationSnapshot::default(),
            &MetamapSnapshot::default(),
            &core,
            &CoinagTransferGuard::NotFound,
        );
        assert!(!report.can_transfer());
        assert!(
            report
                .blockers
                .iter()
                .any(|reason| reason.contains("titularidad"))
        );
    }

    #[test]
    fn creditors_alone_do_not_trigger_member_third_party_override() {
        let mut core = valid_core_snapshot();
        core.cancellation_amount = Some(Decimal::new(1000, 0));
        core.cash_in_hand_amount = Some(Decimal::ZERO);
        core.coinag_cuil = Some("27-33444555-6".to_owned());
        assert!(!super::has_third_party_destination(&core));
        core.cash_in_hand_amount = Some(Decimal::new(-100, 0));
        assert!(super::has_third_party_destination(&core));
    }

    #[test]
    fn missing_metamap_is_only_a_warning_when_other_checks_pass() {
        let report = build_validation_report(
            &ValidationSnapshot::default(),
            &MetamapSnapshot::default(),
            &valid_core_snapshot(),
            &CoinagTransferGuard::NotFound,
        );

        assert!(report.blockers.is_empty());
        assert_eq!(report.warnings.len(), 1);
        assert!(report.can_transfer());
        assert_eq!(
            report.warnings[0],
            "No existe validacion MetaMap completed asociada en el server."
        );
    }

    #[test]
    fn missing_metamap_does_not_skip_non_metamap_blockers() {
        let mut core = valid_core_snapshot();
        core.request_status = Some("Pendiente".to_owned());
        core.transfer_cbu = None;

        let report = build_validation_report(
            &ValidationSnapshot::default(),
            &MetamapSnapshot::default(),
            &core,
            &CoinagTransferGuard::NotFound,
        );

        assert_eq!(report.warnings.len(), 1);
        assert_eq!(report.blockers.len(), 2);
        assert!(
            report
                .blockers
                .iter()
                .any(|value| value.contains("no 'A Transferir'"))
        );
        assert!(
            report
                .blockers
                .iter()
                .any(|value| value.contains("Prestamo.[CBU transferencia]"))
        );
        assert!(!report.can_transfer());
    }

    #[test]
    fn dollar_account_type_blocks_transfer() {
        let mut core = valid_core_snapshot();
        core.coinag_account_type_code = Some("11".to_owned());
        core.coinag_account_type_label = Some("CA Dolares".to_owned());

        let report = build_validation_report(
            &ValidationSnapshot::default(),
            &MetamapSnapshot::default(),
            &core,
            &CoinagTransferGuard::NotFound,
        );

        assert!(
            report
                .blockers
                .iter()
                .any(|value| value.contains("11 - CA Dolares"))
        );
        assert!(!report.can_transfer());
    }

    #[test]
    fn metamap_cross_checks_still_block_when_validation_exists() {
        let report = build_validation_report(
            &ValidationSnapshot {
                request_number: Some("999".to_owned()),
                ..completed_validation()
            },
            &MetamapSnapshot {
                document: Some("99888777".to_owned()),
                request_number: Some("999".to_owned()),
                amount: Some(Decimal::new(1500, 0)),
                ..Default::default()
            },
            &valid_core_snapshot(),
            &CoinagTransferGuard::NotFound,
        );

        assert!(
            report
                .blockers
                .iter()
                .any(|value| value.contains("La validacion del server corresponde"))
        );
        assert!(
            report
                .blockers
                .iter()
                .any(|value| value.contains("Numero de solicitud inconsistente"))
        );
        assert!(
            report
                .blockers
                .iter()
                .any(|value| value.contains("Documento no coincide"))
        );
        assert!(
            report
                .blockers
                .iter()
                .any(|value| value.contains("Monto no coincide"))
        );
        assert!(!report.can_transfer());
    }

    #[test]
    fn remote_transfer_status_blocks_when_already_transferred() {
        let report = build_validation_report(
            &ValidationSnapshot::default(),
            &MetamapSnapshot::default(),
            &valid_core_snapshot(),
            &CoinagTransferGuard::YaTransferida,
        );

        assert!(
            report
                .blockers
                .iter()
                .any(|value| value == "YA TRANSFERIDA")
        );
        assert!(!report.can_transfer());
    }

    #[test]
    fn remote_transfer_status_blocks_when_in_progress() {
        let report = build_validation_report(
            &ValidationSnapshot::default(),
            &MetamapSnapshot::default(),
            &valid_core_snapshot(),
            &CoinagTransferGuard::EnProceso,
        );

        assert!(report.blockers.iter().any(|value| value == "EN PROCESO"));
        assert!(!report.can_transfer());
    }

    #[test]
    fn renewal_is_allowed_and_emits_warning() {
        let mut core = valid_core_snapshot();
        core.bank_cmf_amount = Some(Decimal::new(800, 0));

        let report = build_validation_report(
            &ValidationSnapshot::default(),
            &MetamapSnapshot::default(),
            &core,
            &CoinagTransferGuard::NotFound,
        );

        assert!(report.blockers.is_empty());
        assert!(
            report
                .warnings
                .iter()
                .any(|value| value.contains("Se detecto renovacion"))
        );
        assert!(report.can_transfer());
    }

    #[test]
    fn bank_amount_greater_than_request_blocks_transfer() {
        let mut core = valid_core_snapshot();
        core.bank_cmf_amount = Some(Decimal::new(1200, 0));

        let report = build_validation_report(
            &ValidationSnapshot::default(),
            &MetamapSnapshot::default(),
            &core,
            &CoinagTransferGuard::NotFound,
        );

        assert!(
            report
                .blockers
                .iter()
                .any(|value| value.contains("Monto bancario mayor que MontoAFinanciar"))
        );
        assert!(!report.can_transfer());
    }

    #[test]
    fn multiple_positive_bank_amounts_block_transfer() {
        let mut core = valid_core_snapshot();
        core.bank_coinag_cba_amount = Some(Decimal::new(1000, 0));

        let report = build_validation_report(
            &ValidationSnapshot::default(),
            &MetamapSnapshot::default(),
            &core,
            &CoinagTransferGuard::NotFound,
        );

        assert!(
            report
                .blockers
                .iter()
                .any(|value| value.contains("son mayores a cero"))
        );
        assert!(!report.can_transfer());
    }
}
