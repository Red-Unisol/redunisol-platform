# Plan: Transferencias Celesol con core como fuente de verdad

## Estado actualizado 2026-04-08

Este documento reemplaza el supuesto anterior de que `apps/metamap-platform/server/`
mantendria una cola operativa para `transferencias_celesol`.

Realidad actual confirmada:

- `metamap-platform/server` ya no mantiene cola ni workflow por etapas
- `metamap-platform/server` registra y expone validaciones MetaMap persistidas
- el cliente Rust actual sigue acoplado a una cola inexistente:
  - `GET /api/v1/queues/transferencias_celesol`
  - `transfer_initiated`
  - `transfer_submitted`
- el core financiero pasa a ser la fuente de verdad operativa para armar la lista de trabajo
- la condicion `Estado.Descripcion = A Transferir` deja de ser solo un chequeo y pasa a ser el criterio de inclusion

## Problema reformulado

Antes:

1. la lista nacia desde validaciones MetaMap publicadas por el server
2. el cliente consultaba el core para decidir si ese item podia transferirse

Ahora:

1. la lista debe nacer desde el core financiero
2. cada solicitud en `A Transferir` pasa a ser un item candidato
3. sobre cada item candidato se consulta el server para verificar si existe una validacion MetaMap util
4. la validacion deja de ser la fuente del item y pasa a ser una condicion complementaria

Consecuencia de arquitectura:

- el cliente deja de ser un consumidor de cola del server
- pasa a ser una app de transferencias basada en polling del core
- el server queda como lookup autenticado de validaciones ya registradas

## Modelo operativo propuesto

### Fuente primaria

La lista visible se reconstruye desde el core financiero cada 20 segundos.

Consulta propuesta:

- endpoint: `POST /api/Empresa/EvaluateList`
- tipo: `PreSolicitud.Module.Solicitud`
- criterio base: `[Estado.Descripcion]='A Transferir'`
- clave de correlacion primaria: `Oid`

Observacion importante:

- el cliente actual ya asume implicitamente que el `request_number` de MetaMap correlaciona con `Oid`
- conviene preservar esa convencion y hacerla explicita en el rediseño

### Fuente secundaria

Por cada solicitud obtenida del core, la app consulta al server para verificar si existe una validacion asociada.

Consulta minima propuesta:

- `GET /api/v1/validations?request_number=<Oid>&normalized_status=completed&limit=10`

Regla minima asumida para esta fase:

- una validacion es util si existe en el server y su `normalized_status` es `completed`

Nota:

- si "paso los controles" significa algo mas que `completed`, ese estado o flag debe exponerse explicitamente en la API del server
- con el contrato actual, eso no existe todavia

### Enriquecimiento MetaMap

El server hoy indexa al menos:

- `verification_id`
- `resource_url`
- `request_number`
- `loan_number`
- `amount_raw`
- `amount_value`
- `applicant_name`
- `document_number`

Con ese enriquecimiento, el cliente ya no necesita hablar con MetaMap directo.

## Comportamiento funcional deseado

1. La app hace polling al core cada 20 segundos.
2. Obtiene todas las solicitudes en `A Transferir`.
3. Para cada solicitud:
   - arma un item base desde el core
   - consulta el server por validaciones asociadas a ese `Oid`
   - si encuentra una validacion util, la asocia al item
   - usa los datos enriquecidos que devuelve el server para comparar documento, monto y mostrar titular
4. La UI muestra todos los items que vienen del core, incluso si aun no tienen validacion lista.
5. El boton `Transferir` solo se habilita cuando:
   - la solicitud sigue en `A Transferir`
   - existe `Prestamo.[CBU transferencia]`
   - existe validacion MetaMap util
   - las comparaciones de documento y monto dan OK
   - la titularidad Coinag via CUIL/CUIT da OK

## Estados de UI propuestos

La lista ya no representa una cola del server. Debe representar solicitudes del core con estado operativo.

Estados sugeridos por item:

