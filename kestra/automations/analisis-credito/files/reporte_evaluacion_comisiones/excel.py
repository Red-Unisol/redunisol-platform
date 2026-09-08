from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Sequence

from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Font, PatternFill, Border, Side, Protection
from openpyxl.formatting.rule import FormulaRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.pagebreak import Break
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.workbook.properties import CalcProperties

from reporte_evaluacion_report.core import MonthlyReport

from .calendar import CALENDAR_DESCRIPTION, CALENDAR_VERSION, SOURCES
from .core import EXCLUDED_SELLERS, MANUAL_RULES, MANUAL_WEIGHT, METRICS, RULE_VERSION, Loan, previous_months

MONEY = '"$" #,##0.00'


def build_commission_sheet(workbook, months, reports, loans, ref_rows, placement_ranges):
    """Una ficha vertical por mes con liquidacion ligada a la revision de cada legajo."""
    ws = workbook.create_sheet("Comisiones")
    ws.sheet_view.showGridLines = False
    ws.freeze_panes = "A4"
    ws.sheet_view.zoomScale = 85
    for col in "ABCDEFGH":
        ws.column_dimensions[col].width = 15

    def band(row, first, last, value=None, *, fill="FFFFFF", bold=False, fmt=None, color="243746"):
        for col in range(first, last + 1):
            cell = ws.cell(row, col)
            cell.fill = PatternFill("solid", fgColor=fill)
            cell.alignment = Alignment(vertical="center", wrap_text=True, indent=1)
            cell.font = Font(name="Calibri", size=11, bold=bold, color=color)
        if last > first:
            ws.merge_cells(start_row=row, start_column=first, end_row=row, end_column=last)
        cell = ws.cell(row, first, value)
        if fmt:
            cell.number_format = fmt
        ws.row_dimensions[row].height = 25
        return cell

    band(1, 1, 8, "Evaluación y comisiones", fill="17365D", bold=True, color="FFFFFF")
    ws.row_dimensions[1].height = 34
    band(2, 1, 8, "Menor tiempo es mejor. Cada mes muestra objetivos, tramo alcanzado y comisión. Revisar cada caso en Muestreo legajos.", fill="EAF0F7")
    ws.row_dimensions[2].height = 32
    for index, month in enumerate(months):
        top = 4 + index * 64
        report = reports[month]
        band(top, 1, 8, report.month_label, fill="17365D", bold=True, color="FFFFFF")
        ws.row_dimensions[top].height = 32
        band(top + 1, 1, 2, "Colocación del Core", bold=True)
        start, end = placement_ranges[month]
        placement = f"C{top + 1}"
        band(top + 1, 3, 4, f"=SUM('Colocacion Core'!I{start}:I{end})" if end >= start else "=0", fmt=MONEY)
        band(top + 1, 5, 6, "Préstamos", bold=True)
        band(top + 1, 7, 8, len(loans[month]), fmt="0")
        baseline = previous_months(month)
        band(top + 2, 1, 8, f"Referencia: media simple de {', '.join(baseline)}. Tiempos en minutos laborales; solo feriados nacionales obligatorios.", fill="EAF0F7")
        ws.row_dimensions[top + 2].height = 32
        amount_cells = []
        for metric_index, (_, _, label, weight) in enumerate(METRICS):
            row = top + 4 + metric_index * 10
            val = row + 2
            band(row, 1, 8, label, fill="305496", bold=True, color="FFFFFF")
            for col, text in [(1, "Referencia / objetivo"), (3, "Resultado del mes"), (5, "Resultado / referencia"), (7, "Comisión")]:
                band(row + 1, col, col + 1, text, fill="EAF0F7", bold=True)
            ws.row_dimensions[row + 1].height = 32
            source_col = get_column_letter(3 + metric_index)
            sources = ",".join(f"'Metricas referencia'!{source_col}{ref_rows[m]}" for m in baseline)
            source = f"'Metricas referencia'!{source_col}{ref_rows[month]}"
            band(val, 1, 2, f'=IF(COUNT({sources})=3,AVERAGE({sources}),"")', fmt="0.0000")
            band(val, 3, 4, f'=IF(ISNUMBER({source}),{source},"")', fmt="0.0000", bold=True)
            valid = f'AND(COUNT(A{val},C{val})=2,A{val}>0)'
            band(val, 5, 6, f'=IF({valid},C{val}/A{val},"")', fmt="0.00%", bold=True)
            rate, weight_cell = f"G{row + 8}", f"C{row + 8}"
            band(val, 7, 8, f'=IF(ISNUMBER({rate}),ROUND({placement}*{weight_cell}*{rate},2),"")', fmt=MONEY, bold=True)
            amount_cells.append(f"G{val}")
            for col, text in [(1, "Rango de performance"), (3, "Límites (minutos)"), (5, "Tasa de comisión"), (7, "Tramo alcanzado")]:
                band(row + 3, col, col + 1, text, bold=True)
            ws.row_dimensions[row + 3].height = 32
            tier_labels = ["Hasta 100%", "Más de 100% y hasta 110%", "Más de 110%"]
            lower = f'A{val}*\'Reglas\'!$B$6'
            upper = f'A{val}*\'Reglas\'!$B$7'
            conditions = [f"C{val}<={lower}", f"AND(C{val}>{lower},C{val}<={upper})", f"C{val}>{upper}"]
            intervals = [f'"≤ "&TEXT({lower},"0.0000")', f'"> "&TEXT({lower},"0.0000")&" y ≤ "&TEXT({upper},"0.0000")', f'"> "&TEXT({upper},"0.0000")']
            for tier, (text, condition, interval, fill) in enumerate(zip(tier_labels, conditions, intervals, ["E2F0D9", "FFF2CC", "FCE4D6"])):
                r = row + 4 + tier
                band(r, 1, 2, text, fill=fill)
                band(r, 3, 4, f'=IF(AND(ISNUMBER(A{val}),A{val}>0),{interval},"Sin referencia")', fill=fill)
                band(r, 5, 6, f"='Reglas'!B{8 + tier}", fill=fill, fmt="0.0%")
                band(r, 7, 8, f'=IF({valid},IF({condition},"ALCANZADO",""),"Pendiente")', fill=fill, bold=True)
                ws.row_dimensions[r].height = 32
                ws.conditional_formatting.add(f"A{r}:H{r}", FormulaRule(
                    formula=[f'AND({valid},{condition})'.replace(f'A{val}', f'$A${val}').replace(f'C{val}', f'$C${val}')],
                    font=Font(bold=True, color="17365D"),
                    border=Border(top=Side(style="medium", color="17365D"), bottom=Side(style="medium", color="17365D")),
                ))
            band(row + 7, 1, 8, f'=IF({valid},"Resultado: "&TEXT(C{val},"0.0000")&" min · "&TEXT(E{val},"0.00%")&" de la referencia","Pendiente: se requieren tres meses con datos y referencia positiva.")', fill="F2F5F9")
            band(row + 8, 1, 2, "Peso en el esquema")
            band(row + 8, 3, 4, float(weight), fmt="0%")
            band(row + 8, 5, 6, "Tasa aplicada", bold=True)
            band(row + 8, 7, 8, f'=IF({valid},IF({conditions[0]},\'Reglas\'!$B$8,IF({conditions[1]},\'Reglas\'!$B$9,\'Reglas\'!$B$10)),"")', fmt="0.0%", bold=True)

        manual = top + 44
        band(manual, 1, 8, "Legajos · revisión humana", fill="305496", bold=True, color="FFFFFF")
        for col, text in [(1, "Correctos"), (3, "Incorrectos"), (5, "A revisar / sin resolver"), (7, "Legajos en la muestra")]:
            band(manual + 1, col, col + 1, text, fill="EAF0F7", bold=True)
        r = manual + 2
        has_samples = any(reports[m].legajos_sample for m in months)
        for col, status, fill in [(1, "Correcto", "E2F0D9"), (3, "Incorrecto", "FCE4D6")]:
            count = f'=COUNTIFS(RevisionLegajos[Mes],"{month}",RevisionLegajos[Revisión],"{status}")' if has_samples else '=0'
            band(r, col, col + 1, count, fmt="0", fill=fill, bold=True)
        band(r, 7, 8, f'=COUNTIF(RevisionLegajos[Mes],"{month}")' if has_samples else '=0', fmt="0")
        band(r, 5, 6, f'=G{r}-A{r}-C{r}', fmt="0", fill="FFF2CC", bold=True)
        complete = f"AND(G{r}='Reglas'!$B$13,G{r}={len(report.legajos_sample)},E{r}=0)"
        band(manual + 3, 1, 8, f'=IF(G{r}<>\'Reglas\'!$B$13,"Pendiente: se requiere una muestra de 30 legajos",IF({complete},"Revisión completa · comisión calculada","Pendiente: resolver todos los legajos en Muestreo legajos"))', fill="EAF0F7")
        ws.row_dimensions[manual + 3].height = 32
        for col, text in [(1, "Objetivo"), (3, "Legajos correctos"), (5, "Tasa de comisión"), (7, "Tramo alcanzado")]:
            band(manual + 4, col, col + 1, text, bold=True)
        conditions = [f"A{r}>='Reglas'!$B$11", f"AND(A{r}>='Reglas'!$B$12,A{r}<'Reglas'!$B$11)", f"A{r}<'Reglas'!$B$12"]
        intervals = ['=\'Reglas\'!B11&" a "&\'Reglas\'!B13', '=\'Reglas\'!B12&" a "&(\'Reglas\'!B11-1)', '="0 a "&(\'Reglas\'!B12-1)']
        for tier, (label, condition, interval, fill) in enumerate(zip(["Máximo", "Medio", "Bajo"], conditions, intervals, ["E2F0D9", "FFF2CC", "FCE4D6"])):
            line = manual + 5 + tier
            band(line, 1, 2, label, fill=fill)
            band(line, 3, 4, interval, fill=fill)
            band(line, 5, 6, f"='Reglas'!B{8 + tier}", fmt="0.0%", fill=fill)
            band(line, 7, 8, f'=IF({complete},IF({condition},"ALCANZADO",""),"Pendiente")', fill=fill, bold=True)
            ws.conditional_formatting.add(f"A{line}:H{line}", FormulaRule(
                formula=[f'AND({complete},{condition})'.replace(f'A{r}', f'$A${r}').replace(f'G{r}', f'$G${r}').replace(f'E{r}', f'$E${r}')],
                font=Font(bold=True, color="17365D"),
                border=Border(top=Side(style="medium", color="17365D"), bottom=Side(style="medium", color="17365D")),
            ))
        link = band(manual + 8, 1, 8, "→ Ir a Muestreo legajos y seleccionar el resultado de cada revisión", color="0563C1")
        link.hyperlink = "#'Muestreo legajos'!A1"
        band(manual + 9, 1, 2, "Peso en el esquema")
        band(manual + 9, 3, 4, float(MANUAL_WEIGHT), fmt="0%")
        band(manual + 9, 5, 6, "Tasa aplicada", bold=True)
        rate = f"G{manual + 9}"
        band(manual + 9, 7, 8, f'=IF({complete},IF({conditions[0]},\'Reglas\'!$B$8,IF({conditions[1]},\'Reglas\'!$B$9,\'Reglas\'!$B$10)),"")', fmt="0.0%", bold=True)
        manual_amount = f"E{manual + 10}"
        band(manual + 10, 1, 4, "Comisión de legajos (30%)", bold=True)
        band(manual + 10, 5, 8, f'=IF(ISNUMBER({rate}),ROUND({placement}*C{manual + 9}*{rate},2),"")', fmt=MONEY, fill="E2F0D9", bold=True)
        subtotal = manual + 12
        amounts = ",".join(amount_cells)
        band(subtotal, 1, 4, "Subtotal automático · componente del 70%", fill="E2F0D9", bold=True)
        band(subtotal, 5, 8, f'=IF(COUNT({amounts})=4,SUM({amounts}),"")', fill="E2F0D9", bold=True, fmt=MONEY)
        band(subtotal + 1, 1, 4, "Total definitivo", fill="17365D", bold=True, color="FFFFFF")
        band(subtotal + 1, 5, 8, f'=IF(COUNT(E{subtotal},{manual_amount})=2,SUM(E{subtotal},{manual_amount}),"Pendiente de completar evaluación")', fill="17365D", bold=True, color="FFFFFF", fmt=MONEY)
        # Al imprimir, mantener completos los bloques: dos metricas por pagina.
        if index:
            ws.row_breaks.append(Break(id=top - 1))
        ws.row_breaks.append(Break(id=top + 23))

    ws.print_area = f"A1:H{ws.max_row}"
    ws.print_title_rows = "1:2"
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = "portrait"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    return ws


