use std::{sync::Arc, time::Duration};

use anyhow::{Context, Result, anyhow, bail};
use bytes::Bytes;
use http::{
    HeaderName, HeaderValue, Method, Request, StatusCode,
    header::{CONNECTION, HOST},
};
use http_body_util::{BodyExt, Full};
use hyper::client::conn::http1;
use hyper_util::rt::TokioIo;
use russh::{
    Disconnect,
    client::{self, Config as SshConfig, Handle},
    keys::{PrivateKeyWithHashAlg, PublicKey, load_public_key, load_secret_key},
};
use tokio::runtime::{Builder as RuntimeBuilder, Runtime};
use tokio_rustls::{
    TlsConnector,
    rustls::{ClientConfig, RootCertStore, pki_types::ServerName},
};
use url::Url;
use webpki_roots::TLS_SERVER_ROOTS;

use crate::config::CoinagSshConfig;

#[derive(Clone)]
pub struct SshHttpClient {
    runtime: Arc<Runtime>,
    config: CoinagSshConfig,
    expected_host_key: PublicKey,
    timeout: Duration,
}

pub struct TransportRequest {
    pub method: Method,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

pub struct TransportResponse {
    pub status: StatusCode,
    pub body: Vec<u8>,
}

struct VerifiedSshClient {
    expected_host_key: PublicKey,
}

impl client::Handler for VerifiedSshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(server_public_key == &self.expected_host_key)
    }
}

impl SshHttpClient {
    pub fn new(
        config: &CoinagSshConfig,
        timeout: Duration,
        allow_invalid_certs: bool,
    ) -> Result<Self> {
        config.validate()?;
        if allow_invalid_certs {
            log::warn!(
                "TRANSFERENCIAS_COINAG_ALLOW_INVALID_CERTS se ignora cuando Coinag usa SSH; TLS sigue validando el certificado del banco."
            );
        }
        let expected_host_key =
            load_public_key(&config.host_public_key_path).with_context(|| {
                format!(
                    "No se pudo leer la host key SSH de la VPS desde {:?}.",
                    config.host_public_key_path
                )
            })?;
        let runtime = RuntimeBuilder::new_multi_thread()
            .enable_all()
            .build()
            .context("No se pudo crear el runtime async para SSH.")?;
        Ok(Self {
            runtime: Arc::new(runtime),
            config: config.clone(),
            expected_host_key,
            timeout,
        })
    }

    pub fn execute(&self, request: TransportRequest) -> Result<TransportResponse> {
        let timeout = self.timeout;
        self.runtime.block_on(async {
            tokio::time::timeout(timeout, self.execute_async(request))
                .await
                .map_err(|_| anyhow!("Timeout al conectar con Coinag por SSH."))?
        })
    }

    async fn execute_async(&self, request: TransportRequest) -> Result<TransportResponse> {
        let url = Url::parse(&request.url)
            .with_context(|| format!("URL invalida para request Coinag: {}", request.url))?;
        let host = url
            .host_str()
            .ok_or_else(|| anyhow!("La URL Coinag no tiene host: {}", request.url))?
            .to_owned();
        let port = url
            .port_or_known_default()
            .ok_or_else(|| anyhow!("No se pudo resolver el puerto para {}", request.url))?;

        let session = self.connect_session().await?;
        let channel = session
            .channel_open_direct_tcpip(
                host.as_str(),
                u32::from(port),
                self.config.originator_address.as_str(),
                0,
            )
            .await
            .with_context(|| format!("No se pudo abrir direct-tcpip a {host}:{port}"))?;
        let stream = channel.into_stream();
        let request_uri = request_uri(&url);
        let host_header = host_header(&url);
        let request = build_request(request, &request_uri, &host_header)?;

        let response = match url.scheme() {
            "https" => {
                let tls_stream = TlsConnector::from(build_tls_config())
                    .connect(server_name(&host)?, stream)
                    .await
                    .with_context(|| format!("No se pudo abrir TLS hacia {host}:{port}"))?;
                self.send_http_request(request, tls_stream).await?
            }
            "http" => self.send_http_request(request, stream).await?,
            scheme => bail!("Esquema no soportado para Coinag por SSH: {scheme}"),
        };

        let _ = session
            .disconnect(Disconnect::ByApplication, "request complete", "es")
            .await;
        Ok(response)
    }

