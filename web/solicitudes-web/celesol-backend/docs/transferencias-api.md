# API BEEX para Transferencias (v1)

BEEX es dueño de la solicitud. Vimarx conserva el socio y el préstamo.
`Solicitud.legacyOid` contiene el **ID del préstamo**, no un ID de solicitud Vimarx.
Esta integración no crea ni busca una segunda solicitud en el core.

Base: `/integrations/transferencias/v1`, en el host de la API backend.
Autenticación: `Authorization: Bearer <token>`. Respuestas JSON con
`Cache-Control: no-store`. Los importes son **strings decimales en ARS** con dos
decimales. Los IDs son strings; no convertir UUID a números ni quitarles letras.

## Alcance y responsabilidades

El backend entrega candidatos, arma el plan, reserva sus identificadores,
registra resultados bancarios confirmados y recibe un PDF para ejecutar
`pagar` por el workflow oficial. No llama al banco ni cambia datos en Vimarx.

La app de Transferencias debe incorporar un adaptador BEEX además del adaptador
legacy. Cada solicitud tiene un solo origen. Un eventual duplicado entre
sistemas es una excepción que requiere revisión; no se une automáticamente por
persona, fecha o importe.

La app sigue siendo responsable de validar MetaMap (documento, importe, estado
y verificación elegida), titularidad y tipo de cuenta bancaria, moneda,
configuración de la línea, controles de renovación, consultas/reconciliación
bancaria y autorización del operador. BEEX registra el `verificationId`
elegido; **no verifica por sí mismo ese ID contra MetaMap ni consulta el banco**.
Una confirmación en esta API es evidencia declarada por el cliente autenticado.
El PDF, por sí solo, no confirma un pago.

## Configuración

Por defecto la integración está deshabilitada (HTTP 404).

| Variable | Uso |
| --- | --- |
| `TRANSFERENCIAS_API_TOKEN_SHA256` | SHA-256 hexadecimal del token; nunca el token en claro |
| `TRANSFERENCIAS_API_USER_ID` | UUID de un usuario dedicado, activo, no administrador, del owner TESORERIA activo |
| `TRANSFERENCIAS_API_CLIENT_ID` | Identidad estable del cliente; predeterminado `transferencias` |

Hash y usuario deben configurarse juntos; una configuración parcial impide el
arranque. El cliente envía el token original (32–512 caracteres sin espacios).
Generar un secreto aleatorio de alta entropía y distribuirlo fuera de Git.
Usar HTTPS. La rotación cambia el hash y conserva el mismo client ID para
recuperar operaciones anteriores. No reutilizar una cuenta personal ni activar
el servicio como administrador. La autorización se verifica en cada request.

### Alta de la identidad de servicio

`scripts/ensure-transferencias-service-user.mjs` provisiona la cuenta técnica
`svc-transferencias-beex` usando el componente de usuarios de la aplicación.
Debe ejecutarse desde el backend, con `dist/` y su acceso a PostgreSQL, o enviarse
por stdin al contenedor operativo (`node --input-type=module -`). Sin `--create`
solo consulta; el alta requiere
autorización operacional explícita y el argumento `--create`.

La cuenta queda activa en TESORERIA, sin permisos de administrador y fuera de
la asignación automática. Usa un correo reservado `.invalid`, no envía emails y
mantiene `emailVerified=false` para impedir el login interactivo. El hash de una
contraseña aleatoria se genera y su original se descarta; la autenticación de
la integración usa el token separado, no esa contraseña. `legacyUser` es una
identidad técnica de Beex: no crea ni modifica un usuario Vimarx.

El script verifica las condiciones antes de confirmar la transacción, devuelve
el UUID y es idempotente: si ya existe con otra configuración, falla sin editarla.
No activa la API ni modifica el runtime env. Incorporar luego el UUID y el hash
del token a la configuración cifrada Git-managed, y desplegar ambos juntos.

