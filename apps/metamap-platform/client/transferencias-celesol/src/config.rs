use std::{env, path::PathBuf, time::Duration};

use anyhow::{Context, Result, anyhow};

#[derive(Clone)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub metamap: MetamapConfig,
    pub core: CoreConfig,
    pub coinag: CoinagConfig,
    pub operator_name: String,
    pub poll_interval: Duration,
    pub request_timeout: Duration,
    pub receipts_dir: PathBuf,
}

#[derive(Clone)]
pub struct ServerConfig {
    pub base_url: String,
    pub client_id: String,
    pub client_secret: String,
    pub allow_invalid_certs: bool,
}

#[derive(Clone)]
pub struct MetamapConfig {
    pub api_token: String,
    pub auth_scheme: String,
    pub allow_invalid_certs: bool,
}

#[derive(Clone)]
pub struct CoreConfig {
    pub base_url: String,
    pub allow_invalid_certs: bool,
}

#[derive(Clone, Default)]
pub struct CoinagSshConfig {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub private_key_path: PathBuf,
    pub host_public_key_path: PathBuf,
    pub originator_address: String,
}

impl CoinagSshConfig {
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn validate(&self) -> Result<()> {
        if !self.enabled {
            return Ok(());
        }
        if self.host.is_empty() {
            return Err(anyhow!(
                "TRANSFERENCIAS_COINAG_SSH_HOST es obligatorio cuando SSH esta habilitado."
            ));
        }
        if self.user.is_empty() {
            return Err(anyhow!(
                "TRANSFERENCIAS_COINAG_SSH_USER es obligatorio cuando SSH esta habilitado."
            ));
        }
        if self.private_key_path.as_os_str().is_empty() {
            return Err(anyhow!(
                "TRANSFERENCIAS_COINAG_SSH_PRIVATE_KEY_PATH es obligatorio cuando SSH esta habilitado."
            ));
        }
        if self.host_public_key_path.as_os_str().is_empty() {
            return Err(anyhow!(
                "TRANSFERENCIAS_COINAG_SSH_HOST_PUBLIC_KEY_PATH es obligatorio cuando SSH esta habilitado."
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Default)]
pub struct CoinagConfig {
    pub api_base: String,
    pub token_url: String,
    pub username: String,
    pub password: String,
    pub client_id: String,
    pub client_secret: String,
    pub cuit_debito: String,
    pub cbu_debito: String,
    pub titular_debito: String,
    pub concepto: String,
    pub descripcion: String,
    pub endpoint: String,
    pub scope: String,
    pub auth_scheme: String,
    pub id_empresa: String,
    pub id_seq_path: PathBuf,
    pub allow_invalid_certs: bool,
    pub ssh: CoinagSshConfig,
}

impl CoinagConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            api_base: optional_env("TRANSFERENCIAS_COINAG_API_BASE").unwrap_or_default(),
            token_url: optional_env("TRANSFERENCIAS_COINAG_TOKEN_URL").unwrap_or_default(),
            username: optional_env("TRANSFERENCIAS_COINAG_USERNAME").unwrap_or_default(),
            password: optional_env("TRANSFERENCIAS_COINAG_PASSWORD").unwrap_or_default(),
            client_id: optional_env("TRANSFERENCIAS_COINAG_CLIENT_ID").unwrap_or_default(),
            client_secret: optional_env("TRANSFERENCIAS_COINAG_CLIENT_SECRET").unwrap_or_default(),
            cuit_debito: optional_env("TRANSFERENCIAS_COINAG_CUIT_DEBITO").unwrap_or_default(),
            cbu_debito: optional_env("TRANSFERENCIAS_COINAG_CBU_DEBITO").unwrap_or_default(),
            titular_debito: optional_env("TRANSFERENCIAS_COINAG_TITULAR_DEBITO")
                .unwrap_or_default(),
            concepto: optional_env("TRANSFERENCIAS_COINAG_CONCEPTO")
                .unwrap_or_else(|| "VAR".to_owned()),
            descripcion: optional_env("TRANSFERENCIAS_COINAG_DESCRIPCION").unwrap_or_default(),
            endpoint: optional_env("TRANSFERENCIAS_COINAG_ENDPOINT")
                .unwrap_or_else(|| "/Transferencia".to_owned()),
            scope: optional_env("TRANSFERENCIAS_COINAG_SCOPE").unwrap_or_default(),
            auth_scheme: optional_env("TRANSFERENCIAS_COINAG_AUTH_SCHEME")
                .unwrap_or_else(|| "Bearer".to_owned()),
            id_empresa: optional_env("TRANSFERENCIAS_COINAG_ID_EMPRESA").unwrap_or_default(),
            id_seq_path: PathBuf::from(
                optional_env("TRANSFERENCIAS_COINAG_ID_SEQ_PATH")
                    .unwrap_or_else(|| "transferencias_coinag_seq.txt".to_owned()),
            ),
            allow_invalid_certs: parse_bool("TRANSFERENCIAS_COINAG_ALLOW_INVALID_CERTS", false)?,
            ssh: CoinagSshConfig {
                enabled: parse_bool("TRANSFERENCIAS_COINAG_SSH_ENABLED", false)?,
                host: optional_env("TRANSFERENCIAS_COINAG_SSH_HOST").unwrap_or_default(),
                port: parse_u16("TRANSFERENCIAS_COINAG_SSH_PORT", 22)?,
                user: optional_env("TRANSFERENCIAS_COINAG_SSH_USER").unwrap_or_default(),
                private_key_path: PathBuf::from(
                    optional_env("TRANSFERENCIAS_COINAG_SSH_PRIVATE_KEY_PATH").unwrap_or_default(),
                ),
                host_public_key_path: PathBuf::from(
                    optional_env("TRANSFERENCIAS_COINAG_SSH_HOST_PUBLIC_KEY_PATH")
                        .unwrap_or_default(),
                ),
                originator_address: optional_env("TRANSFERENCIAS_COINAG_SSH_ORIGINATOR_ADDRESS")
                    .unwrap_or_else(|| "127.0.0.1".to_owned()),
            },
        })
    }

    pub fn is_complete(&self) -> bool {
        !self.api_base.is_empty()
            && !self.token_url.is_empty()
            && !self.username.is_empty()
            && !self.password.is_empty()
            && !self.cuit_debito.is_empty()
            && !self.cbu_debito.is_empty()
            && !self.titular_debito.is_empty()
    }
}

