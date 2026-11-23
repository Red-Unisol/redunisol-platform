# Cliente del portal de Etapa 2 — preparado, sin activar

`pago360.portal.PortalClient` implementa el transporte HTTPS de la API v1 propuesta
por el portal: lectura de trabajos/snapshot y llamadas de claim, begin, received,
verified, finish y release. No es todavía un Repository completo ni se conecta
a Processor. No llama a Vimarx ni a Pago360 y no verifica un pago del proveedor.
Los flujos existentes conservan `disabled: true` y el bloqueo del motor.

## Correspondencias verificadas contra el SQL y handlers del portal

- Base: URL que termina en `/functions/v1/kestra-imputaciones/v1` (también admite
  el montaje interno de la función). Bearer del servicio, mínimo 32 caracteres.
- `live` se normaliza a `production`, sin modificar la evidencia almacenada.
- `prestamo_id` es el ID de préstamo, `nro_cuenta` es el número visible,
  `cuota_prestamo_id` identifica la deuda y `pago_cuota_id` es el UUID del portal.
- Se mantienen importes Decimal y centavos exactos; no se reconstruye un ID
  ausente usando el número de cuota ni se redondea un exceso de precisión.
- Las operaciones manuales y cancelaciones se rechazan en el normalizador del
  circuito automático. El snapshot debe declarar explícitamente ese alcance.
- `finish` solo acepta aplicado/a_conciliar. El retorno seguro a pendiente usa
  `release` con motivo y fencing; el servidor conserva las restricciones ante
  writing, uncertain, rejected o un bloqueo del proveedor.
- `verified` requiere que el llamador entregue el comprobante de una lectura
  nueva. El transporte no lo fabrica copiando el snapshot.
- Un POST con respuesta perdida, 5xx o respuesta inválida es incierto. No se
  reintenta: corresponde releer el snapshot y conciliar el estado.
- Ni el transporte ni su importación producen llamadas de red por sí solos.

El portal está en `alvarojpajonscocco-Apsoluciones/prestamos-celesol`.
Los cambios correspondientes siguen bajo `propuestas/pago360-etapa2/`; la API y
las tablas no están publicadas/aplicadas por este incremento.

## Pago a cuenta y prueba supervisada

El usuario amplió el objetivo del caso histórico: aplicar el importe exacto
recibido a cuenta y mantener la obligación restante, con fecha contable del día
del pago. Esto no relaja `validate_debt` globalmente ni habilita parciales para
el resto de los cupones. La revisión del histórico debe quedar auditada, sin
reescribir su selección original ni crear una segunda imputación del mismo pago.

Se autorizó y ejecutó **una única petición real** a `/fapi/PagoDeuda`, separada de
los flujos inactivos. Se guardó la intención local antes de enviarla; no se hicieron
reintentos financieros. El HTTP 200 devolvió un entero que identifica un
`F.Module.Cuentas.Prestamos.CuotaPrestamoCobro`.

La relectura confirmó:
- El recibo pertenece al préstamo y al cobrador esperado.
- `CuotaPrestamoCobro.TotalPago` refleja el importe con signo negativo; no se
  debe utilizar `MontoTotal` como importe cobrado (fue cero en este caso).
- `MovimientoPrestamo.TransaccionAjuste.ID` enlaza el recibo con la cuota
  `TransaccionPrestamo.ID`, permitiendo probar la relación por IDs.

**La prueba no se considera aprobada para automatizar:** la fecha registrada
no coincidió con `fecha` enviada; se generaron movimientos de punitorios y la
variación del saldo total no acreditó la conservación del remanente pretendido.
No se marcó APPLIED ni se corrigió o revirtió el cobro. La evidencia y los IDs
reales permanecen en artefactos locales fuera de Git.

El recibo ya existe: no probar el otro endpoint ni repetir PagoDeuda sobre el
mismo pago. Sistemas/Cobranzas deben revisar la fecha y la distribución contable
antes de autorizar cualquier corrección o una nueva ejecución.

## Pendiente

1. Resolver las diferencias observadas en la prueba y acordar el formato/semántica
   de fecha realmente respetado por Vimarx y el tratamiento del pago a cuenta.
2. Integrar Repository y Provider con sus comprobaciones reales; conservar una
   fecha calendario como fecha, sin inventar un timestamp de pago.
3. Registrar la revisión del histórico y el recibo existente para evitar un
   nuevo intento cuando se publique la persistencia del portal.
4. Probar autenticación del aviso y recuperación; después desplegar/activar de
   manera controlada. El cupo acumulado de ARS 50.000 no cambia.

## Pruebas

13 tests nuevos de transporte/normalización con dobles, más la suite existente
de Cobranzas. Cubren identidad, dinero, errores, ausencia de reintentos y la
separación entre lectura y claim. No equivalen a una prueba contra la API del
portal publicada, porque esa API todavía está como propuesta.
