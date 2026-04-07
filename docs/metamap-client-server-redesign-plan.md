# Plan De Replanteo Y Reescritura De Notificaciones MetaMap

Fecha: 2026-04-07

## 1. Punto De Partida

Blueprint actual relevado en `untracked/Notificaciones Metamap/`.

Comportamiento observado:

- `celesol_app/celesol_transferencias.py` concentra demasiadas responsabilidades: webhook local MetaMap, UI Tkinter, ngrok, callbacks Coinag, consultas al sistema y disparo de transferencias.
- `celesol_app/transfer_module.py` ya separa razonablemente la parte de API bancaria y sirve como base para el futuro cliente bancario.
- `celesol_app/coinag_callbacks.py` ya resuelve idempotencia basica de callbacks y sirve como base para mover esa logica al lado servidor.
- El estado de pendientes hoy es local y en memoria. Eso sirve para una sola app de escritorio, pero no para varios clientes ni para reconexion.
- El programa actual fue pensado como aplicacion local autonoma. El objetivo nuevo exige separar control plane y data plane.

## 2. Objetivo Del Redisenio

Construir una arquitectura cliente/servidor donde:

- el servidor reciba webhooks de MetaMap y los persista de forma durable
- el servidor arme una cola de trabajo secuencial y entregue cada caso al cliente correcto segun su etapa
- el sistema soporte al menos 2 tipos de cliente sin rehacer el backend
- el cliente `validador` reciba primero las validaciones, las revise y emita un `ok` o rechazo
- el cliente `transferencias_celesol` reciba solo los casos aprobados por `validador`
- el servidor procese tambien los callbacks del banco y cierre el ciclo operativo
- el cliente siga siendo la pieza que contiene la logica operativa y las credenciales bancarias
- la VPS pueda actuar como proxy/tunel hacia el banco sin desencriptar el contenido bancario
- la migracion pueda hacerse por fases sin perder el blueprint funcional del programa original

## 3. Principios De Arquitectura

- Separar ingestion de eventos, entrega a clientes y tunel bancario en componentes distintos.
- Mantener el servidor como source of truth del estado compartido.
- Mantener las credenciales del banco exclusivamente del lado cliente.
- No inventar criptografia propia. Reusar TLS, mTLS y almacenamiento seguro del sistema operativo.
- Diseñar la entrega de pendientes con semantica al menos once e idempotencia.
- Diseñar desde el inicio un modelo de routing por `client_type` o `client_role`.
- Permitir desplegar varios componentes en una misma VPS, pero no mezclarlos en un solo proceso.

## 4. Arquitectura Objetivo Recomendada

Recomendacion de alto nivel:

- un servicio `metamap-ingest`
- un almacenamiento durable para eventos y pendientes
- un servicio `client-sync-api`
- un servicio `bank-tunnel-gateway`
- un cliente de escritorio nuevo

Diagrama logico:

```text
MetaMap ---> metamap-ingest -----> Postgres/workflow store -----> client-sync-api -----> validador
                     |                        |                            |
                     |                        |                            +---- approval/reject ----+
                     |                        |                                                   |
Banco ---> bank-callback-api -----------------+                                                   |
                                                                                                  v
                                                                                      workflow engine / routing
                                                                                                  |
                                                                                                  v
                                                                                           client-sync-api ---> transferencias_celesol
                                                                                                                   |
transferencias_celesol autenticado ---> bank-tunnel-gateway --------------------------------------------------------+
                              |
                              v
                            Banco

Notas:
- el trafico bancario viaja por la VPS, pero el TLS bancario termina en el cliente y en el banco
- el servidor decide la etapa del caso y a que rol se le entrega
```

### 4.1 Flujo Objetivo `validador` -> `transferencias_celesol`

Flujo operativo objetivo:

1. MetaMap envia un evento de verificacion completada al servidor.
2. El servidor crea o actualiza el `case`.
3. El servidor enruta el `case` a la cola de `validador`.
4. `validador` revisa y responde `approved` o `rejected`.
5. Solo si el estado es `approved`, el servidor mueve el `case` a la cola de `transferencias_celesol`.
6. `transferencias_celesol` revisa, ejecuta la transferencia por el tunel y reporta el intento al servidor.
7. El banco responde por la sesion del cliente y, cuando corresponda, envia callbacks al servidor.
8. El servidor reconcilia el callback bancario con el `case` y lo lleva al estado final.

Este flujo implica que el servidor no es solo una cola, sino un orquestador de estados.

## 5. Componentes Y Responsabilidades

### 5.1 `metamap-ingest`

Responsabilidades:

