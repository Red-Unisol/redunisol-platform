use std::{
    fs::{self, File},
    io::{BufWriter, Cursor},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use chrono::Local;
use printpdf::{
    BuiltinFont, Color, Greyscale, Image, ImageTransform, Line, LineCapStyle, LineJoinStyle, Mm,
    PdfDocument, Point, Rgb, image_crate::codecs::png::PngDecoder,
};

use crate::models::HydratedCase;

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
const LOGO_BYTES: &[u8] = include_bytes!("../assets/receipt_logo_flat.png");

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

    draw_frame(&current_layer);
    draw_logo(&current_layer)?;

    write_text(
        &current_layer,
        &bold_font,
        "Comprobante de transferencia",
        TITLE_SIZE_PT,
        TITLE_X_MM,
        TITLE_Y_MM,
        rgb(33, 37, 41),
    );
    write_text(
        &current_layer,
        &regular_font,
        "Generado por Celesol Transferencias",
        SUBTITLE_SIZE_PT,
        TITLE_X_MM,
        SUBTITLE_Y_MM,
        rgb(141, 145, 153),
    );
    draw_divider(&current_layer, DIVIDER_Y_MM);

    let amount = case.amount_display();
    let rows = vec![
        ("N° de transacción", external_transfer_id.to_owned()),
        ("Tipo de transferencia", "Inmediata".to_owned()),
        ("Fecha de carga", timestamp.format("%d/%m/%Y").to_string()),
        (
            "Fecha y hora de emisión",
            timestamp.format("%d/%m/%Y %H:%M").to_string(),
        ),
        ("Operador", operator_name.to_owned()),
        ("Solicitud", case.request_oid().to_owned()),
        (
            "Verification ID",
            case.server_validation
                .verification_id
                .as_deref()
                .unwrap_or("N/D")
                .to_owned(),
        ),
        ("Solicitante", case.display_name()),
        ("Documento", case.document_display()),
        (
            "CBU/CVU",
            case.core
                .transfer_cbu
                .as_deref()
                .unwrap_or("N/D")
                .to_owned(),
        ),
        ("Importe", amount),
        ("Estado", "Comprobante generado".to_owned()),
    ];

    let mut current_y = ROW_START_Y_MM;
    for (label, value) in rows {
        write_text(
            &current_layer,
            &bold_font,
            label,
            ROW_SIZE_PT,
            LABEL_X_MM,
            current_y,
            rgb(71, 75, 82),
        );
        write_text(
            &current_layer,
            &regular_font,
            &value,
            ROW_SIZE_PT,
            VALUE_X_MM,
            current_y,
            rgb(33, 37, 41),
        );
        current_y -= ROW_SPACING_MM;
    }

    document
        .save(&mut BufWriter::new(
            File::create(&receipt_path)
                .with_context(|| format!("No se pudo crear {:?}", receipt_path))?,
        ))
        .with_context(|| format!("No se pudo escribir {:?}", receipt_path))?;
    Ok(receipt_path)
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
