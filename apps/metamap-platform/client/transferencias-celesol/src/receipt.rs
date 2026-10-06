use std::{
    fs::{self, File},
    io::{BufWriter, Cursor},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, ensure};
use chrono::{DateTime, Local};
use printpdf::{
    BuiltinFont, Color, Greyscale, Image, ImageTransform, IndirectFontRef, Line, LineCapStyle,
    LineJoinStyle, Mm, PdfDocument, PdfLayerReference, Point, Rgb,
    image_crate::codecs::png::PngDecoder,
};

use crate::{
    cancellations::{TransferLeg, TransferLegKind},
    models::HydratedCase,
    validation::format_money,
};

const PAGE_WIDTH_MM: f32 = 210.0;
const PAGE_HEIGHT_MM: f32 = 297.0;
const FRAME_LEFT_MM: f32 = 8.0;
const FRAME_RIGHT_MM: f32 = 202.0;
const FRAME_BOTTOM_MM: f32 = 10.0;
const FRAME_TOP_MM: f32 = 286.0;
const LOGO_WIDTH_MM: f32 = 44.0;
const LOGO_BASELINE_MM: f32 = 258.0;
const TITLE_X_MM: f32 = 14.0;
const TITLE_Y_MM: f32 = 244.0;
const SUBTITLE_Y_MM: f32 = 237.0;
const DIVIDER_Y_MM: f32 = 232.0;
const LABEL_X_MM: f32 = 14.0;
const VALUE_X_MM: f32 = 55.0;
const ROW_START_Y_MM: f32 = 222.0;
const ROW_SPACING_MM: f32 = 10.0;
const TITLE_SIZE_PT: f32 = 17.0;
const SUBTITLE_SIZE_PT: f32 = 7.5;
const ROW_SIZE_PT: f32 = 9.5;
const ERROR_DETAIL_CHARS_PER_LINE: usize = 78;
const LOGO_BYTES: &[u8] = include_bytes!("../assets/receipt_logo_flat.png");

pub fn write_receipt(
    receipts_dir: &Path,
    operator_name: &str,
    case: &HydratedCase,
    external_transfer_id: &str,
) -> Result<PathBuf> {
    write_receipt_with_mode(
        receipts_dir,
        operator_name,
        case,
        external_transfer_id,
        ReceiptMode::Manual,
        None,
    )
}

pub fn write_automatic_receipt(
    receipts_dir: &Path,
    operator_name: &str,
    case: &HydratedCase,
    external_transfer_id: &str,
) -> Result<PathBuf> {
    write_receipt_with_mode(
        receipts_dir,
        operator_name,
        case,
        external_transfer_id,
        ReceiptMode::Automatic,
        None,
    )
}

pub fn write_error_receipt(
    receipts_dir: &Path,
    operator_name: &str,
    case: &HydratedCase,
    external_transfer_id: &str,
    error_detail: &str,
) -> Result<PathBuf> {
    write_receipt_with_mode(
        receipts_dir,
        operator_name,
        case,
        external_transfer_id,
        ReceiptMode::ManualError,
        Some(error_detail),
    )
}

pub fn write_automatic_error_receipt(
    receipts_dir: &Path,
    operator_name: &str,
    case: &HydratedCase,
    external_transfer_id: &str,
    error_detail: &str,
) -> Result<PathBuf> {
    write_receipt_with_mode(
        receipts_dir,
        operator_name,
        case,
        external_transfer_id,
        ReceiptMode::AutomaticError,
        Some(error_detail),
    )
}

