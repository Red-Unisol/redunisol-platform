# Solicitudes Core Workflow Engine

## Objetivo
El workflow de `solicitudes-core` es backend-first.

- El backend es la fuente de verdad de transiciones y validaciones.
- El frontend no decide transiciones por estado.
- El catalogo DB (`workflow_states`, `workflow_transitions`) es la fuente de verdad de estados/transiciones.
- `SolicitudTransitionPolicy` valida reglas puras in-memory.
- `SolicitudWorkflowPrismaDatasource` ejecuta persistencia, historial y transaccion.

## Flujo oficial de cambio de estado
Ruta productiva oficial:

`Controller`
-> `ChangeSolicitudStateUseCase`
-> `SolicitudWorkflowEngine`
-> `SolicitudTransitionPolicy`
-> `SolicitudWorkflowPlanBuilder`
-> `SolicitudWorkflowPlanExecutor`
-> `repository.executeWorkflowPlan`
-> `datasource.executeWorkflowPlan`
-> `applyTransition`

No se deben crear nuevos flujos productivos que salteen esta cadena.

## Responsabilidades por componente

### SolicitudWorkflowEngine
- Orquesta carga de contexto, validacion de policy, armado de plan y ejecucion.
- No persiste ni consulta DB directamente.

### SolicitudTransitionPolicy
- Valida reglas puras sobre contexto in-memory:
  - owner asignado / owner match
  - transicion principal existente y activa
  - destino activo
  - comentario obligatorio cuando corresponde
- No consulta DB.

### SolicitudWorkflowPlanBuilder
- Construye `WorkflowExecutionPlan`.
- Arma step principal `domain-transition`.
- Agrega `technical-transition` de `motor` cuando el contexto lo indica.
- No consulta DB.

### SolicitudWorkflowPlanExecutor
- Valida ejecutabilidad basica del plan.
- Delega ejecucion a `repository.executeWorkflowPlan`.
- No ejecuta persistencia por cuenta propia.

### SolicitudWorkflowPrismaDatasource
- Ejecuta el plan por steps en transaccion.
- Revalida transicion activa y destino activo por step contra DB.
- Reutiliza `applyTransition` para actualizar estado e historial.
- Aplica reglas transaccionales de conflicto de estado esperado.

### executeWorkflowPlan
- Camino principal de ejecucion de workflow.
- Ejecuta plan por steps en orden, en una unica transaccion.
- Es un contrato interno del modulo (no API publica HTTP).

## WorkflowExecutionPlan
`WorkflowExecutionPlan` modela la intencion de ejecucion:

- `expectedState.fromStateId`: estado esperado previo a ejecutar.
- `steps`: lista ordenada de steps.
  - `domain-transition`: transicion de negocio principal.
  - `technical-transition`: transicion tecnica (por ejemplo `motor`).

Datos relevantes por step:
- `actionCode`
- `fromStateId`
- `toStateId` (nullable)
- `transitionId` (nullable)
- `technical` (`false` en domain, `true` en technical)

Reglas de ejecutabilidad minimas (precondiciones):
- `expectedState.fromStateId` no nulo.
- Existe al menos un `domain-transition`.
- `transitionInput` presente en el step principal.
- `fromStateId` del primer domain step consistente con `expectedState`.

## Motor
`Motor` es un paso tecnico, no una decision de UI:

- Se representa como `technical-transition` con `actionCode: "motor"`.
- En runtime se resuelve/revalida contra DB en transaccion.
- No se debe ejecutar dos veces.
- Historial esperado se mantiene en orden:
  1. transicion principal
  2. transicion tecnica `motor`

## Transaccion y rollback
`executeWorkflowPlan` ejecuta todos los steps en una unica transaccion.

- Si falla cualquier step:
  - rollback total
  - sin historial parcial
  - sin estado intermedio persistido

## Precedencia de errores
Precedencia operativa documentada:

1. Solicitud inexistente -> `SolicitudCoreNotFoundError` (404)
2. Solicitud existente con estado distinto al esperado -> `WorkflowExecutionPlanStateConflictError` (409)
3. Transicion inexistente/inactiva -> `SolicitudWorkflowTransitionNotAllowedError` (409)
4. Destino inactivo -> `SolicitudWorkflowDestinationInactiveError` (409)

Validaciones complementarias:
- Comentario obligatorio -> `SolicitudWorkflowCommentRequiredError` (400)
- Owner invalido / sin owner -> `ForbiddenSolicitudAccessError` (403) / `MissingWorkflowOwnerAssignmentError` (403)

## Decision sobre domain_from_state_mismatch
`domain_from_state_mismatch` se filtra en datasource para priorizar conflicto real contra estado DB en transaccion.

- Motivo: en ejecucion productiva importa el estado real al momento de persistir.
- En el flujo oficial productivo, el contrato de plan valido se garantiza antes en `PlanExecutor`.
- Esto no es una garantia absoluta para llamados directos al datasource: esos llamados no estan soportados como flujo productivo.
- `executeWorkflowPlan` prioriza validacion transaccional del estado real para conflicto 409 cuando corresponde.

## Regla de assignedToUserId
Regla cerrada del workflow:

- `assignedToUserId` no se limpia automaticamente por cambio de owner/area.
- Solo cambia por acciones explicitas de asignacion/desasignacion.
- `assignedToUserId` no habilita ni bloquea permisos operativos en esta etapa.

## Politica actual de permisos
La politica funcional vigente queda separada en lectura y operacion:

- Usuarios autenticados y activos pueden leer detalle, historial y adjuntos.
- Operaciones requieren pertenecer al owner actual de la solicitud:
  `solicitud.estadoActual.ownerId === user.workflowOwnerId`.
- `creator`, `participant` y `assignedToUserId` no otorgan permisos operativos.
- En `RIESGO`, cualquier usuario del owner `RIESGO` puede operar aunque no sea `assignedToUserId`.
- `GET /solicitudes` conserva sus scopes/bandejas actuales; lectura amplia no implica listado global por defecto.
- Excepcion puntual (2026-07-09): `actionCode: "pagar"` (`Transferir -> Pagada`) la puede ejecutar el owner actual (`TESORERIA`) **o** cualquier usuario del owner `RIESGO`, ademas de `isSystemAdmin`. Es la unica transicion con un owner adicional habilitado fuera del owner del estado origen; implementado en `SolicitudTransitionPolicy`, `SolicitudWorkflowPrismaDatasource.listAvailableTransitions` y `SolicitudPermissions.canEditSolicitud`.

## Alcance actual de Tesoreria
`Pagada` es el estado final operativo real del backend (2026-07-09).

- Se mantiene `VerificarFirmaYDocumentacion -> Transferir` con `actionCode: "transferir"` y label visible `Para Transferir`.
- `Transferir` ya no es terminal: tiene una unica salida activa, `Transferir -> Pagada` con `actionCode: "pagar"`.
- No se implementan devoluciones desde Tesoreria.
- `Appearance` y comportamiento nuevo de `save_and_exit` quedan fuera de alcance hasta definicion funcional (salvo el color verde ya configurado para `Pagada`).

## Cobertura de tests relevante
La suite cubre, a nivel de riesgo real:

- validaciones de `SolicitudTransitionPolicy`
- armado de plan en `SolicitudWorkflowPlanBuilder`
- precondiciones/ejecucion en `SolicitudWorkflowPlanExecutor`
- ejecucion transaccional en datasource
- rollback ante fallos
- flujo de `motor` como step tecnico
- conflicto de estado 409
- guard-rail de arquitectura sobre el camino oficial del workflow
