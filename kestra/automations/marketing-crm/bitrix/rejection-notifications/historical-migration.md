# Migración histórica de rechazos en Kestra

## Estado al 02/10/2026: migración y retiro de etapas completados

El cron se retira del YAML. El flow permanece disponible para inspección manual;
se conservan código, inventario aprobado y diario. No reactivar la programación
para intentar vaciar las etapas: el inventario es cerrado y no incluye todos los
prospectos que hoy ocupan esos estados.

Publicado únicamente este flow desde `8d31522` mediante el deploy del repositorio.
La relectura de producción confirmó **revisión 4, sin triggers**, conservando
tareas, inputs y outputs de la revisión 3. El cambio debe incorporarse a `main`
para que los siguientes despliegues del dominio mantengan retirado el cron.

La última escritura nocturna terminó a las **05:08 ART**. El diario registra
75.254 candidatos procesados: **75.242 migrados y verificados**, **12 omitidos por
cambios**, cero pendientes, cero escrituras inciertas y ninguna pausa. El último
tick `2qq1dL8F2CUkzbeoFJ0I4g` terminó correctamente a las 05:50 ART y conservó esas
cantidades. SHA-256 del diario nocturno:
`cd8ca8425ac6db9ff00cbbd74c824f280242da6bb31c0b258e2e2ea5daa786af`.

La revisión de cierre releyó los últimos 100 migrados y confirmó los tres campos
esperados. No es una revalidación completa del estado actual de los 75.242 casos.
La plantilla 889 conserva el filtro conjunto: RESULTADO PERDIDO, ID > 396841 y
marca de aviso vacía, verificado en el diseñador sin guardar cambios.

Se revisaron individualmente los 12 omitidos:

- Nueve conservaban etapa, fecha de creación, motivo y marca del inventario;
  solamente había cambiado la fecha de modificación. Se completaron con el motivo
  original y `HISTORICAL`, releyendo antes y después y conservando un diario separado.
- Dos ya estaban convertidos: se excluyen definitivamente de esta migración.
- Uno pasó de AUH a PRIVADOS: se conserva su clasificación actual y queda excluido
  del inventario original. No se le aplica el motivo AUH ni se infiere uno nuevo.

El balance del inventario tras esas correcciones es **75.251 migrados** y **tres
exclusiones revisadas**. El diario nocturno permanece inalterado y sigue mostrando
12 omisiones; la evidencia de las nueve correcciones se guarda separadamente.
Una segunda lectura confirmó los nueve resultados y el control de comunicaciones
no encontró actividades nuevas, cambios de chats ni nuevos IDs de mensajes entre
las dos observaciones. Esto no acredita entrega ni ausencia de envíos futuros.
Las copias privadas de la revisión están en
`.local/artifacts/rejection-close-20261002/` del checkout operativo; no versionar
los datos individuales ni reemplazar el inventario aprobado.

### Diagnóstico previo a la normalización final

La consulta completa de las 16 etapas encontró 115 prospectos antes de las nueve
correcciones: 37 posteriores al corte, 26 con marca `PROCESSED` y tres con marca
`HISTORICAL`. Esto acredita ocupación actual, no atribuye los cambios a un robot o
persona determinados. No ampliar la migración automáticamente ni sobrescribir
motivos contradictorios.

| Etapa | Prospectos antes de las correcciones |
| --- | ---: |
| OTRA PROVINCIA | 10 |
| SIT NEG BCRA | 11 |
| OTRO BANCO | 13 |
| NO TIENE ANTIGUEDAD | 0 |
| AUTONOMO | 19 |
| AUH (asignaciones) | 2 |
| JUBILADO PROVINCIAL | 7 |
| PENSIONADO | 4 |
| JUBILADO NACIONAL | 12 |
| PUBLICO NACIONAL | 1 |
| NO TIENE RECIBO (en negro) | 1 |
| CONTRATADO | 0 |
| NUMERO INCORRECTO | 0 |
| PRIVADOS | 18 |
| MUNICIPAL | 15 |
| NO CUMPLE REQUISITOS PARA CONVENIO | 2 |

