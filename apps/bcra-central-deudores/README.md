# BCRA Central de Deudores PNFC

Proceso para consultar la API de préstamos/cuotas y generar la presentación final:

- `output/informacion.zip`

## Ubicacion en redunisol-platform

Esta carpeta versiona el motor Python y el panel local BCRA dentro del monorepo
`Red-Unisol/redunisol-platform`.

La integracion web vive en `web/redunisol-web` como una herramienta interna
protegida por login. La pantalla web no reimplementa las reglas BCRA: abre este
panel Python para conservar la logica ya validada.

Comando local del panel:

```bash
python run_panel.py --host 127.0.0.1 --port 8080
```

El panel tiene proteccion propia por clave, aun cuando se abra desde una web
interna protegida. La clave real no se versiona; se configura con:

```env
BCRA_PANEL_ACCESS_REQUIRED=true
BCRA_PANEL_PASSWORD_HASH=sha256:<hash>
```

Para generar el hash:

```powershell
$clave = "cambiar-esta-clave"
$hash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($clave))).Replace("-", "").ToLower()
"sha256:$hash"
```

En pruebas locales se puede desactivar solo de forma controlada:

```env
BCRA_PANEL_ACCESS_REQUIRED=false
```

Si `BCRA_PANEL_ACCESS_REQUIRED=true` y falta `BCRA_PANEL_PASSWORD_HASH`, el
panel inicia pero queda bloqueado con una pantalla de configuracion pendiente.

Variable usada por la web:

```env
BCRA_PANEL_URL=http://127.0.0.1:8080
```

No subir a Git bases, corridas, archivos finales, logs ni configuraciones reales:

- `data/`
- `runs/`
- `output/`
- `control/`
- `config.full.json`
- `config.local.json`
- `.env`

El ZIP contiene `detalle.xml` en la raíz y una carpeta por período `YYYYMMDD`
con los TXT:

- `detalle.xml`
- `YYYYMMDD/IMPORTES.TXT`
- `YYYYMMDD/PROVEEDORES.TXT`
- `YYYYMMDD/TASA.TXT`

## Configuración

Crear `config.json` a partir de `config.example.json` o usar `config.full.json`
para la corrida completa ya validada.

Campos principales:

- `fecha_corte`: debe estar en formato `YYYY-MM-DD` y ser el último día del mes.
- `max`: techo de filas solicitado a la API.
- `headers`: permite configurar autenticación sin hardcodear credenciales.
- `lineas_excluidas`: líneas excluidas del universo informado.
- `cuits_excluidos`: CUIT completos a excluir por configuración.
- `nro_cuentas_excluidas`: préstamos puntuales a excluir por configuración.

Para esta base, `max` debe quedar en `1000000`: la consulta completa devolvió
`414282` filas, por debajo de ese techo. Si la API devuelve exactamente `max`,
el proceso marca posible truncamiento y no genera `informacion.zip`.

Los headers pueden usar variables de entorno:

```json
{
  "headers": {
    "Authorization": "Bearer ${CELESOL_TOKEN}"
  }
}
```

## Archivos Generados

Definitivos en `output/`:

- `PROVEEDORES.TXT`
- `IMPORTES.TXT`
- `TASA.TXT`
- `detalle.xml`
- `informacion.zip`

Reportes de control en `control/`:

- `reporte_control.json`
- `reporte_control.csv`
- `errores.csv`
- `prestamos_unicos.csv`
- `deudores_consolidados.csv`
- `deudores_por_superior.xlsx`
- `prestamos_tasa.csv`
- `exclusiones_manuales.csv`

Por compatibilidad, también se copian `reporte_control.*` y `errores.csv` en
`output/`, pero la carpeta canónica de control es `control/`.

## TASA.TXT

Por defecto se usa modo manual:

```json
{
  "tasa": {
    "modo": "MANUAL",
    "otorgadas_sin_garantia_real_mes": 0,
    "tasa_promedio_manual": "000,00"
  }
}
```

Reglas:

- Si `otorgadas_sin_garantia_real_mes = 0`, genera `0;000,00`.
- Si `otorgadas_sin_garantia_real_mes = 1`, genera `1;EEE,DD`.
- `tasa_promedio_manual` debe usar coma decimal y dos decimales.

En el panel, la compañía se considera siempre con créditos sin garantía real
otorgados en el mes. Por eso no se pregunta ese dato: la tasa manual queda
siempre editable y `TASA.TXT` se genera como `1;EEE,DD` usando el valor cargado.

El modo automático queda preparado, pero no debe activarse hasta confirmar en la
API los campos reales de fecha de otorgamiento, monto otorgado y garantía real.
No se usan préstamos activos, cuotas, `Fecha`, `FechaCobro`, `SaldoPrestamo`,
`MontoTotal` ni `NroCuota = 0` para inferir TASA.

## detalle.xml y ZIP

`detalle.xml` se genera con:

- régimen `2`
- requerimiento `6`
- tipo `NORMAL` o `RECTIFICATIVA`
- período igual a `fecha_corte`
- rutas exactas con carpeta de período:
  `/YYYYMMDD/IMPORTES.TXT`, `/YYYYMMDD/PROVEEDORES.TXT`,
  `/YYYYMMDD/TASA.TXT`

