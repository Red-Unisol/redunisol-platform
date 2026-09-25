# Migración histórica de rechazos en Kestra

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

- Cada diez minutos entre las 22:00 y las 06:00 de Argentina, solo en producción.
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
