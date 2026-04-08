use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Arc,
        mpsc::{self, Receiver, Sender},
    },
    thread,
    time::Instant,
};

use anyhow::Result;
use chrono::Local;
use eframe::egui::{self, Color32, RichText};
use egui_extras::{Column, TableBuilder};

use crate::{
    coinag_client::CoinagClient,
    config::AppConfig,
    core_client::CoreClient,
    metamap_client::MetamapClient,
    models::{HydratedCase, ServerCase},
    receipt,
    server_client::ServerClient,
    validation,
};

pub struct TransferenciasApp {
    services: Arc<AppServices>,
    items: Vec<HydratedCase>,
    event_tx: Sender<WorkerEvent>,
    event_rx: Receiver<WorkerEvent>,
    queue_loading: bool,
    refresh_loading: bool,
    next_poll_at: Instant,
    notices: Vec<String>,
}

impl TransferenciasApp {
    pub fn new(config: AppConfig) -> Result<Self> {
        let services = Arc::new(AppServices::new(config)?);
        let (event_tx, event_rx) = mpsc::channel();
        let mut app = Self {
            next_poll_at: Instant::now(),
            items: Vec::new(),
            services,
            event_tx,
            event_rx,
            queue_loading: false,
            refresh_loading: false,
            notices: Vec::new(),
        };
        app.spawn_queue_poll();
        Ok(app)
    }

    fn spawn_queue_poll(&mut self) {
        if self.queue_loading {
            return;
        }
        self.queue_loading = true;
        let services = Arc::clone(&self.services);
        let sender = self.event_tx.clone();
        let existing_items = self.items.clone();
        thread::spawn(move || match services.load_queue(existing_items) {
            Ok(items) => {
                let _ = sender.send(WorkerEvent::QueueLoaded(items));
            }
            Err(error) => {
                let _ = sender.send(WorkerEvent::QueueLoadFailed(error.to_string()));
            }
        });
    }

    fn spawn_core_refresh(&mut self) {
        if self.refresh_loading || self.items.is_empty() {
            return;
        }
        self.refresh_loading = true;
        let services = Arc::clone(&self.services);
        let sender = self.event_tx.clone();
        let current_items = self.items.clone();
        thread::spawn(move || {
            let items = services.refresh_cases(current_items);
            let _ = sender.send(WorkerEvent::CoreRefreshed(items));
        });
    }

    fn spawn_transfer(&mut self, case_id: String) {
        let Some(position) = self.items.iter().position(|item| item.case_id == case_id) else {
            return;
        };
        if self.items[position].busy {
            return;
        }
        self.items[position].busy = true;
        self.items[position].message = Some("Procesando transferencia...".to_owned());
        let item = self.items[position].clone();
        let services = Arc::clone(&self.services);
        let sender = self.event_tx.clone();
        thread::spawn(move || {
            let result = services.execute_transfer(item);
            let _ = sender.send(result);
        });
    }