- `Lista para transferir`
- `Esperando validacion MetaMap`
- `Validacion incompleta o no terminal`
- `Inconsistencia de datos`
- `Transferencia en curso`
- `Transferida, pendiente de salida de la lista`

Regla de UX:

- no ocultar por defecto una solicitud de `A Transferir` solo porque aun no tenga validacion
- mostrarla igual, pero bloqueada y con motivo claro

## Impacto directo en el codigo actual

El cliente actual esta armado alrededor de una cola remota. Eso hay que invertirlo.

### `src/app.rs`

Cambios esperados:

- reemplazar `spawn_queue_poll()` por un polling de fuente primaria del core
- dejar de usar el lenguaje de "cola" en toolbar, mensajes y empty state
- reconstruir la lista desde el core y no desde `server.list_transfer_queue()`
- usar una clave estable basada en solicitud, no en `case_id`

### `src/core_client.rs`

Cambios esperados:

- mantener `fetch_core_snapshot()` para revalidacion puntual
- agregar un metodo nuevo tipo `fetch_transfer_candidates()`
- usar `EvaluateList` para traer solicitudes en `A Transferir`

### `src/server_client.rs`

Cambios esperados:

- dejar de consumir `/api/v1/queues/transferencias_celesol`
- dejar de enviar `transfer_initiated` y `transfer_submitted`
- convertirlo en un cliente de lookup de validaciones
- conviene renombrarlo a algo como `validation_client`

### `src/models.rs`

Cambios esperados:

- eliminar conceptos ligados a cola:
  - `QueueResponse`
  - `ServerCase`
  - `case_id`
  - `current_stage`
- introducir un modelo centrado en solicitud del core:
  - `request_oid`
  - snapshot del core
  - snapshot de validacion
  - snapshot MetaMap opcional

### `src/validation.rs`

Cambios esperados:

- la validacion ya no puede asumir que el item existe porque vino de MetaMap
- debe evaluar primero presencia y estado de la validacion remota
- luego correr las comparaciones actuales contra core y MetaMap

### `README.md`

Cambios esperados:

- dejar de describir la app como "cliente de cola"
- documentar que el polling principal va al core
- documentar default de polling en 20 segundos

## Consultas del core a definir

Para construir la lista base hace falta una proyeccion por solicitud.

Minimo necesario:

- `Oid`
- `Estado.Descripcion`
- `MontoAFinanciar`
- `CUIT`
- `NroDocumento`
- `Prestamo.[CBU transferencia]`

Campos recomendados si estan disponibles sin complicar la query:

- algun identificador legible para operador
- nombre del titular
- fecha de la solicitud

## Regla de identidad del item

La identidad del item debe pasar de `case_id` a `request_oid`.

Motivo:

- el item ahora nace del core
- la validacion se asocia despues
- una solicitud puede no tener validacion aun, y aun asi debe existir como item visible

## Transferencia e idempotencia

### Decision operativa cerrada

La barrera anti doble transferencia se resolvera con un archivo local persistido por la app.

Regla acordada:

- cada vez que una transferencia quede efectivamente enviada, la app registra el numero de solicitud en un archivo local
- si una solicitud ya figura en ese archivo, la app no vuelve a permitir `Transferir` para esa solicitud

La clave del registro sera `request_oid`.

### Alcance real de esta estrategia

Esta estrategia bloquea reenvios desde la misma instalacion de la app.

Evita:

- doble click local
- reintento accidental posterior en la misma PC
- volver a transferir una solicitud historica desde esa misma instalacion

No coordina automaticamente entre instalaciones distintas.

Si hay mas de una PC u operador trabajando en paralelo, cada instalacion tendra su propio archivo y la proteccion no sera global.

El plan sigue adelante con esta estrategia igual, pero este limite debe quedar explicitamente documentado.

### Mecanica propuesta

Archivo local:

- formato simple y auditable
- una entrada por solicitud transferida
- datos minimos por fila:
  - `request_oid`
  - `timestamp`
  - `operator_name`
  - `external_transfer_id` si existe

Comportamiento esperado:

