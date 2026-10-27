# Revisión documental de BEEX

La firma del legajo digital se gestiona en paralelo al análisis, desde que existe
un préstamo asociado y hasta su transferencia. BEEX consulta los intentos de
MetaMap, propone una decisión y conserva la aprobación humana de Legajos Digitales.
La generación del préstamo sigue separada del cierre del análisis.
El worker registra evidencia y avisos; nunca aprueba firmas por sí solo.

El vendedor ve un resumen sin evidencia biométrica: enlace vigente, cantidad de
envíos completos, fecha del último y aprobación. La primera tilde requiere un
envío terminado (`completedAt` válido); abrir o iniciar un intento no alcanza.
La segunda requiere una aprobación humana vigente. La bandeja de Legajos incluye
préstamos activos aún no transferidos, también los que esperan firma o análisis.
La bandeja excluye estados terminales, solicitudes archivadas y cualquier
desembolso reservado o pago externo registrado en BEEX. Antes de filtrar por
firma y paginar, consulta en lotes Vimarx para omitir préstamos anulados o
inactivos y solicitudes históricas marcadas como `Pagada`. Los préstamos creados
directamente se consultan por su ID; los vínculos históricos se resuelven desde
su solicitud original, sin confundir ambos espacios de IDs. Un saldo, una fila
contable de desembolso o el estado `Normal` no se interpretan como prueba de pago.
Si Vimarx falla o no permite verificar un préstamo, la bandeja devuelve un error
de consulta en lugar de mostrarlo como pendiente o devolver una lista vacía.
Estas lecturas no cambian vínculos, estados ni historiales. El préstamo anulado
permanece en el detalle para su trazabilidad y eventual reemplazo controlado.

## Reglas de la propuesta

Se aprueba si al menos un intento cumple todos estos controles:

- Referencia `Solicitud` del documento firmado igual al ID del préstamo asociado.
- DNI de BEEX y documento de identidad coincidentes.
- Monto solicitado, cantidad de cuotas y monto de cuota iguales a BEEX.
- Declaración PEP de MetaMap explícitamente falsa.
- Estado vigente `identity.status = verified` en el recurso de MetaMap.
- Documentos firmados con fecha válida y originales disponibles para el legajo.

No se deduce el verde a partir de `verification_completed`, del estado original
del webhook ni del índice consolidado. Se consulta el recurso vigente del
proveedor. Los valores ausentes, ambiguos, inconsistentes o no recuperables
producen una propuesta de no aprobar; los controles muestran el motivo.

Los importes se normalizan con decimales exactos a centavos; las cuotas firmadas
y `cuotaResultante` usan el formato argentino. La versión de reglas se guarda en
cada evaluación. No se agregan umbrales biométricos ni plazos de vigencia que no
formen parte de estas reglas.

## Referencias e intentos repetidos

`solicitud.id` es el UUID de BEEX, `nroSolicitud` es su número visible y
`legacyOid` identifica el préstamo de Vimarx. Este último se envía como variable
firmada `Solicitud` y como `request_number` al índice de MetaMap. No corresponde
al número de solicitud del sistema legado ni a `NroCuenta`.

Se recuperan todos los intentos, sin filtrar por estado. Se propone el más
reciente que cumple los controles; una firma anterior válida basta aunque exista
una nueva rechazada, incompleta o ilegible. El operador puede elegir otro intento
de la evaluación y todas las alternativas quedan conservadas.

## Decisión humana y concurrencia

El panel muestra la propuesta, sus razones, los cruces de datos y los intentos.
Solo el área `LEGAJOS_DIGITALES` o un administrador puede decidir, sin depender
del owner actual de la solicitud:

- Aprobar: guarda decisión y legajo final. Si el análisis ya terminó, avanza a
  `Transferir` en la misma transacción; si está pendiente, conserva la aprobación
  sin cambiar el estado general.
- Solicitar nueva firma: exige motivo, conserva la decisión anterior e inicia un
  ciclo nuevo. Los intentos ya existentes y los envíos anteriores al pedido no
  satisfacen ese ciclo. No devuelve la solicitud al análisis ni altera su avance.

Finalizar el análisis ofrece `Mandar a revisar firma` cuando falta una aprobación
o `Mandar a transferir` cuando ya existe. Liquidada histórica se reconoce como un
análisis ya entregado. La transferencia requiere ambos controles y mantiene sus
guardas financieras. Una reserva o pago ya iniciado impide modificar la gestión
de firma. Aprobar habilita la instancia de transferencia, sin ejecutar el pago.

Diferir de la propuesta o aprobar un intento individual no conforme exige motivo.
Se registran por separado la disparidad global y la excepción sobre el intento.
Una aprobación requiere envío completo, evidencia y legajo completos incluso si
es una excepción humana. La referencia de préstamo, DNI y condiciones financieras
firmadas deben coincidir; esos controles no admiten excepción manual.

