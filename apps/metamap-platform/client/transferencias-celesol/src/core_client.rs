use anyhow::{Context, Result};
use reqwest::blocking::Client;
use serde_json::{Value, json};

use crate::{
    config::CoreConfig,
    models::CoreSnapshot,
    validation::{normalize_digits, parse_decimal},
};

#[derive(Clone)]
pub struct CoreClient {
    http: Client,
    base_url: String,
}

impl CoreClient {
    pub fn new(config: &CoreConfig, timeout: std::time::Duration) -> Result<Self> {
        let http = Client::builder()
            .timeout(timeout)
            .danger_accept_invalid_certs(config.allow_invalid_certs)
            .build()
            .context("No se pudo construir el cliente HTTP del core financiero.")?;
        Ok(Self {
            http,
            base_url: config.base_url.trim_end_matches('/').to_owned(),
        })
    }

    pub fn fetch_core_snapshot(
        &self,
        request_number: Option<&str>,
        metamap_document: Option<&str>,
    ) -> Result<CoreSnapshot> {
        let mut snapshot = CoreSnapshot::default();
        if let Some(request_number) = request_number {
            if let Some(criteria) = build_eval_criteria("Oid", request_number) {
                let result = self.evaluate_obj(json!({
                    "cmd": criteria,
                    "tipo": "PreSolicitud.Module.Solicitud",
                    "campos": "Estado.Descripcion;MontoAFinanciar;CUIT;NroDocumento;Prestamo.[CBU transferencia]",
                }))?;
                snapshot.request_status =
                    read_indexed_value(&result, 0, &["Estado.Descripcion", "EstadoDescripcion"]);
                snapshot.request_amount_raw = read_indexed_value(&result, 1, &["MontoAFinanciar"]);
                snapshot.request_amount = snapshot
                    .request_amount_raw
                    .as_deref()
                    .and_then(parse_decimal);
                snapshot.request_cuil = read_indexed_value(&result, 2, &["CUIT", "Cuit", "cuit"]);
                snapshot.request_document = read_indexed_value(
                    &result,
                    3,
                    &["NroDocumento", "nroDocumento", "NroDoc", "nroDoc"],
                );
                snapshot.transfer_cbu = read_indexed_value(
                    &result,
                    4,
                    &[
                        "Prestamo.[CBU transferencia]",
                        "Prestamo.CBU transferencia",
                        "prestamo.cbu transferencia",
                    ],
                );
            }
        }

        if let Some(document) = metamap_document {
            snapshot.document_cuil = self.fetch_system_cuil_by_document(document)?;
        }

        Ok(snapshot)
    }

    fn fetch_system_cuil_by_document(&self, document: &str) -> Result<Option<String>> {
        let Some(criteria) = build_eval_criteria("NroDoc", document) else {
            return Ok(None);
        };
        let result = self.evaluate_obj(json!({
            "cmd": criteria,
            "tipo": "F.Module.SocioMutual",
            "campos": "NroDoc;CUIT",
        }))?;

        let document_from_core = read_indexed_value(
            &result,
            0,
            &["NroDoc", "NroDocumento", "nroDoc", "nroDocumento"],
        );
        let core_cuil = read_indexed_value(&result, 1, &["CUIT", "Cuit", "cuit"]);
        let Some(core_cuil) = core_cuil else {
            return Ok(None);
        };
        let Some(document_from_core) = document_from_core else {
            return Ok(None);
        };
        if normalize_digits(document_from_core) != normalize_digits(document) {
            return Ok(None);
        }
        Ok(Some(core_cuil))
    }

    fn evaluate_obj(&self, payload: Value) -> Result<Value> {
        self.http
            .post(format!("{}/api/Empresa/EvaluateObj", self.base_url))
            .json(&payload)
            .send()
            .context("No se pudo consultar EvaluateObj en el core financiero.")?
            .error_for_status()
            .context("EvaluateObj devolvio error en el core financiero.")?
            .json::<Value>()
            .context("No se pudo decodificar la respuesta de EvaluateObj.")
    }
}

fn read_indexed_value(value: &Value, list_index: usize, dict_keys: &[&str]) -> Option<String> {
    match value {
        Value::Array(items) => items.get(list_index).and_then(value_to_string),
        Value::Object(map) => dict_keys
            .iter()
            .find_map(|key| map.get(*key).and_then(value_to_string)),
        _ => None,
    }
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_owned())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn build_eval_criteria(field: &str, value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let digits = normalize_digits(trimmed);
    if digits.as_deref() == Some(trimmed) {
        return Some(format!("[{field}]={trimmed}"));
    }
    let escaped = trimmed.replace('\'', "''");
    Some(format!("[{field}]='{escaped}'"))
}
