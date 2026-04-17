use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use chrono::Local;
use env_logger::{Builder, Target, WriteStyle};
use log::LevelFilter;

use crate::config;

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

    let path = resolve_log_path();
    let file = open_log_file(&path)?;
    eprintln!("Log activo en {}", path.display());
    builder.target(Target::Pipe(Box::new(file)));

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

fn resolve_log_path() -> PathBuf {
    if let Some(path) = env::var_os("TRANSFERENCIAS_DEBUG_LOG_PATH")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        return path;
    }
    if let Some(path) =
        config::read_config_file_value("TRANSFERENCIAS_DEBUG_LOG_PATH").map(PathBuf::from)
    {
        return path;
    }
    default_base_dir()
        .join("logs")
        .join(default_log_file_name())
}

fn open_log_file(path: &Path) -> Result<std::fs::File> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .with_context(|| format!("No se pudo crear la carpeta de logs {:?}", parent))?;
        }
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .with_context(|| format!("No se pudo abrir el archivo de log {:?}", path))
}

fn default_log_file_name() -> &'static str {
    if cfg!(debug_assertions) {
        "transferencias-debug.log"
    } else {
        "transferencias.log"
    }
}

fn default_base_dir() -> PathBuf {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .or_else(|| env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}
