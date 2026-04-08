use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
    time::Instant,
};

use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use chrono::Utc;
use http::{Method, StatusCode};
use reqwest::blocking::Client;
use serde_json::{Value, json};

use crate::{
    config::CoinagConfig,
    models::HydratedCase,
    ssh_transport::{SshHttpClient, TransportRequest, TransportResponse},
    validation::{normalize_digits, parse_decimal},
};

#[derive(Clone)]
pub struct CoinagClient {
    direct_http: Option<Client>,
    ssh_http: Option<SshHttpClient>,
    config: CoinagConfig,
    token_cache: Arc<Mutex<TokenCache>>,
}

#[derive(Clone, Default)]
struct RequestBody {
    bytes: Vec<u8>,
    content_type: Option<&'static str>,
}

#[derive(Default)]
struct TokenCache {
    access_token: Option<String>,
    expires_at: Option<Instant>,
}

impl CoinagClient {
    pub fn new(config: &CoinagConfig, timeout: std::time::Duration) -> Result<Self> {
        let (direct_http, ssh_http) = if config.ssh.is_enabled() {
            (
                None,
                Some(SshHttpClient::new(
                    &config.ssh,
                    timeout,
                    config.allow_invalid_certs,
                )?),
            )
        } else {
            let http = Client::builder()
                .timeout(timeout)
                .danger_accept_invalid_certs(config.allow_invalid_certs)
                .build()
                .context("No se pudo construir el cliente HTTP de Coinag.")?;
            (Some(http), None)
        };

        Ok(Self {
            direct_http,
            ssh_http,
            config: config.clone(),
            token_cache: Arc::new(Mutex::new(TokenCache::default())),
        })
    }

    pub fn uses_ssh(&self) -> bool {
        self.ssh_http.is_some()
    }

    pub fn probe_get_status(&self, url: &str) -> Result<u16> {
        let response =
            self.execute_request(Method::GET, url, Vec::new(), RequestBody::default())?;
        Ok(response.status.as_u16())
    }

    pub fn lookup_cbu_cuil(&self, cbu: &str) -> Result<String> {
        let response = self.request_authorized_json(
            Method::GET,
            format!(
                "{}/Consulta/CBU/{}",
                self.config.api_base.trim_end_matches('/'),
                cbu
            ),
            RequestBody::default(),
        )?;
        extract_coinag_cuil(&response)
            .ok_or_else(|| anyhow!("Coinag no devolvio CUIL/CUIT para el CBU destino."))
    }

    pub fn build_transfer_payload(&self, case: &HydratedCase) -> Result<Value> {
        let cuit_debito = normalize_digits(self.config.cuit_debito.as_str())
            .ok_or_else(|| anyhow!("TRANSFERENCIAS_COINAG_CUIT_DEBITO no es valido."))?;
        let cbu_debito = normalize_digits(self.config.cbu_debito.as_str())
            .ok_or_else(|| anyhow!("TRANSFERENCIAS_COINAG_CBU_DEBITO no es valido."))?;
        let titular_debito = self.config.titular_debito.trim();
        if titular_debito.is_empty() {
            return Err(anyhow!(
                "TRANSFERENCIAS_COINAG_TITULAR_DEBITO es obligatorio para transferir."
            ));
        }

        let cuit_credito = case
            .core
            .request_cuil
            .as_deref()
            .or(case.core.document_cuil.as_deref())
            .and_then(normalize_digits)
            .ok_or_else(|| anyhow!("No se pudo resolver CUIL/CUIT de destino."))?;
        let cbu_credito = case
            .core
            .transfer_cbu
            .as_deref()
            .and_then(normalize_digits)
            .ok_or_else(|| anyhow!("No se pudo resolver el CBU de destino."))?;
        let amount = case
            .metamap
            .amount
            .or_else(|| case.metamap.amount_raw.as_deref().and_then(parse_decimal))
            .ok_or_else(|| anyhow!("No se pudo resolver el importe de la transferencia."))?;

        Ok(json!({
            "idTrxCliente": self.build_id_trx_cliente(
                case.metamap.request_number.as_deref(),
                Some(case.verification_id.as_str()),
            )?,
            "cuitDebito": cuit_debito,
            "cbuDebito": cbu_debito,
            "titularDebito": titular_debito,
            "cuitCredito": cuit_credito,
            "cbuCredito": cbu_credito,
            "concepto": self.config.concepto,
            "importe": amount.round_dp(2).to_string(),
            "descripcion": self.config.descripcion,
        }))
    }

    pub fn perform_transfer(&self, payload: &Value) -> Result<Value> {
        self.request_authorized_json(
            Method::POST,
            format!(
                "{}{}",
                self.config.api_base.trim_end_matches('/'),
                normalize_path(&self.config.endpoint),
            ),
            RequestBody::json(payload)?,
        )
    }

