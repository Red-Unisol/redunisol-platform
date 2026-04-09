use std::{
    fs::{self, File},
    io::BufWriter,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use chrono::Local;
use printpdf::{BuiltinFont, Mm, PdfDocument};

use crate::{models::HydratedCase, validation::format_money};

pub fn write_receipt(
    receipts_dir: &Path,
    operator_name: &str,
    case: &HydratedCase,
    external_transfer_id: &str,
) -> Result<PathBuf> {
    fs::create_dir_all(receipts_dir)
        .with_context(|| format!("No se pudo crear la carpeta {:?}", receipts_dir))?;

    let timestamp = Local::now();
    let file_name = format!(
        "{}-{}-{}.pdf",
        sanitize_filename(case.request_oid()),
        sanitize_filename(case.display_name().as_str()),
        timestamp.format("%Y%m%d-%H%M%S"),
    );
    let receipt_path = receipts_dir.join(file_name);

    let (document, page, layer) =
        PdfDocument::new("Comprobante Transferencia", Mm(210.0), Mm(297.0), "Capa 1");
    let current_layer = document.get_page(page).get_layer(layer);
    let font = document
        .add_builtin_font(BuiltinFont::Helvetica)
        .context("No se pudo cargar la fuente PDF builtin.")?;
    let amount = case
        .metamap
        .amount
        .map(format_money)
        .or_else(|| case.metamap.amount_raw.clone())
        .unwrap_or_else(|| "N/D".to_owned());
    let lines = [
        "Comprobante de transferencia",
        "",
        &format!("Fecha: {}", timestamp.format("%Y-%m-%d %H:%M:%S")),
        &format!("Operador: {operator_name}"),
        &format!("Solicitud: {}", case.request_oid()),
        &format!(
            "Verification ID: {}",
            case.server_validation
                .verification_id
                .as_deref()
                .unwrap_or("N/D")
        ),
        &format!("Titular: {}", case.display_name()),
        &format!("Documento: {}", case.document_display()),
        &format!(
            "CBU destino: {}",
            case.core.transfer_cbu.as_deref().unwrap_or("N/D")
        ),
        &format!("Importe: {amount}"),
        &format!("External transfer ID: {external_transfer_id}"),
        "",
        "Documento generado por transferencias-celesol (Rust MVP).",
    ];

    let mut current_y = 275.0;
    for line in lines {
        current_layer.use_text(line, 12.0, Mm(20.0), Mm(current_y), &font);
        current_y -= if line.is_empty() { 8.0 } else { 10.0 };
    }

    document
        .save(&mut BufWriter::new(
            File::create(&receipt_path)
                .with_context(|| format!("No se pudo crear {:?}", receipt_path))?,
        ))
        .with_context(|| format!("No se pudo escribir {:?}", receipt_path))?;
    Ok(receipt_path)
}

fn sanitize_filename(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ' ')
        })
        .collect();
    let cleaned = cleaned.trim().replace(' ', "_");
    if cleaned.is_empty() {
        "comprobante".to_owned()
    } else {
        cleaned
    }
}