Checkpoint 2026-10-06: identidad técnica creada en producción mediante el componente
de usuarios, con las condiciones anteriores verificadas. El UUID y un token generado
con 256 bits aleatorios se registraron localmente fuera de Git. La configuración
cifrada `web/solicitudes-web/deploy/solicitudes-web.prod.env.enc` incorpora el hash
SHA-256 y el UUID juntos; su despliegue habilita la API en producción. El token
original no se incluye en el repositorio. El estado actual del usuario debe
comprobarse antes de desplegar la configuración.

Aplicar las migraciones antes de arrancar la versión nueva. Los ejemplos y
Compose dejan ambas variables vacías por defecto; desarrollo conserva la API
deshabilitada. El alta del usuario es una operación separada del despliegue.

## Identidades y datos financieros

- `solicitudId`: UUID BEEX; `nroSolicitud`: referencia legible, no identidad bancaria.
- `prestamoLegacyId`: ID del préstamo Vimarx asociado, único por desembolso.
- `financialLineId`: ID de `F.Module.Cuentas.Prestamos.LineaPrestamo`. No es
  `lineaPrestamoLegacyOid` de la presolicitud. El cliente debe resolver su
  configuración bancaria usando este namespace explícito.
- `id` del desembolso: UUID persistente de la operación reservada.
- `paymentKey`: `member` o `creditor:<UUID de cancelación BEEX>`.
- `bankNumber`: número secuencial global por solicitud/pago, serializado como
  string decimal. Lo asigna PostgreSQL al consultar el plan y permanece igual
  entre instalaciones, consultas concurrentes y reintentos. No es `nroSolicitud`
  ni el ID del préstamo. Puede haber huecos; no se recicla y la secuencia no cicla.
  La nueva migración debe aplicarse antes de usar el cliente compatible con Beex.
- `bankTransactionId`: ID que el cliente genera con el formato admitido por el
  banco y guarda en BEEX **antes de enviar**. Único, inmutable y nunca reciclado.
- `bankOperationId`: referencia bancaria confirmada; no puede usarse en dos pagos.

El plan incluye `member: {cuit, name}` aunque el neto al socio sea cero, para
validar el titular contra el lookup por DNI sin inferirlo de una pata acreedora.

El cliente conserva los IDs de Vimarx. Para Beex usa `ID_EMPRESA` + ocho dígitos
altos de `bankNumber` + `3` + cinco dígitos bajos + `9`. El sufijo tiene 15
dígitos: el `3` separa las patas legacy (tipos `1`/`2`) y el `9` lo separa del
pago legacy normal (terminado en `0`). La misma empresa y el mismo número
producen siempre el mismo ID. Los desembolsos reservados con formatos anteriores
conservan sus IDs; no se reemplazan automáticamente.

El plan lee el préstamo por ID, restringido al socio vinculado al CUIT del
titular BEEX. Consulta los campos `LineaPrestamo.ID`, `[CBU transferencia]`,
`[Bco CMF]`, `[Bco Coinag Cba]` y `[Monto En Mano]`. Los CUIT de socio y
acreedores se resuelven por sus IDs en `F.Module.SocioMutual`. Se rechazan
respuestas inesperadas, préstamos ajenos y datos incompletos.

El CBU no habitual tiene prioridad sobre el habitual y debe coincidir con el
préstamo. Los acreedores deben tener CUIT de persona jurídica; los controles
bancarios definitivos siguen en la app. Solo puede haber un monto bancario
distinto de cero; se toma su valor absoluto. Sin cancelaciones, ese importe es
el pago al socio. Si es menor al solicitado, `requiresRenewalReview=true`;
si lo supera, se bloquea.

Con cancelaciones, la suma de sus detalles + abs(neto en mano) debe coincidir
exactamente con el monto solicitado y el total bancario. Un neto cero omite el
pago al socio. Los cálculos usan Decimal, sin tolerancias ni redondeos. Los
importes numéricos JSON del core mayores a 10^12 se rechazan: para valores
grandes el core debe devolver strings decimales.

