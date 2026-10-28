import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

export type ComprobanteRefinanciacionCuota = {
  capital: number;
  /** Interes de las cuotas que no vencieron, que no se cobra. */
  creditoPagoAdelantado: number;
  /** Cargo de refinanciacion de la linea ("Gastos administrativos"). */
  gastos: number;
  interes: number;
  nroCuota: number;
  punitorios: number;
  total: number;
  /** "dd/mm/aaaa". */
  vencimiento: string;
};

export type ComprobanteRefinanciacion = {
  cuotas: ComprobanteRefinanciacionCuota[];
  documento: string;
  domicilio: string;
  /** "dd/mm/aaaa". */
  fecha: string;
  linea: string;
  localidad: string;
  /** ID del cobro en Vimarx; "0" en una simulacion, como en Vimarx. */
  numero: string;
  /** NroCuenta del prestamo que se cancela. */
  operacion: string;
  socio: string;
};

const negro = rgb(0, 0, 0);
const gris = rgb(0.45, 0.45, 0.45);
const borde = rgb(0.7, 0.7, 0.7);
const rojo = rgb(0.85, 0.1, 0.1);

/**
 * Comprobante del cobro de una refinanciacion, con la misma informacion y el
 * mismo orden que el reporte "Prestamos Pagos" de Vimarx ("REFINANCIACION DE
 * CREDITO") que los analistas adjuntan a la solicitud. Vimarx no lo expone
 * por API, asi que se arma aca con los datos del cobro.
 *
 * Una pagina por cobro. En una simulacion lleva "SIMULACION" cruzado en
 * rojo, como el de Vimarx, y numero 0.
 */
export async function buildComprobanteRefinanciacionPdf(
  comprobantes: readonly ComprobanteRefinanciacion[],
  options: { simulacion: boolean },
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(
    options.simulacion
      ? "Simulación de refinanciación de crédito"
      : "Refinanciación de crédito",
  );

  for (const comprobante of comprobantes) {
    const page = pdf.addPage([595.28, 841.89]);

    dibujarComprobante(page, comprobante, { bold, regular });

    if (options.simulacion) {
      dibujarMarcaSimulacion(page, bold);
    }
  }

  return Buffer.from(await pdf.save());
}

