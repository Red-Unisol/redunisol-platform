# Plan: Cliente de Transferencias en Rust

## Update 2026-04-08

Este plan quedo parcialmente desactualizado por el cambio de especificacion del server.

Alcance actual confirmado de `apps/metamap-platform/server/`:

- persistir validaciones de MetaMap
- exponer API para fetchear y buscar validaciones
- no exponer colas ni acciones de workflow por ahora

En consecuencia, cualquier referencia en este documento a:

- `GET /api/v1/queues/transferencias_celesol`
- `transfer_initiated`
- `transfer_submitted`
- locks server-side o workflow por etapa

debe considerarse diferida hasta que se cierre una nueva definicion del flujo operativo. El cliente Rust puede seguir usandose como referencia funcional del proceso de transferencias, pero no como contrato vigente del backend.

## Objetivo

Construir la primera version del cliente de `transferencias_celesol` en Rust, tomando como guia el sistema actual en `untracked\Notificaciones Metamap`, pero apoyandose en el nuevo `metamap-platform/server` como backend de cola y estado.

## Material de referencia

- Sistema actual de guia:
  - `untracked\Notificaciones Metamap\celesol_app\celesol_transferencias.py`
  - `untracked\Notificaciones Metamap\tests\unit\test_celesol_transferencias.py`
  - `untracked\Notificaciones Metamap\agents.md`
- Backend nuevo ya disponible:
  - `apps/metamap-platform/server/`

## Supuestos de trabajo

- El cliente sera un desktop app para Windows.
- El backend `metamap-platform/server` seguira entregando a la cola solo `verification_id` y `resource_url`.
- El cliente sera responsable de:
  - fetch de detalles en MetaMap
  - consultas al core
  - validaciones previas a transferir
  - disparo de la transferencia
  - toma de lock previa en el server antes de transferir
  - notificacion al server cuando la transferencia fue enviada
- Para este MVP, el server ya auto-rutea `verification_completed` directo a la cola de `transferencias_celesol`.
- La prioridad principal es evitar doble transferencias a todo costo, aunque eso empeore la ergonomia operativa.
- Las variables de entorno del cliente quedaran en texto plano solo en el workspace local y no se subiran a Git, ni en texto plano ni cifradas.

## Alcance MVP

- Implementar cliente Rust que consuma `GET /api/v1/queues/transferencias_celesol`.
- Mostrar lista de elementos pendientes con estado de validacion y boton `Transferir`.
- Agregar boton `Refrescar` que vuelva a consultar el core para todos los elementos visibles.
- Bloquear la transferencia cuando falten datos o haya inconsistencias.
- Ejecutar la transferencia solo cuando todos los chequeos bloqueantes den OK y el server haya otorgado lock exclusivo.
- Informar al server un estado intermedio `transfer_initiated` antes de llamar a Coinag.
- Informar al server `transfer_submitted` cuando la transferencia salga bien.
- No permitir reintentos automáticos ni desde UI sobre items que hayan entrado en `transfer_initiated`.

## Decisiones cerradas el 2026-04-07

- UI confirmada: `egui/eframe`.
- Fuente de verdad desde MetaMap para correlacion minima:
  - numero de solicitud
  - numero de documento
  - monto
- `core` en este contexto significa el core financiero en `celesol.dyndns`, no el server nuevo.
- La validacion de titularidad en Coinag via CUIL/CUIT es bloqueante en MVP.
- La regla de monto es igualdad exacta.
- El boton `Refrescar` reconsulta solo el core financiero.
- Los datos de MetaMap se consideran estables y no cambian al refrescar.
- El cliente reconstruye su estado desde el server al abrir o resincronizar; no se requiere persistencia local como fuente de verdad.
- El cliente necesita generar comprobante en v1.
- La recuperacion manual de casos que queden trabados en `transfer_initiated` ocurre fuera de la app.
- Queremos que la app se mantenga actualizada con la cola del server y, si evitar push/WebSocket agrega demasiada complejidad, se acepta polling simple.

## Validaciones bloqueantes a replicar

Estas salen de la logica vigente en `celesol_transferencias.py` y deben conservarse en el cliente nuevo.

1. El caso debe venir del server en la cola de `transferencias_celesol`.
2. El cliente debe poder resolver el `resource_url` y leer desde MetaMap al menos:
   - documento
   - monto
   - identificador de solicitud o equivalente para correlacion con el core
3. En el core, la solicitud debe estar en `Estado.Descripcion = A Transferir`.
4. En el core, debe existir `Prestamo.[CBU transferencia]`.
5. El documento del core debe coincidir con el documento obtenido desde MetaMap.
6. El monto del core (`MontoAFinanciar`) debe coincidir con el monto obtenido desde MetaMap.

