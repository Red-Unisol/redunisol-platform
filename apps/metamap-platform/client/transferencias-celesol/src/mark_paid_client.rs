use std::{fs, path::Path, time::Duration};

use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use reqwest::blocking::Client;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::config::MarkPaidConfig;

#[derive(Clone)]
pub struct MarkPaidClient {
    http: Client,
    endpoint_url: String,
    auth_token: String,
}

#[derive(Debug, Clone)]
pub struct MarkPaidResponse {
    pub status_code: u16,
    pub body: String,
    pub pdf_bytes: usize,
    pub pdf_sha256: String,
}

#[derive(Debug)]
pub struct MarkPaidHttpError {
    pub status_code: u16,
    pub body: String,
    request_oid: String,
}

impl std::fmt::Display for MarkPaidHttpError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "El endpoint de marcado devolvio HTTP {} para la solicitud {}. Respuesta: {}",
            self.status_code, self.request_oid, self.body
        )
    }
}

impl std::error::Error for MarkPaidHttpError {}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkPaidRequest<'a> {
    numero_solicitud: &'a str,
    comprobante_pdf_base64: String,
}

impl MarkPaidClient {
    pub fn new(config: &MarkPaidConfig, timeout: Duration) -> Result<Self> {
        let http = Client::builder()
            .timeout(timeout)
            .danger_accept_invalid_certs(config.allow_invalid_certs)
            .build()
            .context("No se pudo construir el cliente para marcar solicitudes como pagadas.")?;
        Ok(Self {
            http,
            endpoint_url: config.endpoint_url.trim().to_owned(),
            auth_token: normalize_bearer_token(&config.auth_token),
        })
    }

    pub fn endpoint_url(&self) -> &str {
        &self.endpoint_url
    }

    pub fn mark_paid(&self, request_oid: &str, receipt_path: &Path) -> Result<MarkPaidResponse> {
        let pdf = fs::read(receipt_path).with_context(|| {
            format!("No se pudo leer el comprobante PDF {receipt_path:?} para enviarlo al core.")
        })?;
        let pdf_sha256 = format!("{:X}", Sha256::digest(&pdf));
        let request = MarkPaidRequest {
            numero_solicitud: request_oid,
            comprobante_pdf_base64: BASE64_STANDARD.encode(&pdf),
        };

        log::info!(
            "Enviando comprobante al core: endpoint={} solicitud_oid={} pdf_path={:?} pdf_bytes={} pdf_sha256={}.",
            self.endpoint_url,
            request_oid,
            receipt_path,
            pdf.len(),
            pdf_sha256
        );

        let response = self
            .http
            .post(&self.endpoint_url)
            .bearer_auth(&self.auth_token)
            .json(&request)
            .send()
            .with_context(|| {
                format!(
                    "No se pudo conectar con el endpoint de marcado para la solicitud {request_oid}."
                )
            })?;
        let status = response.status();
        let body = response
            .text()
            .context("No se pudo leer la respuesta del endpoint de marcado.")?;

        if status != reqwest::StatusCode::OK {
            return Err(anyhow!(MarkPaidHttpError {
                status_code: status.as_u16(),
                body,
                request_oid: request_oid.to_owned(),
            }));
        }

        Ok(MarkPaidResponse {
            status_code: status.as_u16(),
            body,
            pdf_bytes: pdf.len(),
            pdf_sha256,
        })
    }
}

