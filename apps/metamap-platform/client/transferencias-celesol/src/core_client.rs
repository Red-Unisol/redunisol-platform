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
        request_oid: &str,
        metamap_document: Option<&str>,
    ) -> Result<CoreSnapshot> {
        log::debug!(
            "Consultando snapshot de core para solicitud {}.",
            request_oid.trim()
        );
        let criteria = build_eval_criteria("Oid", request_oid)
            .context("No se pudo construir el criterio para consultar la solicitud.")?;
        let result = self.evaluate_obj(json!({
            "cmd": criteria,
            "tipo": "PreSolicitud.Module.Solicitud",
            "campos": "Oid;Estado.Descripcion;MontoAFinanciar;NombreCompleto;Prestamo.LineaPrestamo.Descripcion;CUIT;NroDocumento;Prestamo.[CBU transferencia]",
        }))?;
        let mut snapshot = parse_core_snapshot(&result);
        if snapshot.request_oid.is_empty() {
            snapshot.request_oid = request_oid.trim().to_owned();
        }

        let document_for_lookup = metamap_document.or(snapshot.request_document.as_deref());
        if let Some(document) = document_for_lookup {
            log::debug!(
                "Resolviendo CUIL por documento {} para solicitud {}.",
                mask_value(document, 4),
                snapshot.request_oid
            );
            snapshot.document_cuil = self.fetch_system_cuil_by_document(document)?;
        }
        log::debug!(
            "Core snapshot resuelto para solicitud {}: estado={:?}, monto={:?}, cbu={}.",
            snapshot.request_oid,
            snapshot.request_status,
            snapshot.request_amount_raw,
            snapshot
                .transfer_cbu
                .as_deref()
                .map(|value| mask_value(value, 6))
                .unwrap_or_else(|| "N/D".to_owned())
        );
        Ok(snapshot)
    }

    pub fn fetch_transfer_candidates(&self) -> Result<Vec<CoreSnapshot>> {
        log::debug!("Consultando lista de solicitudes en 'A Transferir' en core.");
        let result = self.evaluate_list(json!({
            "cmd": "[Estado.Descripcion]='A Transferir'",
            "tipo": "PreSolicitud.Module.Solicitud",
            "campos": "Oid;Estado.Descripcion;MontoAFinanciar;NombreCompleto;Prestamo.LineaPrestamo.Descripcion;CUIT;NroDocumento;Prestamo.[CBU transferencia]",
            "max": 5000,
        }))?;

        let Value::Array(rows) = result else {
            return Ok(Vec::new());
        };

        let mut items = Vec::new();
        for row in rows {
            let snapshot = parse_core_snapshot(&row);
            if snapshot.request_oid.trim().is_empty() {
                continue;
            }
            items.push(snapshot);
        }
        log::info!(
            "Core devolvio {} solicitudes en 'A Transferir'.",
            items.len()
        );
        Ok(items)
    }

    pub fn fetch_system_cuil_by_document(&self, document: &str) -> Result<Option<String>> {
        let Some(criteria) = build_eval_criteria("NroDoc", document) else {
            return Ok(None);
        };
        log::debug!(
            "Consultando CUIL por documento {} en core.",
            mask_value(document, 4)
        );
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

    fn evaluate_list(&self, payload: Value) -> Result<Value> {
        log::debug!("POST {}/api/Empresa/EvaluateList", self.base_url);
        self.http
            .post(format!("{}/api/Empresa/EvaluateList", self.base_url))
            .json(&payload)
            .send()
            .context("No se pudo consultar EvaluateList en el core financiero.")?
            .error_for_status()
            .context("EvaluateList devolvio error en el core financiero.")?
            .json::<Value>()
            .context("No se pudo decodificar la respuesta de EvaluateList.")
    }

    fn evaluate_obj(&self, payload: Value) -> Result<Value> {
        log::debug!("POST {}/api/Empresa/EvaluateObj", self.base_url);
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

fn parse_core_snapshot(value: &Value) -> CoreSnapshot {
    let request_amount_raw = read_indexed_value(value, 2, &["MontoAFinanciar"]);
    CoreSnapshot {
        request_oid: read_indexed_value(value, 0, &["Oid", "ID"]).unwrap_or_default(),
        request_status: read_indexed_value(value, 1, &["Estado.Descripcion", "EstadoDescripcion"]),
        request_amount: request_amount_raw.as_deref().and_then(parse_decimal),
        request_amount_raw,
        request_name: read_indexed_value(
            value,
            3,
            &["NombreCompleto", "nombreCompleto", "Socio.NombreCompleto"],
        ),
        credit_line_description: read_indexed_value(
            value,
            4,
            &[
                "Prestamo.LineaPrestamo.Descripcion",
                "LineaPrestamo.Descripcion",
                "lineaPrestamo.descripcion",
            ],
        ),
        request_cuil: read_indexed_value(value, 5, &["CUIT", "Cuit", "cuit"]),
        request_document: read_indexed_value(
            value,
            6,
            &["NroDocumento", "nroDocumento", "NroDoc", "nroDoc"],
        ),
        transfer_cbu: read_indexed_value(
            value,
            7,
            &[
                "Prestamo.[CBU transferencia]",
                "Prestamo.CBU transferencia",
                "prestamo.cbu transferencia",
            ],
        ),
        ..CoreSnapshot::default()
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

fn mask_value(value: &str, visible_suffix: usize) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= visible_suffix {
        return trimmed.to_owned();
    }
    format!("***{}", &trimmed[trimmed.len() - visible_suffix..])
}
