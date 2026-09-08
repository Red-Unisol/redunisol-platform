from __future__ import annotations

from openpyxl.chart import LineChart, Reference
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.pagebreak import Break

MONEY = '"$" #,##0.00'
VARIATION = '"↑ "0.0%;"↓ "0.0%;"→ "0.0%'


def build_monthly_comparison(workbook, months):
    """Vista compacta enlazada al resumen, incluida la revision humana editable."""
    del workbook["Comparativo mensual"]
    ws = workbook.create_sheet("Comparativo mensual")
    ws.sheet_view.showGridLines = False
    ws.freeze_panes = "B5"
    ws.sheet_format.defaultRowHeight = 6
    for col, width in zip("ABCDE", [15, 21, 21, 22, 16]):
        ws.column_dimensions[col].width = width
    # Series auxiliares: NA() evita dibujar pendientes como ceros en Excel.
    for col in "FGHI":
        ws.column_dimensions[col].hidden = True

    def heading(row, text, *, dark=False):
        ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=5)
        cell = ws.cell(row, 1, text)
        cell.font = Font(name="Calibri", size=12 if dark else 10, bold=dark, color="FFFFFF" if dark else "374151")
        cell.fill = PatternFill("solid", fgColor="17365D" if dark else "EAF0F7")
        cell.alignment = Alignment(wrap_text=True, vertical="center", indent=1)
        ws.row_dimensions[row].height = 23

    def table(row, title, metric=None):
        heading(row, title)
        headers = ["Mes", "Referencia (min)", "Resultado (min)", "Variación vs referencia", "Tasa"]
        if metric is None:
            headers = ["Mes", "Máximo teórico ($)", "Total definitivo ($)", "Variación vs máximo", "Tasa efectiva"]
        for col, text in enumerate(headers, 1):
            cell = ws.cell(row + 1, col, text)
            cell.font = Font(name="Calibri", bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="305496")
            cell.alignment = Alignment(wrap_text=True, vertical="center", indent=1)
        ws.row_dimensions[row + 1].height = 25
        start = row + 2
        for index, month in enumerate(months):
            r = start + index
            top = 4 + index * 64
            ws.cell(r, 1, month)
            if metric is not None:
                source = top + 6 + metric * 10
                ref = f"'Comisiones'!A{source}"
                result = f"'Comisiones'!C{source}"
                rate = f"'Comisiones'!G{source + 6}"
                ws.cell(r, 2, f'=IF(ISNUMBER({ref}),{ref},"")')
                ws.cell(r, 5, f'=IF(ISNUMBER({rate}),{rate},"")')
            else:
                placement = f"'Comisiones'!C{top + 1}"
                result = f"'Comisiones'!E{top + 57}"
                ws.cell(r, 2, f"=ROUND({placement}*'Reglas'!$B$8,2)")
                ws.cell(r, 5, f'=IF(AND(ISNUMBER(C{r}),{placement}>0),C{r}/{placement},"")')
            ws.cell(r, 3, f'=IF(ISNUMBER({result}),{result},"Pendiente")')
            ws.cell(r, 4, f'=IF(AND(COUNT(B{r}:C{r})=2,B{r}>0),C{r}/B{r}-1,"")')
            for col in range(1, 6):
                cell = ws.cell(r, col)
                cell.font = Font(name="Calibri", size=10, bold=col == 3, color="243746")
                cell.fill = PatternFill("solid", fgColor="F2F5F9" if index % 2 == 0 else "FFFFFF")
                cell.alignment = Alignment(vertical="center", indent=1)
            ws.cell(r, 2).number_format = ws.cell(r, 3).number_format = MONEY if metric is None else "0.00"
            ws.cell(r, 4).number_format = VARIATION
            ws.cell(r, 5).number_format = "0.00%"
            ws.row_dimensions[r].height = 19
        end = start + len(months) - 1
        # Escalas continuas: comparar meses sin convertir el pendiente en cero.
        green, yellow, red = "B7D7A8", "FFF2CC", "EA9999"
        ws.conditional_formatting.add(f"D{start}:D{end}", ColorScaleRule(
            start_type="num", start_value=-0.10, start_color=green if metric is not None else red,
            mid_type="num", mid_value=0, mid_color=yellow,
            end_type="num", end_value=0.10, end_color=red if metric is not None else green))
        if metric is not None:
            ws.conditional_formatting.add(f"C{start}:C{end}", ColorScaleRule(
                start_type="min", start_color=green, mid_type="percentile", mid_value=50,
                mid_color=yellow, end_type="max", end_color=red))
        ws.conditional_formatting.add(f"E{start}:E{end}", ColorScaleRule(
            start_type="num", start_value=0.001, start_color=red,
            mid_type="num", mid_value=0.003, mid_color=yellow,
            end_type="num", end_value=0.005, end_color=green))
        return start, end

    def chart(anchor, data_start, data_end, title, unit):
        ws.cell(data_start - 1, 8, "Referencia")
        ws.cell(data_start - 1, 9, "Resultado")
        for r in range(data_start, data_end + 1):
            ws.cell(r, 7, f"=A{r}")
            ws.cell(r, 8, f'=IF(ISNUMBER(B{r}),B{r},NA())')
            ws.cell(r, 9, f'=IF(ISNUMBER(C{r}),C{r},NA())')
        plot = LineChart()
        plot.title = title
        plot.y_axis.title = unit
        plot.y_axis.scaling.min = 0
        plot.x_axis.delete = False
        plot.y_axis.delete = False
        plot.y_axis.majorGridlines = None
        plot.title.overlay = False
        plot.y_axis.title.overlay = False
        plot.style = 2
        plot.height, plot.width = 4, 19.5
        plot.legend.position = "b"
        plot.legend.overlay = False
        plot.display_blanks = "gap"
        plot.visible_cells_only = False
        plot.add_data(Reference(ws, min_col=8, max_col=9, min_row=data_start - 1, max_row=data_end), titles_from_data=True)
        plot.set_categories(Reference(ws, min_col=7, min_row=data_start, max_row=data_end))
        for series, color in zip(plot.series, ["8497B0", "007F86"]):
            series.graphicalProperties.line.solidFill = color
            series.graphicalProperties.line.width = 25000
            series.marker.symbol = "circle"
            series.marker.size = 5
            series.marker.graphicalProperties.solidFill = color
            series.marker.graphicalProperties.line.solidFill = color
        plot.series[0].graphicalProperties.line.prstDash = "sysDot"
        ws.add_chart(plot, f"A{anchor}")
        for r in range(anchor, anchor + 12):
            ws.row_dimensions[r].height = 10

    heading(1, "Comparativo mensual", dark=True)
    heading(2, "Histórico completo del período. Verde: menor tiempo o mayor tasa; rojo: lo contrario. Flechas: variación frente a la referencia.")
    ws.row_dimensions[2].height = 32
    row = 4
    for title, first_metric in [("Primera respuesta", 0), ("Transferencias", 2)]:
        heading(row, title, dark=True)
        table(row + 1, "Mediana · referencia: promedio de los tres meses anteriores", first_metric)
        mean_row = row + len(months) + 5
        start, end = table(mean_row, "Promedio · referencia: promedio de los tres meses anteriores", first_metric + 1)
        chart(end + 2, start, end, f"{title} · evolución del promedio", "Minutos laborales")
        row = end + 15
        ws.row_breaks.append(Break(id=row - 1))
    heading(row, "Comisiones", dark=True)
    heading(row + 1, "Referencia: máximo teórico (0,5% de colocación). El total y la tasa efectiva quedan pendientes hasta completar la evaluación y los legajos.")
    ws.row_dimensions[row + 1].height = 32
    start, end = table(row + 3, "Total definitivo y distancia al máximo teórico")
    chart(end + 2, start, end, "Comisiones · total y máximo teórico", "Pesos")
    # La referencia monetaria no se confunde con el objetivo de tiempos.
    ws.cell(start - 1, 8, "Máximo teórico")
    ws.cell(start - 1, 9, "Total definitivo")
    heading(end + 15, "Percentiles y estadísticas ampliadas se conservan en las hojas de detalle. Comisiones es el resumen principal.")
    ws.print_area = f"A1:E{end + 15}"
    ws.print_title_rows = "1:2"
    ws.page_setup.orientation = "portrait"
    ws.page_setup.paperSize = ws.PAPERSIZE_A3
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return ws