fn normalize_bearer_token(value: &str) -> String {
    value
        .trim()
        .strip_prefix("Bearer ")
        .or_else(|| value.trim().strip_prefix("bearer "))
        .unwrap_or(value.trim())
        .trim()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
        thread,
    };

    #[test]
    fn normalizes_raw_and_prefixed_bearer_tokens() {
        assert_eq!(normalize_bearer_token("abc"), "abc");
        assert_eq!(normalize_bearer_token("Bearer abc"), "abc");
        assert_eq!(normalize_bearer_token(" bearer abc "), "abc");
    }

    #[test]
    fn serializes_oid_using_the_existing_numero_solicitud_property() {
        let request = MarkPaidRequest {
            numero_solicitud: "248948",
            comprobante_pdf_base64: "JVBERi0=".to_owned(),
        };

        let value = serde_json::to_value(request).unwrap();

        assert_eq!(value["numeroSolicitud"], "248948");
        assert_eq!(value["comprobantePdfBase64"], "JVBERi0=");
    }

    #[test]
    fn sends_pdf_and_accepts_http_200() {
        let (endpoint, request_rx, server) = serve_once(
            "200 OK",
            r#"{"NumeroSolicitud":"248948","Estado":"Pagada"}"#,
        );
        let pdf_path = test_pdf_path("success");
        fs::write(&pdf_path, b"%PDF-test%%EOF").unwrap();
        let client = MarkPaidClient::new(
            &MarkPaidConfig {
                endpoint_url: endpoint,
                auth_token: "Bearer test-token".to_owned(),
                allow_invalid_certs: false,
            },
            Duration::from_secs(5),
        )
        .unwrap();

        let response = client.mark_paid("248948", &pdf_path).unwrap();
        let raw_request = request_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        server.join().unwrap();
        fs::remove_file(pdf_path).unwrap();

        assert_eq!(response.status_code, 200);
        assert!(response.body.contains(r#""Estado":"Pagada""#));
        assert!(raw_request.starts_with("POST /api/Transferencias/marcar-pagada HTTP/1.1"));
        assert!(
            raw_request
                .to_ascii_lowercase()
                .contains("authorization: bearer test-token")
        );
        assert!(raw_request.contains(r#""numeroSolicitud":"248948""#));
        assert!(raw_request.contains(r#""comprobantePdfBase64":"JVBERi10ZXN0JSVFT0Y=""#));
    }

    #[test]
    fn rejects_any_status_other_than_http_200_and_keeps_response_body() {
        let (endpoint, _request_rx, server) =
            serve_once("409 Conflict", r#"{"error":"estado incorrecto"}"#);
        let pdf_path = test_pdf_path("conflict");
        fs::write(&pdf_path, b"%PDF-test%%EOF").unwrap();
        let client = MarkPaidClient::new(
            &MarkPaidConfig {
                endpoint_url: endpoint,
                auth_token: "test-token".to_owned(),
                allow_invalid_certs: false,
            },
            Duration::from_secs(5),
        )
        .unwrap();

        let error = client.mark_paid("248948", &pdf_path).unwrap_err();
        server.join().unwrap();
        fs::remove_file(pdf_path).unwrap();
        let message = format!("{error:#}");

        assert!(message.contains("HTTP 409"));
        assert!(message.contains("estado incorrecto"));
    }

    fn test_pdf_path(suffix: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "transferencias-mark-paid-{}-{suffix}.pdf",
            std::process::id()
        ))
    }

    fn serve_once(
        status: &'static str,
        response_body: &'static str,
    ) -> (String, mpsc::Receiver<String>, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let (request_tx, request_rx) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4096];
            let mut expected_length = None;
            loop {
                let read = stream.read(&mut buffer).unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if expected_length.is_none()
                    && let Some(header_end) = find_bytes(&request, b"\r\n\r\n")
                {
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().ok())
                                .flatten()
                        })
                        .unwrap_or(0);
                    expected_length = Some(header_end + 4 + content_length);
                }
                if expected_length.is_some_and(|length| request.len() >= length) {
                    break;
                }
            }
            request_tx
                .send(String::from_utf8_lossy(&request).into_owned())
                .unwrap();
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
                response_body.len()
            )
            .unwrap();
        });
        (
            format!("http://{address}/api/Transferencias/marcar-pagada"),
            request_rx,
            server,
        )
    }

    fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack
            .windows(needle.len())
            .position(|window| window == needle)
    }
}
