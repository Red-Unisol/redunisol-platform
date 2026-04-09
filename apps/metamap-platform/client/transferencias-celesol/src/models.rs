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
    pub request_status: Option<String>,
    pub request_amount_raw: Option<String>,
    pub request_amount: Option<Decimal>,
    pub request_document: Option<String>,
    pub request_cuil: Option<String>,
    pub document_cuil: Option<String>,
    pub transfer_cbu: Option<String>,
    pub coinag_cuil: Option<String>,
    pub refreshed_label: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct ValidationReport {
    pub blockers: Vec<String>,
    pub warnings: Vec<String>,
}

impl ValidationReport {
    pub fn can_transfer(&self) -> bool {
        self.blockers.is_empty()
    }

    pub fn summary(&self) -> String {
        if self.can_transfer() {
            if self.warnings.is_empty() {
                return "OK".to_owned();
            }
            return format!("OK con {} advertencias", self.warnings.len());
        }
        format!("{} bloqueos", self.blockers.len())
    }
}

#[derive(Clone, Debug)]
pub struct HydratedCase {
    pub server_validation: ValidationSnapshot,
    pub metamap: MetamapSnapshot,
    pub core: CoreSnapshot,
    pub validation: ValidationReport,
    pub already_transferred: bool,
    pub busy: bool,
    pub message: Option<String>,
}

impl ValidationSnapshot {
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
                .amount_raw
                .clone()
                .or_else(|| self.amount_value.clone()),
            amount: self.amount(),
        }
    }
}

impl HydratedCase {
    pub fn request_oid(&self) -> &str {
        self.core.request_oid.as_str()
    }

    pub fn display_name(&self) -> String {
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
                    .amount()
                    .map(crate::validation::format_money)
            })
            .or_else(|| self.server_validation.amount_raw.clone())
            .or_else(|| self.server_validation.amount_value.clone())
            .unwrap_or_else(|| "N/D".to_owned())
    }

    pub fn core_amount_display(&self) -> String {
        self.core
            .request_amount
            .map(crate::validation::format_money)
            .or_else(|| self.core.request_amount_raw.clone())
            .unwrap_or_else(|| "N/D".to_owned())
    }
}
