# Revisión documental de BEEX

Cuando una solicitud está en `VerificarFirmaYDocumentacion`, BEEX consulta los
intentos de MetaMap, propone una decisión y genera un legajo propio. La solicitud
permanece en ese estado hasta que una persona responsable decide. El worker no
ejecuta transiciones.

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
Solo el owner del estado actual o un administrador puede decidir:

- Aprobar: guarda la decisión humana, legajo final y avance a `Transferir`.
- Desaprobar: exige motivo, guarda la decisión y devuelve a `Liquidada` para
  corregir o volver a firmar.

Diferir de la propuesta o aprobar un intento individual no conforme exige
motivo. Se registran por separado la disparidad con la propuesta global y la
excepción sobre el intento elegido. Una aprobación requiere evidencia y legajo
completos incluso si es una excepción humana.

Antes de aprobar se consulta MetaMap nuevamente, y otra vez después de compilar
el legajo. La firma elegida debe conservar su evidencia y estado; la propuesta
global también debe seguir siendo la que vio el operador. Un nuevo intento
fallido ajeno a la firma elegida no invalida la aprobación y queda en la evidencia
de la decisión. Un cambio de la firma o de la propuesta exige revisar una nueva
evaluación. Las URLs temporales no se consideran cambios de evidencia.

En la transacción se bloquean solicitud y titular y se comprueban los datos, el
ciclo de verificación, el estado y los permisos. Decisión, adjunto final e
historial de transición se guardan juntos. `requestId` permite reintentar la
misma decisión sin duplicarla. Los endpoints genéricos no permiten saltarse el
panel, tampoco como administrador, mientras el flujo está habilitado.

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
| `GET /solicitudes/:id/document-review`                  | Evaluación vigente, historial y permiso para decidir            |
| `POST /solicitudes/:id/document-review/evaluate`        | Consulta y conserva una evaluación nueva si cambió la evidencia |
| `POST /solicitudes/:id/document-review/decisions`       | Decisión humana y transición atómica                            |
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

El timeout por petición es `DOCUMENT_REVIEW_TIMEOUT_MS` (20 s por defecto). Los
legajos tienen su propio límite `DOCUMENT_REVIEW_MAX_PDF_BYTES` (64 MiB), porque
incluyen páginas reproducidas y originales embebidos. No cambia el límite de las
cargas manuales. Cada original descargado admite 32 MiB; los originales suman
hasta 64 MiB y 150 páginas. Solo se descargan recursos HTTPS de hosts de MetaMap
permitidos, sin seguir redirecciones.

El worker consulta pendientes cada 15 s en lotes de cinco, con leases en la base,
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
