"""Respuestas de CUAD de mentira, para los tests.

Todo lo que hay aca es inventado a mano: no sale de ninguna corrida real y no
contiene datos de ninguna persona. Reproduce la FORMA de las respuestas de
CUAD, que es lo unico que los parsers necesitan ver.

Sobre la forma: CUAD devuelve HTML con los datos metidos adentro de llamadas
JavaScript. El detalle importante es que cada parent.setX(...) tiene que cerrar
contra un </script>, porque asi lo exige la expresion regular que los extrae.
"""

HTML_MOVIMIENTO = """<html><head><title>Movimientos - CUAD</title></head><body>
<script>parent.Emp_Id = 12345; parent.Display('S');</script>
<script>parent.setEmpleado('PEREZ JUAN','DNI','MUNICIPALIDAD','SANTA FE','10','ENTIDAD X','999','20111111112','11111111','S','N')</script>
<script>parent.setTotales('100000,00','80000,00','40000,00','15000,00','37,50','0,00','0,00','25000,00','62,50','15000,00','0,00','0,00','N','0,00','0,00','0,00','0,00','0,00','0,00','','')</script>
<script>parent.setInformacion_empleado('Sin observaciones')</script>
<script>parent.setPreCancelado('No registra precancelado')</script>
<script>
bSel = 'N'; bPag = 'S'; sCallBack = 'grilla.asp'; ID = 'MOVIMIENTOS'; Orden = '1';
MultiSel = 'N'; Estilo = 'e1'; EstiloFila = 'f1'; EstiloColumna = 'c1';
Formato = 'fmt'; FormatoFila = 'fmtf'; FormatoColumna = 'fmtc';
Pags = 2; Recs = 7; Obj_Desc = 'Movimientos'; VerPie = 'S'; Borde = '1';
</script>
<table id="oTableCab"><tr><td>Organismo</td><td>Sector</td><td>Entidad</td><td>Cupo</td><td>Afectado</td><td>%</td><td>PreCancelado</td><td>%</td><td>Deuda</td></tr></table>
<table id="oTable">
<tr><td>MUNI</td><td>SEC1</td><td>ENT&nbsp;1</td><td>40.000,00</td><td>15.000,00</td><td>37,50</td><td>0,00</td><td>0,00</td><td>15.000,00</td></tr>
<tr><td>MUNI</td><td>SEC2</td><td>ENT2</td><td>10.000,00</td><td>2.000,00</td><td>20,00</td><td>0,00</td><td>0,00</td><td>2.000,00</td></tr>
</table>
</body></html>"""

# Respuesta de grilla.asp?Modo=SERVICIO&ID=MOVIMIENTOS. Cada fila trae un valor
# de mas al principio (el id oculto) respecto de la cantidad de titulos.
HTML_GRILLA = """<html><body><script>
parent.frames['fGrilla'].contentWindow.setTitulos('Fecha|Concepto|Importe|%',4,'80|200|100|50');
parent.frames['fGrilla'].contentWindow.setDatos('1|01/07/2026|CUOTA 1|1500,00|10,00~2|01/08/2026|CUOTA 2|1500,00|10,00','');
</script></body></html>"""

# Lo que devuelve CUAD cuando el CUIL no existe en el regimen consultado.
HTML_SIN_RESULTADO = """<html><body><script>
parent.Emp_Id = -1; parent.Display('N');
</script></body></html>"""

# Sesion vencida: CUAD redirige al login.
HTML_SESION_VENCIDA = """<html><head><title>Identificacion - CUAD</title></head>
<body><script>top.location='login.asp?Modo=E';</script></body></html>"""

# Tabla con encabezados repetidos que NO son el caso especial de Organismos,
# para ejercitar la rama generica de desduplicacion de columnas.
HTML_TABLA_REPETIDA = """<html><body>
<table id="oTableCab"><tr><td>Cod</td><td>Monto</td><td>Monto</td><td>Monto</td></tr></table>
<table id="oTable"><tr><td>A</td><td>1</td><td>2</td><td>3</td></tr></table>
</body></html>"""