Tras las nueve correcciones se recontaron las 16 etapas: **106 prospectos**.
El historial confirma que los tres casos con `HISTORICAL` habían llegado a
RESULTADO PERDIDO y después volvieron a otras etapas antiguas. Las seis muestras
de historial consultadas (esos tres, dos nuevos y el omitido con cambio de etapa)
registran la última modificación bajo el usuario 57; ese dato no identifica por
sí solo si la acción fue manual o ejecutada por una integración con ese usuario.

El panel de automatizaciones todavía muestra robots de comunicación en las etapas
originales, incluidas las vacías. Además, `JUNK` es un estado de sistema
(`SYSTEM=Y`). La búsqueda en el código vigente de marketing y web no encontró los
IDs históricos alfanuméricos, pero no reemplaza una auditoría de procesos Bitrix,
integraciones externas y asignaciones numéricas.

Ese diagnóstico motivó una autorización adicional para los 106 restantes. El
resultado posterior se registra a continuación y reemplaza el pendiente de limpieza.

### Normalización final autorizada y verificada

Santiago aprobó el criterio **la etapa de rechazo actual prevalece sobre el motivo
anterior**, aplicado exclusivamente a los 106 IDs revisados (69 anteriores al corte
y 37 posteriores). No cambia las reglas comerciales ni recalifica casos activos.
Ver decisión `LEAD-DEC-REJ-20261002` en
[el registro funcional](../../docs/commercial-rules/DECISION_LOG.md).

- **106/106 verificados** en RESULTADO PERDIDO, con el motivo correspondiente a su
  etapa de origen. Relectura antes de cada lote; cero cambios concurrentes omitidos
  y cero escrituras inciertas.
- **26 PROCESSED conservados; 80 HISTORICAL** (tres ya tenían la marca, 77 estaban
  vacíos). Se conservaron responsables, contactos y demás datos comerciales.
- El control de los 106 no detectó actividades nuevas, cambios de chats ni nuevos
  IDs de mensajes entre las observaciones. Es una comprobación temporal, no una
  auditoría de entrega de todos los proveedores.
- Recuento de las 16 etapas: **cero prospectos**. Se respaldaron sus 16 plantillas,
  la plantilla central 889 y el catálogo antes de intervenir.
- **31 robots antiguos desactivados y guardados** mediante acciones grupales.
  No se borraron plantillas de procesos arbitrariamente.
- Se eliminaron por REST **15 estados no sistémicos**, tras releer individualmente
  que seguían vacíos. La relectura del catálogo confirmó su ausencia. Se conservaron
  los motivos de rechazo del campo personalizado y el manifiesto histórico original.
- **JUNK se conserva**, por ser de sistema, con sus dos robots desactivados. No usar
  esa etapa para rechazos nuevos; utilizar RESULTADO PERDIDO y su motivo. No se
  activó una redirección ni se forzó la eliminación del estado del sistema.
- Los procesos vigentes NEW (1), GANADO (159), SIN RESPUESTA (709) y general (1019)
  revisados no contienen actividades que asignen esas etapas. Esta revisión no
  acredita una auditoría de toda integración externa o acción manual.

El caso excluido del inventario original por pasar de AUH a PRIVADOS quedó incluido
en esta normalización separada con motivo PRIVADOS. Tres de los 106 ya figuraban
migrados en el diario original y habían regresado a etapas antiguas: no sumar los
106 al balance original como si todos fueran prospectos únicos adicionales.

La evidencia privada está en
`.local/artifacts/rejection-close-20261002/remaining-migration/`: plan y valores
previos, diario por lote, lectura final, controles de comunicaciones, catálogos y
diario de eliminación de etapas, exportaciones BPT. No contiene una nueva lista
abierta de candidatos ni debe utilizarse para reejecutar automáticamente.

La inspección manual admite fuentes ya retiradas y sigue verificando motivos,
etapa destino y resultados migrados. Los modos de escritura conservan la validación
estricta de todas las fuentes; después del retiro no deben ejecutarse. El cron sigue
ausente. No restaurar las etapas o robots desde los respaldos como rollback rutinario.