1. Al iniciar la app, se carga el archivo local en memoria.
2. En cada polling al core, si una solicitud ya esta registrada como transferida:
   - se muestra como ya transferida o se oculta, segun la UX que definamos
   - en cualquier caso, no se habilita `Transferir`
3. Justo antes de transferir, la app vuelve a verificar en memoria y en disco que `request_oid` no este ya registrado.
4. Si Coinag responde OK, la app persiste la solicitud en el archivo local antes de considerar cerrada la operacion.
5. Si la escritura del archivo falla despues de que Coinag acepto la transferencia, el caso debe quedar marcado como incidente operativo y no como exito silencioso.

### Requisitos de implementacion

- el archivo debe escribirse de forma atomica
- no debe depender de memoria solamente
- la lectura debe tolerar archivo inexistente en primer arranque
- la app debe rechazar duplicados por `request_oid`
- la ubicacion del archivo debe ser configurable

Nombre sugerido:

- `transferencias_realizadas.jsonl`

Variable sugerida:

- `TRANSFERENCIAS_COMPLETED_LOG_PATH`

### Criterio operativo

Con esta definicion ya se puede avanzar la implementacion de transferencia real.

La barrera elegida es local y suficiente para el alcance acordado de esta etapa.

## Plan por fases

### Fase 1: Inversion de fuente de verdad

- agregar `fetch_transfer_candidates()` en `core_client`
- pasar el polling automatico de 15 a 20 segundos
- reconstruir la lista desde el core
- eliminar lenguaje y estructuras de cola en la UI

### Fase 2: Lookup de validaciones

- reemplazar `list_transfer_queue()` por busqueda de validaciones por `request_number`
- asociar al item la validacion mas reciente y terminal
- marcar como bloqueados los items sin validacion util

### Fase 3: Enriquecimiento server-side de MetaMap

- exponer desde el server los datos de validacion que la UI necesita
- evitar fetch directo del cliente a `resource_url`
- mantener documento y monto como comparaciones obligatorias

### Fase 4: Rediseño del motor de validacion

- reordenar reglas segun el nuevo flujo:
  - existe solicitud en core
  - sigue en `A Transferir`
  - existe validacion remota util
  - datos cruzados consistentes
  - titularidad Coinag OK
- mostrar razones de bloqueo orientadas al operador

### Fase 5: Transferencia segura

- agregar registro local de solicitudes ya transferidas
- cargar ese registro al iniciar la app
- bloquear `Transferir` si `request_oid` ya existe en el archivo
- revalidar core + server + MetaMap justo antes de transferir
- ejecutar Coinag solo si la solicitud no figura en el archivo local
- persistir la solicitud en el archivo local inmediatamente despues de la aceptacion de Coinag
- refrescar inmediatamente la solicitud despues del envio

### Fase 6: Tests y rollout

- tests unitarios de correlacion core-validacion
- tests de seleccion de validacion cuando hay multiples matches
- tests de UI para items sin validacion
- tests de rechazo por solicitud ya registrada en archivo local
- smoke test manual con polling real de 20 segundos

## Preguntas abiertas

- Cual es exactamente la query de `EvaluateList` que devuelve la lista operativa final de `A Transferir`?
- El `request_number` indexado en el server sigue correlacionando 1:1 con `Solicitud.Oid` en todos los casos?
- Que criterio exacto significa "la validacion paso los controles"?
- Si existen multiples validaciones `completed` para una misma solicitud, tomamos la mas reciente o bloqueamos por ambiguedad?
- Que evento o estado hace que una solicitud deje de aparecer en `A Transferir` despues de transferir?
- En UI conviene ocultar las solicitudes ya registradas en el archivo local o mostrarlas como `ya transferidas`?

## Resultado esperado del rediseño

Cuando este cambio quede completo:

- la lista de trabajo nacerá del core financiero
- el server dejará de ser tratado como una cola
- la app seguirá usando las validaciones MetaMap, pero como chequeo complementario
- la app tendrá una barrera local contra reenvio por numero de solicitud
- el lenguaje del producto quedará alineado con la realidad operativa
- la arquitectura dejará de depender de un contrato de backend que ya no existe
