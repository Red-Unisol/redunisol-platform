# Recuperacion de disparadores comerciales - 2026-11-03

## Alcance y estado deseado

Intervencion en produccion autorizada por el operador para recuperar el
enriquecimiento de prospectos y la calificacion de negociaciones, y comprobar
el procesamiento de pendientes. Horarios expresados en Argentina (UTC-03).

Los siguientes disparadores de `redunisol.prod.marketing-crm` deben permanecer
habilitados, con cron `* * * * *` y sin bloqueos asociados a ejecuciones ausentes:

| Flow | Trigger | Revision observada |
| --- | --- | --- |
| `bitrix24_lead_prefill` | `cada_minuto` | 8 |
| `bitrix24_catamarca_deal_qualification` | `cada_minuto` | 25 |

La recuperacion modifica exclusivamente estado operativo mediante la API publica
de Kestra. Las definiciones de flows y namespace files permanecen en Git; no fue
necesario cambiar YAML, variables, imagenes, reglas comerciales ni datos a mano.

## Evidencia y causa

1. El 2/11 a las 21:56 y 21:58, el journal registra tareas Ansible de actualizacion
   de paquetes mediante DNF.
2. A las 21:59:25, Ansible consulta `needs-restarting -r`.
3. A las 21:59:28, `systemd-logind` registra expresamente un reinicio automatico
   gestionado por Ansible debido a actualizaciones criticas.
4. A las 22:00:58, Docker inicia el apagado y PostgreSQL recibe una solicitud de
   apagado rapido. A las 22:01:08, Docker informa que varios contenedores no
   terminaron dentro de diez segundos y fuerza su cierre. El daemon finaliza
   forzosamente a las 22:01:13. El host vuelve a arrancar a las 22:01:53.
5. Ambos disparadores quedan bloqueados con `lastTriggeredDate` del 2/11 a las
   22:01:00 y `nextEvaluationDate` a las 22:02:00. Sus IDs de ejecucion no existen
   en la tabla `executions`, y la API de ejecuciones devuelve HTTP 404.
6. El monitor de Kestra repite `No execution found, schedule is blocked`.
   Un arranque posterior del contenedor tampoco elimino ese estado persistido.

La causa operativa comprobada es un bloqueo de scheduler huerfano durante el
apagado por actualizaciones. La ventana exacta de perdida del despacho se infiere
de los tiempos y del codigo del motor: Kestra guarda el estado del disparador
antes de publicar la creacion de la ejecucion. Si esta no llega al ejecutor, el
monitor avisa, pero no libera el bloqueo automaticamente. No se atribuye el
incidente a las reglas comerciales ni a una falta de vendedores.

Referencia del motor observado (`kestra/kestra:v2.0.0`):