pub fn write_cancellation_receipt(
    receipts_dir: &Path,
    operator_name: &str,
    case: &HydratedCase,
    legs: &[(TransferLeg, String)],
) -> Result<PathBuf> {
    ensure!(
        !legs.is_empty(),
        "No se puede generar un comprobante de cancelacion sin transferencias."
    );
    fs::create_dir_all(receipts_dir)
        .with_context(|| format!("No se pudo crear la carpeta {receipts_dir:?}"))?;
    let timestamp = Local::now();
    let receipt_path = receipts_dir.join(format!(
        "{}-{}-{}-cancelacion.pdf",
        sanitize_filename(case.request_oid()),
        sanitize_filename(case.display_name().as_str()),
        timestamp.format("%Y%m%d-%H%M%S"),
    ));
    let (document, page, layer) = PdfDocument::new(
        "Comprobante Transferencia",
        Mm(PAGE_WIDTH_MM),
        Mm(PAGE_HEIGHT_MM),
        "Capa 1",
    );
    let regular_font = document
        .add_builtin_font(BuiltinFont::Helvetica)
        .context("No se pudo cargar la fuente PDF Helvetica.")?;
    let bold_font = document
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .context("No se pudo cargar la fuente PDF Helvetica Bold.")?;

    for (index, (leg, transaction_id)) in legs.iter().enumerate() {
        let current_layer = if index == 0 {
            document.get_page(page).get_layer(layer)
        } else {
            let (page, layer) = document.add_page(
                Mm(PAGE_WIDTH_MM),
                Mm(PAGE_HEIGHT_MM),
                format!("Capa {}", index + 1),
            );
            document.get_page(page).get_layer(layer)
        };
        let recipient_name = cancellation_recipient_name(case, leg);
        draw_transfer_receipt_page(
            &current_layer,
            &regular_font,
            &bold_font,
            operator_name,
            case,
            transaction_id,
            ReceiptMode::Manual,
            None,
            &timestamp,
            &recipient_name,
            &leg.cuit,
            &leg.cbu,
            &format_money(leg.amount),
        )?;
    }

    document
        .save(&mut BufWriter::new(
            File::create(&receipt_path)
                .with_context(|| format!("No se pudo crear {receipt_path:?}"))?,
        ))
        .with_context(|| format!("No se pudo escribir {receipt_path:?}"))?;
    Ok(receipt_path)
}

fn cancellation_recipient_name(case: &HydratedCase, leg: &TransferLeg) -> String {
    leg.holder_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| match leg.kind {
            TransferLegKind::Member => case.display_name(),
            TransferLegKind::Creditor => "Entidad financiera".to_owned(),
        })
}

#[derive(Clone, Copy)]
enum ReceiptMode {
    Manual,
    Automatic,
    ManualError,
    AutomaticError,
}

impl ReceiptMode {
    fn is_error(self) -> bool {
        matches!(self, Self::ManualError | Self::AutomaticError)
    }

    fn title(self) -> &'static str {
        if self.is_error() {
            "Constancia de transferencia rechazada"
        } else {
            "Comprobante de transferencia"
        }
    }

    fn state(self) -> &'static str {
        if self.is_error() {
            "Transferencia rechazada"
        } else {
            "Transferencia confirmada"
        }
    }
}

