use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

use anyhow::{Context, Result, anyhow};
use chrono::Utc;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CompletedTransferRecord {
    pub request_oid: String,
    pub timestamp: String,
    pub operator_name: String,
    pub external_transfer_id: Option<String>,
}

pub struct CompletedTransferLog {
    path: PathBuf,
    state: Mutex<CompletedTransferState>,
}

struct CompletedTransferState {
    records: HashMap<String, CompletedTransferRecord>,
}

impl CompletedTransferLog {
    pub fn new(path: PathBuf) -> Result<Self> {
        let records = load_records(&path)?;
        Ok(Self {
            path,
            state: Mutex::new(CompletedTransferState { records }),
        })
    }

    pub fn contains_loaded(&self, request_oid: &str) -> bool {
        let key = normalize_request_oid(request_oid);
        self.state
            .lock()
            .ok()
            .is_some_and(|state| state.records.contains_key(&key))
    }

    pub fn contains_fresh(&self, request_oid: &str) -> Result<bool> {
        let key = normalize_request_oid(request_oid);
        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow!("No se pudo bloquear el registro local de transferencias."))?;
        state.records = load_records(&self.path)?;
        Ok(state.records.contains_key(&key))
    }

    pub fn record(
        &self,
        request_oid: &str,
        operator_name: &str,
        external_transfer_id: Option<&str>,
    ) -> Result<CompletedTransferRecord> {
        let request_oid = normalize_request_oid(request_oid);
        let mut state = self
            .state
            .lock()
            .map_err(|_| anyhow!("No se pudo bloquear el registro local de transferencias."))?;
        state.records = load_records(&self.path)?;
        if let Some(existing) = state.records.get(&request_oid) {
            return Ok(existing.clone());
        }

        let record = CompletedTransferRecord {
            request_oid: request_oid.clone(),
            timestamp: Utc::now().to_rfc3339(),
            operator_name: operator_name.trim().to_owned(),
            external_transfer_id: external_transfer_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned),
        };
        state.records.insert(request_oid, record.clone());
        append_record(&self.path, &record)?;
        Ok(record)
    }
}

fn load_records(path: &Path) -> Result<HashMap<String, CompletedTransferRecord>> {
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let file = fs::File::open(path)
        .with_context(|| format!("No se pudo abrir el registro local {:?}", path))?;
    let reader = BufReader::new(file);
    let mut records = HashMap::new();
    for (line_number, line) in reader.lines().enumerate() {
        let line = line.with_context(|| {
            format!(
                "No se pudo leer la linea {} del registro local {:?}",
                line_number + 1,
                path
            )
        })?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let record =
            serde_json::from_str::<CompletedTransferRecord>(trimmed).with_context(|| {
                format!(
                    "No se pudo decodificar la linea {} del registro local {:?}",
                    line_number + 1,
                    path
                )
            })?;
        records.insert(normalize_request_oid(&record.request_oid), record);
    }
    Ok(records)
}

fn append_record(path: &Path, record: &CompletedTransferRecord) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .with_context(|| format!("No se pudo crear la carpeta {:?}", parent))?;
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .with_context(|| format!("No se pudo abrir el registro local {:?}", path))?;
    let payload = serde_json::to_string(record)
        .context("No se pudo serializar el registro local de transferencia.")?;
    file.write_all(payload.as_bytes())
        .with_context(|| format!("No se pudo escribir en {:?}", path))?;
    file.write_all(b"\n")
        .with_context(|| format!("No se pudo terminar la linea en {:?}", path))?;
    file.flush()
        .with_context(|| format!("No se pudo flushar {:?}", path))?;
    file.sync_data()
        .with_context(|| format!("No se pudo sincronizar {:?}", path))?;
    Ok(())
}

fn normalize_request_oid(value: &str) -> String {
    value.trim().to_owned()
}
