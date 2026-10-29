# Refinanciación: concurrencia y conciliación de cobros

El guardado de cuotas y la reserva de generación toman el mismo bloqueo de fila
en `solicitudes`. Después de simular, el guardado vuelve a verificar estado,
versión, préstamo generado y cobros confirmados dentro de la transacción. La
generación compara también la versión de refinanciación que preparó, incluso si
era una selección vacía. Un conflicto devuelve HTTP 409: actualizar y revisar.
Las llamadas a Vimarx se hacen fuera de estas transacciones.

Antes de cada cobro real se persiste una operación con UUID, préstamo, cuotas,
fecha y estado `PENDING`, dentro de `administrativeCoreControl.generationPending`.
Cada cobro confirmado se agrega a `solicitud_refinanciaciones.cobros` y se retira
la operación pendiente en una sola transacción. Los intentos y sus resultados
quedan en el historial de la solicitud.

Un rechazo explícito de negocio permite liberar la reserva. Un timeout, respuesta
ilegible, error HTTP inesperado o fallo de persistencia conserva el bloqueo. Si
el proceso muere o tampoco puede guardar `UNCERTAIN`, el intento `PENDING` ya
persistido sigue impidiendo editar, volver a cobrar o generar el préstamo.
Los cobros parciales confirmados se conservan y no se repiten en el próximo intento.
No hace falta una migración de base de datos para este protocolo.

## Recuperación administrativa

Usar la sesión propia de un administrador activo; no se permite suplantación.
Estas rutas son relativas al router habitual `/solicitudes` y responden con
`Cache-Control: no-store`:

1. `GET /:id/refinanciacion/cobro-pendiente` devuelve `pending` y
   `expectedUpdatedAt`. La operación incluye `operationId`, `prestamoId`,
   `nrosCuota`, `startedAt`, `status` y, si se pudo conservar, la respuesta real.
2. Esperar al menos el timeout configurado de Vimarx más 60 segundos desde
   `startedAt`. No conciliar mientras el intento pueda seguir ejecutándose.
3. Revisar en Vimarx el préstamo, las cuotas, el movimiento, su cobrador
   **Refinanciación (65)**, motivo, comprobante e importe. El estado de las cuotas
   por sí solo no prueba que se haya usado el cobrador correcto.
4. `POST /:id/refinanciacion/conciliar` con el UUID de operación y la versión
   obtenida en el GET. La identidad se toma de la sesión, nunca del cuerpo.

Cobro confirmado, con el identificador real y el importe del comprobante:

```json
{
  "operationId": "00000000-0000-4000-8000-000000000001",
  "expectedUpdatedAt": "2026-10-29T12:00:00.000Z",
  "resolution": "CONFIRMED",
  "cobroId": "123456",
  "totalCobrado": 1000.50,
  "reason": "Comprobante, importe y cobrador Refinanciación verificados en Vimarx."
}
```

Ausencia del cobro verificada en Vimarx:

```json
{
  "operationId": "00000000-0000-4000-8000-000000000001",
  "expectedUpdatedAt": "2026-10-29T12:00:00.000Z",
  "resolution": "NOT_APPLIED",
  "reason": "Sin movimiento de cobro; cuotas e importe pendientes verificados en Vimarx."
}
```

La API hace una lectura nueva de las cuotas. Para confirmar exige todas las
cuotas con fecha de cobro válida y saldo no positivo; para no aplicado exige
fecha de cobro explícitamente nula y saldo positivo. Datos ausentes o resultados
mixtos mantienen el bloqueo. Si existe una respuesta guardada, no permite negar
el cobro ni cambiar su identificador o importe. La API no dispone de una consulta
que valide automáticamente el comprobante y cobrador: esa evidencia corresponde
a la revisión del administrador y debe quedar explicada en `reason`.

La conciliación registra actor, motivo, operación y resultado en el historial,
guarda el cobro si corresponde y libera la reserva de generación atómicamente.
Después hay que abrir de nuevo el diálogo, revisar los importes y generar el
préstamo; las cuotas confirmadas ya no se cobran. La ruta de recuperación de
préstamos generados no permite resolver cobros pendientes de refinanciación.

Los intentos inciertos anteriores a este protocolo no tienen una operación
durable para esta API y requieren una intervención operativa específica.

## Pruebas

El job `solicitudes-sessions` ejecuta las pruebas de refinanciación con PostgreSQL
aislado y todos los gateways financieros simulados. Para ejecutarlas localmente,
usar `DATABASE_URL` y `BEEX_TEST_DATABASE_URL` contra una base en localhost cuyo
nombre termine en `_test`, aplicar las migraciones y ejecutar:

```sh
npx tsx --test 'src/modules/solicitudes-core/**/*Refinanciacion*.test.ts' \
  src/modules/solicitudes-core/infrastructure/services/InitialLoanGenerationService*.test.ts \
  src/modules/solicitudes-core/infrastructure/services/CobrarPrestamoGateway.test.ts
```

No se usa el seed general: consulta datos reales del core.