Antes de aprobar se consulta MetaMap nuevamente, y otra vez después de compilar
el legajo. La firma elegida debe conservar su evidencia y estado; la propuesta
global también debe seguir siendo la que vio el operador. Un nuevo intento
fallido ajeno a la firma elegida no invalida la aprobación y queda en la evidencia
de la decisión. Un cambio de la firma o de la propuesta exige revisar una nueva
evaluación. Las URLs temporales no se consideran cambios de evidencia.

En la transacción se bloquean solicitud y titular y se comprueban datos, ciclo,
disponibilidad financiera y permisos. Decisión, adjunto final, avisos y avance
correspondiente se guardan juntos. `requestId` permite reintentar sin duplicar.
El ciclo es estable entre estados del análisis y pertenece al préstamo vinculado:
un reemplazo nunca hereda la validez de la firma del préstamo anterior.

Las firmas extra espontáneas no retiran una aprobación válida del mismo ciclo.
Un pedido explícito de nueva firma sí la retira. Los avisos repetidos de un intento
viejo no reabren ni completan ese pedido. Las notificaciones persistentes de BEEX
avisan al vendedor cuando hay enlace o nueva firma solicitada, y a Legajos por
cada envío completo nuevo. Leer un aviso no resuelve la gestión pendiente.

## Evidencia y auditoría

Cada evaluación conserva el snapshot de BEEX, la respuesta de cada intento, la
versión de reglas, sus resultados y el legajo de propuesta. Cada decisión humana
conserva actor, fecha, motivo, intento, propuesta original, decisión humana,
disparidades y contexto de impersonación. Las aprobaciones también archivan la
consulta vigente realizada al decidir. El historial del panel expone ambos
resultados y los intentos conservados.

El legajo contiene resumen, fotos de DNI/selfie, controles biométricos,
declaraciones/listas, condiciones firmadas, resultados y decisiones. La prueba
pasiva (`selfie`) se distingue de la prueba activa (`liveness`). Los PDFs firmados
se reproducen en anexos y se adjuntan embebidos con sus bytes originales y SHA-256;
la compilación no sustituye los originales. Una desaprobación incorpora el legajo
de propuesta original cuando existe, sin volver a consultar el proveedor.

Los archivos se almacenan privados en MinIO y se descargan autenticados. La base
impide actualizar/borrar evaluaciones, decisiones y los adjuntos de legajo que
referencian. Los objetos no usados por una transacción fallida se limpian.
Si falla el almacenamiento, no se permite aprobar ni transferir. Desaprobar para
corregir sigue siendo posible: la decisión estructurada se conserva aunque no
haya podido generarse el PDF final. El índice y las fotos no se exponen con tokens
en el navegador.

Ejemplo de análisis de disparidades (solo lectura):

```sql
SELECT system_decision, human_decision, disagrees_with_system, overrides_attempt,
       count(*) AS decisiones
FROM solicitud_document_decisions
GROUP BY 1, 2, 3, 4;
```

## API

Todas las rutas usan la sesión autenticada existente y `Cache-Control: no-store`.

| Método y ruta                                           | Resultado                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| `GET /solicitudes/document-review/inbox` | Bandeja de Legajos; filtros `status`, `offset`, `limit` |
| `POST /solicitudes/:id/document-review/request-signature` | Solicita nueva firma con `requestId` y `reason` obligatorios |
| `GET /solicitudes/:id/document-review`                  | Evaluación vigente, historial y permiso para decidir            |
| `POST /solicitudes/:id/document-review/evaluate`        | Consulta y conserva una evaluación nueva si cambió la evidencia |
| `POST /solicitudes/:id/document-review/decisions`       | Decisión humana y avance cuando el análisis terminó                            |
| `GET /solicitudes/:id/document-review/:reviewId/legajo` | PDF de propuesta                                                |
| Misma descarga con `?decisionId=<uuid>`                 | PDF de la decisión humana                                       |

Cuerpo de decisión:

```json
{
  "reviewId": "uuid de la evaluación",
  "requestId": "uuid único del intento de decisión",
  "decision": "approve",
  "verificationId": "id del intento de MetaMap elegido",
  "reason": "motivo, obligatorio al desaprobar o diferir"
}
```

`decision` también admite `not_approve`. `verificationId` puede ser nulo al
desaprobar. Un cambio de fuente/proveedor devuelve 409, una falta de permiso 403
y un fallo al guardar una aprobación 503. No se acepta una decisión de sistema
ni un actor enviados por el cliente.

## Configuración y operación

