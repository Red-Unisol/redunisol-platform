# API de cobros de Celesol / Vimarx

Documento para Álvaro · revisión del 16/11/2026 · tarea Bitrix 23595.

## Qué tenemos hoy

Hay dos endpoints diferentes para registrar cobros. No tienen el mismo contrato:

| Endpoint | Qué recibe | Evidencia disponible |
| --- | --- | --- |
| `POST /fapi/PagoDeuda` | Una cuota identificada por su ID interno y un importe explícito. | Contrato publicado en el Swagger vigente, consultado por GET el 16/11/2026. No se ejecutó un cobro para verificar su comportamiento. |
| `POST /api/Prestamo/cobrar` | Un préstamo y los números de cuotas seleccionadas; el consumidor actual pide que Vimarx calcule el pago total. | Gateway y pruebas del código vigente de Red Unisol Platform; comentarios de pruebas históricas en FapiTest de octubre/noviembre. No aparece en el Swagger consultado hoy. |

Para Pago360 necesitamos registrar exactamente el importe que el socio pagó. Por eso `PagoDeuda` es un candidato que debe validarse; que aparezca en Swagger no demuestra cómo distribuye capital, intereses y punitorios ni cómo identifica el cobro generado. El consumidor actual de `Prestamo/cobrar` no envía un importe elegido: utiliza `pagoTotal: true`.

Este documento describe contratos y evidencia. No se desplegó nada ni se ejecutaron cobros o simulaciones en Vimarx durante esta revisión.

## 1. Pago de una cuota: `/fapi/PagoDeuda`

Base consultada para el Swagger: `https://celesol.dyndns.org:5002`.

Esquema publicado hoy: `DeudaPrestamo`, enviado como JSON.

| Campo | Tipo publicado | Qué falta comprobar |
| --- | --- | --- |
| `fecha` | string, formato `date-time` | Si representa fecha contable, de pago o de cálculo; zona horaria y aceptación de fechas anteriores. |
| `importe` | number, double | Cómo distribuye el importe y qué sucede si difiere del saldo, incluyendo cargos y punitorios. |
| `idCuota` | string, nullable | Debe ser el ID interno de la cuota. Falta probar el uso operativo de ese ID en este endpoint. |
| `idCobrador` | integer int32, nullable | Qué cuenta y asiento utiliza el cobrador elegido y cómo trata un valor ausente o inválido. |
| `idCuentaAmv` | integer int32, nullable | Si corresponde enviarla para Pago360 y qué cuenta debe utilizarse. |
| `permitirPagarFueraDeOrden` | boolean, nullable | Su efecto real sobre orden de cuotas y cálculo de intereses/punitorios. |

El último campo figura en el Swagger vigente y no estaba en el snapshot guardado del 15/09/2026. Su nombre es **`permitirPagarFueraDeOrden`**.

El Swagger sólo anuncia una respuesta HTTP `200` con descripción `Success`; no publica un esquema de respuesta para recuperar el ID del cobro. Tampoco publica en este esquema una clave de idempotencia ni una referencia externa para asociar el cupón.

No hay un campo de simulación publicado para `PagoDeuda`. No se debe inventar `simulacion: true` ni llamar al endpoint suponiendo que eso evitaría una escritura.

### Cómo obtener `idCuota`

Los metadatos actuales de Celesol identifican:

- Entidad: `F.Module.Cuentas.Prestamos.CuotaPrestamo`.
- Clave primaria: `ID`, tipo `Int32`.
- Relación: `Prestamo`.
- Número visible de cuota: `NroCuota`.
- Campos útiles de lectura: `Fecha`, `FechaCobro`, `SaldoCuota`, `IsDeleted`, `UltimoPago`.

La resolución debe buscar una cuota del préstamo correcto y comprobar que hay un único resultado activo y consistente. `NroCuota`, `Prestamo.ID` y `NroCuenta` son identificadores diferentes y no sustituyen a `CuotaPrestamo.ID`. Si hay más de una fila candidata, no elegir la primera por aproximación.

Estos campos se verificaron como metadatos; no se hizo una prueba de escritura que demuestre la relación entre `idCuota` y el cobro generado.

## 2. Cobro por selección: `/api/Prestamo/cobrar`

El gateway vigente construye este cuerpo (ejemplo sintético, exclusivamente en modo simulación):

```json
{
  "idPrestamo": 999000001,
  "nrosCuota": [1, 2],
  "cobradorId": 999,
  "motivo": 0,
  "pagoTotal": true,
  "simulacion": true,
  "fecha": "2026-11-16"
}
```

