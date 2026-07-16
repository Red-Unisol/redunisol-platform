use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct ValidationSearchResponse {
    pub items: Vec<ValidationSnapshot>,
}

#[derive(Clone, Debug, Default)]
pub struct MetamapSnapshot {
    pub name: String,
    pub document: Option<String>,
    pub request_number: Option<String>,
    pub amount_raw: Option<String>,
    pub amount: Option<Decimal>,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct ValidationSnapshot {
    pub verification_id: Option<String>,
    pub latest_event_name: Option<String>,
    pub normalized_status: Option<String>,
    pub resource_url: Option<String>,
    pub request_number: Option<String>,
    pub loan_number: Option<String>,
    pub amount_raw: Option<String>,
    pub amount_value: Option<String>,
    pub requested_amount_raw: Option<String>,
    pub requested_amount_value: Option<String>,
    pub applicant_name: Option<String>,
    pub document_number: Option<String>,
    #[serde(default)]
    pub event_count: u64,
    #[serde(skip)]
    pub match_count: usize,
}

#[derive(Clone, Debug, Default)]
pub struct CoreSnapshot {
    pub request_oid: String,
    pub request_name: Option<String>,
    pub credit_line_description: Option<String>,
    pub request_status: Option<String>,
    pub request_amount_raw: Option<String>,
    pub request_amount: Option<Decimal>,
    pub request_document: Option<String>,
    pub request_cuil: Option<String>,
    pub document_cuil: Option<String>,
    pub transfer_cbu: Option<String>,
    pub bank_cmf_amount_raw: Option<String>,
    pub bank_cmf_amount: Option<Decimal>,
    pub bank_coinag_cba_amount_raw: Option<String>,
    pub bank_coinag_cba_amount: Option<Decimal>,
    pub coinag_cuil: Option<String>,
    pub coinag_account_type_code: Option<String>,
    pub coinag_account_type_label: Option<String>,
    pub refreshed_label: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BankAmountField {
    BcoCmf,
    BcoCoinagCba,
}

impl BankAmountField {
    pub fn label(&self) -> &'static str {
        match self {
            Self::BcoCmf => "Prestamo.[Bco CMF]",
            Self::BcoCoinagCba => "Prestamo.[Bco Coinag Cba]",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransferAmountOutcome {
    Exact,
    Renovacion,
    Error,
}

#[derive(Clone, Debug)]
pub struct TransferAmountResolution {
    pub outcome: TransferAmountOutcome,
    pub bank_field: Option<BankAmountField>,
    pub transfer_amount: Option<Decimal>,
    pub request_amount: Option<Decimal>,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct ValidationReport {
    pub disabled: bool,
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub enum CoinagTransferGuard {
    #[default]
    Unknown,
    NotFound,
    YaTransferida,
    EnProceso,
    Error {
        detail: String,
    },
}

impl CoinagTransferGuard {
    pub fn detail(&self) -> Option<&str> {
        match self {
            Self::Error { detail } => Some(detail.as_str()),
            _ => None,
        }
    }
}

impl ValidationReport {
    pub fn can_transfer(&self) -> bool {
        !self.disabled && self.blockers.is_empty()
    }

    pub fn summary(&self) -> String {
        if self.disabled {
            return "DESHABILITADO".to_owned();
        }
        for status in ["YA TRANSFERIDA", "EN PROCESO", "ERROR"] {
            if self.blockers.iter().any(|blocker| blocker == status) {
                return status.to_owned();
            }
        }
        if self.can_transfer() {
            if self.warnings.is_empty() {
                return "OK".to_owned();
            }
            return format!("OK con {} advertencias", self.warnings.len());
        }
        if self.blockers.len() == 1 {
            return "1 bloqueo".to_owned();
        }
        format!("{} bloqueos", self.blockers.len())
    }
}

#[derive(Clone, Debug)]
pub struct HydratedCase {
    pub server_validation: ValidationSnapshot,
    pub metamap: MetamapSnapshot,
    pub core: CoreSnapshot,
    pub transfer_guard: CoinagTransferGuard,
    pub validation: ValidationReport,
    pub busy: bool,
    pub message: Option<String>,
}

impl ValidationSnapshot {
    pub fn requested_amount(&self) -> Option<Decimal> {
        self.requested_amount_value
            .as_deref()
            .and_then(crate::validation::parse_decimal)
            .or_else(|| {
                self.requested_amount_raw
                    .as_deref()
                    .and_then(crate::validation::parse_decimal)
            })
    }

    pub fn amount(&self) -> Option<Decimal> {
        self.amount_value
            .as_deref()
            .and_then(crate::validation::parse_decimal)
            .or_else(|| {
                self.amount_raw
                    .as_deref()
                    .and_then(crate::validation::parse_decimal)
            })
    }

    pub fn has_completed_validation(&self) -> bool {
        matches!(self.normalized_status.as_deref(), Some("completed"))
            && self
                .verification_id
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
    }

    pub fn to_metamap_snapshot(&self) -> MetamapSnapshot {
        MetamapSnapshot {
            name: self.applicant_name.clone().unwrap_or_default(),
            document: self.document_number.clone(),
            request_number: self.request_number.clone(),
            amount_raw: self
                .requested_amount_raw
                .clone()
                .or_else(|| self.requested_amount_value.clone())
                .or_else(|| self.amount_raw.clone())
                .or_else(|| self.amount_value.clone()),
            amount: self.requested_amount().or_else(|| self.amount()),
        }
    }
}

impl HydratedCase {
    pub fn request_oid(&self) -> &str {
        self.core.request_oid.as_str()
    }

    pub fn display_name(&self) -> String {
        if let Some(name) = self.core.request_name.as_deref() {
            let trimmed = name.trim();
            if !trimmed.is_empty() {
                return trimmed.to_owned();
            }
        }
        let trimmed = self.metamap.name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_owned();
        }
        format!("Solicitud {}", self.request_oid())
    }

    pub fn document_display(&self) -> String {
        self.metamap
            .document
            .clone()
            .or_else(|| self.core.request_document.clone())
            .unwrap_or_else(|| "N/D".to_owned())
    }

    pub fn amount_display(&self) -> String {
        self.metamap
            .amount
            .map(crate::validation::format_money)
            .or_else(|| self.metamap.amount_raw.clone())
            .or_else(|| {
                self.server_validation
                    .requested_amount()
                    .or_else(|| self.server_validation.amount())
                    .map(crate::validation::format_money)
            })
            .or_else(|| self.server_validation.requested_amount_raw.clone())
            .or_else(|| self.server_validation.requested_amount_value.clone())
            .or_else(|| self.server_validation.amount_raw.clone())
            .or_else(|| self.server_validation.amount_value.clone())
            .unwrap_or_else(|| "N/D".to_owned())
    }

    pub fn cuil_display(&self) -> String {
        self.core
            .request_cuil
            .clone()
            .or_else(|| self.core.document_cuil.clone())
            .or_else(|| self.core.coinag_cuil.clone())
            .unwrap_or_else(|| "N/D".to_owned())
    }

    pub fn cbu_display(&self) -> String {
        self.core
            .transfer_cbu
            .clone()
            .unwrap_or_else(|| "N/D".to_owned())
    }

    pub fn core_amount_display(&self) -> String {
        self.core
            .request_amount
            .map(crate::validation::format_money)
            .or_else(|| self.core.request_amount_raw.clone())
            .unwrap_or_else(|| "N/D".to_owned())
    }

    pub fn transfer_amount_resolution(&self) -> TransferAmountResolution {
        self.core.transfer_amount_resolution()
    }

    pub fn transfer_amount_display(&self) -> String {
        self.transfer_amount_resolution()
            .transfer_amount
            .map(crate::validation::format_money)
            .unwrap_or_else(|| "N/D".to_owned())
    }

    pub fn transfer_state_display(&self) -> String {
        if !matches!(self.core.request_status.as_deref(), Some("A Transferir")) {
            return self
                .core
                .request_status
                .clone()
                .unwrap_or_else(|| "N/D".to_owned());
        }
        match self.transfer_amount_resolution().outcome {
            TransferAmountOutcome::Exact => "A Transferir".to_owned(),
            TransferAmountOutcome::Renovacion => "RENOVACION".to_owned(),
            TransferAmountOutcome::Error => "ERROR".to_owned(),
        }
    }
}

impl CoreSnapshot {
    pub fn coinag_account_type_display(&self) -> Option<String> {
        match (
            self.coinag_account_type_code.as_deref(),
            self.coinag_account_type_label.as_deref(),
        ) {
            (Some(code), Some(label)) if !label.trim().is_empty() => {
                Some(format!("{} - {}", code.trim(), label.trim()))
            }
            (Some(code), _) => Some(code.trim().to_owned()),
            _ => None,
        }
    }

    pub fn coinag_account_type_is_pesos_transfer_compatible(&self) -> Option<bool> {
        self.coinag_account_type_code
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| matches!(value, "1" | "10" | "20" | "30"))
    }

    pub fn transfer_amount_resolution(&self) -> TransferAmountResolution {
        let zero = Decimal::ZERO;
        let bank_cmf_amount = self.bank_cmf_amount.filter(|amount| *amount > zero);
        let bank_coinag_cba_amount = self.bank_coinag_cba_amount.filter(|amount| *amount > zero);

        match (bank_cmf_amount, bank_coinag_cba_amount) {
            (Some(_), Some(_)) => TransferAmountResolution {
                outcome: TransferAmountOutcome::Error,
                bank_field: None,
                transfer_amount: None,
                request_amount: self.request_amount,
                detail: Some(
                    "Monto bancario inconsistente: Prestamo.[Bco CMF] y Prestamo.[Bco Coinag Cba] son mayores a cero."
                        .to_owned(),
                ),
            },
            (None, None) => TransferAmountResolution {
                outcome: TransferAmountOutcome::Error,
                bank_field: None,
                transfer_amount: None,
                request_amount: self.request_amount,
                detail: Some(
                    "No se pudo resolver el monto bancario: ni Prestamo.[Bco CMF] ni Prestamo.[Bco Coinag Cba] son mayores a cero."
                        .to_owned(),
                ),
            },
            (Some(amount), None) => {
                self.resolve_transfer_amount(BankAmountField::BcoCmf, amount)
            }
            (None, Some(amount)) => {
                self.resolve_transfer_amount(BankAmountField::BcoCoinagCba, amount)
            }
        }
    }

    fn resolve_transfer_amount(
        &self,
        bank_field: BankAmountField,
        transfer_amount: Decimal,
    ) -> TransferAmountResolution {
        let Some(request_amount) = self.request_amount else {
            return TransferAmountResolution {
                outcome: TransferAmountOutcome::Error,
                bank_field: Some(bank_field),
                transfer_amount: Some(transfer_amount),
                request_amount: None,
                detail: Some(
                    "No se pudo resolver MontoAFinanciar en el core financiero.".to_owned(),
                ),
            };
        };

        if transfer_amount > request_amount {
            return TransferAmountResolution {
                outcome: TransferAmountOutcome::Error,
                bank_field: Some(bank_field),
                transfer_amount: Some(transfer_amount),
                request_amount: Some(request_amount),
                detail: Some(format!(
                    "Monto bancario mayor que MontoAFinanciar: banco {}, solicitud {}.",
                    crate::validation::format_money(transfer_amount),
                    crate::validation::format_money(request_amount),
                )),
            };
        }

        if transfer_amount < request_amount {
            return TransferAmountResolution {
                outcome: TransferAmountOutcome::Renovacion,
                bank_field: Some(bank_field),
                transfer_amount: Some(transfer_amount),
                request_amount: Some(request_amount),
                detail: Some(format!(
                    "Se detecto renovacion: monto bancario {} menor que MontoAFinanciar {}.",
                    crate::validation::format_money(transfer_amount),
                    crate::validation::format_money(request_amount),
                )),
            };
        }

        TransferAmountResolution {
            outcome: TransferAmountOutcome::Exact,
            bank_field: Some(bank_field),
            transfer_amount: Some(transfer_amount),
            request_amount: Some(request_amount),
            detail: None,
        }
    }
}