`DOCUMENT_REVIEW_ENABLED` es falso por defecto. Al habilitarlo se exigen todos
los accesos: `DOCUMENT_REVIEW_SERVER_BASE_URL`, `DOCUMENT_REVIEW_SERVER_CLIENT_ID`,
`DOCUMENT_REVIEW_SERVER_CLIENT_SECRET`, `DOCUMENT_REVIEW_METAMAP_CLIENT_ID` y
`DOCUMENT_REVIEW_METAMAP_CLIENT_SECRET`. Los ambientes VPS reciben estos valores
del env cifrado Git-managed; no se guardan credenciales en esta documentación.

La puesta en marcha de este circuito requiere habilitar esa configuración y
asignar los usuarios revisores al nuevo owner `LEGAJOS_DIGITALES` desde la
administración de usuarios. La migración crea el área y cambia el owner de
`VerificarFirmaYDocumentacion`, pero no reasigna personas automáticamente.
Tesorería conserva `Transferir`. Las guardas de firma para transferir son
obligatorias aun si el módulo está deshabilitado: apagarlo no permite eludir la
aprobación. Preparar la configuración y los revisores antes del despliegue.

El camino habitual nuevo cierra el análisis desde `Confirmada` y elige en el
servidor entre `VerificarFirmaYDocumentacion` y `Transferir`, según la aprobación
vigente. `Liquidada` se conserva para solicitudes históricas; no se eliminan
estados ni historiales existentes. Riesgo y administradores conservan el retorno
habitual de `Confirmada` a `Revisar` con motivo, sin desasociar el préstamo.

## Préstamo, monto y recuperación

`Generar préstamo` permanece separado de finalizar el análisis y sólo opera
desde `Confirmada`. Un préstamo activo de igual monto se reutiliza. Si el monto
es distinto se bloquea; una anulación comprobada en Vimarx habilita editar el
monto y regenerar desde Confirmada. El préstamo anulado se reemplaza incluso si
el monto coincide. Los permisos y controles previos sobre otros campos se
conservan. Las devoluciones no liberan el monto de un préstamo vigente.

La generación reserva el intento antes de llamar a Vimarx. Una respuesta incierta
o un fallo de vinculación conserva el intento y bloquea nuevas generaciones.
El administrador puede usar `Recuperar préstamo generado` en la solicitud: el
endpoint `POST /solicitudes/:id/loan-generation/recover` recibe `requestId`,
`expectedUpdatedAt`, `newLoanId` y `reason`; comprueba el préstamo real y lo vincula
sin generar otro. La reserva se consulta en `linked-loan-status` sólo como admin.

La conciliación previa a finalizar el análisis verifica titular, monto, cuotas,
línea, vencimiento y cancelaciones contra Vimarx, conserva evidencia y responsable,
y sólo se completa si todos coinciden. La consulta pública de datos para firmar
hace la misma comprobación de sólo lectura y no modifica la solicitud, de modo
que la firma pueda continuar mientras se analiza una devolución.

Los avisos se guardan por destinatario y evento, con deduplicación transaccional.
La API de Beex ofrece `GET /api/notifications` con `offset`, `limit` y
`unreadOnly`, `POST /api/notifications/:id/read` y `POST /api/notifications/read-all`.
Cada usuario accede únicamente a sus avisos. La lectura no cierra la gestión de
firma. El vendedor recibe el enlace al estar disponible y los pedidos de repetir
la firma; Legajos recibe un aviso por cada envío completo nuevo. El correo al
socio queda fuera de esta entrega.

## Límites y ejecución

El timeout por petición es `DOCUMENT_REVIEW_TIMEOUT_MS` (20 s por defecto). Los
legajos tienen su propio límite `DOCUMENT_REVIEW_MAX_PDF_BYTES` (64 MiB), porque
incluyen páginas reproducidas y originales embebidos. No cambia el límite de las
cargas manuales. Cada original descargado admite 32 MiB; los originales suman
hasta 64 MiB y 150 páginas. Solo se descargan recursos HTTPS de hosts de MetaMap
permitidos, sin seguir redirecciones.

El worker consulta préstamos activos sin transferencia reservada cada 15 s en
lotes de cinco, con leases en la base, independientemente del estado de análisis,
y agenda cada solicitud aproximadamente cada minuto. Las consultas manuales
comparten la ejecución en curso en el proceso. Las observaciones idénticas se
reutilizan; una recuperación de error o cambio de estado genera otra observación.

La migración es aditiva y no mueve solicitudes existentes. El despliegue aplica
las migraciones antes de iniciar la API según el proceso habitual de BEEX.
Para probar la persistencia usar únicamente una base aislada:

```sh
BEEX_TEST_DATABASE_URL=<base-local-aislada> npm test
```

Los tests cubren reglas, intentos repetidos, recursos vigentes, legajo/originales,
permisos, idempotencia, disparidades, datos desactualizados, fallos de storage,
rollback e inmutabilidad. El test de base se omite si no se define esa variable.
