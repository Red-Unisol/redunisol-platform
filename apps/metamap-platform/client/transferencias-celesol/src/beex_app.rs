//! Beex adapter and recovery orchestration.
use super::*;
use crate::{
    beex_client::{BeexPlan, Confirmation as BeexConfirmation, Reservation, ReservationPayment},
    beex_recovery::{Journal as BeexJournal, LockedJournal},
};

impl AppServices {
    pub(super) fn load_beex_candidates(&self) -> Result<Vec<CoreSnapshot>> {
        let (Some(client), Some(store)) = (&self.beex, &self.beex_store) else {
            return Ok(Vec::new());
        };
        let mut result = Vec::new();
        let mut seen = HashSet::new();
        for candidate in client.candidates()? {
            seen.insert(candidate.solicitud_id.clone());
            let plan = if let Some(order) = &candidate.desembolso {
                client.order(&order.id).map(|o| o.plan)
            } else {
                client.plan(&candidate.solicitud_id)
            };
            let snapshot = plan.and_then(|p| p.core());
            match snapshot {
                Ok(mut core) => {
                    if let Some(line) = self
                        .credit_lines_snapshot()
                        .lineas
                        .iter()
                        .find(|l| Some(l.id) == core.credit_line_id)
                    {
                        core.credit_line_code = Some(line.codigo.clone());
                        core.credit_line_description = Some(line.descripcion.clone());
                    }
                    if candidate.desembolso.is_some()
                        && store
                            .lock(&candidate.solicitud_id)
                            .and_then(|l| l.read())
                            .ok()
                            .flatten()
                            .is_none()
                    {
                        core.request_status = Some("Reserva Beex sin diario local; requiere revision de la instalacion original.".to_owned());
                    }
                    result.push(core);
                }
                Err(error) => result.push(CoreSnapshot {
                    request_oid: format!("beex:{}", candidate.solicitud_id),
                    request_name: Some(format!(
                        "Beex {}",
                        candidate
                            .nro_solicitud
                            .as_deref()
                            .unwrap_or(&candidate.solicitud_id)
                    )),
                    request_status: Some(format!("Beex: {error}")),
                    beex: Some(BeexPlan {
                        source: "BEEX".to_owned(),
                        solicitud_id: candidate.solicitud_id,
                        nro_solicitud: candidate.nro_solicitud,
                        ..Default::default()
                    }),
                    ..Default::default()
                }),
            }
        }
        // Recover pending sync even after the request disappears from Transferir.
        for id in store.pending_ids()? {
            if seen.contains(&id) {
                continue;
            }
            let local = store.lock(&id)?.read()?;
            if let Some(local) = local.filter(|l| !l.completed) {
                result.push(local.plan.core()?);
            }
        }
        Ok(result)
    }

    pub(super) fn recover_beex_case(&self, case: &mut HydratedCase) {
        let result = (|| -> Result<()> {
            let plan = case
                .core
                .beex
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Falta plan Beex."))?;
            let client = self
                .beex
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Beex no configurado."))?;
            let store = self
                .beex_store
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Falta almacenamiento Beex."))?;
            let lock = store.lock(&plan.solicitud_id)?;
            let Some(mut journal) = lock.read()? else {
                return Ok(());
            };
            self.sync_beex(case, &mut journal, &lock, client)?;
            if journal.completed {
                case.transfer_guard = CoinagTransferGuard::YaTransferida;
                case.validation.blockers.push("YA TRANSFERIDA".to_owned());
                case.message = Some("Beex: Pagada y comprobante sincronizado.".to_owned());
            } else if !journal.attempted.is_empty() || !journal.confirmations.is_empty() {
                // Confirmed legs can be resumed manually after a fresh approval,
                // but never automatically after a partial or uncertain attempt.
                let unresolved = journal
                    .attempted
                    .iter()
                    .any(|k| !journal.confirmations.contains_key(k));
                if unresolved {
                    case.validation.blockers.push(
                        "EN PROCESO: Beex tiene un resultado bancario incierto; no reenviar."
                            .to_owned(),
                    );
                }
                case.validation.warnings.push(ValidationWarning::new(WarningKind::Renewal, "Beex tiene una reserva parcial. Reanudar solo los pagos pendientes tras revisar."));
                case.message = Some(format!(
                    "Beex: {}/{} pagos confirmados.",
                    journal.confirmations.len(),
                    journal.plan.payments.len()
                ));
            }
            Ok(())
        })();
        if let Err(error) = result {
            case.validation
                .blockers
                .push(format!("Recuperacion Beex pendiente: {error}"));
            case.message = Some(format!("Beex: {error}"));
        }
    }

