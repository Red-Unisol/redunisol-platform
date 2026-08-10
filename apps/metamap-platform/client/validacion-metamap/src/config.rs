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
    pub media: MediaConfig,
    pub poll_interval: Duration,
    pub request_timeout: Duration,
    pub max_items: usize,
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
    pub evaluate_api_bearer_token: Option<String>,
}

#[derive(Clone)]
pub struct MediaConfig {
    pub downloads_dir: PathBuf,
    pub metamap_client_id: Option<String>,
    pub metamap_client_secret: Option<String>,
}

type ConfigValues = HashMap<String, String>;

struct LoadedConfigValues {
    values: ConfigValues,
}

impl AppConfig {
    pub fn load() -> Result<Self> {
        let loaded = LoadedConfigValues::load()?;
        Self::from_values(&loaded.values)
    }

    fn from_values(values: &ConfigValues) -> Result<Self> {
        Ok(Self {
            server: ServerConfig {
                base_url: required_value(values, "VALIDACION_METAMAP_SERVER_BASE_URL")?,
                client_id: required_value(values, "VALIDACION_METAMAP_SERVER_CLIENT_ID")?,
                client_secret: required_value(values, "VALIDACION_METAMAP_SERVER_CLIENT_SECRET")?,
                allow_invalid_certs: parse_bool_value(
                    values,
                    "VALIDACION_METAMAP_SERVER_ALLOW_INVALID_CERTS",
                    false,
                )?,
            },
            core: CoreConfig {
                base_url: optional_value(values, "VALIDACION_METAMAP_CORE_BASE_URL")
                    .unwrap_or_else(|| "https://celesol.dyndns.org:5050".to_owned()),
                allow_invalid_certs: parse_bool_value(
                    values,
                    "VALIDACION_METAMAP_CORE_ALLOW_INVALID_CERTS",
                    true,
                )?,
                evaluate_api_bearer_token: optional_value(
                    values,
                    "VALIDACION_METAMAP_CORE_EVALUATE_API_BEARER_TOKEN",
                ),
            },
            media: MediaConfig {
                downloads_dir: resolve_runtime_dir_path(
                    optional_value(values, "VALIDACION_METAMAP_MEDIA_DOWNLOADS_DIR")
                        .unwrap_or_else(|| "media-validaciones".to_owned()),
                )?,
                metamap_client_id: optional_value(
                    values,
                    "VALIDACION_METAMAP_METAMAP_CLIENT_ID",
                ),
                metamap_client_secret: optional_value(
                    values,
                    "VALIDACION_METAMAP_METAMAP_CLIENT_SECRET",
                ),
            },
            poll_interval: Duration::from_secs(parse_u64_value(
                values,
                "VALIDACION_METAMAP_POLL_INTERVAL_SECONDS",
                20,
            )?),
            request_timeout: Duration::from_secs(parse_u64_value(
                values,
                "VALIDACION_METAMAP_REQUEST_TIMEOUT_SECONDS",
                15,
            )?),
            max_items: parse_usize_value(values, "VALIDACION_METAMAP_MAX_ITEMS", 600)?,
        })
    }
}

impl LoadedConfigValues {
    fn load() -> Result<Self> {
        let mut values = if let Some(path) = resolve_runtime_config_path()? {
            parse_env_file(&path)?
        } else {
            HashMap::new()
        };

        for (key, value) in env::vars() {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                values.insert(key, trimmed.to_owned());
            }
        }

        Ok(Self { values })
    }
}

pub fn resolve_runtime_config_path() -> Result<Option<PathBuf>> {
    if let Some(path) = env::var("VALIDACION_METAMAP_CONFIG_PATH")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(path);
        if !path.exists() {
            return Err(anyhow!(
                "VALIDACION_METAMAP_CONFIG_PATH apunta a un archivo inexistente: {:?}",
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
        candidates.push(exe_dir.join("validacion-metamap.env"));
    }
    if let Some(cwd) = cwd {
        let candidate = cwd.join("validacion-metamap.env");
        if !candidates.iter().any(|existing| existing == &candidate) {
            candidates.push(candidate);
        }
    }

    Ok(candidates.into_iter().find(|path| path.exists()))
}

pub fn read_config_file_value(name: &str) -> Option<String> {
    let path = resolve_runtime_config_path().ok().flatten()?;
    let values = parse_env_file(&path).ok()?;
    optional_value(&values, name)
}

fn resolve_runtime_dir_path(raw_value: String) -> Result<PathBuf> {
    let candidate = PathBuf::from(raw_value.trim());
    if candidate.is_absolute() {
        return Ok(candidate);
    }

    Ok(resolve_runtime_base_dir()?.join(candidate))
}

fn resolve_runtime_base_dir() -> Result<PathBuf> {
    if let Some(config_path) = resolve_runtime_config_path()? {
        if let Some(parent) = config_path.parent() {
            return Ok(parent.to_path_buf());
        }
    }

    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .or_else(|| env::current_dir().ok())
        .ok_or_else(|| anyhow!("No se pudo resolver la carpeta base del runtime."))
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

        values.insert(key.trim().to_owned(), parse_env_value(value.trim()));
    }

    Ok(values)
}

fn parse_env_value(raw: &str) -> String {
    if raw.len() >= 2
        && ((raw.starts_with('"') && raw.ends_with('"'))
            || (raw.starts_with('\'') && raw.ends_with('\'')))
    {
        return raw[1..raw.len() - 1].to_owned();
    }

    raw.to_owned()
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

fn parse_u64_value(values: &ConfigValues, name: &str, default: u64) -> Result<u64> {
    let Some(raw_value) = optional_value(values, name) else {
        return Ok(default);
    };

    raw_value
        .parse::<u64>()
        .with_context(|| format!("Valor invalido para {name}: {raw_value}"))
}

fn parse_usize_value(values: &ConfigValues, name: &str, default: usize) -> Result<usize> {
    let Some(raw_value) = optional_value(values, name) else {
        return Ok(default);
    };

    raw_value
        .parse::<usize>()
        .with_context(|| format!("Valor invalido para {name}: {raw_value}"))
}