fn write_receipt_with_mode(
    receipts_dir: &Path,
    operator_name: &str,
    case: &HydratedCase,
    external_transfer_id: &str,
    mode: ReceiptMode,
    error_detail: Option<&str>,
) -> Result<PathBuf> {
    fs::create_dir_all(receipts_dir)
        .with_context(|| format!("No se pudo crear la carpeta {receipts_dir:?}"))?;

    let timestamp = Local::now();
    let file_name = match mode {
        ReceiptMode::Manual => format!(
            "{}-{}-{}.pdf",
            sanitize_filename(case.request_oid()),
            sanitize_filename(case.display_name().as_str()),
            timestamp.format("%Y%m%d-%H%M%S"),
        ),
        ReceiptMode::Automatic => format!(
            "{}_solicitud-{}_importe-{}_automatico.pdf",
            timestamp.format("%Y%m%d-%H%M%S"),
            sanitize_filename(case.request_oid()),
            sanitize_filename(case.transfer_amount_display().as_str()),
        ),
        ReceiptMode::ManualError => format!(
            "{}-{}-{}-rechazada.pdf",
            sanitize_filename(case.request_oid()),
            sanitize_filename(case.display_name().as_str()),
            timestamp.format("%Y%m%d-%H%M%S"),
        ),
        ReceiptMode::AutomaticError => format!(
            "{}_solicitud-{}_importe-{}_automatico-rechazada.pdf",
            timestamp.format("%Y%m%d-%H%M%S"),
            sanitize_filename(case.request_oid()),
            sanitize_filename(case.transfer_amount_display().as_str()),
        ),
    };
    let receipt_path = receipts_dir.join(file_name);

    let (document, page, layer) = PdfDocument::new(
        "Comprobante Transferencia",
        Mm(PAGE_WIDTH_MM),
        Mm(PAGE_HEIGHT_MM),
        "Capa 1",
    );
    let current_layer = document.get_page(page).get_layer(layer);
    let regular_font = document
        .add_builtin_font(BuiltinFont::Helvetica)
        .context("No se pudo cargar la fuente PDF Helvetica.")?;
    let bold_font = document
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .context("No se pudo cargar la fuente PDF Helvetica Bold.")?;

    let recipient_name = case.display_name();
    let recipient_document = case.document_display();
    let cbu = case.core.transfer_cbu.as_deref().unwrap_or("N/D");
    let amount = case.transfer_amount_display();
    draw_transfer_receipt_page(
        &current_layer,
        &regular_font,
        &bold_font,
        operator_name,
        case,
        external_transfer_id,
        mode,
        error_detail,
        &timestamp,
        &recipient_name,
        &recipient_document,
        cbu,
        &amount,
    )?;

    document
        .save(&mut BufWriter::new(
            File::create(&receipt_path)
                .with_context(|| format!("No se pudo crear {receipt_path:?}"))?,
        ))
        .with_context(|| format!("No se pudo escribir {receipt_path:?}"))?;
    Ok(receipt_path)
}

#[allow(clippy::too_many_arguments)]
fn draw_transfer_receipt_page(
    current_layer: &PdfLayerReference,
    regular_font: &IndirectFontRef,
    bold_font: &IndirectFontRef,
    operator_name: &str,
    case: &HydratedCase,
    external_transfer_id: &str,
    mode: ReceiptMode,
    error_detail: Option<&str>,
    timestamp: &DateTime<Local>,
    recipient_name: &str,
    recipient_document: &str,
    cbu: &str,
    amount: &str,
) -> Result<()> {
    draw_frame(current_layer);
    draw_logo(current_layer)?;

    write_text(
        current_layer,
        bold_font,
        mode.title(),
        TITLE_SIZE_PT,
        TITLE_X_MM,
        TITLE_Y_MM,
        rgb(33, 37, 41),
    );
    write_text(
        current_layer,
        regular_font,
        "Generado por Celesol Transferencias",
        SUBTITLE_SIZE_PT,
        TITLE_X_MM,
        SUBTITLE_Y_MM,
        rgb(141, 145, 153),
    );
    draw_divider(current_layer, DIVIDER_Y_MM);

    let mut rows = vec![
        (
            "N° de transacción".to_owned(),
            external_transfer_id.to_owned(),
        ),
        ("Tipo de transferencia".to_owned(), "Inmediata".to_owned()),
        (
            "Fecha de carga".to_owned(),
            timestamp.format("%d/%m/%Y").to_string(),
        ),
        (
            "Fecha y hora de emisión".to_owned(),
            timestamp.format("%d/%m/%Y %H:%M").to_string(),
        ),
        ("Operador".to_owned(), operator_name.to_owned()),
        ("Solicitud".to_owned(), case.request_oid().to_owned()),
        (
            "Verification ID".to_owned(),
            case.server_validation
                .verification_id
                .as_deref()
                .unwrap_or("N/D")
                .to_owned(),
        ),
        ("Solicitante".to_owned(), recipient_name.to_owned()),
        ("Documento".to_owned(), recipient_document.to_owned()),
        ("CBU/CVU".to_owned(), cbu.to_owned()),
        ("Importe".to_owned(), amount.to_owned()),
        ("Estado".to_owned(), mode.state().to_owned()),
    ];
    if let Some(error_detail) = error_detail.filter(|detail| !detail.trim().is_empty()) {
        for (index, line) in wrap_detail(error_detail, ERROR_DETAIL_CHARS_PER_LINE)
            .into_iter()
            .enumerate()
        {
            rows.push((
                if index == 0 {
                    "Detalle".to_owned()
                } else {
                    String::new()
                },
                line,
            ));
        }
    }

    let mut current_y = ROW_START_Y_MM;
    for (label, value) in rows {
        write_text(
            current_layer,
            bold_font,
            &label,
            ROW_SIZE_PT,
            LABEL_X_MM,
            current_y,
            rgb(71, 75, 82),
        );
        write_text(
            current_layer,
            regular_font,
            &value,
            ROW_SIZE_PT,
            VALUE_X_MM,
            current_y,
            rgb(33, 37, 41),
        );
        current_y -= ROW_SPACING_MM;
    }

    Ok(())
}

