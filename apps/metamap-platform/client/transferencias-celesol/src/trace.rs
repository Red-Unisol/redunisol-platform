use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, mpsc},
    thread,
    time::Duration,
};

use anyhow::{Context, Result};
use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{BUILD_TAG, server_client::ServerClient};

const BATCH_SIZE: usize = 100;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TransferTraceEvent {
    pub event_id: String,
    pub session_id: String,
    pub client_instance_id: String,
    pub event_type: String,
    pub occurred_at: String,
    pub operator: String,
    pub application_version: String,
    pub request_oid: Option<String>,
    pub mode: Option<String>,
    pub severity: String,
    pub data: Value,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum OutboxEntry {
    Event { event: TransferTraceEvent },
    Ack { event_ids: Vec<String> },
}

struct OutboxState {
    path: PathBuf,
    pending: Vec<TransferTraceEvent>,
}

enum WorkerCommand {
    Flush,
    Shutdown,
}

struct TraceRuntime {
    state: Arc<Mutex<OutboxState>>,
    sender: mpsc::Sender<WorkerCommand>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
    session_id: String,
    client_instance_id: String,
    operator: String,
    session_marker_path: PathBuf,
}

static RUNTIME: OnceLock<Arc<TraceRuntime>> = OnceLock::new();

pub fn init(server: ServerClient, operator: String, outbox_path: PathBuf) -> Result<()> {
    if RUNTIME.get().is_some() {
        return Ok(());
    }
    ensure_parent(&outbox_path)?;
    let identity_path = sibling_path(&outbox_path, "client-id");
    let session_marker_path = sibling_path(&outbox_path, "session");
    let client_instance_id = load_or_create_identity(&identity_path)?;
    let previous_session = read_nonempty(&session_marker_path);
    let session_id = Uuid::new_v4().to_string();
    fs::write(&session_marker_path, &session_id).with_context(|| {
        format!("No se pudo escribir el marcador de sesion {session_marker_path:?}")
    })?;

    let state = Arc::new(Mutex::new(OutboxState {
        pending: load_pending(&outbox_path)?,
        path: outbox_path,
    }));
    let (sender, receiver) = mpsc::channel();
    let worker_state = Arc::clone(&state);
    let worker = thread::spawn(move || uploader_loop(server, worker_state, receiver));
    let runtime = Arc::new(TraceRuntime {
        state,
        sender,
        worker: Mutex::new(Some(worker)),
        session_id,
        client_instance_id,
        operator,
        session_marker_path,
    });
    if RUNTIME.set(Arc::clone(&runtime)).is_err() {
        return Ok(());
    }

    if let Some(previous_session_id) = previous_session {
        record_audit(
            "previous_session_unclean",
            None,
            None,
            json!({ "previous_session_id": previous_session_id }),
        );
    }
    record_audit("app_started", None, None, json!({}));
    let _ = runtime.sender.send(WorkerCommand::Flush);
    Ok(())
}

pub fn record_audit(event_type: &str, request_oid: Option<&str>, mode: Option<&str>, data: Value) {
    let Some(runtime) = RUNTIME.get() else {
        return;
    };
    let event = TransferTraceEvent {
        event_id: Uuid::new_v4().to_string(),
        session_id: runtime.session_id.clone(),
        client_instance_id: runtime.client_instance_id.clone(),
        event_type: event_type.to_owned(),
        occurred_at: Local::now().to_rfc3339(),
        operator: runtime.operator.clone(),
        application_version: BUILD_TAG.to_owned(),
        request_oid: request_oid.map(str::to_owned),
        mode: mode.map(str::to_owned),
        severity: "info".to_owned(),
        data,
    };
    match runtime.state.lock() {
        Ok(mut state) => {
            if let Err(error) = append_entry(
                &state.path,
                &OutboxEntry::Event {
                    event: event.clone(),
                },
            ) {
                log::error!("No se pudo persistir un evento de trazabilidad: {error:#}");
                return;
            }
            state.pending.push(event);
        }
        Err(error) => {
            log::error!("No se pudo bloquear la outbox de trazabilidad: {error}");
            return;
        }
    }
    let _ = runtime.sender.send(WorkerCommand::Flush);
}

pub fn shutdown() {
    let Some(runtime) = RUNTIME.get() else {
        return;
    };
    record_audit("app_closed", None, None, json!({ "normal": true }));
    if let Err(error) = fs::remove_file(&runtime.session_marker_path)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        log::warn!("No se pudo retirar el marcador de sesion: {error}");
    }
    let _ = runtime.sender.send(WorkerCommand::Shutdown);
    if let Ok(mut worker) = runtime.worker.lock()
        && let Some(handle) = worker.take()
    {
        let _ = handle.join();
    }
}

