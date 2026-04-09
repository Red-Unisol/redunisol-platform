use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use chrono::Local;
use env_logger::{Builder, Target, WriteStyle};
use log::LevelFilter;

pub fn init_logging() -> Result<()> {
    let mut builder = Builder::new();
    builder.write_style(WriteStyle::Never);

    if env::var_os("RUST_LOG").is_some() {
        builder.parse_default_env();
    } else {
        builder.filter_level(LevelFilter::Warn);
        builder.filter_module("transferencias_celesol", debug_level());
    }

    builder.format(|buf, record| {
        writeln!(
            buf,
            "{} {:<5} [{}] {}",
            Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            record.level(),
            record.target(),
            record.args()
        )
    });

    if cfg!(debug_assertions) {
        let path = resolve_debug_log_path();
        let file = open_debug_log_file(&path)?;
        eprintln!("Debug log activo en {}", path.display());
        builder.target(Target::Pipe(Box::new(file)));
    }

    builder
        .try_init()
        .context("No se pudo inicializar el logger de la aplicacion.")?;
    log::info!("Logger inicializado.");
    Ok(())
}

fn debug_level() -> LevelFilter {
    if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    }
}

fn resolve_debug_log_path() -> PathBuf {
    if let Some(path) = env::var_os("TRANSFERENCIAS_DEBUG_LOG_PATH")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        return path;
    }
    if let Some(path) = read_env_file_value("TRANSFERENCIAS_DEBUG_LOG_PATH").map(PathBuf::from) {
        return path;
    }
    default_base_dir()
        .join("logs")
        .join("transferencias-debug.log")
}

fn open_debug_log_file(path: &Path) -> Result<std::fs::File> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .with_context(|| format!("No se pudo crear la carpeta de logs {:?}", parent))?;
        }
    }
    std::fs::File::create(path)
        .with_context(|| format!("No se pudo abrir el archivo de log {:?}", path))
}

fn default_base_dir() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .or_else(|| env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn read_env_file_value(name: &str) -> Option<String> {
    let path = resolve_config_path().ok().flatten()?;
    let raw = fs::read_to_string(path).ok()?;
    raw.lines().find_map(|raw_line| {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            return None;
        }
        let (key, value) = line.split_once('=')?;
        if key.trim() != name {
            return None;
        }
        let value = parse_env_value(value.trim());
        (!value.is_empty()).then_some(value)
    })
}

fn resolve_config_path() -> Result<Option<PathBuf>> {
    if let Some(path) = env::var("TRANSFERENCIAS_CONFIG_PATH")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(path);
        if !path.exists() {
            return Ok(None);
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
