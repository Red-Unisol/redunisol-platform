# Incidente 23271: pool pausado bloqueaba la calificación

## Causa y alcance

El 02/10/2026 se confirmó que la negociación 1237759, creada el 01/10 a las
21:03 ART, encabezaba la selección FIFO global de PENDIENTE CALIFICACION KESTRA.
Su bucket `policia_federal_caba` tenía un pool remoto explícitamente vacío.
`resolve_round_robin_assignee` lanzaba un error técnico; el caso permanecía pendiente
y se volvía a seleccionar cada minuto. La cola de asignación fallaba por el mismo
motivo. Kestra mostraba SUCCESS porque los entrypoints emitían `ok=false` sin
terminar el proceso con error; el estado de ejecución solo no acreditaba avance.

Al diagnóstico había 66 pendientes y tres casos en cola. Justo antes del deploy,
la lectura paginada registró **71 pendientes y tres en cola**. La pausa del pool
permanece vigente: no se agregaron vendedores ni se modificó elegibilidad.

## Cambio

Según [ROUTE-DEC-23271](../commercial-rules/DECISION_LOG.md), un pool vacío utiliza
la misma excepción controlada que la falta de vendedores disponibles. La primera
calificación conserva la decisión y envía el caso a la cola temporal; la selección
siguiente puede continuar. Los reintentos de esa cola informan
`queue_waiting / routing_pool_paused`, sin transferencias ni asignación de fallback.
Otros buckets siguen su circuito habitual. Al habilitar vendedores, el caso puede
salir de la cola conservando decisión y etapa destino. Se mantienen horarios,
rechazos y cierre semanal.

La corrección no altera el contrato general de estados Kestra ante otros errores;
seguir mirando `ok`, resultado comercial, distribución y estado real en Bitrix.

## Publicación y validación

- Rama `fix/paused-routing-pool-23271`, implementación `da687ca`.
- Se compararon los tres namespace files productivos con la base Git: coincidían.
- Se publicaron únicamente `commercial_trace.py`, `catamarca_deal_qualification.py`
  y `deal_service.py`, mediante el helper de deploy del repositorio. La descarga
  posterior coincide byte a byte. Se conservaron los flows y sus crons por minuto.
- Pruebas: 224 del package y 106 del dominio (329 correctas, una omitida en Windows
  por requerir Linux); validación estructural Kestra y `git diff --check` correctos.
- Regresiones: pool vacío con vendedor online no lo asigna; el primer pendiente
  sale a cola y permite seleccionar el siguiente; otro bucket distribuye y transfiere
  chat; al reactivar el pool se conserva la decisión y se transfiere el chat pendiente.
- Primera ejecución productiva corregida: `4Gm0UeALw9dgyT0DOBxAuz`, caso 1237759,
  `ok=true`, `queued`, `routing_pool_paused`. Relectura Bitrix: cola con Maru (57).
- Cola: `6PbEd8od54Ci6ici3zjRGQ`, `ok=true`, espera por pool pausado para 1237441.
- Evidencia privada: `.local/artifacts/bitrix-task-23271/` del checkout operativo:
  inventario previo, configuración de pools, respaldos de código, hashes publicados
  y observaciones de ejecuciones. No versionar datos personales de las operaciones.

El deploy ya está aplicado; el PR debe incorporarse a main para conservarlo en los
siguientes despliegues. Los checks remotos no se monitorean desde esta intervención.