`informacion.zip` no incluye reportes ni errores. Dentro del ZIP, los TXT van
en la carpeta del período, por ejemplo `20250930/`.

## Ejecución

```powershell
python run_bcra_deudores.py --config config.full.json
```

## Panel Local

El panel administra el mes de presentación, superiores, exclusiones manuales,
TASA manual e historial de corridas usando SQLite local.

```powershell
python run_panel.py --host 127.0.0.1 --port 8080
```

Abrir:

```text
http://127.0.0.1:8080
```

El panel crea `data/panel_control.db` y sincroniza superiores desde
`control/prestamos_unicos.csv` cuando existe. Cada corrida iniciada desde el
panel guarda sus archivos en:

```text
runs/YYYY-MM/YYYYMMDD_HHMMSS/output/
runs/YYYY-MM/YYYYMMDD_HHMMSS/control/
```

La última corrida exitosa también copia los archivos a `output/` y `control/`
para mantener compatibilidad con la ejecución por consola.

Desde el panel se editan:

- superiores excluidos, que alimentan `lineas_excluidas`;
- superiores con situación `01` hasta 66 días, que alimentan
  `lineas_situacion_01_hasta_66_dias`;
- alias de superiores, solo para lectura operativa; el proceso sigue usando el
  nombre real informado por la API;
- clasificación TASA futura por superior: sin garantía real por defecto o no
  aplica. En esta operatoria los productos no se ofrecen con garantía real;
- CUIT excluidos;
- números de préstamo excluidos;
- TASA manual.

También permite:

- guardar la configuración actual en `data/config_guardada.json`;
- validar la configuración antes de ejecutar;
- descargar el `config_aplicada.json` exacto usado en cada corrida iniciada desde
  el panel;
- ocultar errores de control ya revisados desde la vista del panel, dejando la regla
  auditada en SQLite sin modificar el reporte original;
- resolver errores con acciones asistidas: excluir CUIT, excluir NroCuenta,
  marcar revisado o ignorar con justificación cuando corresponda;
- ver totales con separador de miles para lectura rápida, por ejemplo
  `19.951.711`.

Flujo recomendado:

1. Elegir mes. El panel calcula la fecha de corte como último día del mes.
2. Revisar superiores y reglas. `HABERES DESCUENTO POLICIA CBA` queda marcado
   por defecto con situación `01` hasta 66 días.
3. Cargar exclusiones de CUIT o NroCuenta con motivo obligatorio.
4. Presionar **Validar configuración**.
5. Si no hay errores bloqueantes, presionar **Ejecutar presentación**.
6. Descargar el archivo principal **informacion.zip** desde la tarjeta superior.

Antes de cada corrida el panel congela la configuración en:

```text
runs/YYYY-MM/YYYYMMDD_HHMMSS/config_aplicada.json
runs/YYYY-MM/YYYYMMDD_HHMMSS/config_aplicada_resumen.txt
runs/YYYY-MM/YYYYMMDD_HHMMSS/snapshot_superiores.csv
runs/YYYY-MM/YYYYMMDD_HHMMSS/snapshot_exclusiones_cuit.csv
runs/YYYY-MM/YYYYMMDD_HHMMSS/snapshot_exclusiones_nro_cuenta.csv
runs/YYYY-MM/YYYYMMDD_HHMMSS/prevalidacion.json
runs/YYYY-MM/YYYYMMDD_HHMMSS/manifiesto_presentacion.json
```

La corrida usa `config_aplicada.json`; cambios posteriores en el panel no
modifican la configuración histórica de corridas anteriores.

La tarjeta **Archivo final de presentación** destaca `informacion.zip`. Ese es el
archivo para presentar. Los TXT, XML y reportes se muestran como acciones
secundarias. Los reportes de control nunca se incluyen dentro del ZIP.

Los errores se resuelven desde la sección **Errores y acciones sugeridas**. Las
acciones modifican la configuración en SQLite y requieren nueva corrida; no editan
archivos finales manualmente. Las resoluciones quedan auditadas en la tabla
`errores_resoluciones`.

## Validaciones

Antes de considerar definitiva la presentación, el proceso valida:

- No truncamiento de API.
- Existencia de TXT, XML y ZIP.
- Un solo registro por CUIT en PROVEEDORES e IMPORTES.
- Correspondencia de CUIT y totales entre PROVEEDORES e IMPORTES.
- Campos fijos de PROVEEDORES.
- Normalizacion BCRA de Denominacion en PROVEEDORES: mayusculas, sin tildes,
  sin Ñ, sin tabulaciones, sin saltos internos y sin caracteres especiales
  fuera de letras A-Z, numeros, espacios, puntos y guiones.
- CUIT numérico de 11 dígitos.
- Fechas `YYYY-MM-DD`.
- Mora sin cuota `0` ni montos no positivos.
- Exclusiones por línea, CUIT y número de cuenta.
- Encoding cp1252 y saltos CRLF.
- `TASA.TXT` con una sola línea y formato válido.
- XML bien formado.
- ZIP abrible y con exactamente los archivos esperados.

## Tests

```powershell
python -m unittest discover -s tests
```