    pub fn extract_external_transfer_id(response: &Value) -> Option<String> {
        response
            .get("response")
            .and_then(|response| response.get("debito"))
            .and_then(|debito| {
                debito
                    .get("idTrx")
                    .or_else(|| debito.get("id"))
                    .or_else(|| debito.get("idTrxOriginal"))
            })
            .and_then(value_to_string)
    }

    fn request_authorized_json(
        &self,
        method: Method,
        url: String,
        body: RequestBody,
    ) -> Result<Value> {
        let response =
            self.execute_authorized_request(method.clone(), &url, body.clone(), false)?;
        if response.status == StatusCode::UNAUTHORIZED {
            let retried = self.execute_authorized_request(method, &url, body, true)?;
            return decode_json_response(retried);
        }
        decode_json_response(response)
    }

    fn execute_authorized_request(
        &self,
        method: Method,
        url: &str,
        body: RequestBody,
        force_refresh: bool,
    ) -> Result<TransportResponse> {
        let token = self.ensure_token(force_refresh)?;
        let mut headers = vec![(
            "Authorization".to_owned(),
            format!("{} {}", self.config.auth_scheme, token),
        )];
        if let Some(content_type) = body.content_type {
            headers.push(("Content-Type".to_owned(), content_type.to_owned()));
        }
        self.execute_request(method, url, headers, body)
    }

    fn execute_request(
        &self,
        method: Method,
        url: &str,
        headers: Vec<(String, String)>,
        body: RequestBody,
    ) -> Result<TransportResponse> {
        if let Some(ssh_http) = &self.ssh_http {
            return ssh_http.execute(TransportRequest {
                method,
                url: url.to_owned(),
                headers,
                body: body.bytes,
            });
        }

        let direct_http = self
            .direct_http
            .as_ref()
            .ok_or_else(|| anyhow!("No hay transporte HTTP disponible para Coinag."))?;
        let mut request = direct_http.request(method, url);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        if !body.bytes.is_empty() {
            request = request.body(body.bytes);
        }
        let response = request.send().context("No se pudo conectar con Coinag.")?;
        let status = response.status();
        let body = response
            .bytes()
            .context("No se pudo leer la respuesta HTTP de Coinag.")?
            .to_vec();
        Ok(TransportResponse { status, body })
    }

    fn ensure_token(&self, force_refresh: bool) -> Result<String> {
        if !force_refresh {
            if let Ok(cache) = self.token_cache.lock() {
                if let (Some(token), Some(expires_at)) = (&cache.access_token, cache.expires_at) {
                    if Instant::now() < expires_at {
                        return Ok(token.clone());
                    }
                }
            }
        }

        let mut form = vec![
            ("grant_type".to_owned(), "password".to_owned()),
            ("username".to_owned(), self.config.username.clone()),
            ("password".to_owned(), self.config.password.clone()),
        ];
        if !self.config.scope.is_empty() {
            form.push(("scope".to_owned(), self.config.scope.clone()));
        }
        if self.config.client_id.is_empty() || self.config.client_secret.is_empty() {
            if !self.config.client_id.is_empty() {
                form.push(("client_id".to_owned(), self.config.client_id.clone()));
            }
            if !self.config.client_secret.is_empty() {
                form.push((
                    "client_secret".to_owned(),
                    self.config.client_secret.clone(),
                ));
            }
        }

        let mut headers = vec![(
            "Content-Type".to_owned(),
            "application/x-www-form-urlencoded".to_owned(),
        )];
        if !self.config.client_id.is_empty() && !self.config.client_secret.is_empty() {
            headers.push((
                "Authorization".to_owned(),
                format!(
                    "Basic {}",
                    BASE64_STANDARD.encode(format!(
                        "{}:{}",
                        self.config.client_id, self.config.client_secret
                    ))
                ),
            ));
        }

        let response = self.execute_request(
            Method::POST,
            &self.config.token_url,
            headers,
            RequestBody::form(form)?,
        )?;
        let body =
            decode_json_response(response).context("Coinag devolvio error al solicitar token.")?;
        let access_token = body
            .get("access_token")
            .or_else(|| body.get("accessToken"))
            .or_else(|| body.get("token"))
            .and_then(value_to_string)
            .ok_or_else(|| anyhow!("Coinag no devolvio access_token."))?;
        let expires_in = body
            .get("expires_in")
            .or_else(|| body.get("expiresIn"))
            .and_then(|value| value.as_u64())
            .unwrap_or(3600);

        let expires_at = Instant::now()
            .checked_add(std::time::Duration::from_secs(
                expires_in.saturating_sub(60),
            ))
            .unwrap_or_else(Instant::now);

        let mut cache = self
            .token_cache
            .lock()
            .map_err(|_| anyhow!("No se pudo bloquear la cache de token Coinag."))?;
        cache.access_token = Some(access_token.clone());
        cache.expires_at = Some(expires_at);
        Ok(access_token)
    }

