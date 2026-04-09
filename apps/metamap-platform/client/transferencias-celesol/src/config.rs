use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, Result, anyhow};

#[derive(Clone)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub core: CoreConfig,
    pub coinag: CoinagConfig,
    pub operator_name: String,
    pub poll_interval: Duration,
    pub request_timeout: Duration,
    pub receipts_dir: PathBuf,
    pub completed_log_path: PathBuf,
}

#[derive(Clone)]
pub struct ServerConfig {
    pub base_url: String,
    pub client_id: String,
    pub client_secret: String,
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
    pub lookup_api_base: String,
    pub transfer_api_base: String,
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
        let loaded = LoadedConfigValues {
            values: env::vars().collect(),
            base_dir: default_base_dir(),
        };
        Self::from_values(&loaded.values, &loaded.base_dir)
    }

    fn from_values(values: &ConfigValues, base_dir: &Path) -> Result<Self> {
        let legacy_api_base = optional_value(values, "TRANSFERENCIAS_COINAG_API_BASE");
        let transfer_api_base = optional_value(values, "TRANSFERENCIAS_COINAG_TRANSFER_API_BASE")
            .or_else(|| legacy_api_base.clone())
            .unwrap_or_default();
        let lookup_api_base = optional_value(values, "TRANSFERENCIAS_COINAG_LOOKUP_API_BASE")
            .or_else(|| legacy_api_base)
            .unwrap_or_else(|| transfer_api_base.clone());

        Ok(Self {
            lookup_api_base,
            transfer_api_base,
            token_url: optional_value(values, "TRANSFERENCIAS_COINAG_TOKEN_URL")
                .unwrap_or_default(),
            username: optional_value(values, "TRANSFERENCIAS_COINAG_USERNAME").unwrap_or_default(),
            password: optional_value(values, "TRANSFERENCIAS_COINAG_PASSWORD").unwrap_or_default(),
            client_id: optional_value(values, "TRANSFERENCIAS_COINAG_CLIENT_ID")
                .unwrap_or_default(),
            client_secret: optional_value(values, "TRANSFERENCIAS_COINAG_CLIENT_SECRET")
                .unwrap_or_default(),
            cuit_debito: optional_value(values, "TRANSFERENCIAS_COINAG_CUIT_DEBITO")
                .unwrap_or_default(),
            cbu_debito: optional_value(values, "TRANSFERENCIAS_COINAG_CBU_DEBITO")
                .unwrap_or_default(),
            titular_debito: optional_value(values, "TRANSFERENCIAS_COINAG_TITULAR_DEBITO")
                .unwrap_or_default(),
            concepto: optional_value(values, "TRANSFERENCIAS_COINAG_CONCEPTO")
                .unwrap_or_else(|| "VAR".to_owned()),
            descripcion: optional_value(values, "TRANSFERENCIAS_COINAG_DESCRIPCION")
                .unwrap_or_default(),
            endpoint: optional_value(values, "TRANSFERENCIAS_COINAG_ENDPOINT")
                .unwrap_or_else(|| "/Transferencia".to_owned()),
            scope: optional_value(values, "TRANSFERENCIAS_COINAG_SCOPE").unwrap_or_default(),
            auth_scheme: optional_value(values, "TRANSFERENCIAS_COINAG_AUTH_SCHEME")
                .unwrap_or_else(|| "Bearer".to_owned()),
            id_empresa: optional_value(values, "TRANSFERENCIAS_COINAG_ID_EMPRESA")
                .unwrap_or_default(),
            id_seq_path: resolve_path(
                base_dir,
                optional_value(values, "TRANSFERENCIAS_COINAG_ID_SEQ_PATH").as_deref(),
                "transferencias_coinag_seq.txt",
            ),
            allow_invalid_certs: parse_bool_value(
                values,
                "TRANSFERENCIAS_COINAG_ALLOW_INVALID_CERTS",
                false,
            )?,
            ssh: CoinagSshConfig {
                enabled: parse_bool_value(values, "TRANSFERENCIAS_COINAG_SSH_ENABLED", false)?,
                host: optional_value(values, "TRANSFERENCIAS_COINAG_SSH_HOST").unwrap_or_default(),
                port: parse_u16_value(values, "TRANSFERENCIAS_COINAG_SSH_PORT", 22)?,
                user: optional_value(values, "TRANSFERENCIAS_COINAG_SSH_USER").unwrap_or_default(),
                private_key_path: resolve_optional_path(
                    base_dir,
                    optional_value(values, "TRANSFERENCIAS_COINAG_SSH_PRIVATE_KEY_PATH").as_deref(),
                ),
                host_public_key_path: resolve_optional_path(
                    base_dir,
                    optional_value(values, "TRANSFERENCIAS_COINAG_SSH_HOST_PUBLIC_KEY_PATH")
                        .as_deref(),
                ),
                originator_address: optional_value(
                    values,
                    "TRANSFERENCIAS_COINAG_SSH_ORIGINATOR_ADDRESS",
                )
                .unwrap_or_else(|| "127.0.0.1".to_owned()),
            },
        })
    }

    pub fn is_complete(&self) -> bool {
        !self.transfer_api_base.is_empty()
            && !self.token_url.is_empty()
            && !self.username.is_empty()
            && !self.password.is_empty()
            && !self.cuit_debito.is_empty()
            && !self.cbu_debito.is_empty()
            && !self.titular_debito.is_empty()
    }
}

