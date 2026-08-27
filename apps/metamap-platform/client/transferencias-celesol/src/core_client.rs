use std::collections::BTreeMap;

use anyhow::{Context, Result, anyhow};
use chrono::{Local, Months};
use reqwest::blocking::Client;
use serde_json::{Value, json};

use crate::{
    config::CoreConfig,
    credit_lines::CreditLineCatalogEntry,
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
            "campos": "Oid;Estado.Descripcion;MontoAFinanciar;NombreCompleto;Prestamo.LineaPrestamo.ID;Prestamo.LineaPrestamo.Codigo;Prestamo.LineaPrestamo.Descripcion;CUIT;NroDocumento;Prestamo.[CBU transferencia];Prestamo.[Bco CMF];Prestamo.[Bco Coinag Cba]",
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
            "campos": "Oid;Estado.Descripcion;MontoAFinanciar;NombreCompleto;Prestamo.LineaPrestamo.ID;Prestamo.LineaPrestamo.Codigo;Prestamo.LineaPrestamo.Descripcion;CUIT;NroDocumento;Prestamo.[CBU transferencia];Prestamo.[Bco CMF];Prestamo.[Bco Coinag Cba]",
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

    pub fn fetch_credit_line_catalog(&self) -> Result<Vec<CreditLineCatalogEntry>> {
        let from_date = Local::now()
            .date_naive()
            .checked_sub_months(Months::new(3))
            .ok_or_else(|| anyhow!("No se pudo calcular la fecha desde para consultar lineas"))?;
        let criteria = format!("[Fecha] >= #{}#", from_date.format("%Y-%m-%d"));
        log::info!(
            "Consultando lineas con solicitudes desde {} en el core.",
            from_date.format("%Y-%m-%d")
        );
        let result = self.evaluate_list(json!({
            "cmd": criteria,
            "tipo": "PreSolicitud.Module.Solicitud",
            "campos": "LineaPrestamo.ID;LineaPrestamo.Codigo;LineaPrestamo.Descripcion",
            "max": 50000,
        }))?;
        let Value::Array(rows) = result else {
            return Err(anyhow!(
                "EvaluateList del catalogo de lineas no devolvio una lista"
            ));
        };

        let total_rows = rows.len();
        let mut catalog = BTreeMap::<u64, CreditLineCatalogEntry>::new();
        for row in rows {
            let Some(raw_id) = read_indexed_value(
                &row,
                0,
                &["LineaPrestamo.ID", "lineaPrestamo.id", "ID", "Id", "id"],
            ) else {
                continue;
            };
            let id = raw_id
                .parse::<u64>()
                .with_context(|| format!("El core devolvio un ID de linea invalido: {raw_id}"))?;
            let codigo = read_indexed_value(
                &row,
                1,
                &[
                    "LineaPrestamo.Codigo",
                    "lineaPrestamo.codigo",
                    "Codigo",
                    "codigo",
                ],
            )
            .unwrap_or_default();
            let descripcion = read_indexed_value(
                &row,
                2,
                &[
                    "LineaPrestamo.Descripcion",
                    "lineaPrestamo.descripcion",
                    "Descripcion",
                    "descripcion",
                ],
            )
            .unwrap_or_default();
            let line = catalog.entry(id).or_insert_with(|| CreditLineCatalogEntry {
                id,
                codigo: codigo.clone(),
                descripcion: descripcion.clone(),
            });
            if line.codigo.is_empty() && !codigo.is_empty() {
                line.codigo = codigo;
            }
            if line.descripcion.is_empty() && !descripcion.is_empty() {
                line.descripcion = descripcion;
            }
        }
        let catalog = catalog.into_values().collect::<Vec<_>>();
        log::info!(
            "Core devolvio {} solicitudes y {} lineas distintas con actividad desde {}.",
            total_rows,
            catalog.len(),
            from_date.format("%Y-%m-%d")
        );
        Ok(catalog)
    }

    pub fn fetch_system_cuil_by_document(&self, document: &str) -> Result<Option<String>> {
        let Some(criteria) = build_numeric_eval_criteria("NroDoc", document) else {
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
        self.post_evaluate("EvaluateList", payload)
    }

    fn evaluate_obj(&self, payload: Value) -> Result<Value> {
        self.post_evaluate("EvaluateObj", payload)
    }

    fn post_evaluate(&self, endpoint: &str, payload: Value) -> Result<Value> {
        let url = format!("{}/api/Empresa/{endpoint}", self.base_url);
        log::debug!("POST {}", url);
        let response = self
            .http
            .post(&url)
            .json(&payload)
            .send()
            .with_context(|| format!("No se pudo consultar {endpoint} en el core financiero."))?;

        let status = response.status();
        let body = response
            .text()
            .with_context(|| format!("No se pudo leer la respuesta de {endpoint}."))?;

        if !status.is_success() {
            let detail = body.trim();
            return Err(anyhow!(
                "{endpoint} devolvio HTTP {}: {}",
                status,
                if detail.is_empty() {
                    "<body vacio>"
                } else {
                    detail
                }
            ));
        }

        serde_json::from_str::<Value>(&body)
            .with_context(|| format!("No se pudo decodificar la respuesta de {endpoint}."))
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
        credit_line_id: read_indexed_value(
            value,
            4,
            &[
                "Prestamo.LineaPrestamo.ID",
                "LineaPrestamo.ID",
                "lineaPrestamo.id",
            ],
        )
        .and_then(|raw| raw.parse::<u64>().ok()),
        credit_line_code: read_indexed_value(
            value,
            5,
            &[
                "Prestamo.LineaPrestamo.Codigo",
                "LineaPrestamo.Codigo",
                "lineaPrestamo.codigo",
            ],
        ),
        credit_line_description: read_indexed_value(
            value,
            6,
            &[
                "Prestamo.LineaPrestamo.Descripcion",
                "LineaPrestamo.Descripcion",
                "lineaPrestamo.descripcion",
            ],
        ),
        request_cuil: read_indexed_value(value, 7, &["CUIT", "Cuit", "cuit"]),
        request_document: read_indexed_value(
            value,
            8,
            &["NroDocumento", "nroDocumento", "NroDoc", "nroDoc"],
        ),
        transfer_cbu: read_indexed_value(
            value,
            9,
            &[
                "Prestamo.[CBU transferencia]",
                "Prestamo.CBU transferencia",
                "prestamo.cbu transferencia",
            ],
        ),
        bank_cmf_amount_raw: read_indexed_value(
            value,
            10,
            &["Prestamo.[Bco CMF]", "Prestamo.Bco CMF"],
        ),
        bank_cmf_amount: read_indexed_value(value, 10, &["Prestamo.[Bco CMF]", "Prestamo.Bco CMF"])
            .as_deref()
            .and_then(parse_decimal),
        bank_coinag_cba_amount_raw: read_indexed_value(
            value,
            11,
            &[
                "Prestamo.[Bco Coinag Cba]",
                "Prestamo.Bco Coinag Cba",
                "Prestamo.[Bco Coinag cba]",
            ],
        ),
        bank_coinag_cba_amount: read_indexed_value(
            value,
            11,
            &[
                "Prestamo.[Bco Coinag Cba]",
                "Prestamo.Bco Coinag Cba",
                "Prestamo.[Bco Coinag cba]",
            ],
        )
        .as_deref()
        .and_then(parse_decimal),
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

fn build_numeric_eval_criteria(field: &str, value: &str) -> Option<String> {
    let digits = normalize_digits(value)?;
    Some(format!("[{field}]={digits}"))
}

fn mask_value(value: &str, visible_suffix: usize) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= visible_suffix {
        return trimmed.to_owned();
    }
    format!("***{}", &trimmed[trimmed.len() - visible_suffix..])
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{build_eval_criteria, build_numeric_eval_criteria, parse_core_snapshot};

    #[test]
    fn numeric_criteria_strips_non_digits() {
        assert_eq!(
            build_numeric_eval_criteria("NroDoc", "F6542664").as_deref(),
            Some("[NroDoc]=6542664")
        );
        assert_eq!(
            build_numeric_eval_criteria("NroDoc", " 20-12345678-3 ").as_deref(),
            Some("[NroDoc]=20123456783")
        );
    }

    #[test]
    fn generic_criteria_still_quotes_non_numeric_values() {
        assert_eq!(
            build_eval_criteria("Oid", "SOL-123").as_deref(),
            Some("[Oid]='SOL-123'")
        );
    }

    #[test]
    fn snapshot_reads_credit_line_identity_from_indexed_response() {
        let snapshot = parse_core_snapshot(&json!([
            248948,
            "A Transferir",
            100000,
            "Persona",
            2771,
            11523,
            "AMEJUCA RECURRENTE PREMIUM",
            "20123456789",
            "12345678",
            "0200000000000000000000",
            0,
            100000
        ]));

        assert_eq!(snapshot.credit_line_id, Some(2771));
        assert_eq!(snapshot.credit_line_code.as_deref(), Some("11523"));
        assert_eq!(
            snapshot.credit_line_description.as_deref(),
            Some("AMEJUCA RECURRENTE PREMIUM")
        );
        assert_eq!(snapshot.request_document.as_deref(), Some("12345678"));
    }
}