fn draw_frame(layer: &printpdf::PdfLayerReference) {
    layer.set_outline_color(Color::Greyscale(Greyscale::new(0.82, None)));
    layer.set_outline_thickness(0.7);
    layer.set_line_cap_style(LineCapStyle::Round);
    layer.set_line_join_style(LineJoinStyle::Round);
    layer.add_line(Line {
        points: vec![
            (Point::new(Mm(FRAME_LEFT_MM), Mm(FRAME_BOTTOM_MM)), false),
            (Point::new(Mm(FRAME_LEFT_MM), Mm(FRAME_TOP_MM)), false),
            (Point::new(Mm(FRAME_RIGHT_MM), Mm(FRAME_TOP_MM)), false),
            (Point::new(Mm(FRAME_RIGHT_MM), Mm(FRAME_BOTTOM_MM)), false),
        ],
        is_closed: true,
    });
}

fn draw_logo(layer: &printpdf::PdfLayerReference) -> Result<()> {
    let mut logo_reader = Cursor::new(LOGO_BYTES);
    let decoder =
        PngDecoder::new(&mut logo_reader).context("No se pudo decodificar el logo PNG.")?;
    let image = Image::try_from(decoder).context("No se pudo cargar el logo en el PDF.")?;
    let scale = LOGO_WIDTH_MM / ((image.image.width.0 as f32) * 25.4 / 300.0);
    let translate_x = (PAGE_WIDTH_MM - LOGO_WIDTH_MM) / 2.0;
    image.add_to_layer(
        layer.clone(),
        ImageTransform {
            translate_x: Some(Mm(translate_x)),
            translate_y: Some(Mm(LOGO_BASELINE_MM)),
            scale_x: Some(scale),
            scale_y: Some(scale),
            dpi: Some(300.0),
            ..Default::default()
        },
    );
    Ok(())
}

fn draw_divider(layer: &printpdf::PdfLayerReference, y_mm: f32) {
    layer.set_outline_color(Color::Greyscale(Greyscale::new(0.86, None)));
    layer.set_outline_thickness(0.4);
    layer.add_line(Line {
        points: vec![
            (Point::new(Mm(TITLE_X_MM), Mm(y_mm)), false),
            (Point::new(Mm(FRAME_RIGHT_MM - 8.0), Mm(y_mm)), false),
        ],
        is_closed: false,
    });
}

fn write_text(
    layer: &printpdf::PdfLayerReference,
    font: &printpdf::IndirectFontRef,
    text: &str,
    size_pt: f32,
    x_mm: f32,
    y_mm: f32,
    color: Color,
) {
    layer.set_fill_color(color);
    layer.use_text(text, size_pt, Mm(x_mm), Mm(y_mm), font);
}

