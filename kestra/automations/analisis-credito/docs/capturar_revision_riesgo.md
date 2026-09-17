# Captura prospectiva de Revisión Riesgo

Pedido del 17/09/2026: construir una base de cómo se veían las solicitudes
cuando estaban en revisión, incluyendo todos los adjuntos originales.

Flow: `capturar_revision_riesgo`, dominio `analisis-credito`. Frecuencia:
`* * * * *`, todos los días. El deploy habilita el cron sólo en prod mediante
`schedule_scope: prod_only`. No mezcla los archivos de dev/prod: la carpeta
de volumen incluye el namespace del flow.

## Fuente y alcance

La selección es `[Estado.ID] = 114`, verificado como `RevisionRiesgo`. Incluye
todas las líneas y todas las fechas de creación. No confundirlo con
`VerificacionRiesgo` (ID 118) ni con `Revisar` de vendedores.

El core se consulta únicamente mediante proyecciones `EvaluateList`. No se
actualizan solicitudes, adjuntos, estados ni calculadoras. No se ejecutan
EVALUARXP/STOREXP, OCR, nuevas consultas BCRA ni funciones dentro de los Excel.

Se capturan:

- 56 campos de solicitud: identidad y documento, línea/convenio, condiciones e
  importes, fechas, ingresos, cupos, riesgo guardado, antigüedad, datos de los
  adicionales, estado documental, observaciones, ejecutivo y vendedor/usuarios,
  referencia a préstamo y conteos. Inventario exacto versionado en
  `APPLICATION_FIELDS` de `files/capturar_revision_riesgo/archive.py`.
- Todas las novedades accesibles (ID, Fecha, Texto).
- Índice completo de adjuntos (ID, nombre original, tamaño, descripción).
- Todos sus contenidos, sin filtrar por extensión: PDF, imágenes, Excel,
  JSON BCRA y cualquier otro formato. Se preservan bytes originales y SHA-256.
- Datos e índices releídos al finalizar, para identificar cambios durante
  la captura. No sustituir ausencia de información por cero.

**“Todos los datos” no significa una copia íntegra de la base del core.** La
API disponible requiere una lista de propiedades escalares. Los 56 campos
fueron comprobados en vivo; novedades y adjuntos tienen consultas separadas.
No se recorre el grafo completo de socios/cuentas/garantes, que puede generar
objetos enormes. CBU directo, TNA y TEA no resultaron accesibles mediante los
paths ensayados y no se presentan como archivados. Si están en un adjunto, se
conserva ese documento. Ampliar el inventario exige validar paths y versionar
el contrato, dejando claro desde cuándo existe la nueva cobertura.

## Almacenamiento y versiones

Host: `/opt/kestra/data/analisis-credito-capturas/<namespace>/`.
Dentro del contenedor: `/data/capturas`. No se publica en la web ni se adjunta
a outputs de Kestra. Los logs contienen sólo conteos, tiempos y códigos de error.
Los datos identificados requieren el mismo acceso restringido que los originales.

```text
objects/<2 primeros caracteres SHA>/<SHA completo>    bytes originales y payloads
applications/<Oid>/first.json                         primera observación registrada
applications/<Oid>/latest.json                        índice de última observación
applications/<Oid>/observations/<fecha UTC + id>/
    initial.json                                     solicitud antes de descargar
    events.json                                      novedades y hora de lectura
    attachment-index.json                            metadatos y hora de lectura
    downloads/<adjunto ID>.json                       resultado individual y hash
    after.json                                       segunda lectura del core
    manifest.json                                    completitud y referencias
    failure.json                                     sólo si hubo interrupción
pending.json                                         reintentos pendientes
runs/<fecha UTC + id>-scan.json                       selección y ventana de consulta
runs/<fecha UTC + id>-summary.json                    resumen de corrida
```

`first.json` no se cambia al volver a ver la misma solicitud. Cada sondeo crea
una observación nueva, aunque nada haya cambiado. Los objetos se deduplican por
contenido; una misma calculadora no ocupa otra copia binaria cada minuto.
`payload.sha256` identifica la versión conjunta de solicitud, novedades y
adjuntos. No incluye timestamps locales de lectura, para que los reintentos
sin cambios tengan el mismo hash de contenido.

