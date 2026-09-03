use std::{
    sync::{Arc, Mutex},
    time::Instant,
};

use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use chrono::{Local, Utc};
use http::{Method, StatusCode};
use reqwest::blocking::Client;
use serde_json::{Value, json};

use crate::{
    cancellations::{TransferLeg, TransferLegKind},
    config::CoinagConfig,
    models::{CoinagTransferGuard, HydratedCase},
    ssh_transport::{SshHttpClient, TransportRequest, TransportResponse},
    trace,
    validation::{format_money, normalize_digits, parse_decimal},
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

#[derive(Clone, Debug, Default)]
pub struct AvailableBalanceSnapshot {
    pub amount: Option<rust_decimal::Decimal>,
    pub source: Option<&'static str>,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct TransferLookupResponse {
    pub request_number: String,
    pub id_trx_cliente: String,
    pub body: Value,
}

#[derive(Clone, Debug)]
pub struct CbuLookupResponse {
    pub cuil: Option<String>,
    pub holder_name: Option<String>,
    pub account_type_code: Option<String>,
    pub account_type_label: Option<String>,
}

#[derive(Clone, Debug)]
pub struct CoelsaTransferLookupResponse {
    pub id_coelsa: String,
    pub body: Value,
    pub status: CoelsaTransferStatus,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CoelsaTransferStatus {
    Confirmed,
    Rejected { detail: String },
    Pending { detail: String },
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
        .inspect(|client| {
            log::info!(
                "Cliente Coinag inicializado via {}.",
                if client.uses_ssh() {
                    "ssh"
                } else {
                    "http directo"
                }
            );
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
        self.lookup_cbu_details(cbu)?
            .cuil
            .ok_or_else(|| anyhow!("Coinag no devolvio CUIL/CUIT para el CBU destino."))
    }

    pub fn lookup_cbu_details(&self, cbu: &str) -> Result<CbuLookupResponse> {
        log::debug!(
            "Consultando titularidad Coinag para CBU {}.",
            mask_value(cbu, 6)
        );
        let response = self.request_authorized_json(
            Method::GET,
            format!(
                "{}/Consulta/CBU/{}",
                self.config.lookup_api_base.trim_end_matches('/'),
                cbu
            ),
            RequestBody::default(),
        )?;
        let coinag_cuil = extract_coinag_cuil(&response);
        let holder_name = extract_coinag_holder_name(&response);
        let account_type_code = extract_cbu_account_type_code(&response);
        let account_type_label = account_type_code
            .as_deref()
            .and_then(coinag_account_type_label)
            .map(str::to_owned);
        log::debug!(
            "Coinag devolvio titularidad {} y tipoCuenta {:?} para CBU {}.",
            coinag_cuil
                .as_deref()
                .map(|value| mask_value(value, 4))
                .unwrap_or_else(|| "N/D".to_owned()),
            account_type_code,
            mask_value(cbu, 6),
        );
        Ok(CbuLookupResponse {
            cuil: coinag_cuil,
            holder_name,
            account_type_code,
            account_type_label,
        })
    }

    pub fn can_fetch_balance(&self) -> bool {
        !self.config.balance_api_base.trim().is_empty()
            && normalize_digits(self.config.cbu_debito.as_str()).is_some()
    }

    pub fn fetch_available_balance_snapshot(&self) -> AvailableBalanceSnapshot {
        let Some(cbu) = normalize_digits(self.config.cbu_debito.as_str()) else {
            return AvailableBalanceSnapshot {
                error: Some("CBU debito no configurado".to_owned()),
                ..Default::default()
            };
        };
        if self.config.balance_api_base.trim().is_empty() {
            return AvailableBalanceSnapshot {
                error: Some("Base de saldo Coinag no configurada".to_owned()),
                ..Default::default()
            };
        }

        match self.fetch_saldo_actual(&cbu) {
            Ok(response) => {
                let amount = response
                    .get("response")
                    .and_then(extract_balance_amount)
                    .or_else(|| extract_balance_amount(&response));
                if let Some(amount) = amount {
                    log::debug!(
                        "SaldoActual Coinag obtenido desde campo Saldo: {} para CBU {}.",
                        format_money(amount),
                        mask_value(&cbu, 6)
                    );
                    AvailableBalanceSnapshot {
                        amount: Some(amount),
                        source: Some("SaldoActual"),
                        error: None,
                    }
                } else {
                    log::warn!(
                        "SaldoActual Coinag no devolvio un campo Saldo interpretable para CBU {}.",
                        mask_value(&cbu, 6)
                    );
                    AvailableBalanceSnapshot {
                        amount: None,
                        source: None,
                        error: Some("SaldoActual no devolvio campo Saldo interpretable".to_owned()),
                    }
                }
            }
            Err(error) => {
                log::warn!(
                    "Fallo la consulta de SaldoActual Coinag para CBU {}: {error:#}",
                    mask_value(&cbu, 6)
                );
                AvailableBalanceSnapshot {
                    amount: None,
                    source: None,
                    error: Some(error.to_string()),
                }
            }
        }
    }

    pub fn build_available_balance_text(&self) -> String {
        let snapshot = self.fetch_available_balance_snapshot();
        let suffix = match snapshot.source {
            Some(source) => format!("{source}, {}", Local::now().format("%H:%M:%S")),
            None => Local::now().format("%H:%M:%S").to_string(),
        };
        if let Some(amount) = snapshot.amount {
            return format!("Saldo actual: {} ({suffix})", format_money(amount));
        }
        let detail = snapshot.error.unwrap_or_else(|| "sin datos".to_owned());
        format!("Saldo actual: no disponible ({detail}, {suffix})")
    }

    pub fn lookup_transfer_by_request_number(
        &self,
        request_number: &str,
    ) -> Result<TransferLookupResponse> {
        match self.request_transfer_lookup(request_number) {
            Ok(response) => Ok(response),
            Err(error) if is_transfer_not_found_error(&error) => Err(anyhow!(
                "No hubo transferencia para esa solicitud en Coinag."
            )),
            Err(error) => Err(error),
        }
    }

    pub fn fetch_transfer_guard_status(&self, request_number: &str) -> CoinagTransferGuard {
        match self.request_transfer_lookup(request_number) {
            Ok(response) => map_transfer_guard_status(&response.body),
            Err(error) if is_transfer_not_found_error(&error) => CoinagTransferGuard::NotFound,
            Err(error) => CoinagTransferGuard::Error {
                detail: error.to_string(),
            },
        }
    }

    pub fn fetch_transfer_guard_status_by_id(&self, id_trx_cliente: &str) -> CoinagTransferGuard {
        match self.request_transfer_lookup_by_id(id_trx_cliente) {
            Ok(response) => map_transfer_guard_status(&response.body),
            Err(error) if is_transfer_not_found_error(&error) => CoinagTransferGuard::NotFound,
            Err(error) => CoinagTransferGuard::Error {
                detail: error.to_string(),
            },
        }
    }

    pub fn lookup_transfer_by_id_trx_cliente(
        &self,
        id_trx_cliente: &str,
    ) -> Result<Option<TransferLookupResponse>> {
        match self.request_transfer_lookup_by_id(id_trx_cliente) {
            Ok(response) => Ok(Some(response)),
            Err(error) if is_transfer_not_found_error(&error) => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn transfer_guard_from_lookup(response: &TransferLookupResponse) -> CoinagTransferGuard {
        map_transfer_guard_status(&response.body)
    }

    pub fn verify_lookup_matches_leg(
        response: &TransferLookupResponse,
        leg: &TransferLeg,
    ) -> Result<()> {
        let root = response.body.get("response").unwrap_or(&response.body);
        let cbu = find_value_by_key(root, "cbuCredito")
            .or_else(|| {
                root.get("credito")
                    .and_then(|value| find_value_by_key(value, "cbu"))
            })
            .and_then(value_to_string)
            .and_then(normalize_digits)
            .ok_or_else(|| anyhow!("Coinag no devolvio el CBU credito de la pata existente."))?;
        let cuit = find_value_by_key(root, "cuitCredito")
            .or_else(|| {
                root.get("credito")
                    .and_then(|value| find_value_by_key(value, "cuit"))
            })
            .and_then(value_to_string)
            .and_then(normalize_digits)
            .ok_or_else(|| anyhow!("Coinag no devolvio el CUIT credito de la pata existente."))?;
        let amount = find_value_by_key(root, "importe")
            .and_then(value_to_string)
            .and_then(|value| parse_decimal(&value))
            .ok_or_else(|| anyhow!("Coinag no devolvio el importe de la pata existente."))?;
        if normalize_digits(&leg.cbu).as_deref() != Some(cbu.as_str())
            || normalize_digits(&leg.cuit).as_deref() != Some(cuit.as_str())
            || leg.amount.round_dp(2) != amount.round_dp(2)
        {
            return Err(anyhow!(
                "La pata existente en Coinag no coincide con CBU, CUIT e importe del plan actual."
            ));
        }
        Ok(())
    }

    pub fn lookup_transfer_by_id_coelsa(
        &self,
        id_coelsa: &str,
    ) -> Result<CoelsaTransferLookupResponse> {
        let id_coelsa = id_coelsa.trim();
        if id_coelsa.is_empty() {
            return Err(anyhow!("Id Coelsa vacio."));
        }
        log::info!("Consultando transferencia Coinag por idCoelsa {id_coelsa}.");
        let body = self.request_authorized_json(
            Method::GET,
            format!(
                "{}/TransferenciaByIdCoelsa/{}",
                self.config.lookup_api_base.trim_end_matches('/'),
                id_coelsa
            ),
            RequestBody::default(),
        )?;
        let status = classify_coelsa_transfer_status(&body);
        log::info!(
            target: "transfer_audit",
            "{}",
            json!({
                "event": "coinag_confirmation_lookup",
                "id_coelsa": id_coelsa,
                "classification": coelsa_status_label(&status),
                "classification_detail": coelsa_status_detail(&status),
                "response": body,
            })
        );
        Ok(CoelsaTransferLookupResponse {
            id_coelsa: id_coelsa.to_owned(),
            status,
            body,
        })
    }

    fn request_transfer_lookup(&self, request_number: &str) -> Result<TransferLookupResponse> {
        let normalized_request_number = normalize_digits(request_number).ok_or_else(|| {
            anyhow!("Numero de solicitud invalido. Ingresa digitos, con o sin puntos.")
        })?;
        let id_trx_cliente =
            self.build_request_lookup_id_trx_cliente(&normalized_request_number)?;
        log::info!(
            "Consultando transferencia Coinag para solicitud {} con idTrxCliente {}.",
            normalized_request_number,
            id_trx_cliente
        );
        self.request_transfer_lookup_by_id(&id_trx_cliente)
            .map(|mut response| {
                response.request_number = normalized_request_number;
                response
            })
    }

    fn request_transfer_lookup_by_id(
        &self,
        id_trx_cliente: &str,
    ) -> Result<TransferLookupResponse> {
        let body = self.request_authorized_json(
            Method::GET,
            format!(
                "{}/TransferenciaByIdTrxCliente/{}",
                self.config.lookup_api_base.trim_end_matches('/'),
                id_trx_cliente
            ),
            RequestBody::default(),
        )?;
        Ok(TransferLookupResponse {
            request_number: String::new(),
            id_trx_cliente: id_trx_cliente.to_owned(),
            body,
        })
    }

    pub fn build_transfer_payload(&self, case: &HydratedCase) -> Result<Value> {
        if crate::cancellations::is_candidate(&case.core) {
            return Err(anyhow!(
                "Una cancelacion debe ejecutarse por patas; se rechazo el payload unico."
            ));
        }
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
            .transfer_amount_resolution()
            .transfer_amount
            .ok_or_else(|| anyhow!("No se pudo resolver el importe de la transferencia."))?;

        Ok(json!({
            "idTrxCliente": self.build_id_trx_cliente(
                Some(case.request_oid()),
                case.server_validation.verification_id.as_deref(),
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

    pub fn build_transfer_leg_payload(
        &self,
        case: &HydratedCase,
        leg: &TransferLeg,
    ) -> Result<Value> {
        let cuit_debito = normalize_digits(self.config.cuit_debito.as_str())
            .ok_or_else(|| anyhow!("TRANSFERENCIAS_COINAG_CUIT_DEBITO no es valido."))?;
        let cbu_debito = normalize_digits(self.config.cbu_debito.as_str())
            .ok_or_else(|| anyhow!("TRANSFERENCIAS_COINAG_CBU_DEBITO no es valido."))?;
        let titular_debito = self.config.titular_debito.trim();
        if titular_debito.is_empty() {
            return Err(anyhow!(
                "TRANSFERENCIAS_COINAG_TITULAR_DEBITO es obligatorio."
            ));
        }
        Ok(json!({
            "idTrxCliente": self.build_cancellation_id_trx_cliente(case.request_oid(), leg)?,
            "cuitDebito": cuit_debito,
            "cbuDebito": cbu_debito,
            "titularDebito": titular_debito,
            "cuitCredito": leg.cuit,
            "cbuCredito": leg.cbu,
            "concepto": self.config.concepto,
            "importe": leg.amount.round_dp(2).to_string(),
            "descripcion": self.config.descripcion,
        }))
    }

    pub fn build_cancellation_id_trx_cliente(
        &self,
        request_number: &str,
        leg: &TransferLeg,
    ) -> Result<String> {
        let empresa = normalize_digits(self.config.id_empresa.as_str()).ok_or_else(|| {
            anyhow!("TRANSFERENCIAS_COINAG_ID_EMPRESA es obligatorio para cancelaciones.")
        })?;
        let request = normalize_digits(request_number)
            .ok_or_else(|| anyhow!("Numero de solicitud invalido."))?;
        if request.len() > 8 {
            return Err(anyhow!(
                "La solicitud excede los 8 digitos admitidos para patas."
            ));
        }
        let (kind, reference) = match leg.kind {
            TransferLegKind::Member => ('1', 0_u64),
            TransferLegKind::Creditor => {
                let id = leg
                    .key
                    .strip_prefix("creditor:")
                    .and_then(|value| value.parse::<u64>().ok())
                    .ok_or_else(|| anyhow!("Clave de acreedor invalida: {}", leg.key))?;
                ('2', id)
            }
        };
        if reference > 999_999 {
            return Err(anyhow!("El ID de detalle excede 6 digitos: {reference}"));
        }
        Ok(format!("{empresa}{request:0>8}{kind}{reference:0>6}"))
    }

    fn fetch_saldo_actual(&self, cbu: &str) -> Result<Value> {
        log::debug!(
            "Consultando SaldoActual Coinag para CBU {}.",
            mask_value(cbu, 6)
        );
        self.request_authorized_json(
            Method::GET,
            format!(
                "{}/SaldoActual?cbu={}",
                self.config.balance_api_base.trim_end_matches('/'),
                cbu
            ),
            RequestBody::default(),
        )
    }

    pub fn transfer_is_smoke(&self) -> bool {
        cfg!(debug_assertions)
    }

    pub fn perform_transfer(&self, payload: &Value) -> Result<Value> {
        #[cfg(debug_assertions)]
        {
            self.perform_smoke_transfer(payload)
        }

        #[cfg(not(debug_assertions))]
        {
            log::info!(
                "Enviando transferencia a Coinag: idTrxCliente={:?}, cbuCredito={}, importe={:?}.",
                payload.get("idTrxCliente").and_then(value_to_string),
                payload
                    .get("cbuCredito")
                    .and_then(value_to_string)
                    .map(|value| mask_value(&value, 6))
                    .unwrap_or_else(|| "N/D".to_owned()),
                payload.get("importe").and_then(value_to_string)
            );
            self.request_authorized_json(
                Method::POST,
                format!(
                    "{}{}",
                    self.config.transfer_api_base.trim_end_matches('/'),
                    normalize_path(&self.config.endpoint),
                ),
                RequestBody::json(payload)?,
            )
        }
    }

    #[cfg(debug_assertions)]
    fn perform_smoke_transfer(&self, payload: &Value) -> Result<Value> {
        let output_path = self.write_smoke_transfer_payload(payload)?;
        log::info!(
            "Debug build: transferencia en modo smoke para idTrxCliente={:?}. Archivo={:?}.",
            payload.get("idTrxCliente").and_then(value_to_string),
            output_path
        );
        Ok(json!({
            "smoke": true,
            "smoke_output_path": output_path.display().to_string(),
            "response": {
                "debito": {
                    "idTrx": format!(
                        "SMOKE-{}",
                        payload
                            .get("idTrxCliente")
                            .and_then(value_to_string)
                            .unwrap_or_else(|| "SIN-ID".to_owned())
                    )
                }
            }
        }))
    }

    #[cfg(debug_assertions)]
    fn write_smoke_transfer_payload(&self, payload: &Value) -> Result<std::path::PathBuf> {
        use std::fs;

        fs::create_dir_all(&self.config.smoke_transfers_dir).with_context(|| {
            format!(
                "No se pudo crear la carpeta de smoke {:?}",
                self.config.smoke_transfers_dir
            )
        })?;

        let timestamp = Utc::now().format("%Y%m%d-%H%M%S");
        let request_id = payload
            .get("idTrxCliente")
            .and_then(value_to_string)
            .unwrap_or_else(|| "transferencia".to_owned());
        let file_name = format!("{}-{}.json", timestamp, sanitize_filename(&request_id));
        let output_path = self.config.smoke_transfers_dir.join(file_name);
        let contents = serde_json::to_string_pretty(&json!({
            "mode": "smoke",
            "generated_at_utc": Utc::now().to_rfc3339(),
            "url": format!(
                "{}{}",
                self.config.transfer_api_base.trim_end_matches('/'),
                normalize_path(&self.config.endpoint),
            ),
            "body": payload,
        }))
        .context("No se pudo serializar el payload smoke de Coinag.")?;
        fs::write(&output_path, contents).with_context(|| {
            format!(
                "No se pudo escribir el archivo smoke de Coinag {:?}",
                output_path
            )
        })?;
        Ok(output_path)
    }

    pub fn extract_external_transfer_id(response: &Value) -> Option<String> {
        response
            .get("debito")
            .or_else(|| {
                response
                    .get("response")
                    .and_then(|value| value.get("debito"))
            })
            .and_then(|debito| debito.get("idTrx").or_else(|| debito.get("id")))
            .and_then(value_to_string)
    }

    pub fn classify_transfer_response(response: &Value) -> CoelsaTransferStatus {
        classify_coelsa_transfer_status(response)
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
            log::warn!("Coinag respondio 401 para {url}. Se fuerza refresh de token.");
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
        let method_name = method.to_string();
        let is_token_request =
            url.trim_end_matches('/') == self.config.token_url.trim_end_matches('/');
        if !is_token_request {
            trace::record_audit(
                "coinag_http_request",
                None,
                None,
                json!({
                    "method": method_name,
                    "url": url,
                    "body": String::from_utf8_lossy(&body.bytes),
                }),
            );
            log::info!(
                target: "coinag_http",
                "{}",
                json!({
                    "event": "http_request",
                    "method": method_name,
                    "url": url,
                    "body": String::from_utf8_lossy(&body.bytes),
                })
            );
        }

        if let Some(ssh_http) = &self.ssh_http {
            log::debug!("Coinag via SSH: {} {}", method, url);
            let response = ssh_http.execute(TransportRequest {
                method,
                url: url.to_owned(),
                headers,
                body: body.bytes,
            })?;
            log_coinag_http_response(&method_name, url, &response, is_token_request);
            return Ok(response);
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
        log::debug!("Coinag respondio {} para {} {}.", status, method_name, url);
        let response = TransportResponse { status, body };
        log_coinag_http_response(&method_name, url, &response, is_token_request);
        Ok(response)
    }

    fn ensure_token(&self, force_refresh: bool) -> Result<String> {
        if !force_refresh {
            if let Ok(cache) = self.token_cache.lock() {
                if let (Some(token), Some(expires_at)) = (&cache.access_token, cache.expires_at) {
                    if Instant::now() < expires_at {
                        log::debug!("Reutilizando token Coinag desde cache.");
                        return Ok(token.clone());
                    }
                }
            }
        }
        log::debug!("Solicitando nuevo token a Coinag.");

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
        log::debug!("Token Coinag actualizado. Expires in={}s.", expires_in);
        Ok(access_token)
    }

    pub fn build_request_lookup_id_trx_cliente(&self, request_number: &str) -> Result<String> {
        let empresa = normalize_digits(self.config.id_empresa.as_str()).ok_or_else(|| {
            anyhow!(
                "TRANSFERENCIAS_COINAG_ID_EMPRESA es obligatorio para consultar una transferencia por numero de solicitud."
            )
        })?;
        let request_number = normalize_digits(request_number)
            .ok_or_else(|| anyhow!("Numero de solicitud invalido. Ingresa solo digitos."))?;
        let suffix = build_request_based_transaction_suffix(&request_number)?;
        Ok(format!("{empresa}{suffix}"))
    }

    fn build_id_trx_cliente(
        &self,
        request_number: Option<&str>,
        verification_id: Option<&str>,
    ) -> Result<String> {
        if !self.config.id_empresa.trim().is_empty() {
            let request_number = request_number.ok_or_else(|| {
                anyhow!("No se pudo generar idTrxCliente: falta numero de solicitud numerico.")
            })?;
            return self.build_request_lookup_id_trx_cliente(request_number);
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
    #[cfg(not(debug_assertions))]
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

fn extract_coinag_holder_name(body: &Value) -> Option<String> {
    let response = body.get("response").unwrap_or(body);
    response
        .get("titulares")
        .and_then(Value::as_array)
        .and_then(|titulares| {
            titulares.iter().find_map(|titular| {
                ["razonSocial", "nombre", "denominacion", "titular"]
                    .into_iter()
                    .find_map(|key| titular.get(key).and_then(value_to_string))
            })
        })
        .or_else(|| {
            ["razonSocial", "nombre", "denominacion", "titular"]
                .into_iter()
                .find_map(|key| response.get(key).and_then(value_to_string))
        })
}

fn extract_cbu_account_type_code(body: &Value) -> Option<String> {
    let response = body.get("response").unwrap_or(body);
    response
        .get("cuenta")
        .and_then(|cuenta| {
            cuenta
                .get("tipoCuenta")
                .or_else(|| cuenta.get("tipo"))
                .or_else(|| cuenta.get("tipo_cuenta"))
        })
        .and_then(value_to_string)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn coinag_account_type_label(code: &str) -> Option<&'static str> {
    match code.trim() {
        "1" => Some("CVU"),
        "10" => Some("CA Pesos"),
        "20" => Some("CC Pesos"),
        "11" => Some("CA Dolares"),
        "21" => Some("CC Dolares"),
        "30" => Some("CC Especiales Pesos"),
        "31" => Some("CC Especiales Dolares"),
        _ => None,
    }
}

fn extract_balance_amount(body: &Value) -> Option<rust_decimal::Decimal> {
    match body {
        Value::Array(items) => items.iter().find_map(extract_balance_amount),
        Value::Object(map) => {
            for (key, value) in map {
                if key.eq_ignore_ascii_case("saldo") {
                    if let Some(text) = value_to_string(value) {
                        if let Some(amount) = parse_decimal(&text) {
                            return Some(amount);
                        }
                    }
                }
            }
            map.values().find_map(extract_balance_amount)
        }
        _ => None,
    }
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

fn find_value_by_key<'a>(value: &'a Value, expected: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => map
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(expected))
            .map(|(_, value)| value)
            .or_else(|| {
                map.values()
                    .find_map(|value| find_value_by_key(value, expected))
            }),
        Value::Array(items) => items
            .iter()
            .find_map(|value| find_value_by_key(value, expected)),
        _ => None,
    }
}

fn mask_value(value: &str, visible_suffix: usize) -> String {
    let trimmed = value.trim();
    if trimmed.len() <= visible_suffix {
        return trimmed.to_owned();
    }
    format!("***{}", &trimmed[trimmed.len() - visible_suffix..])
}

#[cfg(debug_assertions)]
fn sanitize_filename(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    sanitized.trim_matches('_').to_owned()
}

fn build_request_based_transaction_suffix(request_number: &str) -> Result<String> {
    let request_number = request_number.trim();
    if request_number.is_empty() {
        return Err(anyhow!(
            "No se pudo generar idTrxCliente: numero de solicitud vacio."
        ));
    }

    let suffix = format!("{request_number}0");
    if suffix.len() > 15 {
        return Err(anyhow!(
            "No se pudo generar idTrxCliente: la solicitud {request_number} excede los 15 digitos requeridos."
        ));
    }

    Ok(format!("{suffix:0>15}"))
}

fn is_transfer_not_found_error(error: &anyhow::Error) -> bool {
    error
        .chain()
        .any(|cause| cause.to_string().contains("SIN_REGISTROS"))
}

fn map_transfer_guard_status(body: &Value) -> CoinagTransferGuard {
    match extract_transfer_status_code(body).as_deref() {
        Some("1") => CoinagTransferGuard::YaTransferida,
        Some("2") => CoinagTransferGuard::Error {
            detail: "Coinag devolvio estado 2 (No Completada) para la solicitud.".to_owned(),
        },
        Some("3") => CoinagTransferGuard::EnProceso,
        Some(other) => CoinagTransferGuard::Error {
            detail: format!("Coinag devolvio un estado no esperado: {other}."),
        },
        None => CoinagTransferGuard::Error {
            detail: "Coinag no devolvio un estado interpretable para la solicitud.".to_owned(),
        },
    }
}

fn extract_transfer_status_code(body: &Value) -> Option<String> {
    body.get("response")
        .unwrap_or(body)
        .get("estado")
        .and_then(value_to_string)
}

fn classify_coelsa_transfer_status(body: &Value) -> CoelsaTransferStatus {
    let Some(status) = extract_coelsa_status(body) else {
        return CoelsaTransferStatus::Pending {
            detail: "Coinag no devolvio estado Coelsa interpretable.".to_owned(),
        };
    };
    if status.is_confirmed() {
        return CoelsaTransferStatus::Confirmed;
    }
    let detail = status.detail();
    if status.is_pending() || !status.is_explicit_rejection() {
        CoelsaTransferStatus::Pending { detail }
    } else {
        CoelsaTransferStatus::Rejected { detail }
    }
}

struct CoelsaStatus {
    code: Option<String>,
    description: Option<String>,
    error_coelsa: Option<String>,
}

impl CoelsaStatus {
    fn normalized_text(&self) -> String {
        [
            self.code.as_deref(),
            self.description.as_deref(),
            self.error_coelsa.as_deref(),
        ]
        .into_iter()
        .flatten()
        .map(|value| value.trim().to_uppercase())
        .collect::<Vec<_>>()
        .join(" | ")
    }

    fn numeric_codes(&self) -> Vec<String> {
        [
            self.code.as_deref(),
            self.description.as_deref(),
            self.error_coelsa.as_deref(),
        ]
        .into_iter()
        .flatten()
        .flat_map(|value| {
            value
                .split(|character: char| !character.is_ascii_digit())
                .filter(|part| !part.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect()
    }

    fn is_confirmed(&self) -> bool {
        let code = self.code.as_deref().map(str::trim).map(str::to_uppercase);
        code.as_deref() == Some("00")
            || code.as_deref() == Some("ACREDITADO")
            || self
                .numeric_codes()
                .iter()
                .any(|value| matches!(value.as_str(), "00" | "0600"))
    }

    fn is_pending(&self) -> bool {
        const PENDING_CODES: [&str; 5] = ["0601", "0602", "0612", "2100", "2000"];
        let text = self.normalized_text();
        text.contains("EN CURSO")
            || text.contains("PENDIENTE")
            || text == "INICIADO"
            || self
                .numeric_codes()
                .iter()
                .any(|value| PENDING_CODES.contains(&value.as_str()))
    }

    fn is_explicit_rejection(&self) -> bool {
        let text = self.normalized_text();
        text.contains("ERROR")
            || text.contains("RECHAZ")
            || text.contains("NO COMPLET")
            || text.contains("EXPIRAD")
            || text.contains("ANULAD")
            || text.contains("INEXISTENTE")
            || text.contains("NO HABILITAD")
            || text.contains("INVALID")
            || text.contains("INCORRECT")
            || text.contains("NO COINCID")
            || text.contains("NO PERMITID")
            || text.contains("INSUFICIENTE")
            || self.error_coelsa.is_some()
    }

    fn detail(&self) -> String {
        match (
            self.code.as_deref(),
            self.description.as_deref(),
            self.error_coelsa.as_deref(),
        ) {
            (Some(code), Some(description), Some(error)) => {
                format!("{code} - {description}. Coelsa: {error}")
            }
            (Some(code), Some(description), None) => format!("{code} - {description}"),
            (Some(code), None, Some(error)) => format!("{code}. Coelsa: {error}"),
            (Some(code), None, None) => code.to_owned(),
            (None, Some(description), Some(error)) => format!("{description}. Coelsa: {error}"),
            (None, Some(description), None) => description.to_owned(),
            (None, None, Some(error)) => error.to_owned(),
            (None, None, None) => "Estado Coelsa no informado.".to_owned(),
        }
    }
}

fn coelsa_status_label(status: &CoelsaTransferStatus) -> &'static str {
    match status {
        CoelsaTransferStatus::Confirmed => "confirmed",
        CoelsaTransferStatus::Rejected { .. } => "rejected",
        CoelsaTransferStatus::Pending { .. } => "pending",
    }
}

fn coelsa_status_detail(status: &CoelsaTransferStatus) -> Option<&str> {
    match status {
        CoelsaTransferStatus::Confirmed => None,
        CoelsaTransferStatus::Rejected { detail } | CoelsaTransferStatus::Pending { detail } => {
            Some(detail)
        }
    }
}

fn log_coinag_http_response(
    method: &str,
    url: &str,
    response: &TransportResponse,
    is_token_request: bool,
) {
    if is_token_request {
        trace::record_audit(
            "coinag_oauth_response",
            None,
            None,
            json!({
                "method": method,
                "url": url,
                "status": response.status.as_u16(),
                "body_omitted": true,
            }),
        );
        log::info!(
            target: "coinag_http",
            "OAuth respondio status={} para {} {}. Body omitido por contener credenciales de sesion.",
            response.status,
            method,
            url
        );
        return;
    }
    trace::record_audit(
        "coinag_http_response",
        None,
        None,
        json!({
            "method": method,
            "url": url,
            "status": response.status.as_u16(),
            "body": String::from_utf8_lossy(&response.body),
        }),
    );
    log::info!(
        target: "coinag_http",
        "{}",
        json!({
            "event": "http_response",
            "method": method,
            "url": url,
            "status": response.status.as_u16(),
            "body": String::from_utf8_lossy(&response.body),
        })
    );
}

fn extract_coelsa_status(body: &Value) -> Option<CoelsaStatus> {
    let root = body.get("response").unwrap_or(body);
    let status = root
        .get("estadoCoelsa")
        .or_else(|| root.get("estado"))
        .unwrap_or(root);
    match status {
        Value::Object(map) => {
            let code = map
                .get("codigo")
                .or_else(|| map.get("code"))
                .and_then(value_to_string)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty());
            let description = map
                .get("descripcion")
                .or_else(|| map.get("description"))
                .and_then(value_to_string)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty());
            let error_coelsa = map
                .get("errorCoelsa")
                .and_then(value_to_string)
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty());
            if code.is_none() && description.is_none() && error_coelsa.is_none() {
                None
            } else {
                Some(CoelsaStatus {
                    code,
                    description,
                    error_coelsa,
                })
            }
        }
        _ => value_to_string(status)
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .map(|code| CoelsaStatus {
                code: Some(code),
                description: None,
                error_coelsa: None,
            }),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
    };

    use rust_decimal::Decimal;

    use serde_json::json;

    use super::{
        CoelsaTransferStatus, CoinagClient, TokenCache, build_request_based_transaction_suffix,
        classify_coelsa_transfer_status, extract_cbu_account_type_code, map_transfer_guard_status,
    };
    use crate::{
        cancellations::{TransferLeg, TransferLegKind},
        config::CoinagConfig,
        models::{CoreSnapshot, HydratedCase},
    };

    #[test]
    fn request_based_transaction_suffix_uses_request_number_with_trailing_zero() {
        let suffix = build_request_based_transaction_suffix("234567").unwrap();
        assert_eq!(suffix, "000000002345670");
    }

    #[test]
    fn request_based_transaction_suffix_rejects_more_than_fifteen_digits() {
        let error = build_request_based_transaction_suffix("123456789012345")
            .expect_err("expected suffix generation to fail");
        assert!(error.to_string().contains("excede los 15 digitos"));
    }

    #[test]
    fn build_transfer_payload_uses_effective_bank_amount() {
        let client = CoinagClient {
            direct_http: None,
            ssh_http: None,
            config: CoinagConfig {
                cuit_debito: "20-11111111-3".to_owned(),
                cbu_debito: "2850590940090418135201".to_owned(),
                titular_debito: "Cuenta Debito".to_owned(),
                concepto: "VAR".to_owned(),
                descripcion: "Prueba".to_owned(),
                endpoint: "/Transferencia".to_owned(),
                id_seq_path: PathBuf::from("transferencias_coinag_seq_test.txt"),
                ..Default::default()
            },
            token_cache: Arc::new(Mutex::new(TokenCache::default())),
        };
        let case = HydratedCase {
            server_validation: Default::default(),
            metamap: Default::default(),
            core: CoreSnapshot {
                request_oid: "123".to_owned(),
                request_amount: Some(Decimal::new(1000, 0)),
                request_cuil: Some("20-30111222-3".to_owned()),
                document_cuil: Some("20-30111222-3".to_owned()),
                transfer_cbu: Some("2850590940090418135201".to_owned()),
                bank_cmf_amount: Some(Decimal::new(800, 0)),
                ..Default::default()
            },
            transfer_guard: Default::default(),
            validation: Default::default(),
            busy: false,
            message: None,
        };

        let payload = client
            .build_transfer_payload(&case)
            .expect("expected transfer payload to be created");

        assert_eq!(
            payload.get("importe").and_then(|value| value.as_str()),
            Some("800")
        );
    }

    #[test]
    fn cancellation_ids_are_stable_and_distinguish_member_from_detail() {
        let client = CoinagClient {
            direct_http: None,
            ssh_http: None,
            config: CoinagConfig {
                id_empresa: "12345".to_owned(),
                ..Default::default()
            },
            token_cache: Arc::new(Mutex::new(TokenCache::default())),
        };
        let member = TransferLeg {
            key: "member".to_owned(),
            kind: TransferLegKind::Member,
            amount: Decimal::new(1_335_000, 0),
            cbu: "0000003100015780238648".to_owned(),
            cuit: "20301112223".to_owned(),
            holder_name: None,
        };
        let creditor = TransferLeg {
            key: "creditor:1296".to_owned(),
            kind: TransferLegKind::Creditor,
            amount: Decimal::new(565_000, 0),
            cbu: "0970099413001097400111".to_owned(),
            cuit: "30625567382".to_owned(),
            holder_name: Some("MUDON".to_owned()),
        };

        assert_eq!(
            client
                .build_cancellation_id_trx_cliente("246729", &member)
                .unwrap(),
            "12345002467291000000"
        );
        assert_eq!(
            client
                .build_cancellation_id_trx_cliente("246729", &creditor)
                .unwrap(),
            "12345002467292001296"
        );
    }

    #[test]
    fn existing_leg_must_match_destination_and_amount() {
        let leg = TransferLeg {
            key: "creditor:1296".to_owned(),
            kind: TransferLegKind::Creditor,
            amount: Decimal::new(565_000, 0),
            cbu: "0970099413001097400111".to_owned(),
            cuit: "30625567382".to_owned(),
            holder_name: None,
        };
        let response = super::TransferLookupResponse {
            request_number: String::new(),
            id_trx_cliente: "id".to_owned(),
            body: json!({
                "response": {
                    "credito": { "cbu": leg.cbu, "cuit": leg.cuit },
                    "importe": "565000.00"
                }
            }),
        };

        CoinagClient::verify_lookup_matches_leg(&response, &leg).unwrap();
        let mut changed = leg.clone();
        changed.amount += Decimal::ONE;
        assert!(CoinagClient::verify_lookup_matches_leg(&response, &changed).is_err());
    }

    #[test]
    fn cbu_lookup_extracts_account_type_code() {
        let body = json!({
            "cuenta": {
                "tipoCuenta": "11",
                "cbu": "0110519331051903253916"
            }
        });

        assert_eq!(extract_cbu_account_type_code(&body).as_deref(), Some("11"));
    }

    #[test]
    fn coelsa_status_code_zero_is_confirmed() {
        let body = json!({
            "estado": {
                "codigo": "00",
                "descripcion": "OK"
            }
        });

        assert_eq!(
            classify_coelsa_transfer_status(&body),
            CoelsaTransferStatus::Confirmed
        );
    }

    #[test]
    fn coelsa_accredited_0600_is_confirmed() {
        let body = json!({
            "estado": {
                "codigo": "ACREDITADO",
                "descripcion": "0600 - ACREDITADO",
                "errorCoelsa": null
            }
        });

        assert_eq!(
            classify_coelsa_transfer_status(&body),
            CoelsaTransferStatus::Confirmed
        );
    }

    #[test]
    fn coelsa_accredited_0600_is_confirmed_inside_response_wrapper() {
        let body = json!({
            "response": {
                "estado": {
                    "codigo": " acreditado ",
                    "descripcion": "0600 - ACREDITADO"
                }
            }
        });

        assert_eq!(
            classify_coelsa_transfer_status(&body),
            CoelsaTransferStatus::Confirmed
        );
    }

    #[test]
    fn coelsa_initial_zero_with_description_is_confirmed() {
        let body = json!({
            "estado": {
                "codigo": "00 Garantia Correcta",
                "descripcion": "Garantia Correcta"
            }
        });

        assert_eq!(
            classify_coelsa_transfer_status(&body),
            CoelsaTransferStatus::Confirmed
        );
    }

    #[test]
    fn documented_coelsa_pending_codes_remain_pending() {
        for (code, label) in [
            ("0601", "ACREDITACION EN CURSO"),
            ("0602", "CREDITO PENDIENTE"),
            ("0612", "ACREDITACION PENDIENTE CON GARANTIA"),
            ("2100", "INICIADO"),
            ("2000", "CREACION PENDIENTE"),
        ] {
            let body = json!({
                "estado": {
                    "codigo": label,
                    "descripcion": format!("{code} - {label}"),
                    "errorCoelsa": null
                }
            });

            assert!(matches!(
                classify_coelsa_transfer_status(&body),
                CoelsaTransferStatus::Pending { .. }
            ));
        }
    }

    #[test]
    fn unknown_coelsa_status_remains_pending_instead_of_false_rejection() {
        let body = json!({
            "estado": {
                "codigo": "ESTADO NUEVO",
                "descripcion": "Respuesta aun no catalogada",
                "errorCoelsa": null
            }
        });

        assert!(matches!(
            classify_coelsa_transfer_status(&body),
            CoelsaTransferStatus::Pending { .. }
        ));
    }

    #[test]
    fn documented_expired_status_is_rejected() {
        let body = json!({
            "estado": {
                "codigo": "EXPIRADO",
                "descripcion": "0370 - EXPIRADO",
                "errorCoelsa": null
            }
        });

        assert!(matches!(
            classify_coelsa_transfer_status(&body),
            CoelsaTransferStatus::Rejected { .. }
        ));
    }

    #[test]
    fn coelsa_non_zero_status_is_rejected() {
        let body = json!({
            "estado": {
                "codigo": "ERROR DATOS",
                "descripcion": "2109 - MONEDA DEL VENDEDOR DIFERENTE A LA REQUERIDA"
            }
        });

        assert_eq!(
            classify_coelsa_transfer_status(&body),
            CoelsaTransferStatus::Rejected {
                detail: "ERROR DATOS - 2109 - MONEDA DEL VENDEDOR DIFERENTE A LA REQUERIDA"
                    .to_owned()
            }
        );
    }

    #[test]
    fn id_trx_cliente_status_codes_follow_coinag_documentation() {
        assert!(matches!(
            map_transfer_guard_status(&json!({ "estado": "1" })),
            crate::models::CoinagTransferGuard::YaTransferida
        ));
        assert!(matches!(
            map_transfer_guard_status(&json!({ "estado": "2" })),
            crate::models::CoinagTransferGuard::Error { .. }
        ));
        assert!(matches!(
            map_transfer_guard_status(&json!({ "estado": "3" })),
            crate::models::CoinagTransferGuard::EnProceso
        ));
    }
}
