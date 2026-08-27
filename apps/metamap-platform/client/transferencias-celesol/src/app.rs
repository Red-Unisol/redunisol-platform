use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{
        Arc, RwLock,
        mpsc::{self, Receiver, Sender},
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use chrono::Local;
use eframe::egui::{self, Color32, Key, RichText, TextEdit};
use egui_extras::{Column, TableBuilder};
use serde_json::{Value, json};

use crate::{
    APP_NAME_WITH_TAG,
    coinag_client::{CoelsaTransferStatus, CoinagClient, TransferLookupResponse},
    config::AppConfig,
    core_client::CoreClient,
    credit_lines::{
        CreditLineCatalogEntry, CreditLineEntry, CreditLineMode, CreditLinesFile, ReconcileSummary,
    },
    mark_paid_client::{MarkPaidClient, MarkPaidHttpError},
    models::{
        CoinagTransferGuard, CoreSnapshot, HydratedCase, MetamapSnapshot, TransferAmountOutcome,
        ValidationReport,
    },
    receipt,
    server_client::ServerClient,
    validation,
};

pub struct TransferenciasApp {
    services: Arc<AppServices>,
    items: Vec<HydratedCase>,
    event_tx: Sender<WorkerEvent>,
    event_rx: Receiver<WorkerEvent>,
    items_loading: bool,
    balance_loading: bool,
    balance_text: String,
    next_poll_at: Instant,
    next_balance_poll_at: Instant,
    notices: Vec<String>,
    show_disabled_lines: bool,
    pending_transfer_confirmation: Option<TransferConfirmation>,
    transfer_lookup: TransferLookupDialog,
    automatic_processing_enabled: bool,
    automatic_inflight: HashSet<String>,
    automatic_attempted: HashSet<String>,
    automatic_pending: Vec<AutomaticTransferPending>,
    show_automatic_pending: bool,
    credit_line_editor: CreditLineEditor,
}

const BALANCE_POLL_INTERVAL: Duration = Duration::from_secs(60);
const TRANSFER_PROCESSING_MESSAGE: &str = "Procesando transferencia...";
const COELSA_CONFIRMATION_FAST_POLLS: usize = 10;
const COELSA_CONFIRMATION_SLOW_POLLS: usize = 9;
const COELSA_CONFIRMATION_FAST_INTERVAL: Duration = Duration::from_secs(3);
const COELSA_CONFIRMATION_SLOW_INTERVAL: Duration = Duration::from_secs(10);

impl TransferenciasApp {
    pub fn new(config: AppConfig) -> Result<Self> {
        let services = Arc::new(AppServices::new(config)?);
        let (event_tx, event_rx) = mpsc::channel();
        let startup_notices = services.startup_notices.clone();
        let credit_lines = services.credit_lines_snapshot();
        let mut app = Self {
            next_poll_at: Instant::now(),
            next_balance_poll_at: Instant::now(),
            items: Vec::new(),
            balance_text: services.initial_balance_text(),
            services,
            event_tx,
            event_rx,
            items_loading: false,
            balance_loading: false,
            notices: startup_notices
                .into_iter()
                .map(|message| format!("[{}] {message}", Local::now().format("%H:%M:%S")))
                .collect(),
            show_disabled_lines: false,
            pending_transfer_confirmation: None,
            transfer_lookup: TransferLookupDialog::default(),
            automatic_processing_enabled: false,
            automatic_inflight: HashSet::new(),
            automatic_attempted: HashSet::new(),
            automatic_pending: Vec::new(),
            show_automatic_pending: false,
            credit_line_editor: CreditLineEditor::from_config(credit_lines),
        };
        log::info!("TransferenciasApp inicializada.");
        app.spawn_items_poll();
        if app.services.balance_enabled() {
            app.spawn_balance_poll("inicio");
        }
        Ok(app)
    }

    fn spawn_items_poll(&mut self) {
        if self.items_loading {
            return;
        }
        self.items_loading = true;
        log::debug!(
            "Disparando polling de lista. items_actuales={}.",
            self.items.len()
        );
        let services = Arc::clone(&self.services);
        let sender = self.event_tx.clone();
        let existing_items = self.items.clone();
        thread::spawn(move || match services.load_candidates(existing_items) {
            Ok(items) => {
                let _ = sender.send(WorkerEvent::ItemsLoaded(items));
            }
            Err(error) => {
                let _ = sender.send(WorkerEvent::ItemsLoadFailed(error.to_string()));
            }
        });
    }

    fn spawn_balance_poll(&mut self, reason: &'static str) {
        if self.balance_loading || !self.services.balance_enabled() {
            return;
        }
        self.balance_loading = true;
        log::debug!("Disparando refresh de saldo. reason={reason}.");
        let services = Arc::clone(&self.services);
        let sender = self.event_tx.clone();
        thread::spawn(move || {
            let text = services.load_balance_text();
            let _ = sender.send(WorkerEvent::BalanceUpdated(text));
        });
    }

    fn spawn_transfer(&mut self, request_oid: String) {
        self.spawn_transfer_worker(request_oid, TransferKind::Manual);
    }

    fn spawn_transfer_worker(&mut self, request_oid: String, transfer_kind: TransferKind) {
        let Some(position) = self
            .items
            .iter()
            .position(|item| item.request_oid() == request_oid)
        else {
            return;
        };
        if self.items[position].busy {
            return;
        }
        log::info!(
            "Iniciando transferencia {} para solicitud {}.",
            transfer_kind.label(),
            request_oid
        );
        self.items[position].busy = true;
        self.items[position].message = Some(match transfer_kind {
            TransferKind::Manual => TRANSFER_PROCESSING_MESSAGE.to_owned(),
            TransferKind::Automatic => "Procesando transferencia automatica...".to_owned(),
        });
        let item = self.items[position].clone();
        let services = Arc::clone(&self.services);
        let sender = self.event_tx.clone();
        thread::spawn(move || {
            let result = services.execute_transfer(item, transfer_kind);
            let _ = sender.send(result);
        });
    }

    fn try_spawn_automatic_transfers(&mut self) {
        if !self.automatic_processing_enabled
            || !self.services.automatic_transfer_enabled()
            || !self.automatic_inflight.is_empty()
        {
            return;
        }

        let candidate = self
            .items
            .iter()
            .filter(|item| self.is_automatic_candidate(item))
            .map(|item| item.request_oid().to_owned())
            .next();

        if let Some(request_oid) = candidate {
            self.spawn_automatic_transfer(request_oid);
        }
    }

    fn spawn_automatic_transfer(&mut self, request_oid: String) {
        if !self.automatic_processing_enabled
            || !self.automatic_inflight.is_empty()
            || self.automatic_inflight.contains(&request_oid)
            || self.automatic_attempted.contains(&request_oid)
        {
            return;
        }
        let Some(position) = self
            .items
            .iter()
            .position(|item| item.request_oid() == request_oid)
        else {
            return;
        };
        if !self.is_automatic_candidate(&self.items[position]) {
            return;
        }
        if let Err(error) = self.services.ensure_automatic_receipts_dir() {
            self.push_notice(format!(
                "Automatica bloqueada: no se pudo preparar la carpeta de comprobantes: {error}"
            ));
            return;
        }

        self.automatic_inflight.insert(request_oid.clone());
        self.automatic_attempted.insert(request_oid.clone());
        self.push_notice(format!(
            "Transferencia automatica iniciada para solicitud {request_oid}."
        ));
        self.spawn_transfer_worker(request_oid, TransferKind::Automatic);
    }

    fn is_automatic_candidate(&self, item: &HydratedCase) -> bool {
        self.services.transfer_enabled()
            && self.services.automatic_transfer_enabled()
            && self.automatic_processing_enabled
            && !item.busy
            && !item.validation.disabled
            && item.validation.can_transfer()
            && item.validation.warnings.is_empty()
            && item.server_validation.has_completed_validation()
            && self
                .services
                .credit_line_mode(item.core.credit_line_id)
                .allows_automatic()
            && !self.automatic_inflight.contains(item.request_oid())
            && !self.automatic_attempted.contains(item.request_oid())
    }

    fn spawn_transfer_lookup(&mut self, request_number: String) {
        if self.transfer_lookup.loading {
            return;
        }
        self.transfer_lookup.loading = true;
        self.transfer_lookup.error = None;
        self.transfer_lookup.result = None;
        let services = Arc::clone(&self.services);
        let sender = self.event_tx.clone();
        thread::spawn(
            move || match services.lookup_transfer_by_request_number(&request_number) {
                Ok(result) => {
                    let _ = sender.send(WorkerEvent::TransferLookupCompleted(result));
                }
                Err(error) => {
                    let _ = sender.send(WorkerEvent::TransferLookupFailed(error.to_string()));
                }
            },
        );
    }

    fn render_transfer_confirmation(
        &mut self,
        ctx: &egui::Context,
        request_to_transfer: &mut Option<String>,
    ) {
        let Some(confirmation) = self.pending_transfer_confirmation.clone() else {
            return;
        };

        let mut keep_open = true;
        egui::Window::new("Confirmar transferencia")
            .anchor(egui::Align2::CENTER_CENTER, [0.0, 0.0])
            .collapsible(false)
            .resizable(false)
            .show(ctx, |ui| {
                ui.set_min_width(480.0);
                ui.label(&confirmation.message);
                ui.add_space(10.0);
                egui::Grid::new("transfer_confirmation_details")
                    .num_columns(2)
                    .spacing([18.0, 8.0])
                    .show(ui, |ui| {
                        for (label, value) in &confirmation.summary_fields {
                            ui.strong(label);
                            ui.label(value);
                            ui.end_row();
                        }
                    });
                if let Some(warning) = confirmation.warning_message.as_deref() {
                    ui.add_space(10.0);
                    ui.label(RichText::new(warning).color(Color32::from_rgb(176, 113, 0)));
                }
                ui.add_space(12.0);
                ui.horizontal(|ui| {
                    if ui.button("Cancelar").clicked() {
                        keep_open = false;
                    }
                    if ui.button("Confirmar transferencia").clicked() {
                        *request_to_transfer = Some(confirmation.request_oid.clone());
                        keep_open = false;
                    }
                });
            });

        if !keep_open {
            self.pending_transfer_confirmation = None;
        }
    }

    fn render_transfer_lookup_window(&mut self, ctx: &egui::Context) {
        if !self.transfer_lookup.open {
            return;
        }

        let mut open = self.transfer_lookup.open;
        let mut request_to_lookup = None;
        egui::Window::new("Consulta de transferencia")
            .collapsible(false)
            .movable(true)
            .resizable(true)
            .default_width(760.0)
            .default_height(420.0)
            .open(&mut open)
            .show(ctx, |ui| {
                ui.label("Numero de solicitud");
                let response = ui.add(
                    TextEdit::singleline(&mut self.transfer_lookup.request_number)
                        .desired_width(240.0)
                        .hint_text("Ej: 234567"),
                );
                let can_lookup = self.services.transfer_enabled()
                    && !self.transfer_lookup.loading
                    && !self.transfer_lookup.request_number.trim().is_empty();
                let submit =
                    response.lost_focus() && ui.input(|input| input.key_pressed(Key::Enter));

                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    let button = ui.add_enabled(can_lookup, egui::Button::new("Consultar"));
                    if button.clicked() || (can_lookup && submit) {
                        request_to_lookup =
                            Some(self.transfer_lookup.request_number.trim().to_owned());
                    }
                    if !self.services.transfer_enabled() {
                        button.on_hover_text("Coinag no esta configurado en este runtime.");
                    }
                    if self.transfer_lookup.loading {
                        ui.spinner();
                        ui.label("Consultando Coinag...");
                    }
                });

                if let Some(error) = self.transfer_lookup.error.as_deref() {
                    ui.add_space(10.0);
                    ui.label(RichText::new(error).color(Color32::from_rgb(170, 30, 30)));
                }

                if let Some(result) = &mut self.transfer_lookup.result {
                    ui.add_space(10.0);
                    ui.separator();
                    ui.add_space(6.0);
                    egui::Grid::new("transfer_lookup_summary")
                        .num_columns(2)
                        .spacing([18.0, 6.0])
                        .show(ui, |ui| {
                            for (label, value) in &result.summary_fields {
                                ui.strong(label);
                                ui.label(value);
                                ui.end_row();
                            }
                        });
                    ui.add_space(10.0);
                    ui.collapsing("JSON completo", |ui| {
                        ui.add(
                            TextEdit::multiline(&mut result.raw_json)
                                .desired_width(f32::INFINITY)
                                .desired_rows(14)
                                .interactive(false),
                        );
                    });
                }
            });

        self.transfer_lookup.open = open;
        if let Some(request_number) = request_to_lookup {
            self.spawn_transfer_lookup(request_number);
        }
    }

    fn render_automatic_pending_window(&mut self, ctx: &egui::Context) {
        if !self.show_automatic_pending {
            return;
        }

        let mut open = self.show_automatic_pending;
        egui::Window::new("Automaticas pendientes")
            .open(&mut open)
            .default_width(760.0)
            .resizable(true)
            .show(ctx, |ui| {
                ui.label("Transferencias automaticas de esta sesion pendientes de revisar.");
                ui.add_space(8.0);
                if self.automatic_pending.is_empty() {
                    ui.label("No hay transferencias automaticas en esta sesion.");
                    return;
                }

                egui::ScrollArea::vertical()
                    .max_height(360.0)
                    .show(ui, |ui| {
                        for pending in &mut self.automatic_pending {
                            ui.group(|ui| {
                                ui.horizontal(|ui| {
                                    ui.vertical(|ui| {
                                        ui.strong(format!(
                                            "{} - {}",
                                            pending.request_oid, pending.display_name
                                        ));
                                        ui.small(format!(
                                            "{} | {} | {}",
                                            pending.credit_line, pending.amount, pending.created_at
                                        ));
                                        match pending.receipt_path.as_ref() {
                                            Some(path) => {
                                                ui.small(format!("PDF: {}", path.display()));
                                            }
                                            None => {
                                                ui.small(
                                                    RichText::new("PDF no generado")
                                                        .color(Color32::from_rgb(170, 30, 30)),
                                                );
                                            }
                                        }
                                    });
                                    ui.with_layout(
                                        egui::Layout::right_to_left(egui::Align::Center),
                                        |ui| {
                                            if pending.reviewed {
                                                ui.label(
                                                    RichText::new("Revisada")
                                                        .color(Color32::LIGHT_GRAY),
                                                );
                                            } else if ui.button("Marcar revisada").clicked() {
                                                pending.reviewed = true;
                                            }
                                        },
                                    );
                                });
                            });
                            ui.add_space(6.0);
                        }
                    });
            });
        self.show_automatic_pending = open;
    }

    fn automatic_pending_count(&self) -> usize {
        self.automatic_pending
            .iter()
            .filter(|pending| !pending.reviewed)
            .count()
    }

    fn open_credit_line_editor(&mut self) {
        self.credit_line_editor
            .reset(self.services.credit_lines_snapshot());
        self.credit_line_editor.open = true;
    }

    fn spawn_credit_line_catalog_refresh(&mut self) {
        if self.credit_line_editor.loading {
            return;
        }
        self.credit_line_editor.loading = true;
        self.credit_line_editor.message = Some("Consultando catalogo del core...".to_owned());
        let services = Arc::clone(&self.services);
        let sender = self.event_tx.clone();
        thread::spawn(move || match services.fetch_credit_line_catalog() {
            Ok(catalog) => {
                let _ = sender.send(WorkerEvent::CreditLineCatalogLoaded(catalog));
            }
            Err(error) => {
                let _ = sender.send(WorkerEvent::CreditLineCatalogFailed(error.to_string()));
            }
        });
    }

    fn render_credit_line_editor(&mut self, ctx: &egui::Context) {
        if !self.credit_line_editor.open {
            return;
        }

        let mut open = self.credit_line_editor.open;
        let mut refresh_clicked = false;
        let mut save_clicked = false;
        let mut discard_clicked = false;
        let editor = &mut self.credit_line_editor;
        egui::Window::new("Configuracion de lineas")
            .open(&mut open)
            .default_width(980.0)
            .default_height(680.0)
            .resizable(true)
            .show(ctx, |ui| {
                ui.label(
                    "La identidad se resuelve por ID. Las lineas nuevas siempre se incorporan inhabilitadas.",
                );
                ui.horizontal(|ui| {
                    ui.label("Buscar:");
                    ui.add(
                        TextEdit::singleline(&mut editor.search)
                            .hint_text("ID, codigo o descripcion")
                            .desired_width(260.0),
                    );
                    egui::ComboBox::from_id_salt("credit_line_filter")
                        .selected_text(editor.filter.label())
                        .show_ui(ui, |ui| {
                            for filter in [
                                CreditLineFilter::Todas,
                                CreditLineFilter::Inhabilitadas,
                                CreditLineFilter::Habilitadas,
                                CreditLineFilter::Automaticas,
                                CreditLineFilter::Ausentes,
                            ] {
                                ui.selectable_value(&mut editor.filter, filter, filter.label());
                            }
                        });
                    if ui
                        .add_enabled(
                            !editor.loading,
                            egui::Button::new(if editor.loading {
                                "Actualizando..."
                            } else {
                                "Refrescar desde el core"
                            }),
                        )
                        .clicked()
                    {
                        refresh_clicked = true;
                    }
                });

                let disabled = editor
                    .draft
                    .lineas
                    .iter()
                    .filter(|line| line.modo == CreditLineMode::Inhabilitada)
                    .count();
                let enabled = editor
                    .draft
                    .lineas
                    .iter()
                    .filter(|line| line.modo == CreditLineMode::Habilitada)
                    .count();
                let automatic = editor.draft.automatic_count();
                ui.horizontal(|ui| {
                    ui.label(format!("Total: {}", editor.draft.lineas.len()));
                    ui.separator();
                    ui.label(format!("Inhabilitadas: {disabled}"));
                    ui.label(format!("Habilitadas: {enabled}"));
                    ui.label(format!("Automaticas: {automatic}"));
                    if editor.dirty {
                        ui.label(
                            RichText::new("Cambios sin guardar")
                                .color(Color32::from_rgb(220, 165, 45)),
                        );
                    }
                });
                if let Some(message) = &editor.message {
                    ui.label(message);
                }
                ui.separator();

                let query = editor.search.trim().to_lowercase();
                egui::ScrollArea::vertical()
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        for line in &mut editor.draft.lineas {
                            let matches_query = query.is_empty()
                                || line.id.to_string().contains(&query)
                                || line.codigo.to_lowercase().contains(&query)
                                || line.descripcion.to_lowercase().contains(&query);
                            if !matches_query || !editor.filter.includes(line) {
                                continue;
                            }
                            ui.horizontal(|ui| {
                                ui.monospace(format!("{:>5}", line.id));
                                ui.label(format!("{:>8}", line.codigo));
                                let description = if line.descripcion.is_empty() {
                                    "<sin descripcion>"
                                } else {
                                    line.descripcion.as_str()
                                };
                                ui.add_sized([310.0, 20.0], egui::Label::new(description));
                                if line.present_in_core == Some(false) {
                                    ui.label(
                                        RichText::new("No encontrada")
                                            .color(Color32::from_rgb(220, 80, 80)),
                                    );
                                } else {
                                    ui.add_sized([90.0, 20.0], egui::Label::new(""));
                                }
                                let previous = line.modo;
                                ui.radio_value(
                                    &mut line.modo,
                                    CreditLineMode::Inhabilitada,
                                    "Inhabilitada",
                                );
                                ui.radio_value(
                                    &mut line.modo,
                                    CreditLineMode::Habilitada,
                                    "Habilitada",
                                );
                                ui.radio_value(
                                    &mut line.modo,
                                    CreditLineMode::Automatica,
                                    "Automatica",
                                );
                                if previous != line.modo {
                                    editor.dirty = true;
                                }
                            });
                            ui.separator();
                        }
                    });

                ui.separator();
                ui.horizontal(|ui| {
                    if ui
                        .add_enabled(editor.dirty, egui::Button::new("Guardar cambios"))
                        .clicked()
                    {
                        save_clicked = true;
                    }
                    if ui
                        .add_enabled(editor.dirty, egui::Button::new("Descartar cambios"))
                        .clicked()
                    {
                        discard_clicked = true;
                    }
                    ui.label(format!(
                        "Archivo: {}",
                        self.services.credit_lines_path.display()
                    ));
                });
            });
        self.credit_line_editor.open = open;

        if refresh_clicked {
            self.spawn_credit_line_catalog_refresh();
        }
        if discard_clicked {
            self.credit_line_editor
                .reset(self.services.credit_lines_snapshot());
        }
        if save_clicked {
            match self
                .services
                .save_credit_lines(self.credit_line_editor.draft.clone())
            {
                Ok(()) => {
                    self.credit_line_editor.dirty = false;
                    self.credit_line_editor.message =
                        Some("Configuracion guardada y aplicada.".to_owned());
                    self.automatic_processing_enabled = false;
                    self.push_notice(
                        "Configuracion de lineas guardada. Las automaticas quedaron pausadas.",
                    );
                    self.spawn_items_poll();
                }
                Err(error) => {
                    log::error!("No se pudo guardar la configuracion de lineas: {error:#}");
                    self.credit_line_editor.message = Some(format!("Error al guardar: {error}"));
                    self.push_notice(format!(
                        "Error al guardar la configuracion de lineas: {error}"
                    ));
                }
            }
        }
    }

    fn process_worker_events(&mut self) {
        while let Ok(event) = self.event_rx.try_recv() {
            match event {
                WorkerEvent::ItemsLoaded(items) => {
                    self.items_loading = false;
                    log::info!("Polling completado. items_cargados={}.", items.len());
                    self.items = preserve_busy_items(&self.items, items);
                    self.next_poll_at = Instant::now() + self.services.poll_interval;
                    self.push_notice("Lista actualizada desde el core financiero.");
                    self.try_spawn_automatic_transfers();
                }
                WorkerEvent::ItemsLoadFailed(error) => {
                    self.items_loading = false;
                    log::error!("Fallo el polling de lista: {error}");
                    self.next_poll_at = Instant::now() + self.services.poll_interval;
                    self.push_notice(format!("Error al actualizar la lista: {error}"));
                }
                WorkerEvent::BalanceUpdated(text) => {
                    self.balance_loading = false;
                    self.balance_text = text;
                    self.next_balance_poll_at = Instant::now() + BALANCE_POLL_INTERVAL;
                }
                WorkerEvent::TransferLookupCompleted(result) => {
                    self.transfer_lookup.loading = false;
                    self.transfer_lookup.error = None;
                    self.transfer_lookup.result = Some(result.clone());
                    self.transfer_lookup.open = true;
                    self.push_notice(format!(
                        "Consulta Coinag lista para solicitud {}.",
                        result.request_number
                    ));
                }
                WorkerEvent::TransferLookupFailed(error) => {
                    self.transfer_lookup.loading = false;
                    self.transfer_lookup.error = Some(error.clone());
                    self.transfer_lookup.result = None;
                    self.transfer_lookup.open = true;
                    self.push_notice(format!("Error en consulta de transferencia: {error}"));
                }
                WorkerEvent::CreditLineCatalogLoaded(catalog) => {
                    self.credit_line_editor.loading = false;
                    match self.credit_line_editor.draft.reconcile(catalog) {
                        Ok(summary) => {
                            log::info!(
                                "Catalogo de lineas reconciliado. added={} updated={} missing={}.",
                                summary.added,
                                summary.updated,
                                summary.missing
                            );
                            self.credit_line_editor.dirty =
                                summary.added > 0 || summary.updated > 0 || summary.missing > 0;
                            self.credit_line_editor.message =
                                Some(format_reconcile_summary(summary));
                        }
                        Err(error) => {
                            log::error!("El catalogo de lineas recibido no es valido: {error:#}");
                            self.credit_line_editor.message =
                                Some(format!("El catalogo recibido no es valido: {error}"));
                        }
                    }
                }
                WorkerEvent::CreditLineCatalogFailed(error) => {
                    self.credit_line_editor.loading = false;
                    log::error!("No se pudo refrescar el catalogo de lineas: {error}");
                    self.credit_line_editor.message =
                        Some(format!("No se pudo actualizar desde el core: {error}"));
                    self.push_notice(format!("Error al actualizar lineas: {error}"));
                }
                WorkerEvent::CaseUpdated {
                    case,
                    message,
                    receipt_path,
                    refresh_balance,
                    transfer_kind,
                    automatic_receipt_pending,
                } => {
                    let request_oid = case.request_oid().to_owned();
                    log::debug!("Caso actualizado para solicitud {request_oid}.");
                    if transfer_kind == TransferKind::Automatic {
                        self.automatic_inflight.remove(&request_oid);
                        if automatic_receipt_pending {
                            self.automatic_pending.insert(
                                0,
                                AutomaticTransferPending {
                                    request_oid: request_oid.clone(),
                                    display_name: case.display_name(),
                                    amount: case.transfer_amount_display(),
                                    credit_line: display_credit_line(
                                        case.core.credit_line_description.as_deref(),
                                    ),
                                    receipt_path: receipt_path.clone(),
                                    created_at: Local::now().format("%H:%M:%S").to_string(),
                                    reviewed: false,
                                },
                            );
                            self.show_automatic_pending = true;
                        }
                    }
                    if let Some(existing) = self
                        .items
                        .iter_mut()
                        .find(|item| item.request_oid() == request_oid.as_str())
                    {
                        *existing = case;
                    } else {
                        self.items.push(case);
                    }
                    if let Some(receipt_path) = receipt_path {
                        self.push_notice(format!("{message} PDF: {}", receipt_path.display()));
                    } else {
                        self.push_notice(message);
                    }
                    if refresh_balance {
                        self.spawn_balance_poll("post-transferencia");
                    }
                    self.try_spawn_automatic_transfers();
                }
            }
        }
    }

    fn push_notice(&mut self, message: impl Into<String>) {
        let timestamp = Local::now().format("%H:%M:%S");
        self.notices
            .insert(0, format!("[{timestamp}] {}", message.into()));
        if self.notices.len() > 24 {
            self.notices.truncate(24);
        }
    }
}