Se vuelve a leer el contenido de todos los adjuntos en cada captura. Así se
detecta una modificación con el mismo ID, nombre y tamaño. El hash por sí solo
detecta bytes distintos, no explica qué cambió dentro de un documento. Un
adjunto borrado del core no se borra del archivo histórico. El nombre original
queda en el manifiesto y nunca se usa como ruta, evitando colisiones o rutas
fuera del archivo. No se abren ni ejecutan binarios recibidos.

`latest.json` y `pending.json` son índices operativos que sí se actualizan;
no reemplazan los originales ni los manifiestos históricos. Los escaneos
conservan todas las filas iniciales aun si una ejecución se interrumpe antes
de terminar de descargar. Los timestamps están en UTC e incluyen comienzo y
fin de consulta/descarga; no atribuir una hora de descarga al archivo en el core.

## Qué garantiza y qué no

La **primera observación conservada** no es necesariamente la entrada exacta
al estado, la primera revisión de su historia ni una versión sin cambios
previos. Puede ser una reentrada después de decisiones anteriores. Si una
solicitud entra y sale entre sondeos, puede no verse. Para garantizar el instante
de entrada haría falta un evento/transacción del core o un historial de versiones
confiable. Esta captura no inventa esa garantía.

Tampoco hay una transacción de lectura que congele la solicitud y todos sus
archivos a la vez. `metadata_stable=true` significa que ambas lecturas de
datos/índices/novedades coinciden; no demuestra que cada binario permaneció
inalterado durante toda la ventana. Las horas de descarga ayudan a delimitar
esa incertidumbre. `complete=true` exige además que se hayan descargado todos
los adjuntos esperados, coincidan tamaños/conteos y no existan errores.

Si algo cambia durante la captura, el manifiesto queda parcial, pero conserva
los datos y bytes ya obtenidos. Se reintenta mientras siga en revisión y se
mantiene un pendiente si salió del estado. Los reintentos tardíos se etiquetan
`late_retry_after_absence_from_risk`: son una lectura posterior, **no reconstruyen
ni completan retroactivamente los bytes que faltaron en la primera observación**.
Si un adjunto ya desapareció, su contenido original puede resultar irrecuperable.

Los reintentos tardíos usan espera creciente hasta una hora y no se descartan
silenciosamente. Una captura posterior completa puede cerrar el pendiente de
la solicitud; el manifiesto inicial conserva sus errores. Para el dataset de
entrada, revisar su propio `complete`, origen y ventana de lectura, nunca
atribuirle la completitud de `latest.json`.

## Cuándo la corrida se reporta como fallida

Una observación parcial no implica que falte información por recuperar. Si una
persona edita la solicitud mientras se la captura, el sondeo siguiente vuelve a
fotografiarla completa. Por eso el manifiesto registra en `partial_reason` cuál
de los dos casos ocurrió, y el resumen los cuenta separados:

| `partial_reason` | Códigos | Resumen | Corrida |
| --- | --- | --- | --- |
| `changed_during_capture` | `changed_during_capture`, `attachment_size_changed`, `attachment_count_mismatch`, `event_count_mismatch` | `partial_changed` | `ok`; se reintenta |
| `fetch_or_storage_error` | red, HTTP, base64, límites, almacenamiento, interrupción | `partial_error` | falla |

`ok=false` exige `partial_error`, `retry_fetch_failures` o `stuck`, siendo
`stuck` los pendientes con `STUCK_RETRY_ATTEMPTS` intentos o más: con la espera
creciente, cerca de una hora sin poder archivar la misma solicitud. Un escaneo
fallido, la falta de disco o de configuración siguen fallando de inmediato.

Esto cambia únicamente qué se reporta como falla del flow y, con ello, las
alertas de `alerta_flow_fallos`. **No cambia lo que se archiva:** las
observaciones parciales se siguen marcando `complete=false`, con sus errores y
su pendiente, y no se presentan como capturas completas. Una edición concurrente
repetida que nunca se resuelve termina reportada por la vía de `stuck`, en vez
de generar una alerta por minuto desde el primer intento.

## Límites operativos