impl AppConfig {
    pub fn from_env() -> Result<Self> {
        let poll_interval =
            Duration::from_secs(parse_u64("TRANSFERENCIAS_POLL_INTERVAL_SECONDS", 15)?);
        let request_timeout =
            Duration::from_secs(parse_u64("TRANSFERENCIAS_REQUEST_TIMEOUT_SECONDS", 15)?);
        let operator_name = env::var("TRANSFERENCIAS_OPERATOR_NAME")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| env::var("USERNAME").ok())
            .or_else(|| env::var("COMPUTERNAME").ok())
            .unwrap_or_else(|| "operador_desconocido".to_owned());

        Ok(Self {
            server: ServerConfig {
                base_url: required_env("TRANSFERENCIAS_SERVER_BASE_URL")?,
                client_id: required_env("TRANSFERENCIAS_SERVER_CLIENT_ID")?,
                client_secret: required_env("TRANSFERENCIAS_SERVER_CLIENT_SECRET")?,
                allow_invalid_certs: parse_bool(
                    "TRANSFERENCIAS_SERVER_ALLOW_INVALID_CERTS",
                    false,
                )?,
            },
            metamap: MetamapConfig {
                api_token: required_env("TRANSFERENCIAS_METAMAP_API_TOKEN")?,
                auth_scheme: optional_env("TRANSFERENCIAS_METAMAP_AUTH_SCHEME")
                    .unwrap_or_else(|| "Token".to_owned()),
                allow_invalid_certs: parse_bool(
                    "TRANSFERENCIAS_METAMAP_ALLOW_INVALID_CERTS",
                    false,
                )?,
            },
            core: CoreConfig {
                base_url: optional_env("TRANSFERENCIAS_CORE_BASE_URL")
                    .unwrap_or_else(|| "https://celesol.dyndns.org:5050".to_owned()),
                allow_invalid_certs: parse_bool("TRANSFERENCIAS_CORE_ALLOW_INVALID_CERTS", true)?,
            },
            coinag: CoinagConfig::from_env()?,
            operator_name,
            poll_interval,
            request_timeout,
            receipts_dir: PathBuf::from(
                optional_env("TRANSFERENCIAS_RECEIPTS_DIR")
                    .unwrap_or_else(|| "receipts".to_owned()),
            ),
        })
    }
}

fn required_env(name: &str) -> Result<String> {
    optional_env(name).ok_or_else(|| anyhow!("Falta la variable de entorno obligatoria {name}."))
}

fn optional_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn parse_bool(name: &str, default: bool) -> Result<bool> {
    let Some(raw_value) = optional_env(name) else {
        return Ok(default);
    };
    match raw_value.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "y" | "si" => Ok(true),
        "0" | "false" | "no" | "n" => Ok(false),
        _ => Err(anyhow!("Valor invalido para {name}: {raw_value}")),
    }
}

fn parse_u16(name: &str, default: u16) -> Result<u16> {
    let Some(raw_value) = optional_env(name) else {
        return Ok(default);
    };
    raw_value
        .parse::<u16>()
        .with_context(|| format!("Valor invalido para {name}: {raw_value}"))
}

fn parse_u64(name: &str, default: u64) -> Result<u64> {
    let Some(raw_value) = optional_env(name) else {
        return Ok(default);
    };
    raw_value
        .parse::<u64>()
        .with_context(|| format!("Valor invalido para {name}: {raw_value}"))
}