    fn build_id_trx_cliente(
        &self,
        request_number: Option<&str>,
        verification_id: Option<&str>,
    ) -> Result<String> {
        let empresa = normalize_digits(self.config.id_empresa.as_str());
        if let Some(empresa) = empresa {
            let next = read_and_increment_sequence(&self.config.id_seq_path)?;
            return Ok(format!("{empresa}{next:015}"));
        }
        let request = request_number
            .and_then(normalize_digits)
            .unwrap_or_else(|| "sol".to_owned());
        let verification_id = verification_id.unwrap_or("verif").replace(' ', "");
        let timestamp = Utc::now().format("%Y%m%d%H%M%S");
        Ok(format!("{request}-{verification_id}-{timestamp}")
            .chars()
            .take(100)
            .collect())
    }
}

impl RequestBody {
    fn json(value: &Value) -> Result<Self> {
        Ok(Self {
            bytes: serde_json::to_vec(value)
                .context("No se pudo serializar la request JSON para Coinag.")?,
            content_type: Some("application/json"),
        })
    }

    fn form(values: Vec<(String, String)>) -> Result<Self> {
        Ok(Self {
            bytes: serde_urlencoded::to_string(values)
                .context("No se pudo serializar el formulario para Coinag.")?
                .into_bytes(),
            content_type: Some("application/x-www-form-urlencoded"),
        })
    }
}

fn decode_json_response(response: TransportResponse) -> Result<Value> {
    if !response.status.is_success() {
        let body = String::from_utf8_lossy(&response.body);
        let body = body.trim();
        if body.is_empty() {
            return Err(anyhow!(
                "Coinag devolvio una respuesta HTTP no exitosa: {}.",
                response.status
            ));
        }
        let body = body.chars().take(300).collect::<String>();
        return Err(anyhow!(
            "Coinag devolvio una respuesta HTTP no exitosa: {}. Body: {}",
            response.status,
            body
        ));
    }
    serde_json::from_slice::<Value>(&response.body)
        .context("No se pudo decodificar la respuesta JSON de Coinag.")
}

fn extract_coinag_cuil(body: &Value) -> Option<String> {
    let response = body.get("response").unwrap_or(body);
    response
        .get("titulares")
        .and_then(|titulares| titulares.as_array())
        .and_then(|titulares| {
            titulares.iter().find_map(|titular| {
                titular
                    .get("cuit")
                    .or_else(|| titular.get("cuil"))
                    .or_else(|| titular.get("CUIT"))
                    .or_else(|| titular.get("CUIL"))
                    .and_then(value_to_string)
                    .and_then(|value| normalize_digits(value.as_str()))
            })
        })
        .or_else(|| {
            response
                .get("cuit")
                .or_else(|| response.get("cuil"))
                .or_else(|| response.get("CUIT"))
                .or_else(|| response.get("CUIL"))
                .and_then(value_to_string)
                .and_then(|value| normalize_digits(value.as_str()))
        })
        .or_else(|| {
            response
                .get("cuenta")
                .and_then(|cuenta| {
                    cuenta
                        .get("cuit")
                        .or_else(|| cuenta.get("cuil"))
                        .or_else(|| cuenta.get("CUIT"))
                        .or_else(|| cuenta.get("CUIL"))
                })
                .and_then(value_to_string)
                .and_then(|value| normalize_digits(value.as_str()))
        })
}

fn normalize_path(path: &str) -> String {
    if path.starts_with('/') {
        path.to_owned()
    } else {
        format!("/{path}")
    }
}

fn value_to_string(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.trim().to_owned()).filter(|text| !text.is_empty()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn read_and_increment_sequence(path: &Path) -> Result<u64> {
    let mut next = 1;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).with_context(|| {
                format!("No se pudo crear la carpeta del secuencial {:?}", parent)
            })?;
        }
    }
    if path.exists() {
        let raw_value = fs::read_to_string(path)
            .with_context(|| format!("No se pudo leer el secuencial {:?}", path))?;
        let raw_value = raw_value.trim();
        if !raw_value.is_empty() {
            next = raw_value
                .parse::<u64>()
                .with_context(|| format!("Secuencial invalido en {:?}", path))?
                + 1;
        }
    }
    fs::write(path, next.to_string())
        .with_context(|| format!("No se pudo persistir el secuencial {:?}", path))?;
    Ok(next)
}