    // This method has no call to perform_transfer. It can confirm prior bank
    // evidence and replay the same PDF, including after an application restart.
    pub(super) fn sync_beex(
        &self,
        case: &HydratedCase,
        journal: &mut BeexJournal,
        lock: &LockedJournal,
        client: &BeexClient,
    ) -> Result<()> {
        if journal.completed {
            return Ok(());
        }
        let order = if let Some(id) = &journal.order_id {
            Some(client.order(id)?)
        } else {
            client.by_key(&journal.reservation.idempotency_key)?
        };
        let Some(order) = order else {
            return Ok(());
        };
        journal.accept_order(&order)?;
        lock.save(journal)?;
        if journal.completed {
            return Ok(());
        }
        let id = order.id.clone();
        let reserved = journal.reservation.payments.clone();
        for p in reserved {
            if order
                .payments
                .iter()
                .any(|remote| remote.payment_key == p.payment_key && remote.confirmed_at.is_some())
            {
                continue;
            }
            if !journal.confirmations.contains_key(&p.payment_key)
                && journal.attempted.contains(&p.payment_key)
            {
                let coinag = self
                    .coinag
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("Coinag no configurado para conciliar."))?;
                let lookup = coinag.lookup_transfer_by_id_trx_cliente(&p.bank_transaction_id)?.ok_or_else(|| anyhow::anyhow!("Coinag no encuentra un pago intentado. Resultado incierto: no se reenvia."))?;
                if !matches!(
                    CoinagClient::transfer_guard_from_lookup(&lookup),
                    CoinagTransferGuard::YaTransferida
                ) {
                    return Err(anyhow::anyhow!(
                        "Coinag aun no confirma {}. No se reenvia ni avanzan las otras patas.",
                        p.payment_key
                    ));
                }
                let payment = journal
                    .plan
                    .payments
                    .iter()
                    .find(|leg| leg.payment_key == p.payment_key)
                    .unwrap();
                let leg = journal.plan.leg(payment)?;
                CoinagClient::verify_lookup_matches_leg(&lookup, &leg)?;
                let operation = CoinagClient::extract_external_transfer_id(&lookup.body)
                    .ok_or_else(|| {
                        anyhow::anyhow!(
                            "Coinag no expone la referencia de la operacion confirmada."
                        )
                    })?;
                let evidence = BeexConfirmation {
                    installation_id: journal.reservation.installation_id.clone(),
                    operator: journal.reservation.operator.clone(),
                    bank_transaction_id: p.bank_transaction_id.clone(),
                    bank_operation_id: operation,
                    amount: payment.amount.clone(),
                    currency: "ARS".to_owned(),
                    cbu: payment.cbu.clone(),
                    cuit: payment.cuit.clone(),
                    confirmed_at: chrono::Utc::now()
                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                };
                journal.remember_confirmation(&p.payment_key, evidence)?;
                lock.save(journal)?;
            }
            if let Some(evidence) = journal.confirmations.get(&p.payment_key) {
                let updated = client.confirm(&id, &p.payment_key, evidence)?;
                journal.accept_order(&updated)?;
                lock.save(journal)?;
            }
        }
        if journal.confirmations.len() != journal.plan.payments.len() {
            return Ok(());
        }
        if journal.receipt_base64.is_none() {
            let completed = journal
                .plan
                .payments
                .iter()
                .map(|p| {
                    Ok((
                        journal.plan.leg(p)?,
                        journal.confirmations[&p.payment_key]
                            .bank_operation_id
                            .clone(),
                    ))
                })
                .collect::<Result<Vec<_>>>()?;
            let directory = if journal.automatic {
                &self.automatic_receipts_dir
            } else {
                &self.receipts_dir
            };
            let mut receipt_case = case.clone();
            receipt_case.core = journal.plan.core()?;
            receipt_case.server_validation.verification_id =
                journal.reservation.verification_id.clone();
            let path = receipt::write_cancellation_receipt(
                directory,
                &journal.reservation.operator,
                &receipt_case,
                &completed,
            )?;
            let bytes = fs::read(&path)?;
            journal.remember_receipt(path, &bytes)?;
            lock.save(journal)?;
        }
        let updated = client.receipt(
            &id,
            journal
                .receipt_bytes()?
                .ok_or_else(|| anyhow::anyhow!("Falta PDF Beex."))?,
        )?;
        journal.accept_order(&updated)?;
        if !journal.completed {
            return Err(anyhow::anyhow!(
                "Beex no confirmo Pagada despues del comprobante."
            ));
        }
        lock.save(journal)?;
        Ok(())
    }

    pub(super) fn execute_beex_transfer(
        &self,
        mut case: HydratedCase,
        kind: TransferKind,
        approval: Option<ManualTransferApproval>,
    ) -> WorkerEvent {
        let result = (|| -> Result<Option<PathBuf>> {
            let client = self
                .beex
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Beex no configurado."))?;
            let store = self
                .beex_store
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Falta almacenamiento Beex."))?;
            let coinag = self
                .coinag
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Coinag no configurado."))?;
            let id = case.core.beex.as_ref().unwrap().solicitud_id.clone();
            let lock = store.lock(&id)?;
            let mut previous = lock.read()?;
            if let Some(journal) = &mut previous {
                self.sync_beex(&case, journal, &lock, client)?;
                if journal.completed {
                    return Ok(journal.receipt_path.clone());
                }
            }
            let refreshed = self.refresh_case(&case);
            if !refreshed.validation.can_transfer()
                || (kind.is_automatic()
                    && (!refreshed.validation.can_transfer_automatically()
                        || !refreshed.server_validation.has_completed_validation()
                        || !self
                            .credit_line_mode_for(&refreshed.core)
                            .allows_automatic()))
            {
                case = refreshed;
                return Err(anyhow::anyhow!(
                    "Beex bloqueado por las validaciones actuales."
                ));
            }
            if let Some(reason) = transfer_authorization_error(
                &refreshed.core,
                &refreshed.validation,
                kind,
                approval.as_ref(),
            ) {
                case = refreshed;
                return Err(anyhow::anyhow!(reason.to_owned()));
            }
            case = refreshed;
            let plan = case.core.beex.as_ref().unwrap().clone();
            plan.validate()?;
            // Debug never reserves or confirms fake bank operations in Beex.
            if coinag.transfer_is_smoke() {
                for payment in &plan.payments {
                    coinag.perform_transfer(
                        &coinag.build_transfer_leg_payload(&case, &plan.leg(payment)?)?,
                    )?;
                }
                return Ok(None);
            }
            let mut journal = match previous {
                Some(journal) => {
                    if journal.plan != plan {
                        return Err(anyhow::anyhow!(
                            "El plan cambio frente a la reserva; requiere revision, no otro ID."
                        ));
                    }
                    journal
                }
                None => {
                    let payments = plan
                        .payments
                        .iter()
                        .map(|p| {
                            Ok(ReservationPayment {
                                payment_key: p.payment_key.clone(),
                                bank_transaction_id: coinag
                                    .build_case_leg_id(&case, &plan.leg(p)?)?,
                            })
                        })
                        .collect::<Result<Vec<_>>>()?;
                    let reservation = Reservation {
                        idempotency_key: uuid::Uuid::new_v4().to_string(),
                        plan_version: plan.version.clone(),
                        installation_id: store.installation_id.clone(),
                        operator: self.operator_name.clone(),
                        verification_id: case.server_validation.verification_id.clone(),
                        payments,
                    };
                    let mut journal = BeexJournal::new(plan.clone(), reservation);
                    journal.automatic = kind.is_automatic();
                    lock.save(&journal)?;
                    journal
                }
            };
            if journal.order_id.is_none() {
                let order = match client.by_key(&journal.reservation.idempotency_key)? {
                    Some(o) => o,
                    None => client.reserve(&id, &journal.reservation)?,
                };
                journal.accept_order(&order)?;
                lock.save(&journal)?;
            }
            // Preflight all IDs before sending even the first remaining leg.
            for payment in journal.reservation.payments.clone() {
                if journal.confirmations.contains_key(&payment.payment_key) {
                    continue;
                }
                if coinag
                    .lookup_transfer_by_id_trx_cliente(&payment.bank_transaction_id)?
                    .is_some()
                {
                    // Treat even an unexpected existing ID as attempted, then
                    // recover only after matching its full financial evidence.
                    journal.attempted.insert(payment.payment_key.clone());
                    lock.save(&journal)?;
                    self.sync_beex(&case, &mut journal, &lock, client)?;
                }
            }
            for payment in plan.payments {
                if journal.confirmations.contains_key(&payment.payment_key) {
                    continue;
                }
                if journal.attempted.contains(&payment.payment_key) {
                    return Err(anyhow::anyhow!(
                        "Pago Beex incierto; no se vuelve a enviar."
                    ));
                }
                let order_id = journal.order_id.clone().unwrap();
                let validated = client.revalidate(&order_id)?;
                journal.accept_order(&validated)?;
                lock.save(&journal)?;
                let fresh = self.refresh_case(&case);
                if !fresh.validation.can_transfer()
                    || fresh.core.beex.as_ref() != Some(&journal.plan)
                    || (kind.is_automatic()
                        && (!fresh.validation.can_transfer_automatically()
                            || !fresh.server_validation.has_completed_validation()
                            || !self.credit_line_mode_for(&fresh.core).allows_automatic()))
                {
                    return Err(anyhow::anyhow!(
                        "Beex cambio o quedo bloqueado antes del pago pendiente."
                    ));
                }
                if let Some(reason) = transfer_authorization_error(
                    &fresh.core,
                    &fresh.validation,
                    kind,
                    approval.as_ref(),
                ) {
                    return Err(anyhow::anyhow!(reason.to_owned()));
                }
                case = fresh;
                let leg = journal.plan.leg(&payment)?;
                let payload = coinag.build_transfer_leg_payload(&case, &leg)?;
                let bank_id = payload
                    .get("idTrxCliente")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("Falta ID bancario."))?
                    .to_owned();
                if !journal.reservation.payments.iter().any(|p| {
                    p.payment_key == payment.payment_key && p.bank_transaction_id == bank_id
                }) {
                    return Err(anyhow::anyhow!("Cambio el ID bancario reservado."));
                }
                // Persist BEFORE sending, including failures/timeouts without a response.
                log_transfer_audit(
                    "beex_payment_started",
                    case.request_oid(),
                    kind,
                    json!({"solicitud_id": id, "payment_key": payment.payment_key, "bank_transaction_id": bank_id, "desembolso_id": order_id}),
                );
                let response = lock.perform_once(&mut journal, &payment.payment_key, || {
                    coinag.perform_transfer(&payload)
                })?;
                let operation =
                    CoinagClient::extract_external_transfer_id(&response).ok_or_else(|| {
                        anyhow::anyhow!("Coinag no devolvio idCoelsa; resultado incierto.")
                    })?;
                match self.wait_for_coelsa_confirmation(
                    coinag,
                    case.request_oid(),
                    kind,
                    &operation,
                    CoinagClient::classify_transfer_response(&response),
                ) {
                    CoelsaTransferStatus::Confirmed => {}
                    CoelsaTransferStatus::Pending { detail }
                    | CoelsaTransferStatus::Rejected { detail } => {
                        return Err(anyhow::anyhow!(
                            "Pago no confirmado: {detail}. No se reenvia ni avanzan las otras patas."
                        ));
                    }
                }
                let evidence = BeexConfirmation {
                    installation_id: store.installation_id.clone(),
                    operator: self.operator_name.clone(),
                    bank_transaction_id: bank_id,
                    bank_operation_id: operation,
                    amount: payment.amount,
                    currency: "ARS".to_owned(),
                    cbu: payment.cbu,
                    cuit: payment.cuit,
                    confirmed_at: chrono::Utc::now()
                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                };
                journal.remember_confirmation(&payment.payment_key, evidence)?;
                lock.save(&journal)?;
                self.sync_beex(&case, &mut journal, &lock, client)?;
            }
            self.sync_beex(&case, &mut journal, &lock, client)?;
            if !journal.completed {
                return Err(anyhow::anyhow!(
                    "Beex pendiente de sincronizacion. No repetir los pagos."
                ));
            }
            Ok(journal.receipt_path)
        })();
        case.busy = false;
        let (message, path) = match result {
            Ok(path)
                if self.coinag.as_ref().is_some_and(|c| c.transfer_is_smoke())
                    && path.is_none() =>
            {
                (
                    "Smoke Beex generado; no se reservo ni se enviaron pagos.".to_owned(),
                    None,
                )
            }
            Ok(path) => {
                case.transfer_guard = CoinagTransferGuard::YaTransferida;
                case.validation.blockers.push("YA TRANSFERIDA".to_owned());
                (
                    "Beex: pagos confirmados, comprobante sincronizado y estado Pagada confirmado."
                        .to_owned(),
                    path,
                )
            }
            Err(error) => {
                case.validation
                    .blockers
                    .push(format!("Beex pendiente: {error}"));
                (
                    format!("Beex: {error}. Los IDs reservados se conservan."),
                    None,
                )
            }
        };
        case.message = Some(message.clone());
        WorkerEvent::CaseUpdated {
            case,
            message,
            receipt_path: path.clone(),
            refresh_balance: true,
            transfer_kind: kind,
            automatic_receipt_pending: kind.is_automatic() && path.is_some(),
        }
    }
}

