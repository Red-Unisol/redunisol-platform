//! Durable reservation/payment/PDF outbox. Recovery never initiates a bank transfer.
use crate::beex_client::{BeexOrder, BeexPlan, Confirmation, Reservation};
use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine, engine::general_purpose::STANDARD};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize)]
pub struct Journal {
    pub version: u32,
    pub solicitud_id: String,
    pub plan: BeexPlan,
    pub reservation: Reservation,
    pub order_id: Option<String>,
    pub attempted: HashSet<String>,
    pub confirmations: HashMap<String, Confirmation>,
    pub receipt_base64: Option<String>,
    pub receipt_path: Option<PathBuf>,
    pub completed: bool,
    #[serde(default)]
    pub automatic: bool,
}
impl Journal {
    pub fn new(plan: BeexPlan, reservation: Reservation) -> Self {
        Self {
            version: 1,
            solicitud_id: plan.solicitud_id.clone(),
            plan,
            reservation,
            order_id: None,
            attempted: HashSet::new(),
            confirmations: HashMap::new(),
            receipt_base64: None,
            receipt_path: None,
            completed: false,
            automatic: false,
        }
    }
    pub fn validate(&self, id: &str) -> Result<()> {
        self.plan.validate()?;
        uuid::Uuid::parse_str(&self.reservation.idempotency_key)?;
        if self.version != 1
            || self.solicitud_id != id
            || self.plan.solicitud_id != id
            || self.reservation.plan_version != self.plan.version
            || self.reservation.payments.len() != self.plan.payments.len()
        {
            bail!("Diario Beex invalido; requiere revision. No se crea otra reserva.");
        }
        let mut keys = HashSet::new();
        let mut ids = HashSet::new();
        for p in &self.reservation.payments {
            if !keys.insert(p.payment_key.as_str())
                || !ids.insert(p.bank_transaction_id.as_str())
                || !self
                    .plan
                    .payments
                    .iter()
                    .any(|leg| leg.payment_key == p.payment_key)
            {
                bail!("Pagos del diario Beex invalidos.");
            }
        }
        if self
            .attempted
            .iter()
            .any(|key| !keys.contains(key.as_str()))
        {
            bail!("Intento Beex sin reserva.");
        }
        for (key, confirmation) in &self.confirmations {
            self.validate_confirmation(key, confirmation)?;
        }
        if let Some(order_id) = &self.order_id {
            uuid::Uuid::parse_str(order_id)?;
        }
        if self.completed
            && (self.order_id.is_none() || self.confirmations.len() != self.plan.payments.len())
        {
            bail!("Diario Beex afirma completado sin reserva y evidencia de todos los pagos.");
        }
        Ok(())
    }
    fn validate_confirmation(&self, key: &str, c: &Confirmation) -> Result<()> {
        let leg = self
            .plan
            .payments
            .iter()
            .find(|p| p.payment_key == key)
            .ok_or_else(|| anyhow!("Pago fuera del plan reservado."))?;
        let reserved = self
            .reservation
            .payments
            .iter()
            .find(|p| p.payment_key == key)
            .ok_or_else(|| anyhow!("Pago no reservado."))?;
        if c.bank_transaction_id != reserved.bank_transaction_id
            || c.amount != leg.amount
            || c.currency != "ARS"
            || c.cbu != leg.cbu
            || c.cuit != leg.cuit
            || c.bank_operation_id.is_empty()
        {
            bail!("Evidencia bancaria no coincide con el plan reservado.");
        }
        chrono::DateTime::parse_from_rfc3339(&c.confirmed_at)?;
        Ok(())
    }
    pub fn accept_order(&mut self, order: &BeexOrder) -> Result<()> {
        if self.order_id.as_ref().is_some_and(|id| id != &order.id)
            || order.plan != self.plan
            || order.solicitud_id != self.solicitud_id
            || order.payments.len() != self.reservation.payments.len()
            || !matches!(
                order.status.as_str(),
                "RESERVED" | "BANK_CONFIRMED_PENDING_SYNC" | "COMPLETED"
            )
        {
            bail!("La reserva Beex no coincide con el diario local.");
        }
        uuid::Uuid::parse_str(&order.id)?;
        let mut seen = HashSet::new();
        for p in &order.payments {
            if !seen.insert(&p.payment_key)
                || !self.reservation.payments.iter().any(|r| {
                    r.payment_key == p.payment_key && r.bank_transaction_id == p.bank_transaction_id
                })
            {
                bail!("Beex cambio los identificadores reservados.");
            }
            match (&p.confirmation, &p.confirmed_at, &p.bank_operation_id) {
                (Some(c), Some(_), Some(op)) if op == &c.bank_operation_id => {
                    self.validate_confirmation(&p.payment_key, c)?;
                    if let Some(prior) = self.confirmations.get(&p.payment_key) {
                        // Operator/installation may differ on recovery, financial evidence cannot.
                        if prior.bank_operation_id != c.bank_operation_id
                            || prior.confirmed_at != c.confirmed_at
                        {
                            // PostgreSQL normalizes RFC3339 timestamps to milliseconds.
                            if prior.bank_operation_id != c.bank_operation_id
                                || chrono::DateTime::parse_from_rfc3339(&prior.confirmed_at)?
                                    != chrono::DateTime::parse_from_rfc3339(&c.confirmed_at)?
                            {
                                bail!("Beex devolvio otra evidencia bancaria.");
                            }
                        }
                    }
                    self.confirmations.insert(p.payment_key.clone(), c.clone());
                }
                (None, None, None) => {}
                _ => bail!("Confirmacion Beex incompleta."),
            }
        }
        if order.status != "RESERVED" && self.confirmations.len() != self.plan.payments.len() {
            bail!("Beex afirma completado sin todos los pagos.");
        }
        self.order_id = Some(order.id.clone());
        self.completed = order.status == "COMPLETED";
        Ok(())
    }
    pub fn remember_confirmation(&mut self, key: &str, confirmation: Confirmation) -> Result<()> {
        self.validate_confirmation(key, &confirmation)?;
        if self
            .confirmations
            .get(key)
            .is_some_and(|prior| prior != &confirmation)
        {
            bail!("Otro resultado local para el mismo pago.");
        }
        self.confirmations.insert(key.to_owned(), confirmation);
        Ok(())
    }
    pub fn receipt_bytes(&self) -> Result<Option<Vec<u8>>> {
        self.receipt_base64
            .as_ref()
            .map(|s| STANDARD.decode(s).context("PDF Beex corrupto."))
            .transpose()
    }
    pub fn remember_receipt(&mut self, path: PathBuf, bytes: &[u8]) -> Result<()> {
        if self.confirmations.len() != self.plan.payments.len() {
            bail!("Faltan pagos confirmados; no se adjunta PDF.");
        }
        if let Some(prior) = self.receipt_bytes()? {
            if prior != bytes {
                bail!("No se reemplaza el PDF reservado.");
            }
        }
        self.receipt_base64 = Some(STANDARD.encode(bytes));
        self.receipt_path = Some(path);
        Ok(())
    }
}
pub struct Store {
    pub dir: PathBuf,
    pub installation_id: String,
}
impl Store {
    pub fn new(dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(&dir)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(dir.join("installation.lock"))?;
        file.try_lock_exclusive()
            .context("Otra instancia esta inicializando Beex.")?;
        let path = dir.join("installation-id");
        let installation_id = if path.exists() {
            let value = fs::read_to_string(&path)?;
            uuid::Uuid::parse_str(value.trim())?.to_string()
        } else {
            let value = uuid::Uuid::new_v4().to_string();
            atomic_write(&path, value.as_bytes())?;
            value
        };
        Ok(Self {
            dir,
            installation_id,
        })
    }
    pub fn lock(&self, id: &str) -> Result<LockedJournal> {
        uuid::Uuid::parse_str(id)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(self.dir.join(format!("{id}.lock")))?;
        file.try_lock_exclusive()
            .context("Otra operacion esta procesando esta solicitud Beex.")?;
        Ok(LockedJournal {
            path: self.dir.join(format!("{id}.json")),
            id: id.to_owned(),
            _lock: file,
        })
    }
    pub fn pending_ids(&self) -> Result<Vec<String>> {
        let mut ids = Vec::new();
        for entry in fs::read_dir(&self.dir)? {
            let path = entry?.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let id = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .ok_or_else(|| anyhow!("Nombre de diario invalido."))?;
                uuid::Uuid::parse_str(id)?;
                ids.push(id.to_owned());
            }
        }
        Ok(ids)
    }
}
pub struct LockedJournal {
    path: PathBuf,
    id: String,
    _lock: File,
}
impl LockedJournal {
    pub fn perform_once<T>(
        &self,
        state: &mut Journal,
        key: &str,
        send: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        if !state
            .reservation
            .payments
            .iter()
            .any(|p| p.payment_key == key)
            || state.confirmations.contains_key(key)
            || state.attempted.contains(key)
            || state.order_id.is_none()
        {
            bail!("Pago no reservado, confirmado o ya intentado; no se reenvia.");
        }
        state.attempted.insert(key.to_owned());
        self.save(state)?;
        send()
    }
    pub fn read(&self) -> Result<Option<Journal>> {
        if !self.path.exists() {
            return Ok(None);
        }
        let state: Journal = serde_json::from_slice(&fs::read(&self.path)?)
            .context("Diario Beex corrupto; no se crea otro.")?;
        state.validate(&self.id)?;
        Ok(Some(state))
    }
    pub fn save(&self, state: &Journal) -> Result<()> {
        state.validate(&self.id)?;
        atomic_write(&self.path, &serde_json::to_vec_pretty(state)?)
    }
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let temp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    crate::credit_lines::replace_file(&temp, path)?;
    #[cfg(not(windows))]
    File::open(path.parent().unwrap())?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::beex_client::test_support::{confirmation, journal, order};
    #[test]
    fn lost_reservation_response_keeps_the_exact_body_and_installation_across_restart() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().to_owned()).unwrap();
        let original = journal();
        let lock = store.lock(&original.solicitud_id).unwrap();
        lock.save(&original).unwrap();
        assert!(store.lock(&original.solicitud_id).is_err());
        drop(lock);
        let restarted = Store::new(temp.path().to_owned()).unwrap();
        assert_eq!(store.installation_id, restarted.installation_id);
        let recovered = restarted
            .lock(&original.solicitud_id)
            .unwrap()
            .read()
            .unwrap()
            .unwrap();
        assert_eq!(recovered.reservation, original.reservation);
        assert_eq!(recovered.plan, original.plan);
        assert!(recovered.order_id.is_none());
    }
    #[test]
    fn timeout_persists_attempt_before_send_and_never_sends_again_on_restart() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().to_owned()).unwrap();
        let mut state = journal();
        state.order_id = Some(uuid::Uuid::new_v4().to_string());
        let lock = store.lock(&state.solicitud_id).unwrap();
        lock.save(&state).unwrap();
        let result: Result<()> = lock.perform_once(&mut state, "member", || {
            let persisted: Journal =
                serde_json::from_slice(&fs::read(&lock.path).unwrap()).unwrap();
            assert!(persisted.attempted.contains("member"));
            bail!("simulated lost bank response")
        });
        assert!(result.is_err());
        drop(lock);
        let lock = store.lock(&state.solicitud_id).unwrap();
        let mut recovered = lock.read().unwrap().unwrap();
        assert!(
            lock.perform_once(&mut recovered, "member", || -> Result<()> {
                panic!("must not send twice")
            })
            .is_err()
        );
        assert_eq!(recovered.reservation, state.reservation);
    }
    #[test]
    fn corrupt_outbox_never_resets_to_a_new_reservation() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().to_owned()).unwrap();
        let state = journal();
        let lock = store.lock(&state.solicitud_id).unwrap();
        fs::write(&lock.path, b"{truncated").unwrap();
        assert!(lock.read().is_err());
        assert_eq!(fs::read(&lock.path).unwrap(), b"{truncated");
        let mut invalid = state.clone();
        invalid.completed = true;
        assert!(lock.save(&invalid).is_err());
    }
    #[test]
    fn mismatched_order_financial_evidence_and_pdf_replacement_are_rejected() {
        let mut state = journal();
        let mut remote = order(&state, false);
        remote.payments[0].bank_transaction_id = "changed".to_owned();
        assert!(state.accept_order(&remote).is_err());
        remote = order(&state, false);
        remote.plan.payments[0].cbu = "0000000000000000000002".to_owned();
        assert!(state.accept_order(&remote).is_err());
        let evidence = confirmation(&state);
        let mut different = evidence.clone();
        different.amount = "1000.02".to_owned();
        assert!(state.remember_confirmation("member", different).is_err());
        state
            .remember_confirmation("member", evidence.clone())
            .unwrap();
        different = evidence;
        different.bank_operation_id = "second-id".to_owned();
        assert!(state.remember_confirmation("member", different).is_err());
        state
            .remember_receipt(PathBuf::from("synthetic.pdf"), b"%PDF-1.7 first %%EOF")
            .unwrap();
        assert!(
            state
                .remember_receipt(PathBuf::from("new.pdf"), b"%PDF-1.7 changed %%EOF")
                .is_err()
        );
        assert_eq!(
            state.receipt_bytes().unwrap().unwrap(),
            b"%PDF-1.7 first %%EOF"
        );
    }
}