## Regla operativa clave

Si en el core no esta el CBU o la solicitud no esta en `A Transferir`, el cliente no debe permitir transferir.

El flujo esperado es:

1. el cliente muestra el item con error o bloqueo
2. el operador corrige el core
3. el operador aprieta `Refrescar`
4. el cliente vuelve a consultar el core para todos los items visibles
5. si ahora los chequeos dan OK, el boton `Transferir` queda habilitado

## Regla anti doble transferencia

La metodologia operativa acordada para este cliente es:

1. el cliente pide al server cambiar el case a `transfer_initiated`
2. si el server acepta, ese item deja de estar disponible para otros clientes u operadores
3. recien despues de ese lock el cliente llama a Coinag
4. si Coinag responde OK, el cliente informa `transfer_submitted` al server
5. si algo falla despues de `transfer_initiated`, no se habilita reintento automatico

Consecuencia buscada:

- preferimos dejar un caso trabado para revision manual antes que arriesgar una doble transferencia

Implicancias para el server:

- hay que agregar el estado `transfer_initiated`
- la cola de `transferencias_celesol` no debe seguir mostrando items en ese estado
- el cambio a `transfer_initiated` debe ser atomico e idempotente
- si dos clientes intentan iniciar al mismo tiempo, solo uno debe ganar

Implicancias para la UI:

- al iniciar transferencia, el boton debe quedar inmediatamente deshabilitado
- si el case ya esta en `transfer_initiated` o posterior, la UI no debe ofrecer `Transferir`
- si el envio a Coinag falla luego del lock, el item debe quedar marcado como bloqueado y escalarse a revision manual

## Chequeos adicionales del sistema actual a revisar

El sistema actual hace mas cosas que conviene revisar aunque no necesariamente queden todas como bloqueantes en v1:

- triangulacion de CUIL/CUIT entre:
  - lookup del sistema por DNI
  - lookup del sistema por solicitud
  - titularidad del CBU consultada en Coinag
- deteccion de solicitudes `Pagadas` en los ultimos 7 dias para el mismo DNI
- consulta de titularidad del CBU destino antes de transferir

Propuesta:

- mantener estos chequeos en el plan
- decidir explicitamente cuales son bloqueantes en MVP y cuales quedan como advertencia

## Arquitectura propuesta

### UI

Recomiendo una UI nativa en Rust con `egui/eframe`.

Motivos:

- menos dependencia operativa que Tauri/WebView
- buen encaje para una lista operativa con refresco manual
- simple de empaquetar como ejecutable Windows

### Modulos sugeridos

- `config`
  - carga de URLs, credenciales y secrets
- `server_client`
  - cola, detalle de case, accion `transfer_initiated`, accion `transfer_submitted`
- `metamap_client`
  - autenticacion y fetch del `resource_url`
- `core_client`
  - consultas al core necesarias para estado, CBU, monto y documento
- `coinag_client`
  - token, transferencia y consultas auxiliares
- `validation`
  - normalizacion de documento y monto
  - reglas bloqueantes y advertencias
- `app_state`
  - items visibles, errores, refresh y acciones en curso
- `ui`
  - lista, detalle, boton `Transferir`, boton `Refrescar`, estados y mensajes

## Flujo funcional propuesto

1. El cliente consulta la cola de `transferencias_celesol`.
2. Por cada item:
   - toma `verification_id` y `resource_url`
   - hace fetch en MetaMap
   - extrae documento, monto y solicitud
   - consulta el core
   - calcula estado de validacion
3. La UI muestra por item:
   - nombre
   - documento
   - solicitud
   - CBU
   - monto MetaMap
   - monto core
   - estado core
   - resultado de validaciones
   - boton `Transferir`
4. El boton `Refrescar` reconsulta el core para todos los items cargados.
5. Antes de transferir, el cliente vuelve a correr validaciones sobre ese item.
6. Si todo da OK:
   - solicita lock al server con `transfer_initiated`
   - si el lock no entra, aborta sin llamar a Coinag
   - ejecuta transferencia en Coinag
   - registra `external_transfer_id`
   - llama al server con `transfer_submitted`
   - actualiza la UI local
7. Si algo falla despues del lock:
   - no reintenta automaticamente
   - deja el caso bloqueado para tratamiento manual

## Fases de implementacion

### Fase 1: Contratos y esqueleto

- Crear el proyecto Rust del cliente.
- Definir configuracion local y manejo de secrets solo fuera de Git.
- Implementar cliente HTTP base y modelos para server, MetaMap y core.
- Diseñar el contrato nuevo del server para `transfer_initiated`.