- Un proceso a la vez, también mediante lock local, y tres solicitudes en
  paralelo como máximo. Si la corrida tarda más de un minuto, no prometer una
  observación por minuto: el disparador puede esperar o cancelar un solapamiento.
  [Semántica de concurrencia de Kestra](https://kestra.io/docs/workflow-components/concurrency).
- Imagen existente `ghcr.io/kestra-io/kestrapy:latest`; colector de biblioteca
  estándar Python, sin instalar dependencias en cada minuto.
- Límite de lectura: 2.000 solicitudes activas, 1.000 adjuntos por solicitud,
  10.000 novedades por solicitud. Se solicita uno más y se rechaza truncamiento
  en vez de afirmar cobertura completa.
- Máximo de contenido individual: 50 MiB; archivos superiores se registran
  como error, sin marcar la captura completa. Se requiere 1 GiB libre y se
  revisa espacio antes de escribir objetos nuevos. No hay borrado automático.
- Timeout de tarea: diez minutos. Los JSON iniciales y los recibos de descarga
  individuales ya escritos permanecen si la tarea se interrumpe. Una interrupción
  entre archivos puede dejar una observación sin manifiesto final.
- Los permisos nuevos son privados (`umask 077`). El volumen persiste al
  recrear contenedores; eso no sustituye backup. No se comprobó que una política
  de backup existente incluya esta ruta: incorporarla al esquema operativo.

## Validación y despliegue

```sh
python -m unittest discover -s kestra/automations/analisis-credito/tests -p 'test_capturar_revision_riesgo.py'
python kestra/tools/validate_kestra.py
python kestra/tools/deploy_kestra.py --environment prod --domain analisis-credito --dry-run
```

La prueba local contra el core del 17/09/2026 conservó una solicitud activa,
tres adjuntos, sin errores ni cambios de metadatos detectados. No se extrapola
esa medición a tiempos/cobertura en horario de mayor carga. La API de Kestra
validó el YAML sin errores ni advertencias antes de publicarlo.

El YAML, los namespace files, las pruebas y esta documentación se mantienen
en Git dentro del dominio `analisis-credito`. El workflow
`.github/workflows/deploy-prod.yml` detecta estos paths y despliega el dominio
desde `main` con `kestra/tools/deploy_kestra.py`. No requiere un despliegue
separado ni cambios persistentes desde la UI de Kestra. El deploy normaliza
el namespace y mantiene el cron habilitado únicamente en prod.

La activación inicial se realizó de forma selectiva desde el commit de
investigación indicado abajo. Para incorporar el flujo al circuito habitual,
se extrajeron únicamente estos archivos a `feat/captura-revision-riesgo`,
basada en `main`; la UI y el resto de la investigación conservan su propia
rama. Los adjuntos y datos personales son datos operativos del volumen privado,
no archivos que deban subirse a Git.

### Activación verificada — 17/09/2026

Código desplegado desde el commit `313af2c`, rama
`research/motor-criterios-crediticios`. Se subieron únicamente los dos archivos
Python de `capturar_revision_riesgo/` y luego este YAML mediante las funciones
del deploy canónico. Namespace: `redunisol.prod.analisis-credito`, revisión 1,
flow y cron habilitados. No se desplegó el resto del dominio ni se integró la
rama en main.

Validaciones locales: estructura válida, 228 pruebas del dominio aprobadas y
dry-run correcto. Validación del YAML en Kestra sin errores ni advertencias.

Ejecuciones automáticas comprobadas (horario Argentina):

| Inicio | Ejecución | Resultado | Solicitudes | Adjuntos | Parciales | Versiones distintas de la anterior |
| --- | --- | --- | --- | --- | --- | --- |
| 13:01 | `6gy8kqJz1bFIYKptoJkJhe` | SUCCESS | 1 | 4 | 0 | 1 |
| 13:02 | `3YH9nIz2IYuTKzJjA1JJpn` | SUCCESS | 1 | 4 | 0 | 0 |

Ambas terminaron sin pendientes. La primera duró 11,13 segundos incluyendo
arranque del contenedor. La segunda reconoció la misma versión archivada en
la primera, comprobando continuidad del volumen entre ejecuciones. La
verificación usó estados y resúmenes de logs de Kestra; no publicó documentos
ni datos de solicitantes. No se verificó restauración desde backup.

El runner emitió un aviso informativo sobre no inferir la versión de Python
desde la etiqueta `kestrapy:latest`; no afectó la ejecución. El colector usa
la biblioteca estándar y no instala dependencias durante el sondeo.
