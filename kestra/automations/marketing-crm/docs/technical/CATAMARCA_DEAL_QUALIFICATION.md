# Calificacion Comercial De Negociaciones

Estado: Catamarca historico desplegado; ampliacion Catamarca/Cordoba implementada en
el PR #218 y pendiente de deploy.

## Objetivo

Separar dos decisiones que antes ocurrian sobre el lead:

1. La precalificacion usa solamente provincia, situacion laboral y banco.
2. La calificacion comercial definitiva usa los datos enriquecidos y ocurre despues de crear la negociacion.

La clasificacion se ejecuta sobre negociaciones internas Catamarca y Cordoba que
llegan a la etapa pendiente. El owner comercial previo del lead no actua como gate.

## Circuito

```text
Lead en PRECLASIFICACION
        |
        | criterios locales, sin BCRA
        v
RESULTADO GANADO
        |
        v
Deal VENTAS
Etapa: PENDIENTE CALIFICACION KESTRA
Responsable provisional: Maru Lopez (57)
        |
        v
Calificacion definitiva Catamarca o Cordoba
        |-- aprobable -> PRESENTACION + linea comercial
        |-- rechazo duro BCRA -> SIT. NEG. EN BCRA
        |-- rechazo comercial -> etapa configurada o fallback manual
        `-- dato insuficiente/regla ambigua -> REVISION MANUAL KESTRA
        |
        `-- aprobacion o revision que requiere vendedor:
            politica independiente de distribucion, horario, bucket y chat
```

## Etapas Bitrix

- `C1:KESTRA_PENDING`: `PENDIENTE CALIFICACION KESTRA`
- `C1:KESTRA_REVIEW`: `REVISION MANUAL KESTRA`
- `C1:KESTRA_ROUTE_REVIEW`: `REVISION DE ENRUTAMIENTO KESTRA`
- `C1:NEW`: `PRESENTACION`
- `C1:5`: `SIT. NEG. EN BCRA`

Las dos etapas Kestra fueron creadas por API sin mover negociaciones existentes.

Provisionado en Bitrix el 2026-08-06:

- campo de negociacion `UF_CRM_ROUTE_BUCKET` (ID `1801`);
- etapa `C1:KESTRA_ROUTE_REVIEW` (ID `807`).

## Reglas Automatizadas

La tabla funcional normativa y sus casos de aceptación se encuentran en:

- [`../commercial-rules/DEAL_CLASSIFICATION.md`](../commercial-rules/DEAL_CLASSIFICATION.md)
- [`../commercial-rules/ACCEPTANCE_CASES.md`](../commercial-rules/ACCEPTANCE_CASES.md)

Este documento no duplica esas reglas para evitar divergencias futuras.

## Buckets Y Distribucion

La negociacion nace asignada a Maru. Antes de distribuir, Kestra resuelve un bucket
con los datos enriquecidos disponibles en la negociacion y su lead vinculado.

Los buckets Catamarca y Cordoba, sus criterios y pools se definen en
[`../commercial-rules/DEAL_ROUTING.md`](../commercial-rules/DEAL_ROUTING.md). El bucket
se persiste en `UF_CRM_ROUTE_BUCKET` (`ufCrmRouteBucket` en CRM universal).

Si la provincia o situacion laboral no coincide con ningun bucket, la negociacion pasa a
`C1:KESTRA_ROUTE_REVIEW`: no cambia de responsable, no transfiere el chat y Maru
recibe una notificacion explicita.

Para una negociacion con bucket:

- si el contacto tuvo una negociacion previa del mismo bucket con alguien disponible
  del pool, conserva ese vendedor;
- si no, toma la ultima negociacion distribuida dentro del mismo bucket y asigna al
  siguiente vendedor disponible segun el orden configurado;
- la negociacion, el chat y la notificacion comparten el mismo vendedor;
- la notificacion informa el bucket aplicado.

## Distribucion Fuera De Horario

La distribucion automatica funciona de forma continua desde el lunes a las 00:00
inclusive hasta el viernes a las 17:00 exclusive, usando
`America/Argentina/Cordoba`.

Si una negociacion pendiente se procesa fuera de esa ventana:

- Kestra ejecuta y conserva igualmente la clasificacion comercial;
- aplica la linea y etapa comercial que correspondan;
- queda asignada a Maru Lopez (`57`);
- no se ejecuta round-robin;
- no se transfiere ningun chat;
- no vuelve a entrar automaticamente en la cola al comenzar el siguiente dia habil.

La distribucion de esos casos queda a cargo de Maru de forma manual.

Cuando el unico impedimento dentro de la ventana es la falta de vendedores online,
la negociacion pasa a `C1:KESTRA_QUEUE`. El flow
`bitrix24_deal_assignment_queue` procesa una vez por minuto el caso FIFO de cada
bucket de manera independiente. No vuelve a ejecutar la clasificacion comercial ni
las consultas BCRA: usa la decision persistida al encolar.

Las decisiones de rechazo BCRA o comercial no participan de la distribucion: Kestra
aplica directamente la etapa correspondiente, conserva a Maru como responsable y no
busca vendedor, no transfiere el chat y no las incorpora a la cola.

Al cerrar la ventana semanal, el mismo flow mueve todo remanente a
`C1:KESTRA_REVIEW` con Maru y lo retira definitivamente de la distribucion automatica.

## Contrato De Decisiones Y Trazabilidad

La revision `deal-commercial-distribution-trace.v2` registra dos decisiones
independientes e inmutables:

- `commercial_action`, `commercial_reason`, `commercial_stage_id` y
  `commercial_line` describen exclusivamente la clasificacion comercial;
- `distribution_action`, `distribution_reason`, `assignment_strategy`, bucket y
  responsable describen exclusivamente la distribucion.

Los campos historicos `action` y `reason` se conservan temporalmente por
compatibilidad, pero el informe usa primero el contrato separado. Entrar o salir de
la cola no reemplaza el motivo comercial original.

## Operacion

El flow conserva el ID historico `bitrix24_catamarca_deal_qualification` para evitar
migrar el scheduler. Procesa hasta cinco negociaciones internas pendientes por
ejecución, una por vez. Es idempotente por etapa: si ya salio de `C1:KESTRA_PENDING`, no vuelve a decidir ni
reasignar.

El clasificador selecciona el lote antes de modificar etapas, para no saltar casos
al paginar. Antes del clasificador, la tarea `hay_pendientes` consulta a Bitrix por HTTP,
sin contenedor, si hay negociaciones en `C1:KESTRA_PENDING`; si no hay, el clasificador
no corre y las salidas quedan en sus valores por defecto (`action: no_pending`,
`events_json: []`). Cada ejecución con pendientes usa un contenedor y conserva
`concurrency.limit: 1`.
`BITRIX24_DEAL_QUALIFICATION_BATCH_SIZE` permite ajustar el tamaño (predeterminado
5, entre 1 y 20). Tras 50 segundos no inicia otro caso; termina el caso que ya está
en curso y deja los restantes para el próximo ciclo. El presupuesto es un límite
entre casos, no una cancelación de consultas o transferencias en curso.

Los casos esperando BCRA o Vimarx no consumen lugares del lote. Un error de un caso
se registra y permite continuar con los demás. HTTP 429 difiere el resto del lote.
La salida `events_json` conserva cada decisión individual para el informe diario;
los campos escalares anteriores conservan el último evento por compatibilidad.
