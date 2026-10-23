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


## Reemplazo controlado de préstamo anulado (2026-10-23)

En una solicitud devuelta con la corrección administrativa, el administrador puede
abrir **Conciliación del préstamo Core pendiente → Reemplazo excepcional de préstamo
anulado → Reemplazar préstamo anulado**, debajo de la barra del detalle.
Primero debe guardar las condiciones corregidas. El modal muestra monto, cuotas,
cálculo actualizado, cancelaciones y neto, y exige un motivo.

- Es excepcional: exige administrador activo en sesión propia, préstamo vinculado,
  estado Revisar/RevisionRiesgo/PreAprobada/Confirmada, sin archivo, liquidación previa,
  reserva de desembolso ni pago externo. No agrega transiciones al flujo habitual.
- Vimarx debe confirmar ambos estados como Anulada/Anulado, sin vigencia y saldo cero.
  Beex no anula préstamos. La consulta del préstamo anulado admite que Vimarx haya
  retirado a sus integrantes y resuelve el vínculo histórico antes del ID directo.
- Reutiliza las validaciones de generación: titular completo, socio, vendedor, línea
  vigente y máximos actuales. Rechaza ajustes silenciosos de monto/cuotas y cancelaciones
  superiores al monto. Es necesario guardar y revisar esas condiciones antes de generar.
- Antes de llamar a CrearPrestamo registra un intento durable y único por solicitud y
  préstamo anterior. Conserva el vínculo y firma anteriores hasta tener el ID nuevo.
  Mientras hay un intento pendiente bloquea ediciones, cancelaciones, workflow y firma.
- Al recibir el ID, cambia vínculo y enlace de firma en una transacción y registra
  ADMIN_LOAN_REPLACED sin alterar estado, asignación, documentos ni historia anterior.
  Conserva ID, firma anterior, evidencia de anulación, condiciones enviadas, motivo,
  administrador real y fechas en solicitud_prestamo_replacements e historial.
- El nuevo préstamo exige conciliación antes de liquidar. La conciliación rechaza
  préstamos anulados aunque sus condiciones económicas coincidan.

Un error HTTP o timeout no prueba que Vimarx no haya creado el préstamo. No se repite
la creación automáticamente. La UI muestra el intento y permite **Vincular préstamo
generado**: se ingresa el ID real, y Beex verifica titular, estado activo, monto,
cuotas, línea y cancelaciones contra el intento antes de enlazarlo. Un intento aún
en curso espera el timeout configurado más 60 segundos antes de permitir recuperación.
Si no existe préstamo o hay resultados contradictorios, corresponde investigar la
operación; no hay un botón para borrar el intento ni generar nuevamente a ciegas.

API autenticada con visibilidad habitual y validaciones propias de administrador:

- GET /solicitudes/:id/admin-loan-replacements: disponibilidad y últimos intentos.
- POST /solicitudes/:id/admin-loan-replacements: requestId UUID, expectedUpdatedAt,
  previousLoanId y reason; nunca recibe monto/cuotas ni flags para saltear verificaciones.
- POST /solicitudes/:id/admin-loan-replacements/recover: requestId, expectedUpdatedAt,
  newLoanId y reason. No crea operaciones en el Core.

La migración es aditiva. Los registros no se eliminan en cascada al borrar una solicitud.
La base garantiza un único intento por préstamo anterior y un ID nuevo sin duplicados.
Las pruebas de integración usan exclusivamente una base local cuyo nombre termina en _test.