def table_sheet(workbook: Any, name: str, title: str, subtitle: str, headers: list[str], rows: list[list], table: str) -> Any:
    ws = workbook.create_sheet(name)
    last_column = get_column_letter(len(headers))
    for row, text in [(1, title), (2, subtitle)]:
        ws.merge_cells(f"A{row}:{last_column}{row}")
        cell = ws.cell(row, 1, text)
        cell.fill = PatternFill("solid", fgColor="17365D" if row == 1 else "EAF0F7")
        cell.font = Font(name="Calibri", size=15 if row == 1 else 11, bold=row == 1, color="FFFFFF" if row == 1 else "374151")
        cell.alignment = Alignment(vertical="center", wrap_text=True)
        ws.row_dimensions[row].height = 32 if row == 1 else 46
    for column, label in enumerate(headers, 1):
        cell = ws.cell(4, column, label)
        cell.font = Font(name="Calibri", bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="305496")
        cell.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[get_column_letter(column)].width = 21
    ws.row_dimensions[4].height = 34
    for r, values in enumerate(rows, 5):
        for c, value in enumerate(values, 1):
            cell = ws.cell(r, c, float(value) if isinstance(value, Decimal) else value)
            # Nombres de vendedores/lineas son datos externos, nunca formulas.
            if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
                cell.data_type = "s"
            cell.font = Font(name="Calibri", size=11)
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            if isinstance(value, (float, Decimal)):
                cell.number_format = "0.00"
    if rows:
        excel_table = Table(displayName=table, ref=f"A4:{last_column}{4 + len(rows)}")
        excel_table.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
        ws.add_table(excel_table)
    ws.freeze_panes = "C5"
    ws.sheet_view.showGridLines = False
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_title_rows = "1:4"
    return ws


