# Presentaciones BCRA Celesol

`bcra_deudores_generate` ejecuta el motor recibido en
`BCRACENTRALDEUDORES_instalacion_limpio_20260921_120104.zip`.
SHA-256 del paquete: `59cc97e508414df9f92664832a79b4360d08aeeb8b28de5c1d6c376545271dd4`.
La interfaz vive en Herramientas, `/bcra`. El generador canónico está en
`kestra/automations/contabilidad/files/bcra_deudores/`; no requiere otro servidor Python.

## Fuente y alcance temporal

Cada corrida consulta nuevamente la API Celesol de Vimarx. No reutiliza importes
de una presentación anterior. El motor recibido utiliza `SaldoPrestamo` **vigente
al momento de consultar**, no un saldo histórico al cierre. El período determina
la fecha de corte de mora y excluye préstamos emitidos desde el primer día del
mes siguiente. Se conserva el filtro de préstamos `Activa` del motor recibido.

Esta diferencia se muestra en la pantalla y queda registrada como
`balance_basis=VIMARX_CURRENT_BALANCE`, con la fecha de extracción. Elegir un mes
pasado **no reconstruye** pagos, cancelaciones ni saldos de ese cierre. Para
obtener una presentación con saldo histórico hace falta una fuente que lo
proporcione o una reconstrucción contable verificada; no se aproxima usando
`FechaCobro`, `MontoTotal` ni el saldo actual de las cuotas.

La aplicación genera archivos y controles. No presenta información al BCRA ni
interpreta una generación local como aceptación del organismo.

## Reglas iniciales: julio 2026 versión 2

Referencia: tarea Bitrix 22017, mensaje 6566425 del 22/09/2026. Tefi confirmó
que lo cargaría en el mensaje 6567257. Esa confirmación no es un comprobante de
validación BCRA.

- Incluidos: Mudon Haberes, Préstamos Amortizables, Nación, Tarjeta de Débito,
  DASPU Haberes 830, Amejuca CBU y Bancor.
- Excluidos: Médica dentro de CUAD, AMES y las restantes exclusiones históricas
  enumeradas en `web/herramientas/config/bcra.php`.
- Médica comprende 11 productos exactos. Los planes de desendeudamiento de MUCI
  y Caja dentro de CUAD siguen incluidos.
- Los tres CUIT preconfigurados por Álvaro el 05/06/2026 se conservan en el
  runtime cifrado mediante `BCRA_DEFAULT_EXCLUDED_CUITS`; no se versionan en claro.
- La situación 1 hasta 66 días se precarga para Haberes Descuento Policía CBA,
  como en el motor original. Se puede modificar por superior antes de ejecutar.
- La TNA se ingresa para cada corrida; no se asume que el 112,00 histórico es
  válido para otros períodos. También puede indicarse que no hubo otorgamientos
  sin garantía real, para generar `0;000,00` según el motor original.

El mínimo de $25.000 se aplica a la suma por CUIT de los préstamos seleccionados,
antes de redondear a miles. Se eliminó el filtro original de $25.000 por préstamo,
que omitía socios con varios préstamos menores al mínimo individual.
La referencia del umbral por deudor es el punto 2 de la
[Comunicación A 8001 del BCRA](https://www.bcra.gob.ar/archivos/Pdfs/comytexord/A8001.pdf).

## Ejecución y persistencia

No tiene schedule ni webhook público. Laravel llama a la API autenticada de
Kestra con un input JSON `request`, usando un UUID nuevo por corrida. El flujo
serializa ejecuciones con `concurrency.limit=1` y valida nuevamente el catálogo,
la selección de IDs, el mes cerrado, la tasa y los motivos de las exclusiones.
El navegador nunca recibe credenciales, URL de Vimarx ni permisos para enviar
expresiones de consulta, rutas o configuración de servidor.

Las líneas sin descripción en Vimarx se conservan por ID y se muestran como
`Sin descripción (#ID)`, con las mismas reglas de selección. No se descartan
préstamos por ese motivo. La configuración guarda también `source_name` para
distinguir la descripción fuente de la etiqueta visible.

```text
/srv/redunisol-reports/contabilidad/bcra/<namespace>/<uuid>/
  metadata.json
  config_aplicada.json
  output/informacion.zip
  output/detalle.xml
  output/IMPORTES.TXT
  output/PROVEEDORES.TXT
  output/TASA.TXT
  control/...
```

`<namespace>` es `redunisol.dev.contabilidad` o `redunisol.prod.contabilidad`.
Cada corrida tiene directorio exclusivo: nunca reemplaza una anterior. Guarda
fecha de extracción, período, responsable declarado, reglas, selección de líneas,
exclusiones con motivo y hashes del motor y de sus artefactos. El nombre declarado
por el operador no equivale a identidad individual autenticada: usa el acceso
interno compartido existente en Herramientas.

Los reportes privados contienen datos necesarios para control, incluidos CUIT y
números de préstamo. No se escriben filas, nombres ni CUIT en los logs de Kestra.
El JSON aplicado no incluye headers, tokens ni URLs del servidor fuente.

Una fuente truncada, un catálogo incompleto o una fecha de emisión ausente impiden
generar el ZIP. Un fallo elimina cualquier ZIP parcial y conserva los controles.
Un UUID ya usado no puede ejecutarse nuevamente sobre sus archivos. Si el motor
termina con incidencias no bloqueantes, la pantalla muestra `NEEDS_REVIEW` y
permite descargar el detalle. Las descargas verifican el SHA-256 del archivo.

## Configuración y deploy

Kestra reutiliza `DEVEXPRESS_EVALUATE_API_BASE_URL`,
`DEVEXPRESS_EVALUATE_API_BEARER_TOKEN` y `envs.vimarx_verify_tls` del runtime existente.
El task monta `/srv/redunisol-reports:/reports`.

Herramientas requiere:

- El acceso de Análisis existente (`ANALISIS_PASSWORD_HASH`, fuente y token).
- `BCRA_KESTRA_URL`, `BCRA_KESTRA_USERNAME`, `BCRA_KESTRA_PASSWORD`.
- `BCRA_KESTRA_TENANT=main` y el namespace del ambiente.
- `BCRA_OUTPUT_ROOT=/data/bcra/<namespace>`.
- `BCRA_DEFAULT_EXCLUDED_CUITS`: JSON de objetos `value`, `reason`.

Compose monta el directorio BCRA como solo lectura en Herramientas. Kestra es el
único escritor de las corridas. Los runtimes cifrados de dev y prod incluyen las
claves; el despliegue sigue los workflows existentes. Primero publicar el dominio
contabilidad de Kestra y después Herramientas en el mismo ambiente.

No reintentar automáticamente un inicio si se pierde la respuesta HTTP: podría
haberse creado la ejecución. Consultar historial/estado antes de volver a generar.

## Validación

```powershell
$env:PYTHONPATH = 'kestra/automations/contabilidad/files'
python -m unittest discover -s kestra/automations/contabilidad/tests -p 'test_*.py'
python kestra/tools/validate_kestra.py
python kestra/tools/deploy_kestra.py --environment dev --domain contabilidad --dry-run
```

En `web/herramientas`: `php vendor/phpunit/phpunit/phpunit --filter BcraTest` y
`npm test`. Las pruebas cubren controles originales, sumatoria por socio, mínimo
exacto, selección y emisión, importes que cambian entre corridas, fuente truncada,
preservación de corridas, acceso, archivos corruptos, parámetros no autorizados,
motivos obligatorios y la selección/generación desde la interfaz.
