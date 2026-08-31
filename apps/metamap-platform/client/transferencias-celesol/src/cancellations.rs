use std::collections::HashSet;

use rust_decimal::Decimal;

use crate::{models::CoreSnapshot, validation::normalize_digits};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CancellationPayment {
    pub id: u64,
    pub amount_raw: Option<String>,
    pub amount: Option<Decimal>,
    pub payment_method: Option<String>,
    pub cbu: Option<String>,
    pub owner_cuit: Option<String>,
    pub owner_name: Option<String>,
    pub account_type_code: Option<String>,
    pub account_type_label: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransferLegKind {
    Member,
    Creditor,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransferLeg {
    pub key: String,
    pub kind: TransferLegKind,
    pub amount: Decimal,
    pub cbu: String,
    pub cuit: String,
    pub holder_name: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CancellationPlan {
    pub legs: Vec<TransferLeg>,
    pub blockers: Vec<String>,
}

impl CancellationPlan {
    pub fn can_transfer(&self) -> bool {
        self.blockers.is_empty() && !self.legs.is_empty()
    }

    pub fn total(&self) -> Decimal {
        self.legs.iter().map(|leg| leg.amount).sum()
    }
}

pub fn is_candidate(core: &CoreSnapshot) -> bool {
    core.cancellation_amount
        .is_some_and(|amount| !amount.is_zero())
        || core
            .cancellation_detail_count
            .is_some_and(|count| count > 0)
        || !core.cancellation_payments.is_empty()
}

pub fn build_plan(core: &CoreSnapshot) -> CancellationPlan {
    if !is_candidate(core) {
        return CancellationPlan::default();
    }

    let mut plan = CancellationPlan::default();
    let Some(cancellation_amount) = positive(core.cancellation_amount) else {
        plan.blockers
            .push("MontoCancelaciones debe ser mayor a cero.".to_owned());
        return plan;
    };
    if core.cancellation_payments.is_empty() {
        plan.blockers.push(
            "MontoCancelaciones es mayor a cero pero DetalleFormaPago no tiene destinos."
                .to_owned(),
        );
        return plan;
    }

    let mut detail_ids = HashSet::new();
    let mut detail_total = Decimal::ZERO;
    for payment in &core.cancellation_payments {
        if payment.id == 0 || !detail_ids.insert(payment.id) {
            plan.blockers.push(format!(
                "DetalleFormaPago contiene un ID invalido o duplicado: {}.",
                payment.id
            ));
            continue;
        }
        let Some(amount) = positive(payment.amount) else {
            plan.blockers.push(format!(
                "DetalleFormaPago {} no tiene un monto mayor a cero.",
                payment.id
            ));
            continue;
        };
        detail_total += amount;
        let cbu = valid_cbu(payment.cbu.as_deref());
        let cuit = valid_cuit(payment.owner_cuit.as_deref());
        if cbu.is_none() {
            plan.blockers.push(format!(
                "DetalleFormaPago {} no tiene un CBU valido de 22 digitos.",
                payment.id
            ));
        }
        if cuit.is_none() {
            plan.blockers.push(format!(
                "No se pudo validar el CUIT titular del CBU del detalle {}.",
                payment.id
            ));
        }
        if let Some(cuit) = cuit.as_deref()
            && !is_legal_entity_cuit(cuit)
        {
            plan.blockers.push(format!(
                "El titular del detalle {} no es una persona juridica con CUIT valido.",
                payment.id
            ));
        }
        if payment
            .owner_name
            .as_deref()
            .is_none_or(|name| name.trim().is_empty())
        {
            plan.blockers.push(format!(
                "Coinag no devolvio el nombre del titular para el detalle {}.",
                payment.id
            ));
        }
        if !account_type_is_pesos(payment.account_type_code.as_deref()) {
            plan.blockers.push(format!(
                "El CBU del detalle {} no es una cuenta habilitada en pesos.",
                payment.id
            ));
        }
        if let (Some(cbu), Some(cuit)) = (cbu, cuit) {
            plan.legs.push(TransferLeg {
                key: format!("creditor:{}", payment.id),
                kind: TransferLegKind::Creditor,
                amount,
                cbu,
                cuit,
                holder_name: payment.owner_name.clone(),
            });
        }
    }

    if detail_total != cancellation_amount {
        plan.blockers.push(format!(
            "La suma de DetalleFormaPago ({detail_total}) no coincide con MontoCancelaciones ({cancellation_amount})."
        ));
    }

    if let Some(member_amount) = core
        .cash_in_hand_amount
        .map(|amount| amount.abs())
        .filter(|amount| !amount.is_zero())
    {
        let cbu = valid_cbu(core.transfer_cbu.as_deref());
        let cuit = core
            .request_cuil
            .as_deref()
            .or(core.document_cuil.as_deref())
            .and_then(|value| valid_cuit(Some(value)));
        if cbu.is_none() {
            plan.blockers.push(
                "Prestamo.[CBU transferencia] no es valido para acreditar Monto En Mano."
                    .to_owned(),
            );
        }
        if cuit.is_none() {
            plan.blockers
                .push("No se pudo resolver el CUIL/CUIT del socio.".to_owned());
        }
        if let (Some(cbu), Some(cuit)) = (cbu, cuit) {
            plan.legs.push(TransferLeg {
                key: "member".to_owned(),
                kind: TransferLegKind::Member,
                amount: member_amount,
                cbu,
                cuit,
                holder_name: core.request_name.clone(),
            });
        }
    }

    let expected_total = core.request_amount.map(|amount| amount.abs());
    if expected_total.is_none() {
        plan.blockers
            .push("No se pudo resolver MontoAFinanciar.".to_owned());
    } else if Some(detail_total + core.cash_in_hand_amount.unwrap_or_default().abs())
        != expected_total
    {
        plan.blockers.push(format!(
            "MontoCancelaciones + abs(Monto En Mano) no coincide con MontoAFinanciar."
        ));
    }

    let bank_amounts = [core.bank_cmf_amount, core.bank_coinag_cba_amount]
        .into_iter()
        .flatten()
        .filter(|amount| !amount.is_zero())
        .map(|amount| amount.abs())
        .collect::<Vec<_>>();
    match bank_amounts.as_slice() {
        [bank_total] if Some(*bank_total) == expected_total => {}
        [_] => plan.blockers.push(
            "El monto bancario no coincide con MontoAFinanciar para la cancelacion.".to_owned(),
        ),
        [] => plan
            .blockers
            .push("No existe un monto bancario para la cancelacion.".to_owned()),
        _ => plan.blockers.push(
            "Prestamo.[Bco CMF] y Prestamo.[Bco Coinag Cba] no pueden tener monto simultaneamente."
                .to_owned(),
        ),
    }

    plan
}

pub fn is_legal_entity_cuit(value: &str) -> bool {
    let Some(cuit) = normalize_digits(value) else {
        return false;
    };
    cuit.len() == 11 && matches!(&cuit[..2], "30" | "33" | "34") && has_valid_cuit_checksum(&cuit)
}

fn positive(value: Option<Decimal>) -> Option<Decimal> {
    value.filter(|amount| *amount > Decimal::ZERO)
}

fn valid_cbu(value: Option<&str>) -> Option<String> {
    normalize_digits(value?).filter(|digits| digits.len() == 22)
}

fn valid_cuit(value: Option<&str>) -> Option<String> {
    normalize_digits(value?).filter(|digits| digits.len() == 11)
}

fn account_type_is_pesos(value: Option<&str>) -> bool {
    value.is_some_and(|value| matches!(value.trim(), "1" | "10" | "20" | "30"))
}

fn has_valid_cuit_checksum(cuit: &str) -> bool {
    let digits = cuit
        .bytes()
        .map(|digit| u32::from(digit - b'0'))
        .collect::<Vec<_>>();
    let weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let verifier = 11
        - digits[..10]
            .iter()
            .zip(weights)
            .map(|(digit, weight)| digit * weight)
            .sum::<u32>()
            % 11;
    let verifier = match verifier {
        11 => 0,
        10 => 9,
        other => other,
    };
    verifier == digits[10]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn historical_case() -> CoreSnapshot {
        // Solicitud 246729, 2026-07-06. Se omiten los datos personales del socio.
        CoreSnapshot {
            request_oid: "246729".to_owned(),
            request_amount: Some(Decimal::new(1_900_000, 0)),
            cancellation_amount: Some(Decimal::new(565_000, 0)),
            cash_in_hand_amount: Some(Decimal::new(-1_335_000, 0)),
            bank_cmf_amount: Some(Decimal::new(-1_900_000, 0)),
            request_cuil: Some("20-30111222-3".to_owned()),
            transfer_cbu: Some("0000003100015780238648".to_owned()),
            cancellation_payments: vec![CancellationPayment {
                id: 1296,
                amount: Some(Decimal::new(565_000, 0)),
                cbu: Some("0970099413001097400111".to_owned()),
                owner_cuit: Some("30-62556738-2".to_owned()),
                owner_name: Some("MUDON".to_owned()),
                account_type_code: Some("10".to_owned()),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn builds_two_legs_from_recent_historical_amounts() {
        let plan = build_plan(&historical_case());

        assert!(plan.can_transfer(), "{:?}", plan.blockers);
        assert_eq!(plan.legs.len(), 2);
        assert_eq!(plan.total(), Decimal::new(1_900_000, 0));
        assert_eq!(plan.legs[0].amount, Decimal::new(565_000, 0));
        assert_eq!(plan.legs[1].amount, Decimal::new(1_335_000, 0));
    }

    #[test]
    fn rejects_the_recent_amount_mismatch_instead_of_guessing() {
        // Solicitud historica 247067: 1.220.000 + 1.220.000 != 1.440.000.
        let mut case = historical_case();
        case.request_oid = "247067".to_owned();
        case.request_amount = Some(Decimal::new(1_440_000, 0));
        case.cancellation_amount = Some(Decimal::new(1_220_000, 0));
        case.cash_in_hand_amount = Some(Decimal::new(1_220_000, 0));
        case.bank_cmf_amount = None;
        case.bank_coinag_cba_amount = Some(Decimal::new(1_440_000, 0));
        case.cancellation_payments[0].amount = Some(Decimal::new(1_220_000, 0));

        let plan = build_plan(&case);

        assert!(!plan.can_transfer());
        assert!(
            plan.blockers
                .iter()
                .any(|item| item.contains("MontoCancelaciones"))
        );
    }

    #[test]
    fn rejects_recent_case_with_two_bank_fields() {
        // Solicitud historica 247720: ambos campos bancarios tienen monto.
        let mut case = historical_case();
        case.request_oid = "247720".to_owned();
        case.request_amount = Some(Decimal::new(3_300_000, 0));
        case.cancellation_amount = Some(Decimal::new(14_756_998, 2));
        case.cash_in_hand_amount = Some(Decimal::new(315_243_002, 2));
        case.bank_cmf_amount = Some(Decimal::new(14_756_998, 2));
        case.bank_coinag_cba_amount = Some(Decimal::new(315_243_002, 2));
        case.cancellation_payments[0].amount = Some(Decimal::new(14_756_998, 2));

        let plan = build_plan(&case);

        assert!(!plan.can_transfer());
        assert!(
            plan.blockers
                .iter()
                .any(|item| item.contains("simultaneamente"))
        );
    }

    #[test]
    fn identifies_known_financial_entity_cuits_as_legal_entities() {
        for cuit in ["30-62556738-2", "30-71095091-8", "30-68736512-3"] {
            assert!(is_legal_entity_cuit(cuit), "{cuit}");
        }
        assert!(!is_legal_entity_cuit("20-30111222-3"));
    }
}