- recibir webhooks de MetaMap
- validar autenticacion e idempotencia
- normalizar eventos relevantes
- actualizar el estado actual de cada verificacion
- generar items pendientes para los clientes correspondientes
- exponer healthchecks y logs operativos

Notas:

- el webhook no deberia hablar directo con clientes
- el webhook no deberia depender de memoria local para conservar pendientes
- cada evento debe quedar persistido antes de responder `200`

### 5.2 Almacenamiento Durable

Recomendacion inicial: `PostgreSQL` como fuente de verdad.

Entidades minimas:

- `verification_events`: evento crudo recibido de MetaMap
- `verification_cases`: estado actual consolidado por verificacion
- `delivery_targets`: a que tipo de cliente le corresponde cada caso
- `delivery_queue`: estado de entrega por cliente o rol
- `devices`: clientes registrados
- `device_sessions`: sesiones activas
- `audit_logs`: acciones relevantes y seguridad

Recomendacion practica:

- empezar con Postgres sin broker adicional
- agregar Redis o NATS solo si la latencia o el volumen lo justifican

### 5.3 `client-sync-api`

Responsabilidades:

- autenticar clientes
- informar pendientes al conectar
- mantener un canal de sincronizacion
- aceptar `ack`, `lease`, `complete`, `reviewed`, `failed`
- aceptar decisiones de workflow como `approved` y `rejected`
- reenviar pendientes no confirmados tras timeout o desconexion
- entregar a cada cliente solo los casos habilitados para su rol y etapa actual

Transporte recomendado:

- `WebSocket` para sincronizacion en tiempo real
- fallback opcional a long polling solo si hace falta compatibilidad

Semantica recomendada:

- entrega al menos once
- `ack` explicito del cliente
- timeout de lease
- cliente idempotente por `verification_id`
- el cambio de etapa solo lo decide el servidor luego de recibir una accion valida del cliente actual

### 5.4 `bank-tunnel-gateway`

Este componente debe quedar separado del flujo MetaMap aunque corra en la misma VPS.

Responsabilidades:

- autenticar al cliente antes de abrir el tunel
- permitir conexiones solo a destinos bancarios autorizados
- reenviar bytes sin inspeccionar payload bancario
- registrar solo metadatos de sesion
- cortar sesiones no autorizadas o fuera de politica

Modelo recomendado:

- el cliente establece primero una sesion segura con la VPS usando `mTLS`
- una vez autenticado, solicita abrir un relay TCP hacia el host del banco
- dentro de ese relay, el cliente establece TLS directo con el banco
- la VPS solo ve origen, destino, duracion y volumen, no el contenido de aplicacion

Importante:

- no terminar TLS del banco en la VPS
- no instalar CA custom para interceptar trafico
- no guardar credenciales bancarias en el servidor
- limitar destinos por allowlist de host y puerto

Implementacion posible:

- opcion A: `HAProxy` o `Envoy` en modo TCP passthrough con mTLS y politicas
- opcion B: servicio propio minimo de relay TCP con control de sesiones

Recomendacion:

- empezar por una solucion estandar tipo `HAProxy` o `Envoy`
- agregar servicio propio solo si hace falta control de negocio mas fino

### 5.5 `bank-callback-api`

Aunque el objetivo principal nuevo no lo explicite, el blueprint actual maneja callbacks del banco. Eso obliga a tomar una decision ahora.

Recomendacion:

- mover los endpoints publicos del banco al servidor
- procesar idempotencia y persistencia en servidor
- publicar esos callbacks como eventos hacia el mismo canal de clientes

Motivo:

- un cliente de escritorio no deberia quedar expuesto para callbacks publicos
- si hay varios clientes, el callback debe entrar a una capa comun

### 5.6 Cliente De Escritorio

Responsabilidades objetivo:

- conectarse al `client-sync-api`
- descargar pendientes y reflejarlos en la UI local
- permitir revision y acciones del operador
- mantener credenciales bancarias en almacenamiento local seguro
- abrir tuneles via `bank-tunnel-gateway`
- hablar con el banco a traves del tunel sin exponer secretos al servidor
- generar comprobantes y estado local de UX

Comportamientos del blueprint a preservar:

- lista local de verificaciones pendientes
- distincion entre en curso y completadas
- accion de revisar
- accion operativa asociada a transferencias
- feedback visual y auditivo al operador

## 6. Modelo De Cola Y Workflow

La cola no deberia ser una lista global en memoria. Debe modelarse como un workflow con estado de negocio y estado de entrega.

Recomendacion:

- cada verificacion genera un `case`
- cada `case` tiene una `workflow_stage`
- cada `case` puede generar uno o varios `delivery_target`
- cada `delivery_target` tiene su propio estado de entrega