Se publicó únicamente `bitrix24_rejection_history/run.py` desde `fe2f802`, mediante
el deploy del repositorio; el archivo descargado coincide byte a byte. La ejecución
manual `3sLRUOGKQ5TTC9s73ZWrYE` terminó SUCCESS con `status=inspected`,
`live_verified=100`, `remaining=0`, `uncertain=0`, `paused=false` y cero mutaciones
externas. El flow permanece en revisión 4 sin triggers. La exportación final de la
plantilla central 889 conserva exactamente el mismo árbol de actividades que el
respaldo previo; JUNK exporta ambas actividades de comunicación con `Activated=N`.

La checklist de cierre de la tarea 22751 quedó completa. La tarea permanece abierta
hasta incorporar el PR #415 a `main`; no se publicaron mensajes en chats. Validación
local: estructura Kestra correcta; 106 tests, 105 correctos y uno omitido en Windows
por requerir locks Linux. Los checks remotos del PR quedan pendientes de revisión.


## Operación anterior y recuperación

El flow `bitrix24_historical_rejection_migration`, en
`redunisol.prod.marketing-crm`, sustituye la tarea de Windows
`RedUnisol-HistoricalRejections-20260924`. El YAML y su código Python viven en
Git; los datos privados y el diario viven en la VPS. No necesita una PC encendida,
una sesión interactiva, SSH desde el flow ni cambios manuales en la UI de Kestra.

## Inventario y avance inicial

El inventario aprobado el 24/09/2026 contiene **75.254** leads de las 16 etapas
fallidas del manifiesto, con corte `ID <= 396841`. Su SHA-256 es
`3be805e892af5682ad8fcbc9ec496fb097b7d21802e6280b091fde7bf21c757a`.
Quedan fuera los activos, ganados, convertidos, derivados a vendedor, motivos
contradictorios y los registros que ya estaban en Resultado perdido.

El piloto verificó 50 leads. La tarea local ejecutó otros 25 el 24/09 a las
22:00 ART y se interrumpió. La relectura del 25/09 confirmó esos 25, sin nuevas
actividades ni chats asociados. El corte de importación conserva **75 resultados
verificados y 75.179 pendientes**, sin intentos inciertos. No confundir `recovered`
(25 del piloto) con fallos: son escrituras confirmadas por una lectura posterior.

## Ejecución y garantías

- Antes del cierre: cada diez minutos entre las 22:00 y las 06:00 de Argentina, solo en producción.
  Cada ejecución trabaja como máximo ocho minutos; timeout de tarea: doce minutos.
  El horario se vuelve a comprobar inmediatamente antes de escribir.
- Una ejecución simultánea en Kestra y un bloqueo de sistema operativo en el
  volumen. El bloqueo se libera al morir el proceso; no depende de borrar un PID.
- Lotes de 25 separados al menos 30 segundos. El receptor debe estar activo, sin
  envíos inciertos ni recibos vencidos. Pendientes + checking + waiting + el lote
  no pueden superar 125. La falta de capacidad espera y cede la ejecución.
- Se releen etapa, motivo, marca y fechas antes de modificar cada lead. Los
  cambios concurrentes, registros ausentes y estados no fallidos se omiten.
- Solo se escriben juntos `STATUS_ID=UC_1P8I07`, el motivo aprobado y
  `UF_CRM_REJ_NOTICE=HISTORICAL`. No se reevalúa elegibilidad ni se envían avisos.
  La plantilla 889 excluye el corte histórico y la marca; `REGISTER_SONET_EVENT=N`
  solamente suprime publicaciones del feed.
- Se confirma en disco la intención antes del envío y se releen los tres campos
  después. Si un proceso muere entre escritura y verificación, la próxima
  ejecución solo reconoce el resultado por lectura. Si no coincide por completo,
  pausa para revisión: nunca reenvía una escritura incierta automáticamente.
- Un error deja `execution/paused.json`. Las siguientes ejecuciones no escriben
  en Bitrix hasta que un operador revise la causa. No hay retry automático de
  mutaciones. Al completar el inventario, los siguientes ticks no escriben;
  retirar el trigger mediante Git al cerrar la migración.
- Las lecturas transitorias admiten hasta tres intentos, con esperas de dos y
  cuatro segundos (HTTP 408/429/500/502/503/504, transporte o límites de Bitrix).
  Los batches, que pueden escribir, tienen un solo intento. Los errores de
  permisos, respuestas inválidas y demás errores funcionales no se reintentan.

