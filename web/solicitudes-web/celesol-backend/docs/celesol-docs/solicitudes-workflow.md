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
| `Liquidada` | `verificar_firma` | `Verificar Firma y Documentación` | `VerificarFirmaYDocumentacion` | yes |
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
