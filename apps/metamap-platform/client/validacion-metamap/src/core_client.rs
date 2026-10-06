use std::collections::HashMap;

use anyhow::{Context, Result};
use reqwest::blocking::Client;
use serde_json::{Value, json};

use crate::{
    config::CoreConfig,
    models::{CoreSnapshot, format_cuil, normalize_digits},
};

#[derive(Clone)]
pub struct CoreClient {
    http: Client,
    base_url: String,
    evaluate_api_bearer_token: Option<String>,
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
            evaluate_api_bearer_token: config.evaluate_api_bearer_token.clone(),
        })
    }

    pub fn fetch_request_snapshots(
        &self,
        request_numbers: &[String],
    ) -> Result<HashMap<String, CoreSnapshot>> {
        let mut snapshots = HashMap::new();

        for chunk in request_numbers.chunks(120) {
            let criteria = build_eval_criteria("Oid", chunk);
            if criteria.is_none() {
                continue;
            }

            let payload = json!({
                "cmd": criteria,
                "tipo": "PreSolicitud.Module.Solicitud",
                "campos": "Oid;Estado.Descripcion;MontoAFinanciar;NombreCompleto;Prestamo.LineaPrestamo.Descripcion;CUIT;NroDocumento",
                "max": chunk.len(),
            });
            let response = self.evaluate_list(payload)?;

            let Value::Array(rows) = response else {
                continue;
            };

            for row in rows {
                let snapshot = parse_core_snapshot(&row);
                if !snapshot.request_number.trim().is_empty() {
                    snapshots.insert(snapshot.request_number.clone(), snapshot);
                }
            }
        }

        Ok(snapshots)
    }

    pub fn fetch_cuil_by_documents(&self, documents: &[String]) -> Result<HashMap<String, String>> {
        let mut values = HashMap::new();

        for chunk in documents.chunks(120) {
            let criteria = build_numeric_eval_criteria("NroDoc", chunk);
            if criteria.is_none() {
                continue;
            }

            let payload = json!({
                "cmd": criteria,
                "tipo": "F.Module.SocioMutual",
                "campos": "NroDoc;CUIT",
                "max": chunk.len(),
            });
            let response = self.evaluate_list(payload)?;

            let Value::Array(rows) = response else {
                continue;
            };

            for row in rows {
                let document = read_indexed_value(&row, 0, &["NroDoc", "NroDocumento"]);
                let cuil = read_indexed_value(&row, 1, &["CUIT", "Cuit", "cuit"]);

                let Some(document) = document else {
                    continue;
                };
                let Some(cuil) = cuil else {
                    continue;
                };

                values.insert(normalize_digits(&document), format_cuil(&cuil));
            }
        }

        Ok(values)
    }

    fn evaluate_list(&self, payload: Value) -> Result<Value> {
        let request = self
            .http
            .post(format!("{}/api/Empresa/EvaluateList", self.base_url))
            .json(&payload);
        let request = if let Some(token) = &self.evaluate_api_bearer_token {
            request.bearer_auth(token)
        } else {
            request
        };

        request
            .send()
            .context("No se pudo consultar EvaluateList en el core financiero.")?
            .error_for_status()
            .context("EvaluateList devolvio error en el core financiero.")?
            .json::<Value>()
            .context("No se pudo decodificar la respuesta de EvaluateList.")
    }
}

fn parse_core_snapshot(value: &Value) -> CoreSnapshot {
    CoreSnapshot {
        request_number: read_indexed_value(value, 0, &["Oid", "ID"]).unwrap_or_default(),
        status: read_indexed_value(value, 1, &["Estado.Descripcion", "EstadoDescripcion"]),
        amount: read_indexed_value(value, 2, &["MontoAFinanciar"]),
        name: read_indexed_value(value, 3, &["NombreCompleto", "Socio.NombreCompleto"]),
        line: read_indexed_value(
            value,
            4,
            &[
                "Prestamo.LineaPrestamo.Descripcion",
                "LineaPrestamo.Descripcion",
                "lineaPrestamo.descripcion",
            ],
        ),
        cuil: read_indexed_value(value, 5, &["CUIT", "Cuit", "cuit"])
            .map(|value| format_cuil(&value)),
        document_number: read_indexed_value(value, 6, &["NroDocumento", "NroDoc"]),
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

fn build_eval_criteria(field: &str, values: &[String]) -> Option<String> {
    let parts = values
        .iter()
        .filter_map(|value| build_eval_term(field, value))
        .collect::<Vec<_>>();

    if parts.is_empty() {
        return None;
    }

    Some(parts.join(" OR "))
}

fn build_numeric_eval_criteria(field: &str, values: &[String]) -> Option<String> {
    let parts = values
        .iter()
        .filter_map(|value| {
            let digits = normalize_digits(value);
            if digits.is_empty() {
                None
            } else {
                Some(format!("[{field}]={digits}"))
            }
        })
        .collect::<Vec<_>>();

    if parts.is_empty() {
        return None;
    }

    Some(parts.join(" OR "))
}

fn build_eval_term(field: &str, value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let digits = normalize_digits(trimmed);
    if digits == trimmed {
        return Some(format!("[{field}]={trimmed}"));
    }

    Some(format!("[{field}]='{}'", trimmed.replace('\'', "''")))
}

#[cfg(test)]
mod tests {
    use super::{build_eval_criteria, build_numeric_eval_criteria};

    #[test]
    fn numeric_criteria_strips_non_digits() {
        let values = vec!["F6542664".to_owned(), " 20-12345678-3 ".to_owned()];

        assert_eq!(
            build_numeric_eval_criteria("NroDoc", &values).as_deref(),
            Some("[NroDoc]=6542664 OR [NroDoc]=20123456783")
        );
    }

    #[test]
    fn generic_criteria_still_quotes_non_numeric_values() {
        let values = vec!["SOL-123".to_owned()];

        assert_eq!(
            build_eval_criteria("Oid", &values).as_deref(),
            Some("[Oid]='SOL-123'")
        );
    }
}