impl eframe::App for TransferenciasApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.process_worker_events();
        if !self.items_loading && Instant::now() >= self.next_poll_at {
            self.spawn_items_poll();
        }
        if self.services.balance_enabled()
            && !self.balance_loading
            && Instant::now() >= self.next_balance_poll_at
        {
            self.spawn_balance_poll("intervalo");
        }

        let mut request_to_transfer = None;
        let mut transfer_confirmation = None;
        let mut toggle_automatic_processing = false;
        let mut open_credit_line_editor = false;

        egui::TopBottomPanel::top("toolbar").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.heading(APP_NAME_WITH_TAG);
                ui.separator();
                ui.label(format!(
                    "Lista: {}",
                    if self.items_loading {
                        "actualizando..."
                    } else {
                        "estable"
                    }
                ));
                ui.label(format!(
                    "Coinag: {}",
                    if self.services.transfer_enabled() {
                        "configurado"
                    } else {
                        "sin configurar"
                    }
                ));
                ui.separator();
                let balance_color = if self.balance_loading {
                    Color32::GRAY
                } else {
                    Color32::LIGHT_GRAY
                };
                ui.label(RichText::new(&self.balance_text).color(balance_color));
                ui.separator();
                if ui
                    .add_enabled(!self.items_loading, egui::Button::new("Recargar lista"))
                    .clicked()
                {
                    self.spawn_items_poll();
                }
                if ui
                    .add_enabled(
                        self.services.balance_enabled() && !self.balance_loading,
                        egui::Button::new("Actualizar saldo"),
                    )
                    .clicked()
                {
                    self.spawn_balance_poll("manual");
                }
                let lookup_button = ui.add_enabled(
                    self.services.transfer_enabled() && !self.transfer_lookup.loading,
                    egui::Button::new("Consulta de transferencia"),
                );
                if lookup_button.clicked() {
                    self.transfer_lookup.open = true;
                }
                if !self.services.transfer_enabled() {
                    lookup_button.on_hover_text("Coinag no esta configurado en este runtime.");
                }
                ui.separator();
                let automatic_enabled = self.services.automatic_transfer_enabled();
                let automatic_label = if self.automatic_processing_enabled {
                    RichText::new("Automaticas: HABILITADAS").color(Color32::from_rgb(40, 190, 75))
                } else {
                    RichText::new("Automaticas: PAUSADAS").color(Color32::from_rgb(220, 165, 45))
                };
                if ui
                    .add_enabled(automatic_enabled, egui::Button::new(automatic_label))
                    .clicked()
                {
                    toggle_automatic_processing = true;
                }
                let pending_count = self.automatic_pending_count();
                let pending_label = if pending_count > 0 {
                    format!("● Auto ({pending_count})")
                } else {
                    "Auto pendientes".to_owned()
                };
                if ui.button(pending_label).clicked() {
                    self.show_automatic_pending = true;
                }
                if !automatic_enabled {
                    ui.small(
                        RichText::new("Auto no configurado").color(Color32::from_rgb(176, 113, 0)),
                    );
                }
                ui.checkbox(&mut self.show_disabled_lines, "Mostrar deshabilitadas");
                if ui.button("Configurar lineas").clicked() {
                    open_credit_line_editor = true;
                }
            });
        });

        if open_credit_line_editor {
            self.open_credit_line_editor();
        }

        if toggle_automatic_processing {
            self.automatic_processing_enabled = !self.automatic_processing_enabled;
            let state = if self.automatic_processing_enabled {
                "habilitadas"
            } else {
                "pausadas"
            };
            log::info!("Transferencias automaticas {state} por el operador.");
            self.push_notice(format!("Transferencias automaticas {state}."));
            if self.automatic_processing_enabled {
                self.try_spawn_automatic_transfers();
            }
        }

        self.render_transfer_lookup_window(ctx);
        self.render_automatic_pending_window(ctx);
        self.render_credit_line_editor(ctx);

        egui::TopBottomPanel::bottom("notices")
            .resizable(true)
            .default_height(160.0)
            .show(ctx, |ui| {
                ui.heading("Eventos");
                egui::ScrollArea::vertical().show(ui, |ui| {
                    for notice in &self.notices {
                        ui.label(notice);
                    }
                });
            });

        egui::CentralPanel::default().show(ctx, |ui| {
            let visible_items = self
                .items
                .iter()
                .filter(|item| self.show_disabled_lines || !item.validation.disabled)
                .collect::<Vec<_>>();

            if visible_items.is_empty() {
                ui.add_space(32.0);
                ui.vertical_centered(|ui| {
                    if self.items.iter().any(|item| item.validation.disabled) {
                        ui.label("No hay solicitudes habilitadas para transferir.");
                        ui.small("Activá 'Mostrar deshabilitadas' para ver las excluidas.");
                    } else {
                        ui.label("No hay solicitudes en 'A Transferir'.");
                    }
                });
                return;
            }

            let table = TableBuilder::new(ui)
                .striped(true)
                .resizable(true)
                .column(Column::initial(170.0).at_least(130.0))
                .column(Column::initial(145.0).at_least(120.0))
                .column(Column::initial(95.0))
                .column(Column::initial(110.0))
                .column(Column::initial(150.0))
                .column(Column::initial(95.0))
                .column(Column::initial(95.0))
                .column(Column::initial(100.0))
                .column(Column::initial(170.0))
                .column(Column::remainder())
                .column(Column::initial(120.0));

            table
                .header(24.0, |mut header| {
                    header.col(|ui| {
                        ui.strong("Titular");
                    });
                    header.col(|ui| {
                        ui.strong("Línea");
                    });
                    header.col(|ui| {
                        ui.strong("Documento");
                    });
                    header.col(|ui| {
                        ui.strong("Solicitud");
                    });
                    header.col(|ui| {
                        ui.strong("CBU");
                    });
                    header.col(|ui| {
                        ui.strong("Monto MM");
                    });
                    header.col(|ui| {
                        ui.strong("Monto core");
                    });
                    header.col(|ui| {
                        ui.strong("Estado");
                    });
                    header.col(|ui| {
                        ui.strong("CUIL");
                    });
                    header.col(|ui| {
                        ui.strong("Validaciones");
                    });
                    header.col(|ui| {
                        ui.strong("Accion");
                    });
                })
                .body(|mut body| {
                    for item in visible_items {
                        body.row(62.0, |mut row| {
                            row.col(|ui| {
                                ui.vertical(|ui| {
                                    ui.label(item.display_name());
                                    if let Some(message) = &item.message {
                                        ui.small(RichText::new(message).color(Color32::GRAY));
                                    }
                                });
                            });
                            row.col(|ui| {
                                ui.label(display_credit_line(
                                    item.core.credit_line_description.as_deref(),
                                ));
                            });
                            row.col(|ui| {
                                ui.label(item.document_display());
                            });
                            row.col(|ui| {
                                ui.label(item.request_oid());
                            });
                            row.col(|ui| {
                                ui.label(item.core.transfer_cbu.as_deref().unwrap_or("N/D"));
                            });
                            row.col(|ui| {
                                ui.label(item.amount_display());
                            });
                            row.col(|ui| {
                                ui.label(item.core_amount_display());
                            });
                            row.col(|ui| {
                                let resolution = item.transfer_amount_resolution();
                                let color = if !matches!(
                                    item.core.request_status.as_deref(),
                                    Some("A Transferir")
                                ) || matches!(
                                    resolution.outcome,
                                    TransferAmountOutcome::Error
                                ) {
                                    Color32::from_rgb(170, 30, 30)
                                } else if matches!(
                                    resolution.outcome,
                                    TransferAmountOutcome::Renovacion
                                ) {
                                    Color32::from_rgb(176, 113, 0)
                                } else {
                                    Color32::LIGHT_GRAY
                                };
                                let response = ui.label(
                                    RichText::new(item.transfer_state_display()).color(color),
                                );
                                if let Some(detail) = resolution.detail.as_deref() {
                                    if !matches!(resolution.outcome, TransferAmountOutcome::Exact) {
                                        response.on_hover_text(detail);
                                    }
                                }
                            });
                            row.col(|ui| {
                                ui.vertical(|ui| {
                                    ui.small(format!(
                                        "solicitud: {}",
                                        item.core.request_cuil.as_deref().unwrap_or("N/D")
                                    ));
                                    ui.small(format!(
                                        "dni: {}",
                                        item.core.document_cuil.as_deref().unwrap_or("N/D")
                                    ));
                                    ui.small(format!(
                                        "coinag: {}",
                                        item.core.coinag_cuil.as_deref().unwrap_or("N/D")
                                    ));
                                });
                            });
                            row.col(|ui| {
                                let summary = item.validation.summary();
                                let color = if !item.validation.blockers.is_empty() {
                                    Color32::from_rgb(170, 30, 30)
                                } else if !item.validation.warnings.is_empty() {
                                    Color32::from_rgb(176, 113, 0)
                                } else {
                                    Color32::from_rgb(24, 120, 52)
                                };
                                let mut hover_lines = Vec::new();
                                for blocker in &item.validation.blockers {
                                    hover_lines.push(format!("Bloqueo: {blocker}"));
                                }
                                for warning in &item.validation.warnings {
                                    hover_lines.push(format!("Advertencia: {warning}"));
                                }
                                let response = ui.label(RichText::new(summary).color(color));
                                if !hover_lines.is_empty() {
                                    response.on_hover_text(hover_lines.join("\n"));
                                }
                            });
                            row.col(|ui| {
                                let button_enabled = self.services.transfer_enabled()
                                    && item.validation.can_transfer()
                                    && !item.busy;
                                if item.busy {
                                    ui.label("Procesando...");
                                    return;
                                }
                                let response =
                                    ui.add_enabled(button_enabled, egui::Button::new("Transferir"));
                                if response.clicked() {
                                    transfer_confirmation =
                                        Some(TransferConfirmation::for_case(item));
                                }
                                if !self.services.transfer_enabled() {
                                    response.on_hover_text(
                                        "Coinag no esta configurado en este runtime.",
                                    );
                                }
                            });
                        });
                    }
                });
        });

        if let Some(transfer_confirmation) = transfer_confirmation {
            self.pending_transfer_confirmation = Some(transfer_confirmation);
        }

        self.render_transfer_confirmation(ctx, &mut request_to_transfer);

        if let Some(request_oid) = request_to_transfer {
            self.spawn_transfer(request_oid);
        }

        ctx.request_repaint_after(std::time::Duration::from_millis(250));
    }
}