`verification.requestNumber` es el ID del préstamo usado por el enlace de firma
actual; `verification.document` es el documento BEEX. Comparar MetaMap contra
`requestedAmount`, además de los demás controles de la app. Si
`verification.required=true`, reservar exige un `verificationId` no nulo.

## Endpoints

| Método y ruta | Resultado |
| --- | --- |
| GET `/solicitudes?limit=50&cursor=<uuid>` | `items` y `nextCursor`; solo Transferir / TESORERIA activos, no archivados; incluye referencia de reserva si existe |
| GET `/solicitudes/:id/plan` | Plan actual o error explícito; puede consultar el core |
| POST `/solicitudes/:id/reserva` | Reserva y snapshot inmutable; reintento idéntico devuelve la misma operación |
| GET `/reservas/:idempotencyKey` | Recuperación cuando se perdió la respuesta de reserva |
| GET `/desembolsos/:id` | Estado durable, snapshot, IDs y resultados por pago, y referencia/hash del PDF |
| POST `/desembolsos/:id/revalidar` | Compara el plan financiero actual con la reserva antes de iniciar un pago pendiente |
| PUT `/desembolsos/:id/pagos/:paymentKey` | Registra un resultado bancario confirmado e inmutable |
| POST `/desembolsos/:id/comprobante` | Multipart `file` PDF; adjunta y ejecuta `pagar` atómicamente en PostgreSQL |

`limit`: 1–100; el cursor es el último UUID de la página, orden ascendente.
Recorrer hasta `nextCursor=null`; no es un snapshot de una cola cambiante.
Consultar directamente el desembolso para recuperar pagos que ya salieron de
Transferir. Codificar `paymentKey` como segmento URL.

Ejemplo sintético de reserva (usar los valores del plan recibido):

```json
{
  "idempotencyKey": "11111111-1111-4111-8111-111111111111",
  "planVersion": "<sha256 del plan>",
  "installationId": "tesoreria-pc-01",
  "operator": "operador-interno",
  "verificationId": "verificacion-seleccionada",
  "payments": [
    {"paymentKey": "member", "bankTransactionId": "<id compatible con el banco>"}
  ]
}
```

Persistir el cuerpo de reserva y su clave en disco antes del POST. Reenviar el
mismo contenido ante una respuesta perdida. Cambiar el contenido con la misma
clave produce `IDEMPOTENCY_CONFLICT`. Otra clave para una solicitud/préstamo
reservado o un ID bancario ocupado produce `RESERVATION_CONFLICT`. Los pagos
deben coincidir exactamente con los del plan, sin omisiones ni duplicados.

Ejemplo sintético de confirmación:

```json
{
  "installationId": "tesoreria-pc-01",
  "operator": "operador-interno",
  "bankTransactionId": "<el ID reservado>",
  "bankOperationId": "<referencia confirmada por el banco>",
  "amount": "1000.01",
  "currency": "ARS",
  "cbu": "0000000000000000000001",
  "cuit": "20123456789",
  "confirmedAt": "2026-01-01T12:00:00Z"
}
```

CUIT/CBU/importe/ID deben coincidir con el snapshot. Un reintento con idéntica
evidencia financiera es exitoso, incluso con otro operador de recuperación.
La primera evidencia y sus datos de auditoría se conservan. Un resultado
distinto produce conflicto y no reemplaza lo confirmado.

## Secuencia y recuperación

1. Leer candidatos y plan. Validar MetaMap, banco, configuración de la línea y,
   si corresponde, renovación.
2. Persistir localmente clave de reserva e IDs bancarios; reservar.
3. Revalidar antes de iniciar cada pago pendiente. Un cambio en el core bloquea
   continuar con el snapshot anterior. La revalidación no es una transacción
   distribuida con el core ni con el banco.
4. Ante una operación bancaria de resultado desconocido, consultar al banco por
   **el mismo ID** antes de cualquier reintento. BEEX conserva el ID pero no puede
   saber si el banco debitó. La app debe guardar también su outbox local.