impl AppConfig {
    pub fn load() -> Result<Self> {
        let loaded = LoadedConfigValues::load()?;
        Self::from_values(&loaded.values, &loaded.base_dir)
    }

    pub fn from_env() -> Result<Self> {
        let loaded = LoadedConfigValues {
            values: env::vars().collect(),
            base_dir: default_base_dir(),
        };
        Self::from_values(&loaded.values, &loaded.base_dir)
    }

    fn from_values(values: &ConfigValues, base_dir: &Path) -> Result<Self> {
        let poll_interval = Duration::from_secs(parse_u64_value(
            values,
            "TRANSFERENCIAS_POLL_INTERVAL_SECONDS",
            20,
        )?);
        let request_timeout = Duration::from_secs(parse_u64_value(
            values,
            "TRANSFERENCIAS_REQUEST_TIMEOUT_SECONDS",
            15,
        )?);
        let operator_name = optional_value(values, "TRANSFERENCIAS_OPERATOR_NAME")
            .or_else(|| optional_value(values, "USERNAME"))
            .or_else(|| optional_value(values, "COMPUTERNAME"))
            .unwrap_or_else(|| "operador_desconocido".to_owned());

        Ok(Self {
            server: ServerConfig {
                base_url: required_value(values, "TRANSFERENCIAS_SERVER_BASE_URL")?,
                client_id: required_value(values, "TRANSFERENCIAS_SERVER_CLIENT_ID")?,
                client_secret: required_value(values, "TRANSFERENCIAS_SERVER_CLIENT_SECRET")?,
                allow_invalid_certs: parse_bool_value(
                    values,
                    "TRANSFERENCIAS_SERVER_ALLOW_INVALID_CERTS",
                    false,
                )?,
            },
            core: CoreConfig {
                base_url: optional_value(values, "TRANSFERENCIAS_CORE_BASE_URL")
                    .unwrap_or_else(|| "https://celesol.dyndns.org:5050".to_owned()),
                allow_invalid_certs: parse_bool_value(
                    values,
                    "TRANSFERENCIAS_CORE_ALLOW_INVALID_CERTS",
                    true,
                )?,
            },
            coinag: CoinagConfig::from_values(values, base_dir)?,
            operator_name,
            poll_interval,
            request_timeout,
            receipts_dir: resolve_path(
                base_dir,
                optional_value(values, "TRANSFERENCIAS_RECEIPTS_DIR").as_deref(),
                "receipts",
            ),
            completed_log_path: resolve_path(
                base_dir,
                optional_value(values, "TRANSFERENCIAS_COMPLETED_LOG_PATH").as_deref(),
                "transferencias_realizadas.jsonl",
            ),
        })
    }
}

type ConfigValues = HashMap<String, String>;

struct LoadedConfigValues {
    values: ConfigValues,
    base_dir: PathBuf,
}

impl LoadedConfigValues {
    fn load() -> Result<Self> {
        let config_path = resolve_config_path()?;
        let base_dir = config_path
            .as_deref()
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .unwrap_or_else(default_base_dir);

        let mut values = if let Some(path) = config_path.as_deref() {
            parse_env_file(path)?
        } else {
            HashMap::new()
        };

        for (key, value) in env::vars() {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                values.insert(key, trimmed.to_owned());
            }
        }

        Ok(Self { values, base_dir })
    }
}

fn resolve_config_path() -> Result<Option<PathBuf>> {
    if let Some(path) = env::var("TRANSFERENCIAS_CONFIG_PATH")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(path);
        if !path.exists() {
            return Err(anyhow!(
                "TRANSFERENCIAS_CONFIG_PATH apunta a un archivo inexistente: {:?}",
                path
            ));
        }
        return Ok(Some(path));
    }

    let exe_dir = env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let cwd = env::current_dir().ok();

    let mut candidates = Vec::new();
    if let Some(exe_dir) = exe_dir {
        candidates.push(exe_dir.join("transferencias.env"));
    }
    if let Some(cwd) = cwd {
        let candidate = cwd.join("transferencias.env");
        if !candidates.iter().any(|existing| existing == &candidate) {
            candidates.push(candidate);
        }
    }

    Ok(candidates.into_iter().find(|path| path.exists()))
}

