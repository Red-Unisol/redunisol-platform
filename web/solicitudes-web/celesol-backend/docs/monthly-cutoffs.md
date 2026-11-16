# Cortes mensuales de AMEJUCA

Los analistas de Riesgo y administradores configuran la fecha confirmada de cada mes desde Solicitudes > Fechas de corte. Una fecha confirmada se aplica exactamente como fue informada, sin moverla por fines de semana.

## Operación

- Elegir el período, cargar la fecha informada y una observación opcional, y guardar.
- Cada mes empieza pendiente de confirmación. No se copia el corte del mes anterior.
- El historial conserva fecha anterior, nueva fecha, observación, usuario, fecha y administrador real si se usó suplantación.
- La fecha debe existir dentro del período seleccionado. Los guardados concurrentes usan una versión y un bloqueo por período; un cambio de otro analista devuelve 409. El reintento exacto es idempotente.
- El calendario incluye los OID de presolicitud 2519, 2657, 2770, 2771, 2772, 2774 y 2776, verificados en Vimarx. La identificación usa OID, no coincidencias de nombre.

## Cálculo

La simulación de Beex envía a Vimarx el primer vencimiento calculado a partir del corte confirmado: fin del mes de emisión hasta el corte inclusive; fin del siguiente después. La fecha civil de referencia usa Argentina. La respuesta de Vimarx debe coincidir con la fecha enviada.

Sin corte confirmado se conserva la simulación existente y se muestra que el vencimiento es estimado. Un error de consulta no se interpreta como ausencia de configuración. El guardado del corte no modifica solicitudes ni préstamos ya generados. Antes de generar o reemplazar un préstamo, se exige revisar y guardar las condiciones si el vencimiento difiere del calendario confirmado.

La configuración pertenece a Beex: las operaciones cargadas directamente en Vimarx siguen usando su configuración propia.

## API y despliegue

- GET /api/monthly-cutoffs/amejuca/:period: sesión activa; estado, fecha y permiso de carga. El historial se entrega a Riesgo y administradores.
- PUT en la misma ruta: Riesgo o administrador; cutoffDate (YYYY-MM-DD), note opcional y expectedVersion (0 en el alta).
- Aplicar la migración 20261106130000_amejuca_monthly_cutoffs junto con backend y frontend. No se carga ningún corte real por defecto.

## Verificación local

Pruebas de dominio, autenticación y permisos, límites de calendario, respuesta del simulador y protección antes de generar. repository.db.test.ts usa únicamente BEEX_TEST_DATABASE_URL en localhost con nombre terminado en _test. Comprueba guardados concurrentes e historial inmutable.

La galería /cutoffs del UI Lab usa el componente operativo con datos ficticios; guardar sólo modifica memoria local. cutoffs.browser-test.mjs revisa carga, confirmación, cambio de mes, error recuperable y pantalla de 390 px.
