use transferencias_celesol::{app::TransferenciasApp, config::AppConfig, logging};

fn main() -> eframe::Result<()> {
    if let Err(error) = logging::init_logging() {
        eprintln!("No se pudo inicializar logging: {error}");
    }
    let config = match AppConfig::load() {
        Ok(config) => config,
        Err(error) => {
            log::error!("Error de configuracion: {error:#}");
            eprintln!("Error de configuracion: {error}");
            std::process::exit(1);
        }
    };

    let app = match TransferenciasApp::new(config) {
        Ok(app) => app,
        Err(error) => {
            log::error!("No se pudo iniciar la app: {error:#}");
            eprintln!("No se pudo iniciar la app: {error}");
            std::process::exit(1);
        }
    };

    let native_options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("Transferencias Celesol")
            .with_inner_size([1500.0, 920.0])
            .with_min_inner_size([1200.0, 700.0]),
        ..Default::default()
    };

    eframe::run_native(
        "Transferencias Celesol",
        native_options,
        Box::new(move |_creation_context| Ok(Box::new(app))),
    )
}