5. Registrar cada pago confirmado. Los pagos parciales permanecen en
   `RESERVED`, con detalle de qué pagos están confirmados. Cuando todos están
   confirmados, el estado es `BANK_CONFIRMED_PENDING_SYNC`.
6. Enviar un PDF único del desembolso. Solo se acepta un archivo PDF,
   `application/pdf`, hasta `ADJUNTOS_MAX_FILE_SIZE_BYTES`. Se verifica cabecera
   y marcador final; no se interpreta ni certifica su contenido financiero.
7. El servidor guarda en MinIO por hash de contenido. En una única transacción
   crea el adjunto, ejecuta `ChangeSolicitudStateUseCase -> SolicitudWorkflowEngine`,
   verifica Pagada, escribe historial y marca `COMPLETED`.
8. Si falla MinIO o la transacción, consultar el desembolso y reintentar solo la
   sincronización. Nunca repetir el pago por un error de PDF/BEEX. Un reintento
   del mismo PDF sobre COMPLETED devuelve el resultado; otro PDF da conflicto.

No hay expiración ni liberación automática de reservas. La app no puede reservar
una nueva operación para eludir un resultado bancario desconocido. Cualquier
anulación/liberación requiere un procedimiento de conciliación separado, fuera
de esta API v1.

La reserva congela datos financieros de la solicitud, todo el titular y las
cancelaciones, también desde la UI normal. Solo la transacción de esta
integración puede cambiar el estado de una solicitud reservada. El comprobante
vinculado no se puede editar ni borrar desde la UI. Los triggers de base
serializan esos cambios con las reservas; las solicitudes sin reserva
conservan su funcionamiento anterior. No se cambia automáticamente una
solicitud ya pagada manualmente por fuera de esta integración.

MinIO no comparte transacción con PostgreSQL: una falla posterior al upload
puede dejar un objeto sin vínculo. La clave incluye desembolso y SHA-256 para
no sobrescribir otro PDF. Un retry reutiliza el objeto. Una futura limpieza debe
comprobar referencias y actividad antes de borrar; no borrar en un retry fallido.

## Errores y activación

Errores JSON: `{"error":{"code":"...","message":"..."}}`.
400 formato/PDF inválido; 401 token; 403 identidad/permisos; 404 deshabilitada o
no encontrada; 409 conflicto de plan/reserva/resultado; 413 archivo grande;
503 core no validable; 500 falla interna/sincronización.

Antes de habilitar el cliente, validar en dev el contrato real de los campos
calculados del préstamo (incluidos signo, cero y cancelaciones), la referencia
MetaMap actual y el mapeo de línea financiera a cuenta bancaria. Las pruebas
locales usan datos sintéticos, PostgreSQL real y dobles para core/MinIO; no
ejecutan transferencias ni certifican esos servicios externos.

La adaptación del programa de Transferencias y la activación operacional son
trabajos posteriores. Este PR entrega el lado BEEX y su contrato.

## Pruebas locales

Ejecutar `npm ci`, `npm run prisma:generate`, `npm run typecheck`,
`npm run lint`, `npm run build` y `npm test`.
El suite existente también necesita `DATABASE_URL` con migraciones aplicadas.

Para ejecutar las pruebas nuevas con PostgreSQL real, usar una base local
descartable cuyo nombre termine en `_test`. Aplicar `prisma migrate deploy`
con `DATABASE_URL` apuntando a esa base; definir también
`BEEX_TEST_DATABASE_URL` con la misma URL y ejecutar:

```text
npx tsx --test "src/modules/transferencias-integration/*.test.ts"
```

La prueba rechaza hosts remotos y no usa `DATABASE_URL` como fallback. Crea datos
sintéticos y no borra registros; descartar la base local al terminar. Sin esa
variable la prueba de PostgreSQL se omite explícitamente. No ejecutar seeds
operacionales para estos tests.