Los IDs del ejemplo son ficticios y no son una configuración válida. No se invocó este ejemplo.

Puntos importantes del consumidor actual:

- `idPrestamo` es el ID interno del préstamo, enviado como número.
- `nrosCuota` contiene los números de las cuotas de ese préstamo.
- El nombre del cobrador es **`cobradorId`**. El gateway documenta que usar `idCobrador` aquí fue ignorado por Vimarx en una prueba histórica, tomando CAJA.
- `pagoTotal: true` hace que Vimarx calcule el total. El gateway no implementa la variante de importe explícito o pago parcial.
- `simulacion: true` es el modo que el consumidor utiliza para calcular sin registrar. La evidencia de ese comportamiento es histórica y corresponde a FapiTest; no se ejecutó hoy.
- `fecha` usa `YYYY-MM-DD` y funciona como fecha de cálculo en el gateway. Sin ella, el código documenta cálculo a hoy. No se envía como `fechaCalculo`.
- El campo opcional de este endpoint se llama **`permitePagoFueraDeOrden`**, distinto de `PagoDeuda`. El gateway sólo lo envía cuando vale `true`.
- Los antecedentes del gateway indican que cobrar fuera de orden cambia el tratamiento de punitorios. No debe activarse para resolver un rechazo sin comprobar el importe resultante.

### Motivo del cobro

El código identifica los motivos `0 = Normal`, `1 = Refinanciacion` y `2 = CancelacionAnticipada`.

La integración existente de refinanciaciones utiliza el motivo `1` y un cobrador propio; también puede activar cargos de refinanciación y afectar el importe del préstamo nuevo. Esos valores no deben copiarse al circuito de Pago360. El motivo y la contrapartida de Pago360 deben validarse específicamente.

### Respuesta que procesa el gateway

Ante una respuesta satisfactoria espera `Success: true` y procesa:

- `CobroId`: identificador del cobro; en las simulaciones históricas es `0`.
- `Capital`, `Interes`, `Otros`, `Punitorios`, `TotalPago`.
- `Cuotas`: detalle con `NroCuota`, `FechaVto`, `InteresPagado`, `OtrosPagado`, `PunitoriosPagados` y `TotalPagado`.

Una respuesta histórica también incluye `CuotaId` en el detalle; el mapper actual no lo conserva. No asumir que el gateway ya devuelve ese ID a sus consumidores.

Para un cobro real se debe exigir un identificador válido, conservar la respuesta y releer el estado del cobro y la cuota. `Success: true` o una cuota con saldo cero, por sí solos, no prueban que ese pago corresponde al cupón de Pago360.

### Rechazos y errores inciertos

El gateway considera un rechazo definido a una respuesta HTTP `400` o `422` con un objeto `error.message` válido, siempre que no sea una respuesta contradictoria de éxito. Errores de red, timeouts, respuestas malformadas y otros errores se tratan como resultado incierto.

La API no tiene una garantía de idempotencia comprobada. Si pudo haberse enviado una escritura, no se repite automáticamente: primero hay que conciliar.

## 3. Cobrador de Pago360 encontrado

Una consulta de sólo lectura a `CobradorCuenta` mediante el conector Celesol, realizada el 16/11/2026, devolvió:

| ID | Denominación | Activo | IsDeleted |
| --- | --- | --- | --- |
| 42 | PAGOS 360 | true | false |

Es un candidato observado en el sistema conectado. Falta confirmar que el ambiente de ejecución utiliza el mismo catálogo, que es el cobrador correcto para esta integración, su cuenta contable y si corresponde una cuenta AMV. No quedó configurado como cobrador operativo en la nueva integración.

## 4. Qué falta para habilitar Pago360 → Vimarx

1. Elegir y verificar el endpoint que imputa exactamente lo cobrado para cuotas vencidas. Comparar el importe verificado del proveedor con la deuda vigente; ante diferencias, conciliar sin agregar reglas de descuentos, excedentes o punitorios.
2. Comprobar la resolución inequívoca de `idCuota`, su préstamo, vencimiento y saldo antes de escribir.
3. Confirmar el cobrador `42`, su contrapartida y la necesidad de `idCuentaAmv`.
4. Definir qué fecha enviar y comprobar su efecto real. No asumir que la fecha de cálculo equivale a la fecha de pago del proveedor.
5. Obtener una respuesta de cobro documentada y un mecanismo de relectura que vincule inequívocamente ese cobro con la operación de Pago360, incluso después de un timeout. Una cuota pagada por otro medio debe quedar en conciliación.
6. Validar autenticación y permisos del endpoint en el ambiente que se habilitará.
7. Probar con autorización específica los casos de éxito, rechazo, varias cuotas con éxito parcial y respuesta perdida. Las pruebas de esta implementación serán locales y sintéticas mientras no se autorice una intervención operativa.

