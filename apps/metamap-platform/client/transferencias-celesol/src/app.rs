use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        Arc,
        mpsc::{self, Receiver, Sender},
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::Result;
use chrono::Local;
use eframe::egui::{self, Color32, Key, RichText, TextEdit};
use egui_extras::{Column, TableBuilder};
use serde_json::Value;

use crate::{
    APP_NAME_WITH_TAG,
    coinag_client::{CoinagClient, TransferLookupResponse},
    config::AppConfig,
    core_client::CoreClient,
    models::{CoinagTransferGuard, CoreSnapshot, HydratedCase, MetamapSnapshot, ValidationReport},
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
}

const BALANCE_POLL_INTERVAL: Duration = Duration::from_secs(60);
const TRANSFER_PROCESSING_MESSAGE: &str = "Procesando transferencia...";

impl TransferenciasApp {
    pub fn new(config: AppConfig) -> Result<Self> {
        let services = Arc::new(AppServices::new(config)?);
        let (event_tx, event_rx) = mpsc::channel();
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
            notices: Vec::new(),
            show_disabled_lines: false,
            pending_transfer_confirmation: None,
            transfer_lookup: TransferLookupDialog::default(),
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
        log::info!("Iniciando transferencia para solicitud {}.", request_oid);
        self.items[position].busy = true;
        self.items[position].message = Some(TRANSFER_PROCESSING_MESSAGE.to_owned());
        let item = self.items[position].clone();
        let services = Arc::clone(&self.services);
        let sender = self.event_tx.clone();
        thread::spawn(move || {
            let result = services.execute_transfer(item);
            let _ = sender.send(result);
        });
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
                let submit = response.lost_focus() && ui.input(|input| input.key_pressed(Key::Enter));

                ui.add_space(8.0);
                ui.horizontal(|ui| {
                    let button =
                        ui.add_enabled(can_lookup, egui::Button::new("Consultar"));
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

    fn process_worker_events(&mut self) {
        while let Ok(event) = self.event_rx.try_recv() {
            match event {
                WorkerEvent::ItemsLoaded(items) => {
                    self.items_loading = false;
                    log::info!("Polling completado. items_cargados={}.", items.len());
                    self.items = preserve_busy_items(&self.items, items);
                    self.next_poll_at = Instant::now() + self.services.poll_interval;
                    self.push_notice("Lista actualizada desde el core financiero.");
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
                WorkerEvent::CaseUpdated {
                    case,
                    message,
                    receipt_path,
                    refresh_balance,
                } => {
                    log::debug!("Caso actualizado para solicitud {}.", case.request_oid());
                    if let Some(existing) = self
                        .items
                        .iter_mut()
                        .find(|item| item.request_oid() == case.request_oid())
                    {
                        *existing = case;
                    } else {
                        self.items.push(case);
                    }
                    if let Some(receipt_path) = receipt_path {
                        self.push_notice(format!(
                            "{message} Comprobante: {}",
                            receipt_path.display()
                        ));
                    } else {
                        self.push_notice(message);
                    }
                    if refresh_balance {
                        self.spawn_balance_poll("post-transferencia");
                    }
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
                    lookup_button
                        .on_hover_text("Coinag no esta configurado en este runtime.");
                }
                ui.checkbox(&mut self.show_disabled_lines, "Mostrar deshabilitadas");
            });
        });

        self.render_transfer_lookup_window(ctx);

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
                                ui.label(item.core.request_status.as_deref().unwrap_or("N/D"));
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

impl TransferConfirmation {
    fn for_case(item: &HydratedCase) -> Self {
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
                ("MONTO".to_owned(), item.amount_display()),
                ("CBU".to_owned(), item.cbu_display()),
            ],
            warning_message: if item.server_validation.has_completed_validation() {
                None
            } else {
                Some(
                    "Advertencia: no existe validacion MetaMap completed asociada en el server."
                        .to_owned(),
                )
            },
        }
    }
}

#[derive(Clone)]
struct AppServices {
    server: ServerClient,
    core: CoreClient,
    coinag: Option<CoinagClient>,
    enabled_credit_lines: EnabledCreditLines,
    operator_name: String,
    poll_interval: std::time::Duration,
    receipts_dir: PathBuf,
}

#[derive(Clone)]
struct EnabledCreditLines {
    path: PathBuf,
    values: Arc<HashSet<String>>,
}

impl EnabledCreditLines {
    fn new(path: PathBuf, values: Vec<String>) -> Self {
        let values = values
            .into_iter()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .collect::<HashSet<_>>();
        Self {
            path,
            values: Arc::new(values),
        }
    }

    fn is_enabled(&self, line: Option<&str>) -> bool {
        let Some(line) = line.map(str::trim).filter(|line| !line.is_empty()) else {
            return false;
        };
        self.values.contains(line)
    }

    fn len(&self) -> usize {
        self.values.len()
    }
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
        let coinag = if config.coinag.is_complete() {
            Some(CoinagClient::new(&config.coinag, config.request_timeout)?)
        } else {
            None
        };
        let enabled_credit_lines = EnabledCreditLines::new(
            config.enabled_credit_lines.path,
            config.enabled_credit_lines.values,
        );
        let services = Self {
            server,
            core,
            coinag,
            enabled_credit_lines,
            operator_name: config.operator_name,
            poll_interval: config.poll_interval,
            receipts_dir: config.receipts_dir,
        };
        log::info!(
            "Servicios listos. transfer_enabled={}. lineas_habilitadas={} path={:?}.",
            services.transfer_enabled(),
            services.enabled_credit_lines.len(),
            services.enabled_credit_lines.path
        );
        Ok(services)
    }

    fn transfer_enabled(&self) -> bool {
        self.coinag.is_some()
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

    fn lookup_transfer_by_request_number(&self, request_number: &str) -> Result<TransferLookupResult> {
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
                .enabled_credit_lines
                .is_enabled(core_snapshot.credit_line_description.as_deref())
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
            .enabled_credit_lines
            .is_enabled(refreshed.core.credit_line_description.as_deref())
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
                }
            }
        } else {
            case.core.document_cuil = None;
            case.core.coinag_cuil = None;
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

        if case.core.coinag_cuil.is_none() {
            if let Some(cbu) = case.core.transfer_cbu.clone() {
                if let Some(coinag) = &self.coinag {
                    match coinag.lookup_cbu_cuil(&cbu) {
                        Ok(cuil) => {
                            case.core.coinag_cuil = Some(cuil);
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
            "Solicitud {} marcada como deshabilitada por línea {:?}.",
            case.request_oid(),
            case.core.credit_line_description
        );
    }

    fn execute_transfer(&self, case: HydratedCase) -> WorkerEvent {
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
            };
        };

        let refreshed = self.refresh_case(&case);
        if !refreshed.validation.can_transfer() {
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
                };
            }
        };

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
                };
            }
        };

        let is_smoke = coinag.transfer_is_smoke();
        let smoke_output_path = transfer_response
            .get("smoke_output_path")
            .and_then(|value| value.as_str())
            .map(str::to_owned);
        let external_transfer_id = CoinagClient::extract_external_transfer_id(&transfer_response);
        let receipt_path = receipt::write_receipt(
            &self.receipts_dir,
            &self.operator_name,
            &refreshed,
            external_transfer_id
                .as_deref()
                .unwrap_or("SIN_EXTERNAL_TRANSFER_ID"),
        )
        .ok();

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
                receipt_path,
                refresh_balance: true,
            };
        }
        updated.transfer_guard = CoinagTransferGuard::EnProceso;

        updated.validation = validation::build_validation_report(
            &updated.server_validation,
            &updated.metamap,
            &updated.core,
            &updated.transfer_guard,
        );
        updated.message = Some("EN PROCESO".to_owned());

        let message = if let Some(external_transfer_id) = external_transfer_id.as_deref() {
            log::info!(
                "Transferencia exitosa para solicitud {} con external_transfer_id {}.",
                case.request_oid(),
                external_transfer_id
            );
            format!(
                "Transferencia enviada para solicitud {} con external_transfer_id {}.",
                case.request_oid(),
                external_transfer_id
            )
        } else {
            log::info!(
                "Transferencia exitosa para solicitud {} sin external_transfer_id.",
                case.request_oid()
            );
            format!(
                "Transferencia enviada para solicitud {} sin external_transfer_id en la respuesta de Coinag.",
                case.request_oid()
            )
        };

        WorkerEvent::CaseUpdated {
            case: updated,
            message,
            receipt_path,
            refresh_balance: true,
        }
    }
}

enum WorkerEvent {
    ItemsLoaded(Vec<HydratedCase>),
    ItemsLoadFailed(String),
    BalanceUpdated(String),
    TransferLookupCompleted(TransferLookupResult),
    TransferLookupFailed(String),
    CaseUpdated {
        case: HydratedCase,
        message: String,
        receipt_path: Option<PathBuf>,
        refresh_balance: bool,
    },
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
        assert_eq!(merged[0].message.as_deref(), Some(TRANSFER_PROCESSING_MESSAGE));
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

fn build_transfer_lookup_summary_fields(response: &TransferLookupResponse) -> Vec<(String, String)> {
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