Estados de negocio sugeridos:

- `received_from_metamap`
- `pending_validador_review`
- `leased_to_validador`
- `approved_by_validador`
- `rejected_by_validador`
- `pending_transferencias_celesol_execution`
- `leased_to_transferencias_celesol`
- `transfer_submitted`
- `bank_confirmed`
- `bank_reversed`
- `closed`
- `manual_intervention_required`

Estados sugeridos:

- `pending`
- `leased`
- `acked`
- `completed`
- `failed`
- `dead_letter`

Reglas sugeridas:

- un cliente solo toma items asignados a su rol y etapa
- si el cliente se desconecta durante `leased`, el item vuelve a `pending`
- `approved_by_validador` habilita la creacion de entrega para `transferencias_celesol`
- `rejected_by_validador` cierra el circuito o deriva a revision manual
- `transfer_submitted` no cierra el caso; el cierre real depende de conciliacion con respuesta y callback bancario
- todos los mensajes deben ser idempotentes por `delivery_id` y `verification_id`
- el servidor debe guardar quien aprobo, quien rechazo, quien transfirio y cuando

## 7. Modelo Para Dos Clientes Y Escalabilidad Futura

No conviene hardcodear "cliente 1" y "cliente 2". Conviene modelar tipos de cliente.

Modelo sugerido:

- `client_role`: define el tipo de cliente
- `routing_rule`: define que casos van a que rol
- `device_id`: identifica una instalacion concreta

Roles iniciales recomendados:

- `validador`: recibe validaciones y decide `approved` o `rejected`
- `transferencias_celesol`: recibe solo casos `approved_by_validador` y ejecuta la transferencia

Ejemplos de routing posibles:

- todo caso nuevo va primero a `validador`
- un caso `approved_by_validador` va a `transferencias_celesol`
- un caso `rejected_by_validador` no va a `transferencias_celesol`
- un caso `manual_intervention_required` puede ir a un tercer rol futuro

Beneficio:

- el backend no queda atado a una cantidad fija de clientes
- se puede sumar un tercer cliente o una UI web sin romper el modelo

Nota pragmatica:

- backend con roles distintos desde el dia 1
- cliente de escritorio con una sola codebase si conviene, pero arrancando con perfiles de rol separados

## 8. Redistribucion Del Blueprint Actual

Mapeo recomendado del programa actual al futuro sistema:

- `celesol_transferencias.py`
  - separar en `client-ui`, `client-sync`, `bank-connector`, `local-state`
- `transfer_module.py`
  - conservar del lado cliente como modulo bancario base
- `coinag_callbacks.py`
  - mover al servidor como procesador de callbacks bancarios
- `secure_secrets.py`
  - evolucionar a almacenamiento seguro del sistema operativo

Esto evita tirar el blueprint y tambien evita copiar su acoplamiento actual.

## 9. Decision De Lenguaje: Rust

Conclusiones recomendadas:

- si, tiene sentido evaluar Rust para el cliente nuevo
- no hace falta obligar al servidor a Rust en la primera iteracion

Por que Rust tiene sentido para el cliente:

- genera binarios mas faciles de distribuir en Windows
- evita parte de la fragilidad actual de Python + Tkinter + ngrok + empaquetado
- sirve mejor para networking persistente y manejo de reconexion
- permite integrar mejor almacenamiento seguro local y control de memoria
- encaja bien con un cliente que debe sostener UI, sync y tunel seguro

Recomendacion pragmatica:

- cliente nuevo en Rust
- servidor v1 en Python con `FastAPI` o framework equivalente
- proxy/tunel con componente estandar tipo `HAProxy` o `Envoy`

Esto baja riesgo de reescribir todo a la vez.

## 10. Fases De Implementacion Recomendadas

### Fase 0. Congelar Contratos Del Blueprint

- documentar los eventos que hoy consume el cliente
- documentar los campos minimos para UI y operacion
- documentar que acciones dispara hoy el operador
- documentar que callbacks bancarios siguen siendo necesarios
- documentar el workflow objetivo `validador -> approved/rejected -> transferencias_celesol -> transferencia -> callback banco`

Salida esperada:

- especificacion de contratos y estados

### Fase 1. Disenar El Backend Compartido

- definir tablas y estados de entrega
- definir estados de workflow
- definir autenticacion de cliente
- definir `routing_rule` y `client_role`
- definir contratos HTTP y WebSocket
- definir contratos de accion para `validador` y `transferencias_celesol`
- definir reconciliacion de callbacks bancarios

Salida esperada:

- documento de API y modelo de datos

### Fase 2. Implementar Servidor Workflow-First