## 5. Circuito que se está preparando en las PRs

El portal verifica el pago contra Pago360, registra la confirmación y una imputación pendiente de forma durable, y avisa a Kestra. Kestra será el único ejecutor. Antes de cada escritura debe reservar la operación/cuota y registrar la intención; después conserva el resultado y verifica en Vimarx. Un recuperador periódico atenderá avisos perdidos y resultados pendientes, sin repetir escrituras inciertas.

El portal mostrará por separado pago recibido y pago aplicado. Las cancelaciones anticipadas y refinanciaciones quedan fuera del alcance de la imputación automática de esta etapa.

La escritura real permanecerá bloqueada hasta completar las verificaciones anteriores. Este diseño no agrega una garantía de idempotencia a Vimarx: construye controles propios y exige conciliación cuando el resultado no puede demostrarse.

## Fuentes y nivel de evidencia

- [Swagger vigente de Vimarx](https://celesol.dyndns.org:5002/swagger/v1/swagger.json): consultado por GET, HTTP 200, el 16/11/2026. `PagoDeuda` publicado; `Prestamo/cobrar` ausente.
- Metadatos de `CuotaPrestamo`, `CuotaPrestamoCobro` y `CobradorCuenta`, y consulta acotada del catálogo de cobradores mediante el conector Celesol el 16/11/2026.
- [CobrarPrestamoGateway.ts, revisión inspeccionada](https://github.com/Red-Unisol/redunisol-platform/blob/3d5aca8a0dff627d616e4fa2b2de114ce12a8b99/web/solicitudes-web/celesol-backend/src/modules/solicitudes-core/infrastructure/services/CobrarPrestamoGateway.ts).
- [Pruebas del gateway, misma revisión](https://github.com/Red-Unisol/redunisol-platform/blob/3d5aca8a0dff627d616e4fa2b2de114ce12a8b99/web/solicitudes-web/celesol-backend/src/modules/solicitudes-core/infrastructure/services/CobrarPrestamoGateway.test.ts).
- [Registro durable y conciliación de refinanciaciones](https://github.com/Red-Unisol/redunisol-platform/blob/3d5aca8a0dff627d616e4fa2b2de114ce12a8b99/web/solicitudes-web/celesol-backend/src/modules/solicitudes-core/infrastructure/services/RefinanciacionCobrosService.ts).
- [Tarea Bitrix 23595](https://redunisol.bitrix24.es/company/personal/user/71283/tasks/task/view/23595/).

Los comentarios históricos y las pruebas con respuestas simuladas describen evidencia previa; no sustituyen una validación operativa del circuito de Pago360.

## Incremento del 23/11/2026: prueba real supervisada de PagoDeuda

Con autorización explícita del usuario para una única operación real a cuenta,
se envió importe exacto, idCuota, el cobrador PAGOS 360 comprobado activo y fecha
contable solicitada, con idCuentaAmv=null y permitirPagarFueraDeOrden=false.
No se aplicaron migraciones ni se activaron flujos de Kestra.

El HTTP 200 devolvió **un entero**, ID de CuotaPrestamoCobro. Su relectura
verificó préstamo, cobrador e importe por `TotalPago` (negativo en el recibo).
`MovimientoPrestamo.TransaccionAjuste.ID` vinculó ese recibo con la cuota indicada
por `TransaccionPrestamo.ID`. MontoTotal del recibo no representa necesariamente
el importe cobrado: en la prueba fue cero.

La fecha del recibo fue el día de ejecución, aunque el JSON contenía otra fecha
contable. Hubo movimientos de punitorios y la variación del saldo total no
permitió acreditar por sí sola la conservación del remanente. No se infiere el
motivo de ese comportamiento ni se considera el endpoint validado para la
integración automática. No se repitió ni revirtió la petición.

La evidencia detallada queda fuera de Git. Antes de nuevas escrituras se requiere
revisión de Sistemas/Cobranzas de fecha y distribución, además de los controles
pendientes de concurrencia con otros canales. El pago del caso probado ya tiene
un recibo: debe excluirse de nuevos intentos, no volver a probar otro endpoint.