def build_review_sheet(workbook, months, reports):
    # La v1 conserva su hoja original. Solo la v2 agrega decisiones humanas.
    del workbook["Muestreo legajos"]
    rows = [
        [month, item.get("solicitud_oid"), item.get("nro_socio"), item.get("linea"), "A revisar", None]
        for month in months for item in reports[month].legajos_sample
    ]
    ws = table_sheet(workbook, "Muestreo legajos", "Legajos seleccionados · revisión humana",
                     "Elegir Correcto (verde), Incorrecto (rojo) o A revisar (amarillo). Comisiones cuenta los resultados por mes. Guardar una copia revisada.",
                     ["Mes", "Solicitud", "Número de socio", "Línea", "Revisión", "Observaciones"], rows, "RevisionLegajos")
    for col, width in zip("ABCDEF", [16, 15, 18, 36, 21, 42]):
        ws.column_dimensions[col].width = width
    ws.freeze_panes = "C5"
    ws["A3"] = "← Volver a Comisiones"
    ws["A3"].hyperlink = "#'Comisiones'!A1"
    ws["A3"].font = Font(color="0563C1", underline="single")
    if rows:
        end = len(rows) + 4
        validation = DataValidation(type="list", formula1='"Correcto,Incorrecto,A revisar"', allow_blank=False)
        validation.showDropDown = False
        validation.showErrorMessage = True
        validation.errorStyle = "stop"
        validation.errorTitle = "Seleccionar un estado"
        validation.error = "Elegir Correcto, Incorrecto o A revisar."
        validation.showInputMessage = True
        validation.promptTitle = "Revisión del legajo"
        validation.prompt = "Resolver cada caso. A revisar mantiene pendiente la comisión del mes."
        validation.add(f"E5:E{end}")
        ws.add_data_validation(validation)
        for status, fill, color in [("Correcto", "E2F0D9", "375623"), ("Incorrecto", "FFC7CE", "9C0006"), ("A revisar", "FFF2CC", "7F6000")]:
            ws.conditional_formatting.add(f"E5:E{end}", FormulaRule(
                formula=[f'$E5="{status}"'], fill=PatternFill("solid", fgColor=fill, bgColor=fill), font=Font(bold=True, color=color)))
        for row in range(5, end + 1):
            ws.row_dimensions[row].height = 32
            for col in [5, 6]:
                ws.cell(row, col).protection = Protection(locked=False)
            ws.cell(row, 5).fill = PatternFill("solid", fgColor="FFF2CC")
            ws.cell(row, 5).comment = Comment("La comisión solo se calcula con 30 legajos resueltos. Vacíos o valores no reconocidos cuentan como pendientes.", "Red Unisol")
    workbook.move_sheet(ws, offset=1 - workbook.index(ws))
    return ws