#[derive(Clone)]
struct TransferConfirmation {
    request_oid: String,
    message: String,
    summary_fields: Vec<(String, String)>,
    warning_message: Option<String>,
}

#[derive(Default)]
struct TransferLookupDialog {
    open: bool,
    request_number: String,
    loading: bool,
    error: Option<String>,
    result: Option<TransferLookupResult>,
}

#[derive(Clone)]
struct TransferLookupResult {
    request_number: String,
    summary_fields: Vec<(String, String)>,
    raw_json: String,
}

struct CreditLineEditor {
    open: bool,
    loading: bool,
    search: String,
    filter: CreditLineFilter,
    draft: CreditLinesFile,
    dirty: bool,
    message: Option<String>,
}

impl CreditLineEditor {
    fn from_config(draft: CreditLinesFile) -> Self {
        Self {
            open: false,
            loading: false,
            search: String::new(),
            filter: CreditLineFilter::Todas,
            draft,
            dirty: false,
            message: None,
        }
    }

    fn reset(&mut self, draft: CreditLinesFile) {
        self.draft = draft;
        self.dirty = false;
        self.message = None;
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum CreditLineFilter {
    #[default]
    Todas,
    Inhabilitadas,
    Habilitadas,
    Automaticas,
    Ausentes,
}

impl CreditLineFilter {
    fn label(self) -> &'static str {
        match self {
            Self::Todas => "Todas",
            Self::Inhabilitadas => "Inhabilitadas",
            Self::Habilitadas => "Habilitadas",
            Self::Automaticas => "Automaticas",
            Self::Ausentes => "Ausentes del core",
        }
    }

    fn includes(self, line: &CreditLineEntry) -> bool {
        match self {
            Self::Todas => true,
            Self::Inhabilitadas => line.modo == CreditLineMode::Inhabilitada,
            Self::Habilitadas => line.modo == CreditLineMode::Habilitada,
            Self::Automaticas => line.modo == CreditLineMode::Automatica,
            Self::Ausentes => line.present_in_core == Some(false),
        }
    }
}

#[derive(Clone)]
struct AutomaticTransferPending {
    request_oid: String,
    display_name: String,
    amount: String,
    credit_line: String,
    receipt_path: Option<PathBuf>,
    created_at: String,
    reviewed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TransferKind {
    Manual,
    Automatic,
}

impl TransferKind {
    fn label(&self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Automatic => "automatica",
        }
    }