fn parse_env_file(path: &Path) -> Result<ConfigValues> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("No se pudo leer el archivo de configuracion {:?}", path))?;
    let mut values = HashMap::new();
    for (index, raw_line) in raw.lines().enumerate() {
        let line = if index == 0 {
            raw_line.trim_start_matches('\u{feff}')
        } else {
            raw_line
        };
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let (key, value) = line.split_once('=').ok_or_else(|| {
            anyhow!(
                "Linea invalida en {:?}: {}. Se esperaba formato KEY=VALUE.",
                path,
                index + 1
            )
        })?;
        let key = key.trim();
        if key.is_empty() {
            return Err(anyhow!(
                "Linea invalida en {:?}: {}. La clave no puede estar vacia.",
                path,
                index + 1
            ));
        }
        let value = parse_env_value(value.trim());
        values.insert(key.to_owned(), value);
    }
    Ok(values)
}

fn parse_env_value(raw: &str) -> String {
    if raw.len() >= 2 {
        if (raw.starts_with('"') && raw.ends_with('"'))
            || (raw.starts_with('\'') && raw.ends_with('\''))
        {
            return raw[1..raw.len() - 1].to_owned();
        }
    }
    raw.to_owned()
}

fn default_base_dir() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .or_else(|| env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_path(base_dir: &Path, value: Option<&str>, default_name: &str) -> PathBuf {
    match value {
        Some(value) if !value.trim().is_empty() => {
            let candidate = PathBuf::from(value.trim());
            if candidate.is_absolute() {
                candidate
            } else {
                base_dir.join(candidate)
            }
        }
        _ => base_dir.join(default_name),
    }
}

fn resolve_optional_path(base_dir: &Path, value: Option<&str>) -> PathBuf {
    match value {
        Some(value) if !value.trim().is_empty() => resolve_path(base_dir, Some(value), ""),
        _ => PathBuf::new(),
    }
}

fn required_value(values: &ConfigValues, name: &str) -> Result<String> {
    optional_value(values, name)
        .ok_or_else(|| anyhow!("Falta la variable de entorno obligatoria {name}."))
}

fn optional_value(values: &ConfigValues, name: &str) -> Option<String> {
    values
        .get(name)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn parse_bool_value(values: &ConfigValues, name: &str, default: bool) -> Result<bool> {
    let Some(raw_value) = optional_value(values, name) else {
        return Ok(default);
    };
    match raw_value.to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "y" | "si" => Ok(true),
        "0" | "false" | "no" | "n" => Ok(false),
        _ => Err(anyhow!("Valor invalido para {name}: {raw_value}")),
    }
}

fn parse_u16_value(values: &ConfigValues, name: &str, default: u16) -> Result<u16> {
    let Some(raw_value) = optional_value(values, name) else {
        return Ok(default);
    };
    raw_value
        .parse::<u16>()
        .with_context(|| format!("Valor invalido para {name}: {raw_value}"))
}

fn parse_u64_value(values: &ConfigValues, name: &str, default: u64) -> Result<u64> {
    let Some(raw_value) = optional_value(values, name) else {
        return Ok(default);
    };
    raw_value
        .parse::<u64>()
        .with_context(|| format!("Valor invalido para {name}: {raw_value}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_values(entries: &[(&str, &str)]) -> ConfigValues {
        entries
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn coinag_config_uses_legacy_base_for_lookup_and_transfer() {
        let values = config_values(&[("TRANSFERENCIAS_COINAG_API_BASE", "https://coinag-legacy")]);

        let config = CoinagConfig::from_values(&values, Path::new(".")).unwrap();

        assert_eq!(config.lookup_api_base, "https://coinag-legacy");
        assert_eq!(config.transfer_api_base, "https://coinag-legacy");
    }

    #[test]
    fn coinag_config_supports_distinct_lookup_and_transfer_bases() {
        let values = config_values(&[
            ("TRANSFERENCIAS_COINAG_LOOKUP_API_BASE", "https://coinag-v1"),
            (
                "TRANSFERENCIAS_COINAG_TRANSFER_API_BASE",
                "https://coinag-v2",
            ),
        ]);

        let config = CoinagConfig::from_values(&values, Path::new(".")).unwrap();

        assert_eq!(config.lookup_api_base, "https://coinag-v1");
        assert_eq!(config.transfer_api_base, "https://coinag-v2");
    }

    #[test]
    fn coinag_config_falls_back_to_transfer_base_for_lookup() {
        let values = config_values(&[(
            "TRANSFERENCIAS_COINAG_TRANSFER_API_BASE",
            "https://coinag-v2",
        )]);

        let config = CoinagConfig::from_values(&values, Path::new(".")).unwrap();

        assert_eq!(config.lookup_api_base, "https://coinag-v2");
        assert_eq!(config.transfer_api_base, "https://coinag-v2");
    }
}