def enrich_workbook(
    workbook: Any, *, reports: Sequence[MonthlyReport], months: Sequence[str],
    loans: dict[str, list[Loan]], calendar: dict, extracted_at: datetime,
) -> None:
    by_month = {report.month_value: report for report in reports}
    reference_months = sorted(by_month)
    metrics_rows = []
    for month in reference_months:
        report = by_month[month]
        metrics_rows.append([
            month, report.summary["solicitudes_count"],
            *[report.summary[group][statistic] for group, statistic, _, _ in METRICS],
        ])
    refs = table_sheet(
        workbook, "Metricas referencia", "Métricas para calcular los objetivos",
        "Valores sin redondear para el cálculo. Cada objetivo usa la media simple de los tres meses anteriores, con el mismo calendario laboral.",
        ["Mes", "Solicitudes analizadas", *[label for _, _, label, _ in METRICS]], metrics_rows, "MetricasReferencia",
    )
    ref_row = {month: row for row, month in enumerate(reference_months, 5)}
    for row in range(5, refs.max_row + 1):
        for col in range(3, 7):
            refs.cell(row, col).number_format = "0.0000"

    placement_rows = []
    placement_ranges = {}
    for month in months:
        start = 5 + len(placement_rows)
        for loan in loans[month]:
            placement_rows.append([
                month, loan.loan_id, loan.account, loan.application_id, loan.issued_on,
                loan.seller, loan.line, loan.state, loan.amount, loan.capital,
            ])
        placement_ranges[month] = (start, 4 + len(placement_rows))
    placements = table_sheet(
        workbook, "Colocacion Core", "Base de colocación del Core",
        "Préstamos emitidos en el mes con solicitud Pagada, excluyendo los vendedores indicados en Reglas. Base de comisión: Monto Deseado (MontoADesembolsar).",
        ["Mes", "ID préstamo", "Número préstamo", "Solicitud", "Fecha emisión", "Vendedor", "Línea", "Estado", "Monto para comisión", "Capital original"],
        placement_rows, "ColocacionCore",
    )
    placements.column_dimensions["F"].width = 27
    placements.column_dimensions["G"].width = 36
    for row in range(5, placements.max_row + 1):
        for col in (9, 10):
            placements.cell(row, col).number_format = MONEY

    summary = build_commission_sheet(workbook, months, by_month, loans, ref_row, placement_ranges)

    rules_rows = [
        ["Versión de reglas", RULE_VERSION],                          # B5
        ["Objetivo / referencia", 1.0],                            # B6
        ["Límite intermedio / referencia", 1.10],                   # B7
        ["Tasa hasta 100% (inclusive)", 0.005],                      # B8
        ["Tasa más de 100% hasta 110% (inclusive)", 0.003],          # B9
        ["Tasa más de 110%", 0.001],                               # B10
        ["Legajos: mínimo máximo", MANUAL_RULES["high_min"]],                          # B11
        ["Legajos: mínimo medio", MANUAL_RULES["medium_min"]],                           # B12
        ["Legajos: muestra requerida", MANUAL_RULES["sample_size"]],                       # B13
        ["Referencia", "Media simple de los tres meses anteriores, sin redondear antes de clasificar."],
        ["Pesos", "Respuesta: 20% mediana + 20% promedio. Transferencia: 15% mediana + 15% promedio. Legajos: 30% manual."],
        ["Sin datos / referencia cero", "Comisión pendiente, no se asigna tasa ni se muestra un total definitivo."],
        ["Legajos", "Revisar 30 legajos: 28–30 correctos = 0,5%; 26–27 = 0,3%; 0–25 = 0,1%. Todos deben estar resueltos; muestras menores a 30 quedan pendientes."],
        ["Calendario", CALENDAR_DESCRIPTION],
        ["Versión de calendario", CALENDAR_VERSION],
        ["Extracción iniciada (Buenos Aires)", extracted_at.isoformat()],
        ["Base monetaria", "MontoADesembolsar de préstamos emitidos en el mes con Solicitud.Estado.Descripcion = Pagada."],
        ["Vendedores excluidos", "; ".join(EXCLUDED_SELLERS)],
        ["Separación de universos", "Las métricas conservan las exclusiones de líneas del reporte original. La colocación aplica los filtros de vendedores del Core."],
        ["Histórico", "Cada ejecución conserva la base consultada. Una consulta posterior puede cambiar importes o estados de meses cerrados."],
        *[["Fuente del calendario", url] for url in SOURCES],
    ]
    rules = table_sheet(workbook, "Reglas", "Criterios y trazabilidad", "Calendario y parámetros aplicados a esta ejecución.", ["Concepto", "Valor"], rules_rows, "ReglasComisiones")
    rules.column_dimensions["A"].width = 47
    rules.column_dimensions["B"].width = 105
    for row in range(5, rules.max_row + 1):
        rules.row_dimensions[row].height = 34
    for row in range(6, 11):
        rules.cell(row, 2).number_format = "0.00%"
    table_sheet(workbook, "Feriados nacionales", "Feriados nacionales obligatorios descontados", CALENDAR_DESCRIPTION,
                ["Fecha", "Descripción"], [[day.isoformat(), name] for day, name in calendar.items()], "FeriadosNacionales")
    workbook["Feriados nacionales"].column_dimensions["B"].width = 90

    overview = workbook["Resumen ejecutivo"]
    overview["A1"] = "Reporte evaluatorio comercial — v2 con feriados nacionales"
    overview["A2"] = f"Generado: {extracted_at:%d/%m/%Y %H:%M} | {CALENDAR_DESCRIPTION}"
    overview.row_dimensions[2].height = 42
    for row in overview.iter_rows(min_col=1, max_col=2):
        if str(row[0].value).startswith(("Regla de", "Definicion de punta")):
            row[1].value = f"{row[1].value}. Se excluyen feriados nacionales obligatorios."
    build_review_sheet(workbook, months, by_month)
    workbook.move_sheet(summary, offset=-workbook.index(summary))
    workbook.move_sheet(workbook["Muestreo legajos"], offset=1 - workbook.index(workbook["Muestreo legajos"]))
    workbook.active = 0
    workbook.calculation = CalcProperties(calcMode="auto", fullCalcOnLoad=True, forceFullCalc=True)
