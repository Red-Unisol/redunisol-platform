use anyhow::{Context, Result, anyhow};
use reqwest::blocking::{Client, Response};

use crate::{
    config::ServerConfig,
    models::{ValidationSearchResponse, ValidationSnapshot},
};

#[derive(Clone)]
pub struct ServerClient {
    http: Client,
    base_url: String,
    client_id: String,
    client_secret: String,
}

impl ServerClient {
    pub fn new(config: &ServerConfig, timeout: std::time::Duration) -> Result<Self> {
        let http = Client::builder()
            .timeout(timeout)
            .danger_accept_invalid_certs(config.allow_invalid_certs)
            .build()
            .context("No se pudo construir el cliente HTTP del server.")?;
        Ok(Self {
            http,
            base_url: config.base_url.trim_end_matches('/').to_owned(),
            client_id: config.client_id.clone(),
            client_secret: config.client_secret.clone(),
        })
    }

    pub fn find_validation_by_request_number(
        &self,
        request_number: &str,
    ) -> Result<Option<ValidationSnapshot>> {
        log::debug!(
            "Buscando validacion completed en server para solicitud {}.",
            request_number.trim()
        );
        let response = self.request(
            self.http
                .get(format!("{}/api/v1/validations", self.base_url))
                .header("X-Client-Id", &self.client_id)
                .header("X-Client-Secret", &self.client_secret)
                .query(&[
                    ("request_number", request_number.trim()),
                    ("normalized_status", "completed"),
                    ("limit", "10"),
                ]),
        )?;
        let mut payload = response
            .json::<ValidationSearchResponse>()
            .context("No se pudo decodificar la respuesta de validaciones del server.")?;
        if payload.items.is_empty() {
            log::debug!(
                "Server no devolvio validacion completed para solicitud {}.",
                request_number.trim()
            );
            return Ok(None);
        }

        let match_count = payload.items.len();
        let mut selected = payload.items.remove(0);
        selected.match_count = match_count;
        log::debug!(
            "Server devolvio {} validaciones para solicitud {}. Elegida verification_id={:?}.",
            match_count,
            request_number.trim(),
            selected.verification_id
        );
        Ok(Some(selected))
    }

    fn request(&self, builder: reqwest::blocking::RequestBuilder) -> Result<Response> {
        let response = builder
            .send()
            .context("No se pudo conectar con el server.")?;
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status();
        let detail = extract_error_body(response);
        log::warn!("Server devolvio {status}: {detail}");
        Err(anyhow!("Server devolvio {status}: {detail}"))
    }
}

fn extract_error_body(response: Response) -> String {
    let text = response.text().unwrap_or_else(|_| "sin detalle".to_owned());
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|body| {
            body.get("detail")
                .and_then(|value| value.as_str())
                .map(str::to_owned)
        })
        .unwrap_or(text)
}
