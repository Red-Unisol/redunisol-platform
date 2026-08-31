# Consulta CUAD

## Paquete actual

El comando `python -m consulta_cuad` es la version actual. Recibe una lista de
CUILes desde Excel o JSON, reanuda desde NDJSON y renueva la sesion cuando
CUAD la vence.

El lector automatico de captcha se usa por defecto. Como respaldo operativo se
puede abrir un navegador visible para que un operador autorizado resuelva el
captcha una vez; la corrida conserva la cookie y sigue por HTTP:

```powershell
python -m consulta_cuad --probar-login --login-manual
```

En una corrida masiva se agrega `--login-manual` al comando habitual. Cuando
CUAD venza la sesion, la aplicacion abrira otra vez el navegador, esperara el
login manual y retomara desde el ultimo CUIL guardado.

Durante la corrida el navegador permanece abierto y las consultas se hacen
desde su mismo contexto HTTP. Esto conserva las cookies y la identidad del
cliente que resolvio el captcha; al finalizar o interrumpir la corrida se
cierra automaticamente.

`main2.py`, documentado mas abajo, es el flujo historico: incluye Vimarx pero
depende de una cookie cargada manualmente y no debe tomarse como la app actual.

## Objetivo del script

`main2.py` consulta:

1. Vimarx para obtener los CUILes de la linea configurada, o bien lee un Excel manual
2. CUAD para cada CUIL obtenido

`main2.py` guarda la sig. info de CUAD:

- tabla de empleado
- tabla de totales
- tabla de movimientos

## Que toma como entrada

### Vimarx

Consulta prestamos de:

- linea superior configurable
- estado configurable

Luego aplica en Python el filtro de deuda mayor a `0`.

### Archivo manual

Tambien puede tomar un archivo Excel `.xlsx` o `.xlsm` con una columna de `CUIL` o `CUIT`.

Si se informa `--archivo-cuiles`, no consulta Vimarx.

### CUAD

Para cada CUIL consulta:

1. `movimiento.asp`
2. `grilla.asp?Modo=SERVICIO&Pag=...&ID=MOVIMIENTOS`

Si en `ACTIVOS` no encuentra resultado, reconsulta en `PASIVOS`.

## Que genera

Dentro de `corridas/<YYYY-MM>/`:

- `cuiles_vimarx_main2.json`
- `resultados_cuad_main2.ndjson`

Si se consulta una linea distinta a la default, los archivos se guardan con sufijo automatico:

- `cuiles_vimarx_main2_<sufijo>.json`
- `resultados_cuad_main2_<sufijo>.ndjson`

## Formato de salida

`resultados_cuad_main2.ndjson` guarda una linea por socio. Cada linea es un JSON completo.

Estructura general:

```json
{
  "cuil": "27431680403",
  "ok": true,
  "status": "ok",
  "emr_nombre": "Santa Fe - ACTIVOS",
  "emr_id": "10",
  "consultado_en": "2026-06-16T12:34:56",
  "payload": {},
  "parsed": {
    "tabla_empleado": {},
    "tabla_totales": {},
    "tabla_movimientos": {
      "columnas_visibles": [],
      "columnas_normalizadas": [],
      "registros": []
    }
  }
}
```

### Bloques principales

- `tabla_empleado`: datos del panel izquierdo de CUAD
- `tabla_totales`: datos de la tabla de totales
- `tabla_movimientos`: filas de la grilla superior

Cada elemento de `tabla_movimientos.registros` representa una fila de la tabla.

## Configuracion importante

En `main2.py` revisar:

- `COOKIE_CUAD`
- `INICIAR_NUEVA_CORRIDA`
- `LIMITE_CUAD`

Por linea y estado ya no hace falta editar el codigo: se pueden pasar por linea de comandos.

Para usar un Excel manual tampoco hace falta tocar el codigo.

### Sesion de CUAD

El script requiere una sesion valida de CUAD cargada en `COOKIE_CUAD`.

Este script no automatiza el inicio de sesion en CUAD.

Antes de ejecutarlo:

- se debe ingresar manualmente a CUAD
- se debe resolver manualmente el captcha
- se debe copiar una cookie valida en `COOKIE_CUAD`

Existe una version alternativa con OCR para resolver captcha, pero no fue necesaria en este proceso porque la ejecucion se realiza una sola vez al mes.

Si la sesion vence durante la ejecucion:

- el proceso se detiene
- al actualizar la cookie y volver a ejecutar, el script puede reanudar desde lo ya guardado en el `resultados_cuad_main2*.ndjson` correspondiente

### Uso recomendado

#### Corrida nueva

```python
INICIAR_NUEVA_CORRIDA = True
```

Arranca de cero para el periodo actual y respalda archivos previos de `main2` si existen.

#### Reanudar

```python
INICIAR_NUEVA_CORRIDA = False
```

Reanuda tomando como base `resultados_cuad_main2.ndjson`.

#### Prueba corta

```python
LIMITE_CUAD = 10
```

Sirve para validar con pocos registros antes de correr todo.

## Comportamiento ante errores

- Si la sesion de CUAD vence, el proceso se detiene.
- Al volver a ejecutar con una cookie nueva, puede reanudarse.
- Si `ACTIVOS` no devuelve resultado, consulta `PASIVOS`.
- Reintenta errores transitorios de red y timeout.

## Ejecucion

Desde la carpeta del proyecto:

```powershell
python main2.py
```

### Consultar otra linea de Vimarx

Ejemplo:

```powershell
python main2.py --linea-vimarx "Nombre de la otra lista"
```

Opciones disponibles:

- `--linea-vimarx`: valor de `[LineaPrestamo.Superior.Descripcion]`
- `--estado-vimarx`: valor de `[Estado]` en Vimarx
- `--etiqueta-salida`: sufijo manual para los archivos de salida

Ejemplo completo:

```powershell
python main2.py --linea-vimarx "Nombre de la otra lista" --estado-vimarx "Activa" --etiqueta-salida "otra_lista"
```

### Consultar desde un Excel de CUILes

Ejemplo:

```powershell
python main2.py --archivo-cuiles "C:\Users\Nicolas\Downloads\MEDICOS -A-.xlsx" --columna-cuiles CUIT --etiqueta-salida "medicos_a"
```

Opciones disponibles:

- `--archivo-cuiles`: ruta al archivo Excel
- `--hoja-cuiles`: nombre de la hoja a usar
- `--columna-cuiles`: encabezado, letra o numero de la columna con CUIL/CUIT
- `--limite-cuad`: cantidad maxima de CUILes a consultar en esa corrida

Si no se informa `--hoja-cuiles`, toma la primera hoja.

Si no se informa `--columna-cuiles`, intenta detectar automaticamente una columna `CUIL` o `CUIT`.

### Exportar a Excel

Si no se informa archivo, los scripts toman el `resultados_cuad_main2*.ndjson` mas reciente dentro de `corridas/`.

```powershell
python excel_totales.py
python excel_movimientos.py
```

Tambien se puede indicar un archivo puntual:

```powershell
python excel_totales.py corridas/2026-07/resultados_cuad_main2_otra_lista.ndjson
python excel_movimientos.py corridas/2026-07/resultados_cuad_main2_otra_lista.ndjson
```
