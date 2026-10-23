# Workflow de solicitudes 2026

Este documento describe el catalogo tecnico vigente del workflow de `solicitudes-core` despues del cleanup 2026. La fuente ejecutable es la migracion can�nica `prisma/migrations/20260520000000_workflow_assignment_unified/migration.sql`, actualizada por `prisma/migrations/20260708120000_unify_verificar_firma_documentacion/migration.sql` (unificacion de `VerificacionDocumentacion` y `VerificarFirma`) y por `prisma/migrations/20260709100000_add_pagada_terminal_state/migration.sql` (alta del estado terminal `Pagada`).

## Principios

- El backend es la fuente de verdad del workflow.
- El frontend no decide transiciones ni destinos.
- Los permisos operativos no cambian con este cleanup: siguen dependiendo del owner actual del estado.
- `Motor` se mantiene como paso tecnico automatico interno.
- `RIESGO` agrupa analisis crediticio, verificacion documental y verificacion de firma.
- `Pagada` es el final operativo real: unico estado sin salidas activas alcanzable desde el flujo positivo.
- `Transferir` deja de ser terminal: tiene una unica salida activa (`pagar` -> `Pagada`).

## Owners

| Owner | Funcion |
| --- | --- |
| `VENDEDORES` | Carga, reproceso comercial, preaprobacion y liquidacion. |
| `SISTEMA` | Paso tecnico automatico `Motor`. |
| `RIESGO` | Revision de riesgo, confirmacion, documentacion y firma. |
| `TESORERIA` | Recepcion operativa en `Transferir`. |
| `HISTORIAL` | Estados de cierre: rechazo, vencimiento, desestimacion y pago (`Pagada`). |

## Estados activos

| Code | Label visible | Owner | Initial | Terminal |
| --- | --- | --- | --- | --- |
| `CargaVendedor` | `Carga Vendedor` | `VENDEDORES` | yes | no |
| `Motor` | `Motor` | `SISTEMA` | no | no |
| `RevisionRiesgo` | `Revision Riesgo` | `RIESGO` | no | no |
| `Revisar` | `Revisar` | `VENDEDORES` | no | no |
| `PreAprobada` | `Pre Aprobada` | `VENDEDORES` | no | no |
| `Confirmada` | `Confirmada` | `RIESGO` | no | no |
| `Liquidada` | `Liquidada` | `VENDEDORES` | no | no |
| `VerificarFirmaYDocumentacion` | `Verificar Firma y Documentación` | `RIESGO` | no | no |
| `Transferir` | `Transferir` | `TESORERIA` | no | no |
| `Pagada` | `Pagada` | `HISTORIAL` | no | yes |
| `Rechazada` | `Rechazada` | `HISTORIAL` | no | yes |
| `Vencida` | `Vencida` | `HISTORIAL` | no | yes |
| `Desestimada` | `Desestimada` | `HISTORIAL` | no | yes |

`Terminal` indica cierre historico en el catalogo. `Pagada` es el unico cierre positivo (`Terminal = yes`, sin salidas activas). `Transferir` queda con `Terminal = no` porque es un paso operativo hacia Tesoreria, no un cierre en si mismo, aunque ya tiene una salida activa hacia `Pagada`.

## Matriz de transiciones activas

| Origen | Action code | Label visible | Destino | Requires comment |
| --- | --- | --- | --- | --- |
| `CargaVendedor` | `enviar` | `Enviar` | `Motor` | no |
| `CargaVendedor` | `vencer` | `Vencida` | `Vencida` | yes |
| `CargaVendedor` | `desestimar` | `Desestimar` | `Desestimada` | yes |
| `Motor` | `motor` | `Motor` | `RevisionRiesgo` | no |
| `Revisar` | `revisar_reenviar` | `Revisar/Reenviar` | `RevisionRiesgo` | no |
| `Revisar` | `desestimar` | `Desestimar` | `Desestimada` | yes |
| `PreAprobada` | `desestimar` | `Desestimar` | `Desestimada` | yes |
| `PreAprobada` | `revisar_monto_cuota` | `Revisar si es posible brindar un monto o cuota distinta` | `RevisionRiesgo` | yes |
| `PreAprobada` | `confirmar` | `Confirmar` | `Confirmada` | no |
| `RevisionRiesgo` | `rechazar` | `Rechazada` | `Rechazada` | yes |
| `RevisionRiesgo` | `revisar` | `Revisar` | `Revisar` | yes |
| `RevisionRiesgo` | `preaprobar` | `PreAprobada` | `PreAprobada` | no |
| `RevisionRiesgo` | `confirmar` | `Confirmar` | `Confirmada` | no |
| `Confirmada` | `desestimar` | `Desestimar` | `Desestimada` | yes |
| `Confirmada` | `liquidar` | `Liquidada` | `Liquidada` | no |
| `Liquidada` | `desestimar` | `Desestimar` | `Desestimada` | yes |
| `Liquidada` | `verificar_firma` | `Verificar Firma y Documentación` | `VerificarFirmaYDocumentacion` | no |
| `VerificarFirmaYDocumentacion` | `devolver_a_liquidada` | `Devolver a Liquidada` | `Liquidada` | yes |
| `VerificarFirmaYDocumentacion` | `transferir` | `Para Transferir` | `Transferir` | no |
| `Transferir` | `pagar` | `Pagada` | `Pagada` | no |

## Regla de comentarios

- Las acciones de cierre negativo o desestimacion requieren comentario.
- Las acciones que devuelven una solicitud para correccion requieren comentario.
- Las acciones automaticas, los avances normales y las confirmaciones simples no requieren comentario.