`skip_*` significa omitido, no migrado. El resumen separa los resultados para no
dar esos casos por resueltos.

## Almacenamiento y acceso

Bind mount gestionado por el YAML:
`/srv/redunisol-migrations/bitrix-rejections-20260924` → `/migration`.

- `approved/`: copia inmutable del inventario, catálogos, guardas y diario inicial,
  con hashes fijados en `files/bitrix24_rejection_history/approved.json`.
- `execution/journal.jsonl`: diario que continúa desde los 75 casos importados.
- `execution/progress.json`: cantidades y estado actual.
- `execution/receiver-latest.json`: último estado observado del receptor.
- `execution/paused.json`: bloqueo de seguridad ante un error.
- `execution/last-error.json` y `execution/errors.jsonl`: último error e historial,
  con fase, servicio, operación, estado HTTP/código de API y cantidad de intentos
  cuando corresponda. Nunca contienen URLs, cuerpos HTTP ni mensajes originales
  de excepciones, que podrían incluir secretos.
- `execution/resumes/`: incidente original y evidencia de cada reanudación.

El directorio no está servido por la web de informes. No borrar ni reemplazar
sus datos durante un deploy. Respaldarlo junto con el almacenamiento de Kestra;
conservar también el inventario y diario originales de la PC para auditoría.

Bitrix usa los secrets ya existentes de Kestra. El contenedor entra a `kestra_net`
y consulta exclusivamente `GET /internal/stats` del receptor con su token
administrativo existente, leído desde `/opt/bitrix-lead-receiver/.env` montado
como solo lectura. No se copian credenciales a Git ni al archivo de importación.
La imagen de Python está fijada por digest y no instala paquetes en cada lote.

## Importación y puesta en marcha

1. Desactivar y releer la tarea de Windows; comprobar que no haya procesos locales
   de migración activos. Preservar sus archivos, incluido el bloqueo antiguo.
2. Ejecutar `kestra/tools/prepare_bitrix_history_seed.py --inventory-dir <inventario>
   --output <archivo-privado.zip>`. Solo incluye los ocho archivos permitidos y
   comprueba sus hashes; nunca incluye credenciales, scripts o el bloqueo local.
3. Publicar los namespace files y el flow versionados mediante la API y las
   funciones de `kestra/tools/deploy_kestra.py`. Limitar el despliegue inicial a
   este flow y su directorio para no alterar automatizaciones ajenas. El deploy
   habitual del dominio los mantendrá desde Git después del merge.
4. Ejecutar el flow con `mode=bootstrap` y `seed=<archivo ZIP>`. Importa datos,
   pero no escribe en Bitrix. Rechaza rutas extrañas, hashes diferentes, intentos
   pendientes y cualquier instalación previa: no puede sobrescribir progreso.
5. Ejecutar `mode=inspect` (valor predeterminado). Verifica catálogos, relee los
   75 leads importados, inspecciona los 25 siguientes y consulta el receptor.
   Más adelante relee hasta los últimos 100 migrados. No modifica leads.
6. Ejecutar `mode=run` durante el día para comprobar `outside_night_window`,
   conservando las mismas cantidades. El trigger nocturno pasa `mode=run`.

Ante un `paused.json`, revisar primero ejecución, diario y estado real de los
leads con intención incierta. No quitar el bloqueo para reintentar a ciegas ni
restaurar etapas originales: sus automatizaciones antiguas siguen activas.
Cualquier intervención sobre archivos de la VPS requiere autorización explícita.

## Reanudación después de una revisión

Con autorización del operador, ejecutar el mismo flow con `mode=resume`,
`resume_pause_sha256` igual al SHA-256 exacto del `execution/paused.json`
revisado y `resume_expected_handled` igual a la cantidad procesada revisada.
Estos parámetros nunca se agregan al trigger automático.

La operación conserva el bloqueo exclusivo y verifica el inventario y los
catálogos. Rechaza una pausa diferente, una cantidad inesperada o cualquier
escritura incierta. Relee **todos** los registros migrados para comprobar etapa,
motivo y marca histórica, inspecciona los 25 siguientes y exige un receptor
activo, sin envíos inciertos/recibos vencidos y con capacidad para el próximo lote.
Solo entonces archiva la pausa y guarda evidencia de la revisión. No modifica
leads ni continúa el lote durante esa ejecución; devuelve
`resumed_waiting_for_schedule` y el cron conserva la ventana nocturna.