    fn is_automatic(&self) -> bool {
        matches!(self, Self::Automatic)
    }
}

fn coelsa_status_audit_value(status: &CoelsaTransferStatus) -> Value {
    match status {
        CoelsaTransferStatus::Confirmed => json!({
            "classification": "confirmed",
            "detail": null,
        }),
        CoelsaTransferStatus::Rejected { detail } => json!({
            "classification": "rejected",
            "detail": detail,
        }),
        CoelsaTransferStatus::Pending { detail } => json!({
            "classification": "pending",
            "detail": detail,
        }),
    }
}

fn log_transfer_audit(event: &str, request_oid: &str, transfer_kind: TransferKind, data: Value) {
    log::info!(
        target: "transfer_audit",
        "{}",
        json!({
            "event": event,
            "request_oid": request_oid,
            "transfer_kind": transfer_kind.label(),
            "data": data,
        })
    );
}

fn finish_receipt_trace(
    request_oid: &str,
    transfer_kind: TransferKind,
    final_state: &str,
    result: Result<PathBuf>,
) -> Option<PathBuf> {
    match result {
        Ok(path) => {
            log_transfer_audit(
                "receipt_written",
                request_oid,
                transfer_kind,
                json!({
                    "final_state": final_state,
                    "path": path,
                }),
            );
            Some(path)
        }
        Err(error) => {
            log::error!(
                "No se pudo generar el PDF {final_state} para solicitud {request_oid}: {error:#}"
            );
            log_transfer_audit(
                "receipt_write_failed",
                request_oid,
                transfer_kind,
                json!({
                    "final_state": final_state,
                    "error": format!("{error:#}"),
                }),
            );
            None
        }
    }
}

impl TransferConfirmation {
    fn for_case(item: &HydratedCase) -> Self {
        let resolution = item.transfer_amount_resolution();
        let mut warning_lines = Vec::new();
        if !item.server_validation.has_completed_validation() {
            warning_lines.push(
                "Advertencia: no existe validacion MetaMap completed asociada en el server."
                    .to_owned(),
            );
        }
        if matches!(resolution.outcome, TransferAmountOutcome::Renovacion) {
            warning_lines.push(format!(
                "NOTA: EL MONTO QUE SE VA A TRANSFERIR ({}) ES MENOR QUE EL MONTO DE LA SOLICITUD ({}). SE AUTODETECTO COMO RENOVACION.",
                item.transfer_amount_display(),
                item.core_amount_display(),
            ));
        }

        Self {
            request_oid: item.request_oid().to_owned(),
            message: "Desea transferir esta solicitud?".to_owned(),
            summary_fields: vec![
                ("NOMBRE".to_owned(), item.display_name()),
                ("CUIL".to_owned(), item.cuil_display()),
                (
                    "LINEA".to_owned(),
                    display_credit_line(item.core.credit_line_description.as_deref()),
                ),
                ("MONTO SOLICITUD".to_owned(), item.core_amount_display()),
                (
                    "MONTO A TRANSFERIR".to_owned(),
                    item.transfer_amount_display(),
                ),
                ("CBU".to_owned(), item.cbu_display()),
            ],
            warning_message: if warning_lines.is_empty() {
                None
            } else {
                Some(warning_lines.join("\n"))
            },
        }
    }
}

#[derive(Clone)]
struct AppServices {
    server: ServerClient,
    core: CoreClient,
    mark_paid: Option<MarkPaidClient>,
    coinag: Option<CoinagClient>,
    credit_lines: Arc<RwLock<CreditLinesFile>>,
    credit_lines_path: PathBuf,
    startup_notices: Vec<String>,
    operator_name: String,
    poll_interval: std::time::Duration,
    receipts_dir: PathBuf,
    automatic_receipts_dir: PathBuf,
}

impl AppServices {
    fn new(config: AppConfig) -> Result<Self> {
        log::debug!(
            "Inicializando servicios. poll_interval={}s timeout={}s operator={}.",
            config.poll_interval.as_secs(),
            config.request_timeout.as_secs(),
            config.operator_name
        );
        let server = ServerClient::new(&config.server, config.request_timeout)?;
        let core = CoreClient::new(&config.core, config.request_timeout)?;
        let mark_paid = if config.mark_paid.is_complete() {
            Some(MarkPaidClient::new(
                &config.mark_paid,
                config.request_timeout,
            )?)
        } else {
            None
        };
        let coinag = if config.coinag.is_complete() {
            Some(CoinagClient::new(&config.coinag, config.request_timeout)?)
        } else {
            None
        };
        let credit_lines_path = config.credit_lines_path;
        let mut startup_notices = Vec::new();
        let credit_lines = if credit_lines_path.exists() {
            match CreditLinesFile::load(&credit_lines_path) {
                Ok(lines) => lines,
                Err(error) => {
                    log::error!(
                        "Configuracion de lineas invalida en {credit_lines_path:?}: {error:#}. Todas las lineas quedan inhabilitadas."
                    );
                    startup_notices.push(format!(
                        "ATENCION: no se pudo cargar {}. Todas las lineas quedaron inhabilitadas: {error}",
                        credit_lines_path.display()
                    ));
                    CreditLinesFile::default()
                }
            }
        } else {
            let mut initial = CreditLinesFile::default();
            match core.fetch_credit_line_catalog() {
                Ok(catalog) => match initial.reconcile(catalog) {
                    Ok(summary) => match initial.save_atomic(&credit_lines_path) {
                        Ok(()) => {
                            startup_notices.push(format!(
                                "Se creo {} con {} lineas inhabilitadas.",
                                credit_lines_path.display(),
                                summary.added
                            ));
                        }
                        Err(error) => {
                            log::error!(
                                "No se pudo crear la configuracion inicial de lineas: {error:#}"
                            );
                            startup_notices.push(format!(
                                "No se pudo guardar la configuracion inicial de lineas: {error}"
                            ));
                            initial = CreditLinesFile::default();
                        }
                    },
                    Err(error) => {
                        log::error!("Catalogo inicial de lineas invalido: {error:#}");
                        startup_notices.push(format!(
                            "El catalogo inicial de lineas no es valido: {error}"
                        ));
                    }
                },
                Err(error) => {
                    log::error!("No se pudo obtener el catalogo inicial de lineas: {error:#}");
                    startup_notices.push(format!(
                        "No se pudo crear lineas.toml porque fallo el core. Todas las lineas estan inhabilitadas; reintente desde Configurar lineas: {error}"
                    ));
                }
            }
            initial
        };
        let services = Self {
            server,
            core,
            mark_paid,
            coinag,
            credit_lines: Arc::new(RwLock::new(credit_lines)),
            credit_lines_path,
            startup_notices,
            operator_name: config.operator_name,
            poll_interval: config.poll_interval,
            receipts_dir: config.receipts_dir,
            automatic_receipts_dir: config.automatic_receipts_dir,
        };
        log::info!(
            "Servicios listos. transfer_enabled={}. mark_paid_enabled={}. lineas_habilitadas={} lineas_auto={} lineas_path={:?}.",
            services.transfer_enabled(),
            services.mark_paid.is_some(),
            services.credit_lines_snapshot().enabled_count(),
            services.credit_lines_snapshot().automatic_count(),
            services.credit_lines_path
        );
        Ok(services)
    }