    fn process_worker_events(&mut self) {
        while let Ok(event) = self.event_rx.try_recv() {
            match event {
                WorkerEvent::QueueLoaded(items) => {
                    self.queue_loading = false;
                    self.items = items;
                    self.next_poll_at = Instant::now() + self.services.poll_interval;
                    self.push_notice("Cola actualizada desde el server.");
                }
                WorkerEvent::QueueLoadFailed(error) => {
                    self.queue_loading = false;
                    self.next_poll_at = Instant::now() + self.services.poll_interval;
                    self.push_notice(format!("Error al consultar la cola: {error}"));
                }
                WorkerEvent::CoreRefreshed(items) => {
                    self.refresh_loading = false;
                    self.items = items;
                    self.push_notice(
                        "Refresco manual completado desde el core financiero.".to_owned(),
                    );
                }
                WorkerEvent::CaseUpdated(case, message) => {
                    if let Some(existing) = self
                        .items
                        .iter_mut()
                        .find(|item| item.case_id == case.case_id)
                    {
                        *existing = case;
                    } else {
                        self.items.push(case);
                    }
                    self.push_notice(message);
                }
                WorkerEvent::CaseRemoved {
                    case_id,
                    message,
                    receipt_path,
                } => {
                    self.items.retain(|item| item.case_id != case_id);
                    if let Some(receipt_path) = receipt_path {
                        self.push_notice(format!(
                            "{message} Comprobante: {}",
                            receipt_path.display()
                        ));
                    } else {
                        self.push_notice(message);
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
        if !self.queue_loading && Instant::now() >= self.next_poll_at {
            self.spawn_queue_poll();
        }

        let mut case_to_transfer = None;

        egui::TopBottomPanel::top("toolbar").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.heading("Transferencias Celesol");
                ui.separator();
                ui.label(format!(
                    "Cola: {}",
                    if self.queue_loading {
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
                if ui
                    .add_enabled(!self.queue_loading, egui::Button::new("Recargar cola"))
                    .clicked()
                {
                    self.spawn_queue_poll();
                }
                if ui
                    .add_enabled(
                        !self.refresh_loading && !self.items.is_empty(),
                        egui::Button::new("Refrescar core"),
                    )
                    .clicked()
                {
                    self.spawn_core_refresh();
                }
            });
        });

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
            if self.items.is_empty() {
                ui.add_space(32.0);
                ui.vertical_centered(|ui| {
                    ui.label("No hay casos pendientes en la cola de transferencias.");
                });
                return;
            }

            let table = TableBuilder::new(ui)
                .striped(true)
                .resizable(true)
                .column(Column::initial(150.0).at_least(120.0))
                .column(Column::initial(90.0))
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
                    for item in &self.items {
                        body.row(62.0, |mut row| {
                            row.col(|ui| {
                                ui.vertical(|ui| {
                                    ui.label(&item.metamap.name);
                                    if let Some(message) = &item.message {
                                        ui.small(RichText::new(message).color(Color32::GRAY));
                                    }
                                });
                            });
                            row.col(|ui| {
                                ui.label(item.metamap.document.as_deref().unwrap_or("N/D"));
                            });
                            row.col(|ui| {
                                ui.label(item.metamap.request_number.as_deref().unwrap_or("N/D"));
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
                                let color = if item.validation.can_transfer() {
                                    Color32::from_rgb(24, 120, 52)
                                } else {
                                    Color32::from_rgb(170, 30, 30)
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
                                    case_to_transfer = Some(item.case_id.clone());
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

        if let Some(case_id) = case_to_transfer {
            self.spawn_transfer(case_id);
        }

        ctx.request_repaint_after(std::time::Duration::from_millis(250));
    }
}

#[derive(Clone)]
struct AppServices {
    server: ServerClient,
    metamap: MetamapClient,
    core: CoreClient,
    coinag: Option<CoinagClient>,
    operator_name: String,
    poll_interval: std::time::Duration,
    receipts_dir: PathBuf,
}

impl AppServices {
    fn new(config: AppConfig) -> Result<Self> {
        let server = ServerClient::new(&config.server, config.request_timeout)?;
        let metamap = MetamapClient::new(&config.metamap, config.request_timeout)?;
        let core = CoreClient::new(&config.core, config.request_timeout)?;
        let coinag = if config.coinag.is_complete() {
            Some(CoinagClient::new(&config.coinag, config.request_timeout)?)
        } else {
            None
        };
        Ok(Self {
            server,
            metamap,
            core,
            coinag,
            operator_name: config.operator_name,
            poll_interval: config.poll_interval,
            receipts_dir: config.receipts_dir,
        })
    }

    fn transfer_enabled(&self) -> bool {
        self.coinag.is_some()
    }

    fn load_queue(&self, existing_items: Vec<HydratedCase>) -> Result<Vec<HydratedCase>> {
        let queue = self.server.list_transfer_queue()?;
        let existing_map = existing_items
            .into_iter()
            .map(|item| (item.case_id.clone(), item))
            .collect::<HashMap<_, _>>();

        let mut hydrated = Vec::new();
        for server_case in queue.cases {
            if let Some(mut existing) = existing_map.get(&server_case.case_id).cloned() {
                existing.current_stage = server_case.current_stage.clone();
                if let Some(resource_url) = server_case.resource_url.clone() {
                    existing.resource_url = resource_url;
                }
                hydrated.push(existing);
                continue;
            }
            hydrated.push(self.hydrate_case(&server_case));
        }
        hydrated.sort_by_key(|item| {
            item.metamap
                .request_number
                .clone()
                .unwrap_or_else(|| item.case_id.clone())
        });
        Ok(hydrated)
    }

    fn refresh_cases(&self, cases: Vec<HydratedCase>) -> Vec<HydratedCase> {
        let mut refreshed = cases
            .into_iter()
            .map(|case| self.refresh_case(&case))
            .collect::<Vec<_>>();
        refreshed.sort_by_key(|item| {
            item.metamap
                .request_number
                .clone()
                .unwrap_or_else(|| item.case_id.clone())
        });
        refreshed
    }

    fn hydrate_case(&self, server_case: &ServerCase) -> HydratedCase {
        let resource_url = server_case.resource_url.clone().unwrap_or_default();
        let mut case = HydratedCase {
            case_id: server_case.case_id.clone(),
            verification_id: server_case.verification_id.clone(),
            current_stage: server_case.current_stage.clone(),
            resource_url: resource_url.clone(),
            metamap: Default::default(),
            core: Default::default(),
            validation: Default::default(),
            busy: false,
            message: None,
        };

        if resource_url.is_empty() {
            case.validation
                .blockers
                .push("El server no entrego resource_url para hidratar el caso.".to_owned());
            return case;
        }

        match self.metamap.fetch_snapshot(&resource_url) {
            Ok(snapshot) => {
                case.metamap = snapshot;
                self.apply_core_snapshot(&mut case);
            }
            Err(error) => {
                case.message = Some(error.to_string());
                case.validation
                    .blockers
                    .push(format!("No se pudo leer MetaMap: {error}"));
            }
        }

        case
    }

    fn refresh_case(&self, case: &HydratedCase) -> HydratedCase {
        let mut refreshed = case.clone();
        refreshed.busy = false;
        refreshed.message = None;
        self.apply_core_snapshot(&mut refreshed);
        refreshed
    }

    fn apply_core_snapshot(&self, case: &mut HydratedCase) {
        let mut runtime_errors = Vec::new();
        match self.core.fetch_core_snapshot(
            case.metamap.request_number.as_deref(),
            case.metamap.document.as_deref(),
        ) {
            Ok(mut core_snapshot) => {
                core_snapshot.refreshed_label = Some(Local::now().format("%H:%M:%S").to_string());
                if let Some(cbu) = core_snapshot.transfer_cbu.clone() {
                    if let Some(coinag) = &self.coinag {
                        match coinag.lookup_cbu_cuil(&cbu) {
                            Ok(cuil) => {
                                core_snapshot.coinag_cuil = Some(cuil);
                            }
                            Err(error) => runtime_errors.push(error.to_string()),
                        }
                    }
                }
                case.core = core_snapshot;
            }
            Err(error) => {
                runtime_errors.push(format!("No se pudo consultar el core financiero: {error}"))
            }
        }

        case.validation = validation::build_validation_report(&case.metamap, &case.core);
        case.validation.blockers.extend(runtime_errors.clone());
        if !runtime_errors.is_empty() {
            case.message = Some(runtime_errors.join(" | "));
        }
    }

    fn execute_transfer(&self, case: HydratedCase) -> WorkerEvent {
        let Some(coinag) = &self.coinag else {
            let mut updated = case.clone();
            updated.busy = false;
            updated.message = Some("Coinag no esta configurado en este runtime.".to_owned());
            return WorkerEvent::CaseUpdated(
                updated,
                "Transferencia bloqueada: Coinag no esta configurado.".to_owned(),
            );
        };

        let refreshed = self.refresh_case(&case);
        if !refreshed.validation.can_transfer() {
            return WorkerEvent::CaseUpdated(
                refreshed,
                format!(
                    "Transferencia bloqueada para {} por validaciones.",
                    case.case_id
                ),
            );
        }

        let lock = match self
            .server
            .initiate_transfer(&refreshed.case_id, &self.operator_name)
        {
            Ok(lock) => lock,
            Err(error) => {
                let mut updated = refreshed;
                updated.busy = false;
                updated.message = Some(error.to_string());
                return WorkerEvent::CaseUpdated(
                    updated,
                    format!("No se pudo tomar lock para {}: {error}", case.case_id),
                );
            }
        };

        if !lock.action_applied {
            return WorkerEvent::CaseRemoved {
                case_id: case.case_id.clone(),
                message: format!(
                    "El case {} ya no estaba disponible para transferir (stage actual: {}).",
                    case.case_id, lock.case.current_stage
                ),
                receipt_path: None,
            };
        }

        let transfer_payload = match coinag.build_transfer_payload(&refreshed) {
            Ok(payload) => payload,
            Err(error) => {
                return WorkerEvent::CaseRemoved {
                    case_id: case.case_id.clone(),
                    message: format!(
                        "El case {} quedo bloqueado en transfer_initiated: {}",
                        case.case_id, error
                    ),
                    receipt_path: None,
                };
            }
        };

        let transfer_response = match coinag.perform_transfer(&transfer_payload) {
            Ok(response) => response,
            Err(error) => {
                return WorkerEvent::CaseRemoved {
                    case_id: case.case_id.clone(),
                    message: format!(
                        "Coinag fallo despues del lock para {}: {}. Requiere revision manual.",
                        case.case_id, error
                    ),
                    receipt_path: None,
                };
            }
        };

        let external_transfer_id = match CoinagClient::extract_external_transfer_id(
            &transfer_response,
        ) {
            Some(external_transfer_id) => external_transfer_id,
            None => {
                return WorkerEvent::CaseRemoved {
                    case_id: case.case_id.clone(),
                    message: format!(
                        "Coinag respondio sin external_transfer_id para {}. Requiere revision manual.",
                        case.case_id
                    ),
                    receipt_path: None,
                };
            }
        };

        let receipt_path = receipt::write_receipt(
            &self.receipts_dir,
            &self.operator_name,
            &refreshed,
            &external_transfer_id,
        )
        .ok();

        if let Err(error) = self.server.mark_transfer_submitted(
            &refreshed.case_id,
            &self.operator_name,
            &external_transfer_id,
        ) {
            return WorkerEvent::CaseRemoved {
                case_id: case.case_id.clone(),
                message: format!(
                    "La transferencia de {} fue enviada a Coinag ({external_transfer_id}) pero no se pudo informar al server: {}. Requiere revision manual.",
                    case.case_id, error
                ),
                receipt_path,
            };
        }

        WorkerEvent::CaseRemoved {
            case_id: case.case_id.clone(),
            message: format!(
                "Transferencia enviada para {} con external_transfer_id {}.",
                case.case_id, external_transfer_id
            ),
            receipt_path,
        }
    }
}

enum WorkerEvent {
    QueueLoaded(Vec<HydratedCase>),
    QueueLoadFailed(String),
    CoreRefreshed(Vec<HydratedCase>),
    CaseUpdated(HydratedCase, String),
    CaseRemoved {
        case_id: String,
        message: String,
        receipt_path: Option<PathBuf>,
    },
}
