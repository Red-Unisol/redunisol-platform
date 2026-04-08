use transferencias_celesol::{app::TransferenciasApp, config::AppConfig};

fn main() -> eframe::Result<()> {
    env_logger::init();
    let config = match AppConfig::from_env() {
        Ok(config) => config,
        Err(error) => {
            eprintln!("Error de configuracion: {error}");
            std::process::exit(1);
        }
    };

    let app = match TransferenciasApp::new(config) {
        Ok(app) => app,
        Err(error) => {
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