    fn transfer_enabled(&self) -> bool {
        self.coinag.is_some()
    }

    fn automatic_transfer_enabled(&self) -> bool {
        self.transfer_enabled()
            && self
                .credit_lines
                .read()
                .map(|lines| lines.automatic_count() > 0)
                .unwrap_or(false)
    }

    fn credit_lines_snapshot(&self) -> CreditLinesFile {
        self.credit_lines
            .read()
            .map(|lines| lines.clone())
            .unwrap_or_else(|error| {
                log::error!("No se pudo leer la configuracion de lineas en memoria: {error}");
                CreditLinesFile::default()
            })
    }

    fn credit_line_mode(&self, id: Option<u64>) -> CreditLineMode {
        self.credit_lines
            .read()
            .map(|lines| lines.mode_for(id))
            .unwrap_or_default()
    }

    fn fetch_credit_line_catalog(&self) -> Result<Vec<CreditLineCatalogEntry>> {
        self.core.fetch_credit_line_catalog()
    }

    fn save_credit_lines(&self, config: CreditLinesFile) -> Result<()> {
        let mut guard = self.credit_lines.write().map_err(|error| {
            anyhow::anyhow!("No se pudo actualizar la configuracion en memoria: {error}")
        })?;
        let previous = guard.clone();
        config.save_atomic(&self.credit_lines_path)?;
        let previous_by_id = previous
            .lineas
            .iter()
            .map(|line| (line.id, line))
            .collect::<HashMap<_, _>>();
        for line in &config.lineas {
            let previous_line = previous_by_id.get(&line.id).copied();
            let previous_mode = previous_line
                .map(|previous| previous.modo)
                .unwrap_or_default();
            if previous_line.is_none() {
                log::info!(
                    "credit_line_config_added {}",
                    json!({
                        "operator": self.operator_name,
                        "line_id": line.id,
                        "code": line.codigo,
                        "description": line.descripcion,
                        "mode": line.modo.label(),
                    })
                );
            } else if previous_line.is_some_and(|previous| {
                previous.codigo != line.codigo || previous.descripcion != line.descripcion
            }) {
                log::info!(
                    "credit_line_config_metadata_updated {}",
                    json!({
                        "operator": self.operator_name,
                        "line_id": line.id,
                        "previous_code": previous_line.map(|line| line.codigo.as_str()),
                        "new_code": line.codigo,
                        "previous_description": previous_line.map(|line| line.descripcion.as_str()),
                        "new_description": line.descripcion,
                        "mode": line.modo.label(),
                    })
                );
            }
            if previous_line.is_some() && previous_mode != line.modo {
                log::info!(
                    "credit_line_config_change {}",
                    json!({
                        "operator": self.operator_name,
                        "line_id": line.id,
                        "code": line.codigo,
                        "description": line.descripcion,
                        "previous_mode": previous_mode.label(),
                        "new_mode": line.modo.label(),
                    })
                );
            }
        }
        log::info!(
            "credit_line_config_saved {}",
            json!({
                "operator": self.operator_name,
                "path": self.credit_lines_path,
                "total": config.lineas.len(),
                "enabled": config.enabled_count(),
                "automatic": config.automatic_count(),
            })
        );
        *guard = config;
        Ok(())
    }

    fn ensure_automatic_receipts_dir(&self) -> Result<()> {
        fs::create_dir_all(&self.automatic_receipts_dir).with_context(|| {
            format!(
                "No se pudo crear la carpeta {:?}",
                self.automatic_receipts_dir
            )
        })
    }

    fn balance_enabled(&self) -> bool {
        self.coinag
            .as_ref()
            .is_some_and(CoinagClient::can_fetch_balance)
    }

    fn initial_balance_text(&self) -> String {
        if self.coinag.is_none() {
            return "Saldo actual: no disponible (Coinag no configurado)".to_owned();
        }
        if !self.balance_enabled() {
            return "Saldo actual: no disponible (consulta de saldo no configurada)".to_owned();
        }
        "Saldo actual: actualizando...".to_owned()
    }

    fn load_balance_text(&self) -> String {
        let Some(coinag) = &self.coinag else {
            return "Saldo actual: no disponible (Coinag no configurado)".to_owned();
        };
        if !coinag.can_fetch_balance() {
            return "Saldo actual: no disponible (consulta de saldo no configurada)".to_owned();
        }
        coinag.build_available_balance_text()
    }

    fn lookup_transfer_by_request_number(
        &self,
        request_number: &str,
    ) -> Result<TransferLookupResult> {
        let coinag = self
            .coinag
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Coinag no esta configurado en este runtime."))?;
        let response = coinag.lookup_transfer_by_request_number(request_number)?;
        Ok(TransferLookupResult {
            request_number: response.request_number.clone(),
            summary_fields: build_transfer_lookup_summary_fields(&response),
            raw_json: serde_json::to_string_pretty(&response.body)
                .unwrap_or_else(|_| response.body.to_string()),
        })
    }