### Fase 2: Lectura de cola e hidratacion

- Leer la cola del server.
- Hidratar datos desde MetaMap.
- Resolver correlacion minima con el core.
- Mostrar lista de casos en UI.

### Fase 3: Motor de validaciones

- Portar normalizacion de documento.
- Portar normalizacion de monto.
- Implementar chequeos bloqueantes:
  - `A Transferir`
  - CBU presente
  - documento coincide
  - monto coincide
- Agregar boton `Refrescar` global.

### Fase 4: Transferencia real

- Portar cliente Coinag.
- Ejecutar transferencia solo con validaciones OK y lock previo en server.
- Reportar `transfer_initiated` antes del llamado a Coinag.
- Reportar `transfer_submitted` al server si Coinag responde OK.
- Deshabilitar reintentos desde UI una vez tomado el lock.
- Manejar doble click y carreras entre clientes como error bloqueante, no como caso reintentable.

### Fase 5: Endurecimiento operativo

- Logs locales utiles para soporte.
- Tests unitarios del motor de validacion.
- Tests de integracion con stubs.
- Empaquetado Windows.

## Preguntas abiertas

- Cuando un item queda inconsistente, lo mostramos igual con boton deshabilitado o lo separamos en una vista de errores?
- Despues de transferir, el item debe desaparecer apenas se informa `transfer_submitted`, o quedar visible hasta el callback bancario?
- El server debe exponer una vista separada de casos bloqueados en `transfer_initiated`?

## Riesgos a tener presentes

- El backend nuevo hoy entrega solo `verification_id` y `resource_url`; cualquier dato extra que el cliente necesite debera salir de MetaMap o del core.
- Si la correlacion con el core depende de campos no siempre presentes en MetaMap, la UX del cliente puede quedar bloqueada sin una estrategia alternativa.
- Portar el cliente Coinag a Rust es trabajo separado del motor de validacion; conviene no mezclar ambas cosas en un solo bloque de implementacion sin pruebas intermedias.
- El lock `transfer_initiated` elimina reintentos ergonomicos; hay que diseñar bien el circuito de soporte manual para no dejar operaciones opacas.

## Siguientes pasos propuestos: secretos cifrados y distribucion

Decision acordada para continuar en la proxima sesion:

- No distribuir la app final via script de PowerShell.
- Distribuir el ejecutable junto con un archivo cifrado que contenga la configuracion sensible.
- Al abrir la app, pedir una passphrase al operador.
- Desencriptar la configuracion solo en memoria.
- Evitar usar variables de entorno en produccion como mecanismo operativo principal.

Propuesta tecnica elegida:

- Usar un archivo `transferencias.secrets.age` al lado del `.exe`.
- Cifrarlo con passphrase usando la libreria/formato `age`.
- Guardar internamente la configuracion en formato `.env` plano para reutilizar las claves actuales.
- No hacer `std::env::set_var`; la app debe construir `AppConfig` desde un mapa en memoria.
- Mantener `AppConfig::from_env()` solo como camino de desarrollo/debug local.

Librerias sugeridas:

- `age` para cifrado/descifrado con passphrase
- `secrecy` para encapsular passphrase y secretos sensibles
- `zeroize` para limpiar buffers temporales
- `rpassword` solo para una tool CLI que genere el archivo cifrado

Cambios a implementar cuando retomemos:

1. Refactorizar `config` para soportar construccion desde `HashMap<String, String>` ademas de `from_env()`.
2. Agregar un loader de `transferencias.secrets.age` en el arranque.
3. Reemplazar el arranque actual por una pantalla inicial de desbloqueo con passphrase.
4. Parsear el contenido desencriptado como `.env` y construir `AppConfig` desde memoria.
5. Limpiar passphrase y buffers desencriptados al terminar de cargarlos.
6. Mantener fallback a variables de entorno solo para debug o desarrollo local.
7. Agregar una tool CLI, por ejemplo `transferencias-config-tool`, con al menos:
   - `template`
   - `validate`
   - `seal`

Flujo operativo deseado:

1. Preparar un `config.env` local con los valores reales.
2. Ejecutar la tool CLI para validarlo y generar `transferencias.secrets.age`.
3. Distribuir:
   - `transferencias-celesol.exe`
   - `transferencias.secrets.age`
4. El operador abre la app, ingresa la passphrase y recien ahi se inicializa el cliente.

Notas de alcance:

- Esto todavia no esta implementado.
- La idea es priorizar librerias conocidas y evitar diseñar criptografia propia.
- El archivo cifrado debe quedar fuera de Git incluso si se usa en instalaciones reales.