function dibujarComprobante(
  page: PDFPage,
  comprobante: ComprobanteRefinanciacion,
  fonts: { bold: PDFFont; regular: PDFFont },
) {
  const { bold, regular } = fonts;
  const margen = 36;
  const ancho = page.getWidth() - margen * 2;
  const derecha = margen + ancho;
  let y = page.getHeight() - 48;

  texto(page, "REFINANCIACIÓN DE CRÉDITO", derecha, y, bold, 13, "right");
  texto(page, "Operación:", margen, y, bold, 10);
  texto(page, comprobante.operacion, margen + 80, y, regular, 10);
  y -= 22;
  texto(page, "Socio:", margen, y, bold, 10);
  texto(page, comprobante.socio, margen + 80, y, regular, 10);
  texto(page, comprobante.linea, derecha, y, bold, 10, "right");
  y -= 22;
  texto(page, "Domicilio:", margen, y, bold, 10);
  texto(page, comprobante.domicilio, margen + 80, y, regular, 9);
  texto(page, `Número: ${comprobante.numero}`, derecha, y, bold, 10, "right");
  y -= 13;
  texto(page, comprobante.localidad, margen + 80, y, regular, 9);
  y -= 22;
  texto(page, "Documento:", margen, y, bold, 10);
  texto(page, comprobante.documento, margen + 80, y, regular, 10);
  texto(page, `Fecha: ${comprobante.fecha}`, derecha, y, bold, 10, "right");
  y -= 34;

  texto(page, "Detalle pago", margen, y, bold, 11);
  y -= 10;

  // Columnas del reporte de Vimarx. "Punitorios" solo si alguna cuota tiene:
  // es la parte de las vencidas.
  const conPunitorios = comprobante.cuotas.some((cuota) => cuota.punitorios > 0);
  const columnas: {
    campo: keyof ComprobanteRefinanciacionCuota;
    titulo: string;
    peso: number;
  }[] = [
    { campo: "nroCuota", peso: 0.6, titulo: "Cuota" },
    { campo: "vencimiento", peso: 1.1, titulo: "Vencimiento" },
    { campo: "capital", peso: 1.1, titulo: "Capital" },
    { campo: "creditoPagoAdelantado", peso: 1.2, titulo: "Crédito Pago Adel." },
    ...(conPunitorios
      ? [{ campo: "punitorios" as const, peso: 1.1, titulo: "Punitorios" }]
      : []),
    { campo: "gastos", peso: 1.5, titulo: "Gastos Administrativos" },
    { campo: "interes", peso: 1.1, titulo: "Interés" },
    { campo: "total", peso: 1.1, titulo: "Total General" },
  ];
  const pesoTotal = columnas.reduce((suma, columna) => suma + columna.peso, 0);
  const anchos = columnas.map((columna) => (ancho * columna.peso) / pesoTotal);
  const alto = 18;

  // "unirPrimeras": la fila de totales usa las dos primeras celdas para el
  // titulo, como el reporte de Vimarx.
  const fila = (
    valores: string[],
    font: PDFFont,
    fondo: boolean,
    unirPrimeras = false,
  ) => {
    let x = margen;

    if (fondo) {
      page.drawRectangle({
        color: rgb(0.93, 0.93, 0.93),
        height: alto,
        width: ancho,
        x: margen,
        y: y - alto,
      });
    }

    valores.forEach((valor, index) => {
      if (unirPrimeras && index === 1) return;

      const w =
        unirPrimeras && index === 0
          ? (anchos[0] ?? 0) + (anchos[1] ?? 0)
          : (anchos[index] ?? 0);

      page.drawRectangle({
        borderColor: borde,
        borderWidth: 0.5,
        height: alto,
        width: w,
        x,
        y: y - alto,
      });
      texto(
        page,
        valor,
        index < 2 ? x + 4 : x + w - 4,
        y - 12.5,
        font,
        7,
        index < 2 ? "left" : "right",
        w - 6,
      );
      x += w;
    });
    y -= alto;
  };

  fila(columnas.map((columna) => columna.titulo), bold, true);

  for (const cuota of comprobante.cuotas) {
    fila(
      columnas.map((columna) => {
        const valor = cuota[columna.campo];

        if (columna.campo === "nroCuota" || columna.campo === "vencimiento") {
          return String(valor);
        }

        // Como en Vimarx: los importes en cero quedan en blanco.
        return typeof valor === "number" && valor !== 0 ? importe(valor) : "";
      }),
      regular,
      false,
    );
  }

  const totales = columnas.map((columna, index) => {
    if (index === 0) return "Total General";
    if (columna.campo === "vencimiento") return "";

    const suma = comprobante.cuotas.reduce(
      (total, cuota) => total + (cuota[columna.campo] as number),
      0,
    );

    return suma !== 0 ? importe(suma) : "";
  });

  fila(totales, bold, true, true);
  y -= 26;

  const totalPago = comprobante.cuotas.reduce(
    (total, cuota) => total + cuota.total,
    0,
  );

  texto(page, "TOTAL PAGO", derecha - 110, y, bold, 12, "right");
  texto(page, importe(totalPago), derecha, y, bold, 12, "right");
  y -= 30;
  texto(
    page,
    "Generado por Solicitudes Web con los datos del cobro en Vimarx.",
    margen,
    y,
    regular,
    7,
    "left",
    undefined,
    gris,
  );
}

function dibujarMarcaSimulacion(page: PDFPage, bold: PDFFont) {
  const leyenda = "SIMULACIÓN";
  const size = 90;
  const ancho = bold.widthOfTextAtSize(leyenda, size);
  const angulo = 35;
  const rad = (angulo * Math.PI) / 180;

  page.drawText(leyenda, {
    color: rojo,
    font: bold,
    opacity: 0.25,
    rotate: degrees(angulo),
    size,
    x: page.getWidth() / 2 - (Math.cos(rad) * ancho) / 2,
    y: page.getHeight() / 2 - (Math.sin(rad) * ancho) / 2,
  });
}

function texto(
  page: PDFPage,
  valor: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  align: "left" | "right" = "left",
  maxWidth?: number,
  color = negro,
) {
  let contenido = latin1(valor);

  // Recorta en lugar de pisar la columna de al lado.
  if (maxWidth !== undefined) {
    while (
      contenido.length > 1 &&
      font.widthOfTextAtSize(contenido, size) > maxWidth
    ) {
      contenido = contenido.slice(0, -1);
    }
  }

  const ancho = font.widthOfTextAtSize(contenido, size);

  page.drawText(contenido, {
    color,
    font,
    size,
    x: align === "right" ? x - ancho : x,
    y,
  });
}

// Las fuentes estandar de PDF solo cubren Latin-1: el resto se reemplaza en
// lugar de romper la generacion.
function latin1(valor: string) {
  return valor.replace(/[^\x20-\x7e\xa0-\xff]/g, "-");
}

const formatoImporte = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

function importe(valor: number) {
  return formatoImporte.format(valor);
}