    fn register_paid_receipt(
        &self,
        request_oid: &str,
        transfer_kind: TransferKind,
        receipt_path: &std::path::Path,
    ) -> Result<()> {
        let endpoint = self
            .mark_paid
            .as_ref()
            .map(MarkPaidClient::endpoint_url)
            .unwrap_or("no configurado");
        log_transfer_audit(
            "mark_paid_request_started",
            request_oid,
            transfer_kind,
            json!({
                "endpoint": endpoint,
                "receipt_path": receipt_path,
            }),
        );

        let Some(client) = &self.mark_paid else {
            let error = anyhow::anyhow!(
                "El endpoint para registrar el comprobante no esta configurado. Falta TRANSFERENCIAS_MARK_PAID_AUTH_TOKEN."
            );
            log_transfer_audit(
                "mark_paid_request_failed",
                request_oid,
                transfer_kind,
                json!({ "endpoint": endpoint, "error": format!("{error:#}") }),
            );
            return Err(error);
        };

        match client.mark_paid(request_oid, receipt_path) {
            Ok(response) => {
                log_transfer_audit(
                    "mark_paid_request_succeeded",
                    request_oid,
                    transfer_kind,
                    json!({
                        "endpoint": endpoint,
                        "http_status": response.status_code,
                        "response_body": response.body,
                        "pdf_bytes": response.pdf_bytes,
                        "pdf_sha256": response.pdf_sha256,
                    }),
                );
                log::info!(
                    "Comprobante registrado en el core para solicitud {}. HTTP {}.",
                    request_oid,
                    response.status_code
                );
                Ok(())
            }
            Err(error) => {
                let http_error = error.downcast_ref::<MarkPaidHttpError>();
                log::error!(
                    "La transferencia de la solicitud {request_oid} fue confirmada, pero fallo el registro del comprobante: {error:#}"
                );
                log_transfer_audit(
                    "mark_paid_request_failed",
                    request_oid,
                    transfer_kind,
                    json!({
                        "endpoint": endpoint,
                        "receipt_path": receipt_path,
                        "error_kind": if http_error.is_some() { "http_status" } else { "transport_or_processing" },
                        "http_status": http_error.map(|error| error.status_code),
                        "response_body": http_error.map(|error| error.body.as_str()),
                        "error": format!("{error:#}"),
                    }),
                );
                Err(error)
            }
        }
    }

    fn load_candidates(&self, existing_items: Vec<HydratedCase>) -> Result<Vec<HydratedCase>> {
        let candidates = self.core.fetch_transfer_candidates()?;
        log::debug!(
            "Hidratando {} solicitudes del core con {} items previos.",
            candidates.len(),
            existing_items.len()
        );
        let existing_map = existing_items
            .into_iter()
            .map(|item| (item.request_oid().to_owned(), item))
            .collect::<HashMap<_, _>>();

        let mut hydrated = Vec::new();
        for core_snapshot in candidates {
            let existing = existing_map
                .get(core_snapshot.request_oid.as_str())
                .cloned();
            if !self
                .credit_line_mode(core_snapshot.credit_line_id)
                .allows_manual()
            {
                hydrated.push(self.build_disabled_candidate(core_snapshot, existing));
                continue;
            }
            hydrated.push(self.hydrate_candidate(core_snapshot, existing));
        }
        hydrated
            .sort_by(|left, right| compare_request_oids(left.request_oid(), right.request_oid()));
        log::debug!("Lista hidratada. total_items={}.", hydrated.len());
        Ok(hydrated)
    }

    fn hydrate_candidate(
        &self,
        core_snapshot: CoreSnapshot,
        existing: Option<HydratedCase>,
    ) -> HydratedCase {
        let previous_core = existing.as_ref().map(|item| item.core.clone());

        let mut case = existing.unwrap_or_else(|| HydratedCase {
            server_validation: Default::default(),
            metamap: Default::default(),
            core: core_snapshot.clone(),
            transfer_guard: Default::default(),
            validation: Default::default(),
            busy: false,
            message: None,
        });
        case.core = core_snapshot;
        case.busy = false;
        case.message = None;
        case.transfer_guard = CoinagTransferGuard::Unknown;
        log::debug!("Hidratando solicitud {}.", case.request_oid());

        let mut runtime_errors = Vec::new();
        self.apply_validation_snapshot(&mut case, &mut runtime_errors);
        self.apply_runtime_enrichment(
            &mut case,
            previous_core.as_ref(),
            &mut runtime_errors,
            false,
        );
        self.finalize_case(&mut case, runtime_errors);
        case
    }

    fn build_disabled_candidate(
        &self,
        core_snapshot: CoreSnapshot,
        existing: Option<HydratedCase>,
    ) -> HydratedCase {
        let mut case = existing.unwrap_or_else(|| HydratedCase {
            server_validation: Default::default(),
            metamap: Default::default(),
            core: core_snapshot.clone(),
            transfer_guard: Default::default(),
            validation: Default::default(),
            busy: false,
            message: None,
        });
        case.core = core_snapshot;
        case.busy = false;
        case.message = None;
        case.transfer_guard = CoinagTransferGuard::Unknown;
        self.mark_disabled_case(&mut case);
        case
    }

    fn refresh_case(&self, case: &HydratedCase) -> HydratedCase {
        log::debug!(
            "Refrescando solicitud {} antes de validar/transferir.",
            case.request_oid()
        );
        let mut refreshed = case.clone();
        refreshed.busy = false;
        refreshed.message = None;

        let mut runtime_errors = Vec::new();

        match self
            .core
            .fetch_core_snapshot(case.request_oid(), case.metamap.document.as_deref())
        {
            Ok(core_snapshot) => refreshed.core = core_snapshot,
            Err(error) => runtime_errors.push(format!(
                "No se pudo consultar la solicitud en el core financiero: {error}"
            )),
        }

        if !self
            .credit_line_mode(refreshed.core.credit_line_id)
            .allows_manual()
        {
            self.mark_disabled_case(&mut refreshed);
            return refreshed;
        }

        self.apply_validation_snapshot(&mut refreshed, &mut runtime_errors);
        self.apply_runtime_enrichment(&mut refreshed, Some(&case.core), &mut runtime_errors, true);
        self.finalize_case(&mut refreshed, runtime_errors);
        refreshed
    }

    fn apply_validation_snapshot(&self, case: &mut HydratedCase, runtime_errors: &mut Vec<String>) {
        let previous_validation = case.server_validation.clone();
        let previous_metamap = case.metamap.clone();

        match self
            .server
            .find_validation_by_request_number(case.request_oid())
        {
            Ok(Some(server_validation)) => {
                let mut metamap = server_validation.to_metamap_snapshot();
                if previous_validation.verification_id == server_validation.verification_id {
                    preserve_metamap_value(&mut metamap, &previous_metamap);
                }
                if metamap.request_number.is_none() && server_validation.has_completed_validation()
                {
                    metamap.request_number = Some(case.request_oid().to_owned());
                }
                case.server_validation = server_validation;
                case.metamap = metamap;
                log::debug!(
                    "Solicitud {} asociada a verification_id={:?}. doc={:?} amount={:?}.",
                    case.request_oid(),
                    case.server_validation.verification_id,
                    case.metamap.document,
                    case.metamap.amount_raw
                );
            }
            Ok(None) => {
                case.server_validation = Default::default();
                case.metamap = Default::default();
                log::debug!(
                    "Solicitud {} sin validacion completed en server.",
                    case.request_oid()
                );
            }
            Err(error) => {
                case.server_validation = previous_validation;
                case.metamap = previous_metamap;
                log::error!(
                    "Error consultando validaciones del server para solicitud {}: {error:#}",
                    case.request_oid()
                );
                runtime_errors.push(format!(
                    "No se pudo consultar validaciones del server: {error}"
                ));
            }
        }
    }

    fn apply_runtime_enrichment(
        &self,
        case: &mut HydratedCase,
        previous_core: Option<&CoreSnapshot>,
        runtime_errors: &mut Vec<String>,
        force_refresh: bool,
    ) {
        case.core.refreshed_label = Some(Local::now().format("%H:%M:%S").to_string());

        if !force_refresh {
            if let Some(previous_core) = previous_core {
                if previous_core.request_document == case.core.request_document {
                    case.core.document_cuil = previous_core.document_cuil.clone();
                }
                if previous_core.transfer_cbu == case.core.transfer_cbu {
                    case.core.coinag_cuil = previous_core.coinag_cuil.clone();
                    case.core.coinag_account_type_code =
                        previous_core.coinag_account_type_code.clone();
                    case.core.coinag_account_type_label =
                        previous_core.coinag_account_type_label.clone();
                }
            }
        } else {
            case.core.document_cuil = None;
            case.core.coinag_cuil = None;
            case.core.coinag_account_type_code = None;
            case.core.coinag_account_type_label = None;
        }

        if case.core.document_cuil.is_none() {
            if let Some(document) = case.core.request_document.clone() {
                match self.core.fetch_system_cuil_by_document(&document) {
                    Ok(document_cuil) => {
                        case.core.document_cuil = document_cuil;
                    }
                    Err(error) => runtime_errors.push(format!(
                        "No se pudo obtener CUIL/CUIT del core por DNI: {error}"
                    )),
                }
            }
        }

        if case.core.coinag_cuil.is_none() || case.core.coinag_account_type_code.is_none() {
            if let Some(cbu) = case.core.transfer_cbu.clone() {
                if let Some(coinag) = &self.coinag {
                    match coinag.lookup_cbu_details(&cbu) {
                        Ok(details) => {
                            if let Some(cuil) = details.cuil {
                                case.core.coinag_cuil = Some(cuil);
                            }
                            if let Some(account_type_code) = details.account_type_code {
                                case.core.coinag_account_type_code = Some(account_type_code);
                            }
                            if let Some(account_type_label) = details.account_type_label {
                                case.core.coinag_account_type_label = Some(account_type_label);
                            }
                        }
                        Err(error) => runtime_errors.push(error.to_string()),
                    }
                }
            }
        }

        case.transfer_guard = if let Some(coinag) = &self.coinag {
            coinag.fetch_transfer_guard_status(case.request_oid())
        } else {
            CoinagTransferGuard::Unknown
        };
    }

    fn finalize_case(&self, case: &mut HydratedCase, runtime_errors: Vec<String>) {
        case.validation = validation::build_validation_report(
            &case.server_validation,
            &case.metamap,
            &case.core,
            &case.transfer_guard,
        );
        case.validation.blockers.extend(runtime_errors.clone());
        log::debug!(
            "Solicitud {} validada. blockers={} warnings={}.",
            case.request_oid(),
            case.validation.blockers.len(),
            case.validation.warnings.len()
        );
        if !case.busy {
            if !runtime_errors.is_empty() {
                case.message = Some(runtime_errors.join(" | "));
            } else {
                case.message = match &case.transfer_guard {
                    CoinagTransferGuard::YaTransferida => Some("YA TRANSFERIDA".to_owned()),
                    CoinagTransferGuard::EnProceso => Some("EN PROCESO".to_owned()),
                    CoinagTransferGuard::Error { .. } => Some("ERROR".to_owned()),
                    CoinagTransferGuard::Unknown | CoinagTransferGuard::NotFound => None,
                };
            }
        }
    }