fn uploader_loop(
    server: ServerClient,
    state: Arc<Mutex<OutboxState>>,
    receiver: mpsc::Receiver<WorkerCommand>,
) {
    loop {
        let command = receiver.recv_timeout(Duration::from_secs(10));
        let mut shutdown = matches!(command, Ok(WorkerCommand::Shutdown));
        while let Ok(queued) = receiver.try_recv() {
            shutdown |= matches!(queued, WorkerCommand::Shutdown);
        }
        flush_pending(&server, &state);
        if shutdown {
            break;
        }
    }
}

fn flush_pending(server: &ServerClient, state: &Arc<Mutex<OutboxState>>) {
    loop {
        let batch = match state.lock() {
            Ok(state) => state
                .pending
                .iter()
                .take(BATCH_SIZE)
                .cloned()
                .collect::<Vec<_>>(),
            Err(_) => return,
        };
        if batch.is_empty() {
            return;
        }
        let payload = match batch
            .iter()
            .map(serde_json::to_value)
            .collect::<std::result::Result<Vec<_>, _>>()
        {
            Ok(payload) => payload,
            Err(error) => {
                log::warn!("No se pudo serializar la traza pendiente: {error}");
                return;
            }
        };
        if let Err(error) = server.send_transfer_trace_events(&payload) {
            log::warn!("Trazabilidad remota pendiente; se reintentara: {error:#}");
            return;
        }
        let ids = batch
            .iter()
            .map(|event| event.event_id.clone())
            .collect::<Vec<_>>();
        let acknowledged = ids.iter().cloned().collect::<HashSet<_>>();
        match state.lock() {
            Ok(mut state) => {
                if let Err(error) = append_entry(&state.path, &OutboxEntry::Ack { event_ids: ids })
                {
                    log::warn!("No se pudo confirmar la traza enviada en la outbox: {error:#}");
                    return;
                }
                state
                    .pending
                    .retain(|event| !acknowledged.contains(&event.event_id));
                if state.pending.is_empty()
                    && let Err(error) = compact_empty_outbox(&state.path)
                {
                    log::warn!("No se pudo compactar la outbox vacia: {error:#}");
                }
            }
            Err(_) => return,
        }
    }
}

fn load_pending(path: &Path) -> Result<Vec<TransferTraceEvent>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = fs::File::open(path)
        .with_context(|| format!("No se pudo abrir la outbox de trazabilidad {path:?}"))?;
    let mut events = Vec::new();
    let mut acknowledged = HashSet::new();
    for line in BufReader::new(file).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<OutboxEntry>(&line) {
            Ok(OutboxEntry::Event { event }) => events.push(event),
            Ok(OutboxEntry::Ack { event_ids }) => acknowledged.extend(event_ids),
            Err(error) => log::warn!("Se omitio una linea invalida de la outbox: {error}"),
        }
    }
    events.retain(|event| !acknowledged.contains(&event.event_id));
    Ok(events)
}

fn append_entry(path: &Path, entry: &OutboxEntry) -> Result<()> {
    ensure_parent(path)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .with_context(|| format!("No se pudo abrir la outbox {path:?}"))?;
    serde_json::to_writer(&mut file, entry)?;
    file.write_all(b"\n")?;
    file.flush()?;
    Ok(())
}

fn compact_empty_outbox(path: &Path) -> Result<()> {
    OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .with_context(|| format!("No se pudo compactar la outbox {path:?}"))?;
    Ok(())
}

fn ensure_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn sibling_path(path: &Path, extension: &str) -> PathBuf {
    path.with_extension(extension)
}

fn read_nonempty(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn load_or_create_identity(path: &Path) -> Result<String> {
    if let Some(value) = read_nonempty(path) {
        return Ok(value);
    }
    ensure_parent(path)?;
    let value = Uuid::new_v4().to_string();
    fs::write(path, &value)
        .with_context(|| format!("No se pudo crear la identidad local {path:?}"))?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outbox_replay_removes_only_acknowledged_events() {
        let dir = std::env::temp_dir().join(format!("trace-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("outbox.jsonl");
        let make_event = |id: &str| TransferTraceEvent {
            event_id: id.to_owned(),
            session_id: "session".to_owned(),
            client_instance_id: "client".to_owned(),
            event_type: "event".to_owned(),
            occurred_at: "2026-08-31T15:46:00Z".to_owned(),
            operator: "operator".to_owned(),
            application_version: "test".to_owned(),
            request_oid: None,
            mode: None,
            severity: "info".to_owned(),
            data: json!({}),
        };
        append_entry(
            &path,
            &OutboxEntry::Event {
                event: make_event("one"),
            },
        )
        .unwrap();
        append_entry(
            &path,
            &OutboxEntry::Event {
                event: make_event("two"),
            },
        )
        .unwrap();
        append_entry(
            &path,
            &OutboxEntry::Ack {
                event_ids: vec!["one".to_owned()],
            },
        )
        .unwrap();
        let pending = load_pending(&path).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].event_id, "two");
        fs::remove_dir_all(dir).unwrap();
    }
}