- recibir webhooks de MetaMap
- persistir eventos y casos
- exponer pendientes por cliente y por etapa
- implementar `ack`, lease y reentrega
- implementar cola de revision para `validador`
- implementar transicion `approved` y `rejected`

Salida esperada:

- backend funcional ya alineado al flujo final `validador` -> `transferencias_celesol`

### Fase 3. Construir Cliente `validador`

- autenticar contra servidor
- sincronizar pendientes
- reproducir UX minima del blueprint para revision
- aprobar o rechazar casos
- reflejar estados locales y auditoria del operador de `validador`

Salida esperada:

- cola de `validador` operativa con decisiones persistidas en servidor

### Fase 4. Construir Cliente `transferencias_celesol` Y Tunel Bancario

- autenticar `transferencias_celesol` contra servidor
- recibir solo casos aprobados por `validador`
- revisar y disparar transferencia
- autenticar cliente con mTLS
- restringir destinos
- permitir relay TCP al banco
- verificar que la VPS no termina ni inspecciona TLS bancario

Salida esperada:

- `transferencias_celesol` operando sobre casos aprobados con conectividad bancaria segura

### Fase 5. Integrar Operacion Bancaria Y Callbacks

- mover callbacks publicos a servidor
- hacer que el cliente opere el banco a traves del tunel
- unificar eventos de MetaMap y callbacks bancarios en el mismo bus funcional
- conciliar `transfer_submitted` con callback bancario
- cerrar el caso o marcar excepcion segun respuesta real del banco

Salida esperada:

- flujo operativo completo `validador` -> `transferencias_celesol` -> banco -> callback

### Fase 6. Multiples Dispositivos, Roles Y Hardening Funcional

- registrar multiples dispositivos por rol
- probar exclusividad, reentrega y failover
- probar auditoria por operador
- probar callbacks duplicados e idempotencia punta a punta

Salida esperada:

- backend preparado para crecer sin rehacer el modelo

### Fase 7. Hardening Y Cutover

- observabilidad y auditoria
- rotacion de certificados o credenciales de dispositivos
- rate limiting
- backups y recovery
- plan de rollback

Salida esperada:

- sistema apto para pasar a operacion estable

## 11. Decisiones Que Conviene Cerrar Antes De Empezar A Programar

- si el callback del banco queda dentro del alcance de esta reescritura
- si el backend va a vivir en esta misma repo o en una repo aparte
- si la UI del cliente nuevo sera minima o si tambien se redisenia la experiencia
- que roles de cliente existen de verdad en la primera version
- si la primera version necesita operar transferencias o solo mostrar pendientes
- si el banco acepta sin cambios el esquema de tunel propuesto

## 12. Recomendacion De Alcance Para El MVP

MVP recomendado:

- servidor recibe MetaMap
- servidor persiste casos y etapas
- `validador` sincroniza y aprueba o rechaza
- `transferencias_celesol` recibe solo aprobados
- tunel bancario implementado como componente separado
- callbacks del banco procesados por el servidor

No meter en el mismo primer corte:

- redisenio completo de UI
- logica avanzada de multiples bancos
- reglas complejas de ruteo
- reescritura total de todos los modulos historicos de una sola vez

No conviene hacer como paso intermedio:

- una cola plana de un solo cliente que despues haya que reescribir para soportar `validador` y `transferencias_celesol`

## 13. Recomendacion De Estructura De Codigo Si Esto Queda En Esta Repo

Esto no deberia entrar dentro de `kestra/`, porque no es un flow ni namespace files.

Si se decide versionarlo aca, una estructura razonable seria:

```text
apps/
  metamap-platform/
    docs/
    contracts/
    server/
    client/
    proxy/
```

Si se quiere aislar mejor el ciclo de vida, tambien tiene sentido una repo aparte.

## 14. Recomendacion Final

La mejor direccion no es convertir el programa actual en un servidor gigante, sino dividirlo en:

- servidor de eventos y pendientes
- gateway de tunel bancario
- cliente de escritorio nuevo

Y dentro del servidor, modelar desde el principio el workflow real:

- MetaMap entra al servidor
- servidor entrega a `validador`
- `validador` aprueba o rechaza
- servidor entrega a `transferencias_celesol` solo si hay aprobacion
- `transferencias_celesol` transfiere por el tunel
- banco responde y el callback vuelve al servidor

La separacion mas importante es esta:

- el servidor administra estado compartido y exposicion publica
- el cliente administra operacion local y secretos
- el proxy administra conectividad, no negocio

Ese corte deja una base limpia para sumar un segundo cliente y, si hace falta, una futura UI web u otro consumidor.