fn rgb(red: u8, green: u8, blue: u8) -> Color {
    Color::Rgb(Rgb::new(
        red as f32 / 255.0,
        green as f32 / 255.0,
        blue as f32 / 255.0,
        None,
    ))
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

fn wrap_detail(value: &str, max_chars: usize) -> Vec<String> {
    let max_chars = max_chars.max(20);
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in value.split_whitespace() {
        if current.is_empty() {
            current.push_str(word);
            continue;
        }
        if current.len() + 1 + word.len() > max_chars {
            lines.push(current);
            current = word.to_owned();
        } else {
            current.push(' ');
            current.push_str(word);
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        vec![value.trim().to_owned()]
    } else {
        lines
    }
}

#[cfg(test)]
mod tests {
    use rust_decimal::Decimal;
    use uuid::Uuid;

    use super::*;
    use crate::models::{
        CoinagTransferGuard, CoreSnapshot, MetamapSnapshot, ValidationReport, ValidationSnapshot,
    };

    #[test]
    fn cancellation_receipt_contains_one_standard_transfer_page_per_leg() {
        let temp_dir = std::env::temp_dir().join(format!("celesol-receipt-{}", Uuid::new_v4()));
        let case = HydratedCase {
            server_validation: ValidationSnapshot {
                verification_id: Some("verification-123".to_owned()),
                ..Default::default()
            },
            metamap: MetamapSnapshot {
                name: "Persona Socia".to_owned(),
                document: Some("30111222".to_owned()),
                ..Default::default()
            },
            core: CoreSnapshot {
                request_oid: "246729".to_owned(),
                request_name: Some("Persona Socia".to_owned()),
                request_document: Some("30111222".to_owned()),
                transfer_cbu: Some("0000003100015780238648".to_owned()),
                request_amount: Some(Decimal::new(1_900_000, 0)),
                ..Default::default()
            },
            transfer_guard: CoinagTransferGuard::NotFound,
            validation: ValidationReport::default(),
            busy: false,
            message: None,
        };
        let legs = vec![
            (
                TransferLeg {
                    key: "creditor:1296".to_owned(),
                    kind: TransferLegKind::Creditor,
                    amount: Decimal::new(565_000, 0),
                    cbu: "0970099413001097400111".to_owned(),
                    cuit: "30625567382".to_owned(),
                    holder_name: Some("Entidad Acreedora".to_owned()),
                },
                "tx-creditor-123".to_owned(),
            ),
            (
                TransferLeg {
                    key: "member".to_owned(),
                    kind: TransferLegKind::Member,
                    amount: Decimal::new(1_335_000, 0),
                    cbu: "0000003100015780238648".to_owned(),
                    cuit: "20301112223".to_owned(),
                    holder_name: Some("Persona Socia".to_owned()),
                },
                "tx-member-456".to_owned(),
            ),
        ];

        let receipt_path = write_cancellation_receipt(&temp_dir, "Operador", &case, &legs)
            .expect("el comprobante debe generarse");
        let pdf = lopdf::Document::load(&receipt_path).expect("el PDF debe poder abrirse");
        let pages = pdf.get_pages();

        assert_eq!(pages.len(), 2);
        let first_page = pdf.extract_text(&[1]).expect("texto de la primera hoja");
        let second_page = pdf.extract_text(&[2]).expect("texto de la segunda hoja");
        for page_text in [&first_page, &second_page] {
            assert!(page_text.contains("Comprobante de transferencia"));
            assert!(page_text.contains("Tipo de transferencia"));
            assert!(page_text.contains("Transferencia confirmada"));
        }
        assert!(first_page.contains("tx-creditor-123"));
        assert!(first_page.contains("Entidad Acreedora"));
        assert!(first_page.contains("0970099413001097400111"));
        assert!(second_page.contains("tx-member-456"));
        assert!(second_page.contains("Persona Socia"));
        assert!(second_page.contains("0000003100015780238648"));

        drop(pdf);
        fs::remove_dir_all(&temp_dir).expect("la carpeta temporal debe eliminarse");
    }
}