    fn mark_disabled_case(&self, case: &mut HydratedCase) {
        let line = display_credit_line(case.core.credit_line_description.as_deref());
        case.server_validation = Default::default();
        case.metamap = Default::default();
        case.transfer_guard = CoinagTransferGuard::Unknown;
        case.core.document_cuil = None;
        case.core.coinag_cuil = None;
        case.validation = ValidationReport {
            disabled: true,
            blockers: vec![format!("Línea de crédito deshabilitada: {line}")],
            warnings: Vec::new(),
        };
        if !case.busy {
            case.message = None;
        }
        log::info!(
            "Solicitud {} marcada como deshabilitada por linea_id={:?} descripcion={:?}.",
            case.request_oid(),
            case.core.credit_line_id,
            case.core.credit_line_description
        );
    }

    fn execute_transfer(&self, case: HydratedCase, transfer_kind: TransferKind) -> WorkerEvent {
        log_transfer_audit(
            "transfer_started",
            case.request_oid(),
            transfer_kind,
            json!({
                "operator": self.operator_name,
                "applicant": case.display_name(),
                "document": case.document_display(),
                "cuil": case.cuil_display(),
                "cbu": case.cbu_display(),
                "request_amount": case.core_amount_display(),
                "transfer_amount": case.transfer_amount_display(),
                "credit_line": case.core.credit_line_description,
                "credit_line_id": case.core.credit_line_id,
                "credit_line_code": case.core.credit_line_code,
                "verification_id": case.server_validation.verification_id,
                "blockers": case.validation.blockers,
                "warnings": case.validation.warnings,
            }),
        );
        let Some(coinag) = &self.coinag else {
            log::warn!(
                "Transferencia bloqueada para solicitud {}: Coinag no configurado.",
                case.request_oid()
            );
            let mut updated = case.clone();
            updated.busy = false;
            updated.message = Some("Coinag no esta configurado en este runtime.".to_owned());
            return WorkerEvent::CaseUpdated {
                case: updated,
                message: "Transferencia bloqueada: Coinag no esta configurado.".to_owned(),
                receipt_path: None,
                refresh_balance: false,
                transfer_kind,
                automatic_receipt_pending: false,
            };
        };

        let refreshed = self.refresh_case(&case);
        log_transfer_audit(
            "pre_transfer_validation",
            case.request_oid(),
            transfer_kind,
            json!({
                "can_transfer": refreshed.validation.can_transfer(),
                "blockers": refreshed.validation.blockers,
                "warnings": refreshed.validation.warnings,
                "core_status": refreshed.core.request_status,
                "core_snapshot": format!("{:?}", refreshed.core),
                "metamap_snapshot": format!("{:?}", refreshed.metamap),
                "server_validation": format!("{:?}", refreshed.server_validation),
                "coinag_guard": format!("{:?}", refreshed.transfer_guard),
            }),
        );
        if !refreshed.validation.can_transfer()
            || (transfer_kind.is_automatic()
                && (!refreshed.validation.warnings.is_empty()
                    || !refreshed.server_validation.has_completed_validation()
                    || !self
                        .credit_line_mode(refreshed.core.credit_line_id)
                        .allows_automatic()))
        {
            log::warn!(
                "Transferencia bloqueada para solicitud {} por validaciones: {} bloqueos.",
                case.request_oid(),
                refreshed.validation.blockers.len()
            );
            return WorkerEvent::CaseUpdated {
                case: refreshed,
                message: format!(
                    "Transferencia bloqueada para solicitud {} por validaciones.",
                    case.request_oid()
                ),
                receipt_path: None,
                refresh_balance: false,
                transfer_kind,
                automatic_receipt_pending: false,
            };
        }

        let transfer_payload = match coinag.build_transfer_payload(&refreshed) {
            Ok(payload) => payload,
            Err(error) => {
                log::error!(
                    "No se pudo armar payload Coinag para solicitud {}: {error:#}",
                    case.request_oid()
                );
                let mut updated = refreshed;
                updated.busy = false;
                updated.message = Some(error.to_string());
                return WorkerEvent::CaseUpdated {
                    case: updated,
                    message: format!(
                        "No se pudo armar la transferencia para solicitud {}: {error}",
                        case.request_oid()
                    ),
                    receipt_path: None,
                    refresh_balance: false,
                    transfer_kind,
                    automatic_receipt_pending: false,
                };
            }
        };
        log_transfer_audit(
            "transfer_payload_built",
            case.request_oid(),
            transfer_kind,
            json!({ "payload": transfer_payload }),
        );

        let transfer_response = match coinag.perform_transfer(&transfer_payload) {
            Ok(response) => response,
            Err(error) => {
                log::error!(
                    "Coinag fallo al transferir solicitud {}: {error:#}",
                    case.request_oid()
                );
                let mut updated = refreshed;
                updated.busy = false;
                updated.message = Some(error.to_string());
                return WorkerEvent::CaseUpdated {
                    case: updated,
                    message: format!(
                        "Coinag fallo al transferir la solicitud {}: {}",
                        case.request_oid(),
                        error
                    ),
                    receipt_path: None,
                    refresh_balance: false,
                    transfer_kind,
                    automatic_receipt_pending: false,
                };
            }
        };
        log_transfer_audit(
            "transfer_response_received",
            case.request_oid(),
            transfer_kind,
            json!({ "response": transfer_response }),
        );

        let is_smoke = coinag.transfer_is_smoke();
        let smoke_output_path = transfer_response
            .get("smoke_output_path")
            .and_then(|value| value.as_str())
            .map(str::to_owned);
        let external_transfer_id = CoinagClient::extract_external_transfer_id(&transfer_response);

        let mut updated = refreshed;
        updated.busy = false;
        if is_smoke {
            updated.validation = validation::build_validation_report(
                &updated.server_validation,
                &updated.metamap,
                &updated.core,
                &updated.transfer_guard,
            );
            updated.message =
                Some("Transferencia smoke generada. No se envio a Coinag.".to_owned());
            let message = match smoke_output_path.as_deref() {
                Some(path) => format!(
                    "Smoke generado para solicitud {}. Payload guardado en {}.",
                    case.request_oid(),
                    path
                ),
                None => format!(
                    "Smoke generado para solicitud {}. Payload guardado localmente.",
                    case.request_oid()
                ),
            };
            log::info!("{message}");
            return WorkerEvent::CaseUpdated {
                case: updated,
                message,
                receipt_path: None,
                refresh_balance: false,
                transfer_kind,
                automatic_receipt_pending: false,
            };
        }

        let Some(external_transfer_id) = external_transfer_id.as_deref() else {
            log::warn!(
                "Transferencia enviada para solicitud {} sin idCoelsa en respuesta de Coinag.",
                case.request_oid()
            );
            updated.transfer_guard = CoinagTransferGuard::EnProceso;
            updated.validation = validation::build_validation_report(
                &updated.server_validation,
                &updated.metamap,
                &updated.core,
                &updated.transfer_guard,
            );
            updated.message = Some("EN PROCESO".to_owned());
            return WorkerEvent::CaseUpdated {
                case: updated,
                message: format!(
                    "Transferencia enviada para solicitud {} sin idCoelsa; queda pendiente de revision.",
                    case.request_oid()
                ),
                receipt_path: None,
                refresh_balance: true,
                transfer_kind,
                automatic_receipt_pending: false,
            };
        };

        let initial_status = CoinagClient::classify_transfer_response(&transfer_response);
        log_transfer_audit(
            "initial_response_classified",
            case.request_oid(),
            transfer_kind,
            json!({
                "id_coelsa": external_transfer_id,
                "status": coelsa_status_audit_value(&initial_status),
            }),
        );
        let confirmation_status = self.wait_for_coelsa_confirmation(
            coinag,
            case.request_oid(),
            transfer_kind,
            external_transfer_id,
            initial_status,
        );
        log_transfer_audit(
            "confirmation_finished",
            case.request_oid(),
            transfer_kind,
            json!({
                "id_coelsa": external_transfer_id,
                "status": coelsa_status_audit_value(&confirmation_status),
            }),
        );

        let (message, receipt_path) = match confirmation_status {
            CoelsaTransferStatus::Confirmed => {
                updated.transfer_guard = CoinagTransferGuard::YaTransferida;
                updated.message = Some("YA TRANSFERIDA".to_owned());
                let receipt_result = match transfer_kind {
                    TransferKind::Manual => receipt::write_receipt(
                        &self.receipts_dir,
                        &self.operator_name,
                        &updated,
                        external_transfer_id,
                    ),
                    TransferKind::Automatic => receipt::write_automatic_receipt(
                        &self.automatic_receipts_dir,
                        &self.operator_name,
                        &updated,
                        external_transfer_id,
                    ),
                };
                let receipt_path = finish_receipt_trace(
                    case.request_oid(),
                    transfer_kind,
                    "confirmed",
                    receipt_result,
                );
                log::info!(
                    "Transferencia confirmada para solicitud {} con idCoelsa {}.",
                    case.request_oid(),
                    external_transfer_id
                );
                let message = match receipt_path.as_deref() {
                    Some(path) => {
                        match self.register_paid_receipt(case.request_oid(), transfer_kind, path) {
                            Ok(()) => format!(
                                "Transferencia confirmada para solicitud {} con idCoelsa {}. Comprobante registrado y solicitud marcada como Pagada.",
                                case.request_oid(),
                                external_transfer_id
                            ),
                            Err(error) => {
                                updated.message =
                                    Some("TRANSFERIDA - ERROR AL REGISTRAR COMPROBANTE".to_owned());
                                format!(
                                    "ATENCION: la transferencia de la solicitud {} fue confirmada con idCoelsa {}, pero no se pudo registrar el comprobante ni marcarla como Pagada. No repetir la transferencia; requiere revision. Error: {}",
                                    case.request_oid(),
                                    external_transfer_id,
                                    error
                                )
                            }
                        }
                    }
                    None => {
                        updated.message =
                            Some("TRANSFERIDA - ERROR AL GENERAR COMPROBANTE".to_owned());
                        log_transfer_audit(
                            "mark_paid_request_skipped_missing_receipt",
                            case.request_oid(),
                            transfer_kind,
                            json!({ "id_coelsa": external_transfer_id }),
                        );
                        format!(
                            "ATENCION: la transferencia de la solicitud {} fue confirmada con idCoelsa {}, pero no se genero el PDF y no pudo marcarse como Pagada. No repetir la transferencia; requiere revision.",
                            case.request_oid(),
                            external_transfer_id
                        )
                    }
                };
                (message, receipt_path)
            }
            CoelsaTransferStatus::Rejected { detail } => {
                updated.transfer_guard = CoinagTransferGuard::Error {
                    detail: detail.clone(),
                };
                updated.message = Some(format!("ERROR: {detail}"));
                let receipt_result = match transfer_kind {
                    TransferKind::Manual => receipt::write_error_receipt(
                        &self.receipts_dir,
                        &self.operator_name,
                        &updated,
                        external_transfer_id,
                        &detail,
                    ),
                    TransferKind::Automatic => receipt::write_automatic_error_receipt(
                        &self.automatic_receipts_dir,
                        &self.operator_name,
                        &updated,
                        external_transfer_id,
                        &detail,
                    ),
                };
                let receipt_path = finish_receipt_trace(
                    case.request_oid(),
                    transfer_kind,
                    "rejected",
                    receipt_result,
                );
                log::warn!(
                    "Transferencia rechazada para solicitud {} con idCoelsa {}: {}.",
                    case.request_oid(),
                    external_transfer_id,
                    detail
                );
                (
                    format!(
                        "Transferencia rechazada para solicitud {} con idCoelsa {}: {}.",
                        case.request_oid(),
                        external_transfer_id,
                        detail
                    ),
                    receipt_path,
                )
            }
            CoelsaTransferStatus::Pending { detail } => {
                updated.transfer_guard = CoinagTransferGuard::EnProceso;
                updated.message = Some("EN PROCESO".to_owned());
                log::warn!(
                    "Transferencia pendiente para solicitud {} con idCoelsa {}: {}.",
                    case.request_oid(),
                    external_transfer_id,
                    detail
                );
                (
                    format!(
                        "Transferencia enviada para solicitud {} con idCoelsa {}; sigue pendiente de confirmacion: {}.",
                        case.request_oid(),
                        external_transfer_id,
                        detail
                    ),
                    None,
                )
            }
        };

        updated.validation = validation::build_validation_report(
            &updated.server_validation,
            &updated.metamap,
            &updated.core,
            &updated.transfer_guard,
        );
        let automatic_receipt_pending = transfer_kind.is_automatic() && receipt_path.is_some();

        WorkerEvent::CaseUpdated {
            case: updated,
            message,
            receipt_path,
            refresh_balance: true,
            transfer_kind,
            automatic_receipt_pending,
        }
    }

