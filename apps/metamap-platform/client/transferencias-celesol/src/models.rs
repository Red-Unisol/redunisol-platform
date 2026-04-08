use rust_decimal::Decimal;
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct QueueResponse {
    pub cases: Vec<ServerCase>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ServerCase {
    pub case_id: String,
    pub verification_id: String,
    pub current_stage: String,
    pub resource_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct CaseActionResponse {
    pub case: ServerCase,
    pub action_applied: bool,
}

#[derive(Clone, Debug, Default)]
pub struct MetamapSnapshot {
    pub name: String,
    pub document: Option<String>,
    pub request_number: Option<String>,
    pub amount_raw: Option<String>,
    pub amount: Option<Decimal>,
}

#[derive(Clone, Debug, Default)]
pub struct CoreSnapshot {
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
    pub case_id: String,
    pub verification_id: String,
    pub current_stage: String,
    pub resource_url: String,
    pub metamap: MetamapSnapshot,
    pub core: CoreSnapshot,
    pub validation: ValidationReport,
    pub busy: bool,
    pub message: Option<String>,
}

impl HydratedCase {
    pub fn amount_display(&self) -> String {
        self.metamap
            .amount
            .map(crate::validation::format_money)
            .or_else(|| self.metamap.amount_raw.clone())
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