#[cfg(test)]
mod beex_sync_tests {
    use super::*;
    use crate::{
        beex_client::{OrderPayment, test_support as mock},
        config::{CoreConfig, ServerConfig},
    };
    fn services(base: &str, root: &std::path::Path) -> AppServices {
        AppServices {
            beex: Some(BeexClient::for_test(base)),
            beex_store: Some(Arc::new(BeexStore::new(root.join("state")).unwrap())),
            origin_status: Arc::new(RwLock::new(Vec::new())),
            server: ServerClient::new(
                &ServerConfig {
                    base_url: base.to_owned(),
                    client_id: "test".to_owned(),
                    client_secret: "test".to_owned(),
                    allow_invalid_certs: false,
                },
                Duration::from_secs(3),
            )
            .unwrap(),
            core: CoreClient::new(
                &CoreConfig {
                    base_url: base.to_owned(),
                    allow_invalid_certs: false,
                },
                Duration::from_secs(3),
            )
            .unwrap(),
            mark_paid: None,
            coinag: None,
            credit_lines: Arc::new(RwLock::new(CreditLinesFile::default())),
            credit_lines_path: root.join("lines.toml"),
            creditor_whitelist: Arc::new(RwLock::new(CreditorWhitelistFile::default())),
            creditor_whitelist_path: root.join("creditors.toml"),
            startup_notices: Vec::new(),
            operator_name: "test".to_owned(),
            poll_interval: Duration::from_secs(20),
            receipts_dir: root.join("receipts"),
            automatic_receipts_dir: root.join("auto"),
            observed_candidates: Arc::new(RwLock::new(HashSet::new())),
            observed_evaluations: Arc::new(RwLock::new(HashMap::new())),
            recovering_receipts: Arc::new(RwLock::new(HashSet::new())),
        }
    }
    fn case(journal: &BeexJournal) -> HydratedCase {
        HydratedCase {
            core: journal.plan.core().unwrap(),
            server_validation: Default::default(),
            metamap: Default::default(),
            transfer_guard: Default::default(),
            validation: Default::default(),
            busy: false,
            message: None,
        }
    }
    #[test]
    fn legacy_outage_does_not_hide_beex_and_beex_outage_does_not_hide_legacy() {
        let temp = tempfile::tempdir().unwrap();
        let plan = mock::plan();
        let page = json!({"items": [{"solicitudId": plan.solicitud_id, "nroSolicitud": plan.nro_solicitud, "desembolso": null}], "nextCursor": null});
        let (base, server) = mock::server(vec![
            (503, "{}".to_owned()),
            (200, page.to_string()),
            (200, serde_json::to_string(&plan).unwrap()),
        ]);
        let service = services(&base, temp.path());
        let cases = service.load_candidates(Vec::new()).unwrap();
        assert_eq!(cases.len(), 1);
        assert_eq!(
            cases[0].core.beex.as_ref().unwrap().solicitud_id,
            plan.solicitud_id
        );
        assert!(service.origin_status.read().unwrap()[0].contains("no disponible"));
        server.join().unwrap();
        let legacy = json!([{"Oid": "123", "Estado.Descripcion": "A Transferir", "MontoAFinanciar": "1000.01", "Prestamo.LineaPrestamo.ID": "12"}]);
        let (base, server) = mock::server(vec![(200, legacy.to_string()), (503, "{}".to_owned())]);
        let service = services(&base, temp.path());
        let cases = service.load_candidates(Vec::new()).unwrap();
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0].request_oid(), "123");
        assert!(cases[0].core.beex.is_none());
        assert!(service.origin_status.read().unwrap()[1].contains("no disponible"));
        server.join().unwrap();
    }
    #[test]
    fn beex_pdf_failure_survives_restart_and_replays_identical_bytes_without_a_bank_client() {
        let temp = tempfile::tempdir().unwrap();
        let mut journal = mock::journal();
        let pending = mock::order(&journal, true);
        journal.order_id = Some(pending.id.clone());
        let mut completed = pending.clone();
        completed.status = "COMPLETED".to_owned();
        let (base, server) = mock::server(vec![
            (200, serde_json::to_string(&pending).unwrap()),
            (
                503,
                "{\"error\":{\"code\":\"STORAGE_UNAVAILABLE\"}}".to_owned(),
            ),
            (200, serde_json::to_string(&pending).unwrap()),
            (200, serde_json::to_string(&completed).unwrap()),
        ]);
        let service = services(&base, temp.path());
        let store = service.beex_store.as_ref().unwrap();
        let lock = store.lock(&journal.solicitud_id).unwrap();
        lock.save(&journal).unwrap();
        assert!(
            service
                .sync_beex(
                    &case(&journal),
                    &mut journal,
                    &lock,
                    service.beex.as_ref().unwrap()
                )
                .is_err()
        );
        let original_pdf = journal.receipt_bytes().unwrap().unwrap();
        assert!(original_pdf.starts_with(b"%PDF-"));
        let path = journal.receipt_path.clone();
        drop(lock);
        drop(service);
        let service = services(&base, temp.path());
        let lock = service
            .beex_store
            .as_ref()
            .unwrap()
            .lock(&journal.solicitud_id)
            .unwrap();
        let mut recovered = lock.read().unwrap().unwrap();
        service
            .sync_beex(
                &case(&recovered),
                &mut recovered,
                &lock,
                service.beex.as_ref().unwrap(),
            )
            .unwrap();
        assert!(recovered.completed);
        assert_eq!(recovered.receipt_bytes().unwrap().unwrap(), original_pdf);
        assert_eq!(recovered.receipt_path, path);
        let requests = server.join().unwrap();
        for index in [1, 3] {
            let request = &requests[index];
            assert!(
                String::from_utf8_lossy(request)
                    .starts_with("POST /integrations/transferencias/v1/desembolsos/")
            );
            assert!(
                request
                    .windows(original_pdf.len())
                    .any(|bytes| bytes == original_pdf)
            );
        }
    }
    #[test]
    fn beex_local_bank_evidence_is_synced_before_the_receipt_and_keeps_its_timestamp() {
        let temp = tempfile::tempdir().unwrap();
        let mut journal = mock::journal();
        let reserved = mock::order(&journal, false);
        journal.order_id = Some(reserved.id.clone());
        let confirmed = mock::order(&journal, true);
        let evidence = mock::confirmation(&journal);
        journal
            .remember_confirmation("member", evidence.clone())
            .unwrap();
        let mut completed = confirmed.clone();
        completed.status = "COMPLETED".to_owned();
        let (base, server) = mock::server(vec![
            (200, serde_json::to_string(&reserved).unwrap()),
            (200, serde_json::to_string(&confirmed).unwrap()),
            (200, serde_json::to_string(&completed).unwrap()),
        ]);
        let service = services(&base, temp.path());
        let lock = service
            .beex_store
            .as_ref()
            .unwrap()
            .lock(&journal.solicitud_id)
            .unwrap();
        lock.save(&journal).unwrap();
        service
            .sync_beex(
                &case(&journal),
                &mut journal,
                &lock,
                service.beex.as_ref().unwrap(),
            )
            .unwrap();
        assert!(journal.completed);
        let requests = server.join().unwrap();
        let request = String::from_utf8_lossy(&requests[1]);
        assert!(request.starts_with("PUT "));
        assert!(request.contains("/pagos/member "));
        let body = request.split_once("\r\n\r\n").unwrap().1;
        let posted: BeexConfirmation = serde_json::from_str(body).unwrap();
        assert_eq!(posted, evidence);
    }
    #[test]
    fn beex_partial_reservation_does_not_upload_a_receipt_or_initiate_pending_payments() {
        let temp = tempfile::tempdir().unwrap();
        let mut journal = mock::journal();
        journal.plan.payments[0].amount = "400.00".to_owned();
        let mut creditor = journal.plan.payments[0].clone();
        creditor.payment_key = format!("creditor:{}", uuid::Uuid::new_v4());
        creditor.kind = "creditor".to_owned();
        creditor.amount = "600.01".to_owned();
        creditor.cbu = "0000000000000000000002".to_owned();
        creditor.cuit = "30625567382".to_owned();
        creditor.bank_number = Some("2".to_owned());
        journal.plan.payments.push(creditor.clone());
        journal.reservation.payments.push(ReservationPayment {
            payment_key: creditor.payment_key.clone(),
            bank_transaction_id: crate::beex_client::bank_id("123", "2").unwrap(),
        });
        let mut partial = mock::order(&journal, true);
        partial.status = "RESERVED".to_owned();
        partial.payments.push(OrderPayment {
            payment_key: creditor.payment_key.clone(),
            bank_transaction_id: journal.reservation.payments[1].bank_transaction_id.clone(),
            bank_operation_id: None,
            confirmed_at: None,
            confirmation: None,
        });
        journal.order_id = Some(partial.id.clone());
        let json = serde_json::to_string(&partial).unwrap();
        let (base, server) = mock::server(vec![(200, json.clone()), (200, json)]);
        let service = services(&base, temp.path());
        let lock = service
            .beex_store
            .as_ref()
            .unwrap()
            .lock(&journal.solicitud_id)
            .unwrap();
        lock.save(&journal).unwrap();
        service
            .sync_beex(
                &case(&journal),
                &mut journal,
                &lock,
                service.beex.as_ref().unwrap(),
            )
            .unwrap();
        assert_eq!(journal.confirmations.len(), 1);
        assert!(journal.receipt_base64.is_none());
        journal.attempted.insert(creditor.payment_key);
        lock.save(&journal).unwrap();
        assert!(
            service
                .sync_beex(
                    &case(&journal),
                    &mut journal,
                    &lock,
                    service.beex.as_ref().unwrap()
                )
                .is_err()
        );
        assert!(!journal.completed);
        assert!(journal.receipt_base64.is_none());
        assert!(
            server
                .join()
                .unwrap()
                .iter()
                .all(|r| String::from_utf8_lossy(r).starts_with("GET "))
        );
    }
}