    fn wait_for_coelsa_confirmation(
        &self,
        coinag: &CoinagClient,
        request_oid: &str,
        transfer_kind: TransferKind,
        id_coelsa: &str,
        initial_status: CoelsaTransferStatus,
    ) -> CoelsaTransferStatus {
        if matches!(initial_status, CoelsaTransferStatus::Rejected { .. }) {
            log_transfer_audit(
                "confirmation_poll_skipped_terminal_rejection",
                request_oid,
                transfer_kind,
                json!({
                    "id_coelsa": id_coelsa,
                    "status": coelsa_status_audit_value(&initial_status),
                }),
            );
            return initial_status;
        }

        if matches!(initial_status, CoelsaTransferStatus::Confirmed) {
            log_transfer_audit(
                "confirmation_poll_skipped_already_confirmed",
                request_oid,
                transfer_kind,
                json!({ "id_coelsa": id_coelsa }),
            );
            return initial_status;
        }

        let mut last_status = initial_status;
        let total_attempts = COELSA_CONFIRMATION_FAST_POLLS + COELSA_CONFIRMATION_SLOW_POLLS;
        for attempt in 0..total_attempts {
            if attempt > 0 {
                let delay = if attempt <= COELSA_CONFIRMATION_FAST_POLLS {
                    COELSA_CONFIRMATION_FAST_INTERVAL
                } else {
                    COELSA_CONFIRMATION_SLOW_INTERVAL
                };
                thread::sleep(delay);
            }

            match coinag.lookup_transfer_by_id_coelsa(id_coelsa) {
                Ok(lookup) => {
                    last_status = lookup.status;
                    log_transfer_audit(
                        "confirmation_poll_result",
                        request_oid,
                        transfer_kind,
                        json!({
                            "id_coelsa": id_coelsa,
                            "attempt": attempt + 1,
                            "status": coelsa_status_audit_value(&last_status),
                            "response": lookup.body,
                        }),
                    );
                    if !matches!(last_status, CoelsaTransferStatus::Pending { .. }) {
                        return last_status;
                    }
                }
                Err(error) => {
                    log::warn!(
                        "No se pudo confirmar idCoelsa {} en intento {}: {error:#}.",
                        id_coelsa,
                        attempt + 1
                    );
                    last_status = CoelsaTransferStatus::Pending {
                        detail: error.to_string(),
                    };
                    log_transfer_audit(
                        "confirmation_poll_error",
                        request_oid,
                        transfer_kind,
                        json!({
                            "id_coelsa": id_coelsa,
                            "attempt": attempt + 1,
                            "error": format!("{error:#}"),
                        }),
                    );
                }
            }
        }
        last_status
    }
}

enum WorkerEvent {
    ItemsLoaded(Vec<HydratedCase>),
    ItemsLoadFailed(String),
    BalanceUpdated(String),
    TransferLookupCompleted(TransferLookupResult),
    TransferLookupFailed(String),
    CreditLineCatalogLoaded(Vec<CreditLineCatalogEntry>),
    CreditLineCatalogFailed(String),
    CaseUpdated {
        case: HydratedCase,
        message: String,
        receipt_path: Option<PathBuf>,
        refresh_balance: bool,
        transfer_kind: TransferKind,
        automatic_receipt_pending: bool,
    },
}

fn format_reconcile_summary(summary: ReconcileSummary) -> String {
    format!(
        "Catalogo actualizado en memoria: {} nuevas (inhabilitadas), {} con metadatos actualizados y {} ausentes del core. Revise y guarde para aplicar.",
        summary.added, summary.updated, summary.missing
    )
}

fn preserve_busy_items(
    current_items: &[HydratedCase],
    mut loaded_items: Vec<HydratedCase>,
) -> Vec<HydratedCase> {
    let busy_items = current_items
        .iter()
        .filter(|item| item.busy)
        .map(|item| (item.request_oid().to_owned(), item.message.clone()))
        .collect::<HashMap<_, _>>();

    for item in &mut loaded_items {
        if let Some(message) = busy_items.get(item.request_oid()) {
            item.busy = true;
            item.message = message.clone();
        } else if item.busy {
            item.busy = false;
            if item.message.as_deref() == Some(TRANSFER_PROCESSING_MESSAGE) {
                item.message = None;
            }
        }
    }

    loaded_items
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_case(request_oid: &str, busy: bool, message: Option<&str>) -> HydratedCase {
        HydratedCase {
            server_validation: Default::default(),
            metamap: Default::default(),
            core: CoreSnapshot {
                request_oid: request_oid.to_owned(),
                ..Default::default()
            },
            transfer_guard: Default::default(),
            validation: Default::default(),
            busy,
            message: message.map(str::to_owned),
        }
    }

    #[test]
    fn preserve_busy_items_keeps_current_inflight_state() {
        let current_items = vec![build_case(
            "241705",
            true,
            Some(TRANSFER_PROCESSING_MESSAGE),
        )];
        let loaded_items = vec![build_case("241705", false, Some("ERROR"))];

        let merged = preserve_busy_items(&current_items, loaded_items);

        assert!(merged[0].busy);
        assert_eq!(
            merged[0].message.as_deref(),
            Some(TRANSFER_PROCESSING_MESSAGE)
        );
    }

    #[test]
    fn preserve_busy_items_clears_stale_processing_state() {
        let current_items = vec![build_case("241705", false, Some("ERROR"))];
        let loaded_items = vec![build_case(
            "241705",
            true,
            Some(TRANSFER_PROCESSING_MESSAGE),
        )];

        let merged = preserve_busy_items(&current_items, loaded_items);

        assert!(!merged[0].busy);
        assert_eq!(merged[0].message, None);
    }
}

fn compare_request_oids(left: &str, right: &str) -> std::cmp::Ordering {
    match (left.parse::<u64>(), right.parse::<u64>()) {
        (Ok(left), Ok(right)) => left.cmp(&right),
        _ => left.cmp(right),
    }
}

fn preserve_metamap_value(current: &mut MetamapSnapshot, previous: &MetamapSnapshot) {
    if current.name.trim().is_empty() && !previous.name.trim().is_empty() {
        current.name = previous.name.clone();
    }
    if current.document.is_none() {
        current.document = previous.document.clone();
    }
    if current.request_number.is_none() {
        current.request_number = previous.request_number.clone();
    }
    if current.amount_raw.is_none() {
        current.amount_raw = previous.amount_raw.clone();
    }
    if current.amount.is_none() {
        current.amount = previous.amount;
    }
}

fn display_credit_line(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("N/D")
        .to_owned()
}

fn build_transfer_lookup_summary_fields(
    response: &TransferLookupResponse,
) -> Vec<(String, String)> {
    let root = response.body.get("response").unwrap_or(&response.body);
    let mut fields = vec![
        ("Solicitud".to_owned(), response.request_number.clone()),
        ("idTrxCliente".to_owned(), response.id_trx_cliente.clone()),
    ];

    for (label, key) in [
        ("Id banco", "id"),
        ("Id trx original", "idTrxOriginal"),
        ("Tipo", "tipo"),
        ("Fecha y hora", "fechaHora"),
        ("Cuit debito", "cuitDebito"),
        ("Cuenta debito", "cuentaDebito"),
        ("Cuit credito", "cuitCredito"),
        ("Cuenta credito", "cuentaCredito"),
        ("Importe", "importe"),
        ("Concepto", "concepto"),
        ("Estado", "estado"),
        ("Descripcion", "descripcionTrx"),
        ("Id anulacion", "idAnulacion"),
    ] {
        if let Some(value) = root.get(key).and_then(value_to_display) {
            fields.push((label.to_owned(), value));
        }
    }

    fields
}

fn value_to_display(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.trim().to_owned()).filter(|text| !text.is_empty()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => Some(value.to_string()),
    }
}
