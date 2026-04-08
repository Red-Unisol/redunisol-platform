use anyhow::{Context, Result};
use reqwest::blocking::Client;
use serde_json::Value;

use crate::{config::MetamapConfig, models::MetamapSnapshot, validation::parse_decimal};

#[derive(Clone)]
pub struct MetamapClient {
    http: Client,
    api_token: String,
    auth_scheme: String,
}

impl MetamapClient {
    pub fn new(config: &MetamapConfig, timeout: std::time::Duration) -> Result<Self> {
        let http = Client::builder()
            .timeout(timeout)
            .danger_accept_invalid_certs(config.allow_invalid_certs)
            .build()
            .context("No se pudo construir el cliente HTTP de MetaMap.")?;
        Ok(Self {
            http,
            api_token: config.api_token.clone(),
            auth_scheme: config.auth_scheme.clone(),
        })
    }

    pub fn fetch_snapshot(&self, resource_url: &str) -> Result<MetamapSnapshot> {
        let response = self
            .http
            .get(resource_url)
            .header(
                "Authorization",
                format!("{} {}", self.auth_scheme, self.api_token),
            )
            .send()
            .with_context(|| format!("No se pudo consultar MetaMap para {resource_url}."))?
            .error_for_status()
            .with_context(|| format!("MetaMap devolvio error para {resource_url}."))?;
        let payload = response
            .json::<Value>()
            .context("No se pudo decodificar la respuesta JSON de MetaMap.")?;
        let amount_raw = extract_transfer_amount(&payload);
        Ok(MetamapSnapshot {
            name: extract_name(&payload),
            document: extract_document(&payload),
            request_number: extract_request_number(&payload),
            amount: amount_raw.as_deref().and_then(parse_decimal),
            amount_raw,
        })
    }
}

fn extract_name(payload: &Value) -> String {
    search_exact(
        payload,
        &[
            "name",
            "fullName",
            "full_name",
            "applicantName",
            "applicant_name",
        ],
    )
    .or_else(|| {
        let first = search_exact(payload, &["firstName", "first_name"])?;
        let last = search_exact(payload, &["lastName", "last_name"]);
        Some(match last {
            Some(last) => format!("{first} {last}"),
            None => first,
        })
    })
    .unwrap_or_else(|| "Nombre desconocido".to_owned())
}

fn extract_document(payload: &Value) -> Option<String> {
    search_exact(
        payload,
        &[
            "documentNumber",
            "document_number",
            "documentId",
            "document_id",
            "dni",
            "nationalId",
            "national_id",
            "personalNumber",
        ],
    )
}

fn extract_request_number(payload: &Value) -> Option<String> {
    iter_labeled_values(payload)
        .into_iter()
        .find(|(label, _)| label_matches(label, &["solicitud"]))
        .map(|(_, value)| value)
        .or_else(|| search_key_contains(payload, &["solicitud"]))
}

fn extract_transfer_amount(payload: &Value) -> Option<String> {
    iter_labeled_values(payload)
        .into_iter()
        .find(|(label, _)| label_matches(label, &["importe solicitado"]))
        .map(|(_, value)| value)
        .or_else(|| search_key_contains(payload, &["importe solicitado"]))
}

fn label_matches(label: &str, keywords: &[&str]) -> bool {
    let normalized = normalize_label(label);
    keywords
        .iter()
        .any(|keyword| normalized.contains(&normalize_label(keyword)))
}

fn normalize_label(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .replace('_', " ")
        .replace('-', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn search_exact(payload: &Value, keys: &[&str]) -> Option<String> {
    let mut stack = vec![payload];
    while let Some(current) = stack.pop() {
        match current {
            Value::Object(map) => {
                for (key, value) in map {
                    if keys.iter().any(|expected| key == expected) {
                        if let Some(text) = value_to_string(value) {
                            return Some(text);
                        }
                    }
                    if matches!(value, Value::Object(_) | Value::Array(_)) {
                        stack.push(value);
                    }
                }
            }
            Value::Array(items) => stack.extend(items.iter()),
            _ => {}
        }
    }
    None
}

fn search_key_contains(payload: &Value, keywords: &[&str]) -> Option<String> {
    let mut stack = vec![payload];
    while let Some(current) = stack.pop() {
        match current {
            Value::Object(map) => {
                for (key, value) in map {
                    if label_matches(key, keywords) {
                        if let Some(text) = value_to_string(value) {
                            return Some(text);
                        }
                    }
                    if matches!(value, Value::Object(_) | Value::Array(_)) {
                        stack.push(value);
                    }
                }
            }
            Value::Array(items) => stack.extend(items.iter()),
            _ => {}
        }
    }
    None
}

fn iter_labeled_values(payload: &Value) -> Vec<(String, String)> {
    let mut matches = Vec::new();
    let mut stack = vec![payload];
    while let Some(current) = stack.pop() {
        match current {
            Value::Object(map) => {
                let label = ["title", "label", "name"]
                    .iter()
                    .find_map(|key| map.get(*key).and_then(value_to_string));
                let value = map
                    .get("value")
                    .and_then(value_to_string)
                    .or_else(|| {
                        map.get("atomicFieldParams")
                            .and_then(|field| field.get("value"))
                            .and_then(value_to_string)
                    })
                    .or_else(|| {
                        map.get("atomicFieldParams")
                            .and_then(|field| field.get("defaultValue"))
                            .and_then(value_to_string)
                    });
                if let (Some(label), Some(value)) = (label, value) {
                    matches.push((label, value));
                }
                for value in map.values() {
                    if matches!(value, Value::Object(_) | Value::Array(_)) {
                        stack.push(value);
                    }
                }
            }
            Value::Array(items) => stack.extend(items.iter()),
            _ => {}
        }
    }
    matches
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
        Value::Object(map) => map.get("value").and_then(value_to_string),
        _ => None,
    }
}