- [TriggerEventHandler: persistencia antes del despacho](https://github.com/kestra-io/kestra/blob/v2.0.0/scheduler/src/main/java/io/kestra/scheduler/TriggerEventHandler.java).
- [TriggerSchedulerMonitor: ejecucion ausente genera aviso y retorna](https://github.com/kestra-io/kestra/blob/v2.0.0/scheduler/src/main/java/io/kestra/scheduler/TriggerSchedulerMonitor.java).

## Intervencion realizada

- 3/11, 10:09:11 y 10:09:12: desbloqueo individual por
  `POST /api/v1/main/triggers/{namespace}/{flowId}/cada_minuto/unlock`; ambos
  respondieron HTTP 200. Antes de cada desbloqueo se verifico que la ejecucion
  referenciada no existiera. Se guardo un snapshot local sin secretos.
- El snapshot previo contenia 107 prospectos en INGRESO y seis negociaciones en
  `C1:KESTRA_PENDING`. La cola comercial `C1:KESTRA_QUEUE` estaba vacia.
- Tras desbloquear, Kestra comenzo a recuperar minutos de cron atrasados. Bitrix
  rechazo algunas consultas con HTTP 503 `QUERY_LIMIT_EXCEEDED`.
- 10:12:15 y 10:12:17: se deshabilito y habilito brevemente cada disparador por
  `PUT /api/v1/main/triggers/set-disabled`, con `recoverMissedSchedules=false`.
  Esto avanzo la siguiente evaluacion a las 10:13, conservando las ejecuciones
  activas. Los pendientes se seleccionan por su estado actual en Bitrix; no
  requieren reproducir cada minuto de cron perdido.
- A las 10:12:51, ambos disparadores estaban habilitados, desbloqueados y con
  siguiente evaluacion a las 10:13. Ya habia ciclos completos exitosos y cambios
  comprobados en Bitrix.

- 10:16:12 a 10:20:43: se pauso temporalmente solo el disparador de prefill para
  reducir concurrencia con la calificacion. Se dejo finalizar el lote en curso.
  El rechazo por limite de consultas persistio tambien en esa ventana. Se
  restablecio el prefill, habilitado y desbloqueado, con siguiente evaluacion
  a las 10:21. No quedaron disparadores pausados por esta intervencion.

## Verificacion

La verificacion compara IDs del snapshot con el estado real en Bitrix, ademas de
consultar ejecuciones y disparadores. Un resultado SUCCESS de Kestra por si solo
no prueba que un prospecto haya completado todos los reintentos.

Al primer control estable de las 10:12:51, tres de los 107 prospectos originales
habian salido de INGRESO y dos de las seis negociaciones originales habian salido
de PENDIENTE CALIFICACION. El seguimiento posterior debe registrar el avance y
los motivos de cualquier espera restante.

Control del 3/11 a las 10:21:44:

| Medida | Resultado |
| --- | --- |
| Prospectos originales que salieron de INGRESO | 7 de 107 |
| Prospectos originales aun en INGRESO | 100 |
| Total actual en INGRESO, incluyendo nuevos | 106 |
| Negociaciones originales que salieron de PENDIENTE CALIFICACION | 3 de 6 |
| Total actual en PENDIENTE CALIFICACION, incluyendo nuevas | 4 |
| Cola de distribucion | 0 |
| Estado de ambos disparadores | habilitados, desbloqueados, proxima evaluacion 10:22 |

La ejecucion de prefill de las 10:21 volvio a fallar durante la consulta inicial;
la calificacion ejecuto y termino, pero conserva resultados comerciales fallidos.
El bloqueo huerfano quedo resuelto. La normalizacion completa de los pendientes
no quedo conseguida debido al segundo problema detallado a continuacion.

### Segundo problema detectado al recuperar

El 3/11 a las 10:19, tres de las seis negociaciones originales habian cambiado de
etapa: `1246409` a revision manual, `1246411` a `C1:UC_ZH5DGU` y `1246413` a
presentacion. `1246417`, `1246419` y `1246425` seguian pendientes. Se observaron
ademas negociaciones nuevas creadas por los eventos del prefill recuperado.

Los logs de calificacion muestran rechazos Bitrix HTTP 503 con el codigo
`QUERY_LIMIT_EXCEEDED`. Algunos se convierten en resultados `ok=false`,
`action=error`, `reason=internal_error`, aunque el proceso termina con codigo cero
y Kestra registra SUCCESS. Por eso el contador de ejecuciones exitosas no
representa la cantidad de negociaciones calificadas.

El cliente comercial observado no reintenta esos rechazos dentro de la llamada.
En el prefill, los rechazos tambien pueden producir enriquecimiento parcial bajo
su politica existente de reintentos. No se debe declarar el pipeline normalizado
solo porque los disparadores volvieron a ejecutar.

Bitrix documenta que varias aplicaciones que acceden al mismo portal desde una IP
comparten el limite de intensidad. Recomienda reducir concurrencia y reintentar
con espera creciente: [limites oficiales](https://apidocs.bitrix24.com/limits.html).
La pausa breve de prefill no permite atribuir toda la saturacion a ese flow.
La correccion de la coordinacion de llamadas, los reintentos y la propagacion de
errores comerciales requiere un cambio de aplicacion separado; esta intervencion
recupero los dos disparadores y verifico tanto avances como el bloqueo restante.

## Runbook para un bloqueo equivalente

1. Consultar estado actual del trigger y comprobar que esta habilitado pero
   bloqueado desde hace mas que la duracion normal del flow.
2. Consultar la ejecucion referenciada y los procesos activos antes de liberar
   un bloqueo: una ejecucion real en curso no es un bloqueo huerfano.
3. Guardar snapshot sin secretos. Usar el desbloqueo individual de la API para
   el trigger confirmado como huerfano, con autorizacion operativa vigente.
4. Si el calendario quedo atrasado y el flow consulta pendientes actuales,
   restablecer su siguiente evaluacion con deshabilitar/habilitar y omitir
   minutos perdidos. No aplicar este criterio a procesos que necesiten backfill
   temporal sin revisar primero su contrato.
5. Verificar nuevos ciclos, liberacion posterior del bloqueo, estado real de los
   registros y limites del proveedor. No cambiar directamente tablas de Kestra.

## Prevencion pendiente

Evaluar en un cambio independiente el apagado coordinado de Kestra antes de
PostgreSQL durante reinicios por mantenimiento, un plazo de cierre suficiente y
alertas por disparadores habilitados sin ejecuciones nuevas. Una recuperacion
automatica debe comprobar ausencia de ejecucion y trabajo activo para evitar
duplicados. No se altero la politica Ansible de actualizaciones ni se actualizo
el motor como parte de esta recuperacion.