    async fn connect_session(&self) -> Result<Handle<VerifiedSshClient>> {
        let private_key =
            load_secret_key(&self.config.private_key_path, None).with_context(|| {
                format!(
                    "No se pudo leer la clave privada SSH desde {:?}.",
                    self.config.private_key_path
                )
            })?;
        let config = Arc::new(SshConfig {
            inactivity_timeout: Some(self.timeout),
            keepalive_interval: Some(Duration::from_secs(15)),
            nodelay: true,
            ..Default::default()
        });
        let handler = VerifiedSshClient {
            expected_host_key: self.expected_host_key.clone(),
        };
        let mut session = client::connect(
            config,
            (self.config.host.as_str(), self.config.port),
            handler,
        )
        .await
        .with_context(|| {
            format!(
                "No se pudo conectar por SSH a {}:{}.",
                self.config.host, self.config.port
            )
        })?;
        let auth_result = session
            .authenticate_publickey(
                self.config.user.as_str(),
                PrivateKeyWithHashAlg::new(
                    Arc::new(private_key),
                    session.best_supported_rsa_hash().await?.flatten(),
                ),
            )
            .await
            .context("Fallo la autenticacion SSH contra la VPS.")?;
        if !auth_result.success() {
            bail!("La VPS rechazo la autenticacion SSH del cliente.");
        }
        Ok(session)
    }

    async fn send_http_request<T>(
        &self,
        request: Request<Full<Bytes>>,
        stream: T,
    ) -> Result<TransportResponse>
    where
        T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        let (mut sender, connection) = http1::handshake(TokioIo::new(stream))
            .await
            .context("No se pudo iniciar HTTP/1.1 sobre el tunel SSH.")?;
        let connection_task = tokio::spawn(async move {
            let _ = connection.await;
        });
        let response = sender
            .send_request(request)
            .await
            .context("Coinag no respondio por el canal SSH.")?;
        let status = response.status();
        let body = response
            .into_body()
            .collect()
            .await
            .context("No se pudo leer la respuesta HTTP de Coinag.")?
            .to_bytes()
            .to_vec();
        drop(sender);
        let _ = connection_task.await;
        Ok(TransportResponse { status, body })
    }
}

fn build_request(
    request: TransportRequest,
    request_uri: &str,
    host_header: &str,
) -> Result<Request<Full<Bytes>>> {
    let mut builder = Request::builder()
        .method(request.method)
        .uri(request_uri)
        .header(HOST, host_header)
        .header(CONNECTION, "close");
    for (name, value) in request.headers {
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .with_context(|| format!("Header invalido para Coinag: {name}"))?;
        let header_value = HeaderValue::from_str(&value)
            .with_context(|| format!("Valor invalido de header Coinag: {name}"))?;
        builder = builder.header(header_name, header_value);
    }
    builder
        .body(Full::from(Bytes::from(request.body)))
        .context("No se pudo construir la request HTTP para Coinag.")
}

fn build_tls_config() -> Arc<ClientConfig> {
    let mut roots = RootCertStore::empty();
    roots.extend(TLS_SERVER_ROOTS.iter().cloned());
    Arc::new(
        ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth(),
    )
}

fn host_header(url: &Url) -> String {
    match (url.host_str(), url.port()) {
        (Some(host), Some(port)) if Some(port) != default_port(url.scheme()) => {
            format!("{host}:{port}")
        }
        (Some(host), _) => host.to_owned(),
        _ => String::new(),
    }
}

fn request_uri(url: &Url) -> String {
    match url.query() {
        Some(query) if !query.is_empty() => format!("{}?{query}", url.path()),
        _ if url.path().is_empty() => "/".to_owned(),
        _ => url.path().to_owned(),
    }
}

fn server_name(host: &str) -> Result<ServerName<'static>> {
    ServerName::try_from(host.to_owned())
        .map_err(|_| anyhow!("Hostname TLS invalido para Coinag: {host}"))
}

fn default_port(scheme: &str) -> Option<u16> {
    match scheme {
        "http" => Some(80),
        "https" => Some(443),
        _ => None,
    }
}