## Excepcion de permisos: `Transferir -> pagar -> Pagada`

Unica excepcion a la regla general "solo el owner del estado actual puede operar":

- `pagar` la puede ejecutar el owner actual (`TESORERIA`) **o** cualquier usuario del owner `RIESGO`, ademas de `isSystemAdmin`.
- Implementado en `SolicitudTransitionPolicy` (ejecucion), `SolicitudWorkflowPrismaDatasource.listAvailableTransitions` (listado) y `SolicitudPermissions.canEditSolicitud` (flag `canChangeState` del detalle).
- Ningun otro actionCode ni estado tiene este comportamiento.

## Transiciones removidas o prohibidas

No deben quedar activas:

- transiciones que referencien `Abandonada`, `PreAprobado`, `VerificacionRiesgo`, `VerificacionFirmas` o `ParaTransferir`;
- cualquier salida desde `Pagada`, `Rechazada`, `Vencida` o `Desestimada`;
- cualquier salida desde `Transferir` que no sea `pagar -> Pagada`;
- `RevisionRiesgo -> Liquidada`;
- `RevisionRiesgo -> VerificarFirmaYDocumentacion`;
- `Revisar -> VerificarFirmaYDocumentacion`;
- `Confirmada -> Rechazada`;
- `Confirmada -> Revisar`;
- `Confirmada -> VerificarFirmaYDocumentacion`;
- `Confirmada -> Vencida`.

## Reemplazos can�nicos

- `Desestimada` reemplaza a `Abandonada`.
- `PreAprobada` reemplaza a `PreAprobado`.
- `VerificarFirmaYDocumentacion` reemplaza a `VerificacionRiesgo` y a `VerificacionFirmas`.
- `Transferir` reemplaza a `ParaTransferir` como nombre can�nico del estado de Tesoreria.
- `VerificarFirmaYDocumentacion` unifica (2026-07-08) a los antiguos `VerificacionDocumentacion` y `VerificarFirma`, que quedaron desactivados (`is_active=false`) sin borrarse.
- `Pagada` (2026-07-09) reemplaza a su propio codigo legado: antes de esta fecha `Pagada` figuraba en la lista de codigos legado a desactivar; ahora es el estado terminal real.

## Recorridos de referencia

Camino base:

```text
CargaVendedor -> Motor -> RevisionRiesgo
```

Con preaprobacion:

```text
CargaVendedor -> Motor -> RevisionRiesgo -> PreAprobada -> Confirmada -> Liquidada
```

Camino documental:

```text
Liquidada -> VerificarFirmaYDocumentacion -> Transferir -> Pagada
```

Reproceso desde verificacion:

```text
Liquidada -> VerificarFirmaYDocumentacion -> Liquidada
```


## Corrección administrativa excepcional (2026-10-23)

En el detalle de la solicitud, debajo de la barra de herramientas, los administradores
ven **Administración → Corregir estado**. La primera versión admite exclusivamente
`Confirmada → Revisar` (owner `VENDEDORES`). No se agrega esa transición al catálogo
ni al selector operativo normal.

- Requiere sesión propia de administrador activo, motivo de 10 a 2000 caracteres,
  UUID de operación y la versión `updatedAt` observada al abrir el formulario.
- Rechaza solicitudes archivadas, reservas de desembolso, pagos externos y solicitudes
  cuyo historial haya llegado a Liquidada, VerificarFirmaYDocumentacion, Transferir o Pagada.
- Se ejecuta por `ChangeSolicitudStateUseCase → SolicitudWorkflowEngine`; la persistencia
  bloquea la solicitud y guarda estado e historial en una única transacción.
- Conserva préstamo Core, firma, adjuntos, ejecutivo y asignación. Al entrar a Revisar
  actualiza el tope de Riesgo al monto actual, igual que las devoluciones habituales.
- Registra `ADMIN_CORRECTION_TO_REVISAR` con motivo, administrador real y snapshots de
  estados/áreas; no borra ni reescribe historia ni genera préstamos u operaciones bancarias.

Si existe un préstamo vinculado, la corrección deja pendiente su conciliación. Se bloquean
`liquidar`, `verificar_firma`, `transferir`, `pagar` y la provisión de datos para firma
(`finSolicitud`) hasta verificar las condiciones. El administrador usa
**Conciliar préstamo Core**, en la misma barra, con un motivo obligatorio. La verificación
consulta el Core sin modificarlo y compara socio, monto deseado, cuotas, línea resuelta,
vencimiento explícito y cancelaciones en centavos. Si hay diferencias o falta información,
no se libera el bloqueo; las correcciones en el Core requieren su propio procedimiento.

La conciliación registra evidencia e historial. Un cambio posterior en el vínculo,
identificación del socio, monto, cuotas, línea, vencimiento o cancelaciones invalida
la conciliación automáticamente. El historial anterior de firma se conserva como evidencia;
una conciliación de condiciones no sustituye una nueva firma/documentación si corresponde.

API autenticada (con el guard de visibilidad habitual):

- `GET /solicitudes/:id/admin-state-correction`: disponibilidad, versión y conciliación pendiente.
- `POST /solicitudes/:id/admin-state-correction`: `targetStateCode: Revisar`, `reason`, `expectedUpdatedAt`, `requestId`.
- `POST /solicitudes/:id/admin-core-reconciliation`: `reason`, `expectedUpdatedAt`.

Las dos escrituras validan privilegios en backend, rechazan modo de suplantación y no
aceptan identidad ni privilegios enviados por el cliente. No hay un selector de estados libre.