Si la revisión falla, la pausa original permanece intacta. El nuevo diagnóstico
se guarda por separado, de modo que no se pierde la identidad del incidente
revisado. Un `SUCCESS` de Kestra no significa avance de la migración: consultar
`status`, `handled`, `remaining` y `paused`, también registrados explícitamente
en los logs. `paused_requires_review` indica que ese disparo no procesó el lote.

### Incidente revisado el 28/09/2026

La primera noche avanzó hasta 2.200 registros (2.175 `verified` y 25 `recovered`),
con 73.054 pendientes y cero escrituras inciertas. La ejecución
`1ysVa5GZWCnx6MwGpU4pf9` falló el 26/09 a las 00:30 ART y dejó la pausa activa.
El código anterior solo conservó `ApiFailure`: no hay evidencia suficiente para
atribuir retrospectivamente el error a Bitrix, al receptor o a una falla de red.

La revisión de solo lectura del 28/09 confirmó los tres campos esperados en una
muestra de 100 migrados, los 25 siguientes sin cambios respecto del inventario y
el último lote de 25 sin actividades nuevas desde la migración ni chats asociados.
Estos controles son una muestra; no acreditan una auditoría completa de entrega
de comunicaciones. La reanudación exige además la relectura completa indicada
arriba y debe documentarse con su ejecución real.

Reanudación autorizada y verificada el 28/09 a las 11:02 ART:

- Código publicado desde `5c9ff6f`, solo `core.py`, `run.py` y este flow;
  revisión de flow 3. Cron nocturno habilitado sin cambios de horario.
- Inspección `27FyaQA3iW8wyNfMt1s70e`: `SUCCESS`, 100 verificados, pausa activa.
- Reanudación `5iOA3X5aEcBPqCsPRwmLcE`: `SUCCESS`, `live_verified=2200`,
  `handled=2200`, `remaining=73054`, `uncertain=0`, `paused=false`, 25 siguientes
  elegibles y cero mutaciones externas durante la revisión.
- Guarda diurna `5jXpaXdq36xtYR16ddKReB`: `SUCCESS`, `outside_night_window`,
  mismas cantidades. Relectura de la VPS: pausa archivada, auditoría persistida
  y SHA-256 del diario sin cambios respecto de la inspección previa.
- La continuación queda habilitada para el 28/09 a las 22:00 ART. El primer lote
  posterior a esta reanudación queda pendiente de observar; próximo control
  previsto para el 29/09 a las 10:00 ART, sin promesa de terminar todo el inventario.

Referencia de configuración del runner:
[Docker task runner de Kestra](https://kestra.io/plugins/core/docker-task-runner/io.kestra.plugin.scripts.runner.docker.docker).

## Verificación del cambio, 25/09/2026

- Tarea local releída en estado `Disabled`; sin procesos locales de migración.
- Código de runtime publicado desde el commit `045d23f`, flow revisión 2, con
  trigger habilitado y cron nocturno releído mediante la API.
- Importación `2byRtjcz7Z2qHk56inixpC`: `SUCCESS`, sin escribir leads.
- Prueba diurna `5PUT5T5GbbXjWYYqy7XwhJ`: `outside_night_window`, 75 procesados,
  75.179 pendientes, cero inciertos, corroborado en el volumen de la VPS.
- Inspección final `3VMQ6eVIkOzPlpXnTTGJWl`: `SUCCESS`; outputs `live_verified=75`,
  `handled=75`, `remaining=75179`, `uncertain=0`, `paused=false`.
- El [PR #395](https://github.com/Red-Unisol/redunisol-platform/pull/395) contiene
  la implementación. El PR #394 de ejecución local quedó cerrado como reemplazado;
  sus artefactos y rama se conservaron. Los checks remotos no se monitorearon.

Esta verificación acredita la importación, las lecturas reales y la guarda diurna;
no acredita todavía el primer lote nocturno ejecutado por Kestra.
