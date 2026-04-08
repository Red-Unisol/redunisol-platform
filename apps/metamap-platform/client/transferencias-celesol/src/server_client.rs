use anyhow::{Context, Result, anyhow};
use reqwest::blocking::{Client, Response};
use serde_json::json;

use crate::{
    config::ServerConfig,
    models::{CaseActionResponse, QueueResponse},
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

    pub fn list_transfer_queue(&self) -> Result<QueueResponse> {
        let response = self.request(
            self.http
                .get(format!(
                    "{}/api/v1/queues/transferencias_celesol",
                    self.base_url
                ))
                .header("X-Client-Id", &self.client_id)
                .header("X-Client-Secret", &self.client_secret),
        )?;
        response
            .json::<QueueResponse>()
            .context("No se pudo decodificar la respuesta de la cola del server.")
    }

    pub fn initiate_transfer(&self, case_id: &str, actor: &str) -> Result<CaseActionResponse> {
        self.post_action(case_id, "transfer_initiated", actor, None)
    }

    pub fn mark_transfer_submitted(
        &self,
        case_id: &str,
        actor: &str,
        external_transfer_id: &str,
    ) -> Result<CaseActionResponse> {
        self.post_action(
            case_id,
            "transfer_submitted",
            actor,
            Some(external_transfer_id),
        )
    }

    fn post_action(
        &self,
        case_id: &str,
        action: &str,
        actor: &str,
        external_transfer_id: Option<&str>,
    ) -> Result<CaseActionResponse> {
        let response = self.request(
            self.http
                .post(format!("{}/api/v1/cases/{case_id}/actions", self.base_url))
                .header("X-Client-Id", &self.client_id)
                .header("X-Client-Secret", &self.client_secret)
                .json(&json!({
                    "role": "transferencias_celesol",
                    "action": action,
                    "actor": actor,
                    "external_transfer_id": external_transfer_id,
                })),
        )?;
        response
            .json::<CaseActionResponse>()
            .context("No se pudo decodificar la respuesta de accion del server.")
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
