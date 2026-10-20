# Revisión previa a generar un préstamo

`GET /solicitudes/:id/revision-prestamo` obtiene la solicitud persistida y aplica
el mismo control de área de `CreatePrestamoLegacyUseCase`, usando la identidad
efectiva del usuario autenticado. La ruta pasa además por el guard existente de
visibilidad de Vendedores. No recibe condiciones, tasa, fecha o socio del cliente.

Resuelve al socio mediante `FindSolicitudTitularSocio` y muestra su nombre y
`nroSocioLegacy`, no el ID local ni el número eventualmente cargado en el formulario.
Si el socio o su número no están disponibles se indica en pantalla.

## Cálculo

El contrato existente de `/api/prestamos/simulacion` utiliza `lineaId` como OID de
presolicitud: así lo consumen `SimularPrestamoUseCase` y `SimularCuotaSolicitud`.
La revisión envía ese OID, monto y cuotas persistidos, y `capitalPuro: false`.
No requiere resolver el ID de préstamo para mostrar o calcular la revisión:
ese ID pertenece al circuito de generación, donde `LineaPrestamoLegacyIdResolver`
y sus validaciones permanecen intactos. Un error de esa resolución no impide
consultar el simulador por el OID de presolicitud.

No envía `tasa` ni `fechaPrimerVencimiento`. Ambos valores y las fechas de las
cuotas se toman de la respuesta. La tasa se presenta como el valor numérico del
contrato, igual que el simulador (por ejemplo, `0.165` se ve `0,165`), sin convertirla
a porcentaje ni asignarle una denominación financiera no especificada por la API.

El mapeo de revisión conserva los valores ausentes como null. No altera el mapeo
que utiliza el simulador existente. Rechaza respuestas cuyos campos de condiciones,
cuando están presentes, no coincidan con la solicitud consultada.

El componente se desmonta al cerrar. Cada apertura usa una clave nueva, además del
ID de solicitud y sus condiciones, para no recuperar cálculos anteriores ni una
respuesta pendiente de una apertura previa. Cambiar las condiciones remonta la
revisión. Los errores permiten reintentar; no agregan bloqueos de generación.

## Generación y desembolso

No se modificaron `CreatePrestamoLegacyUseCase`, `CrearPrestamoGateway`, el cuerpo
ni el orden de `/api/Simulador/CrearPrestamo`, ni la mutación del frontend.
La vista previa no escribe datos. La generación vuelve a resolver sus datos por
su circuito existente, sin recibir el resultado de la revisión.

Se conserva la consulta y el detalle de cancelaciones, la fórmula de monto en mano
y sus bloqueos actuales (cargando/error de cancelaciones o importe negativo).

## Archivos

Backend:
- `application/use-cases/GetRevisionPrestamo.use-case.ts` y prueba: consulta de revisión.
- `presentation/SolicitudesCoreController.ts` y prueba: identidad autenticada.
- `presentation/SolicitudesCoreRoutes.ts` y prueba: nueva ruta GET.
- `solicitudes-core-module.ts`: inyección de dependencias.
- `solicitudes/infrastructure/services/PrestamosSimulacionGateway.ts` y prueba:
  reutilización del transporte y mapeo nullable exclusivo para revisión.

Frontend (`modules/solicitudes-core`):
- `components/generar-prestamo-dialog.tsx`: revisión de solo lectura adaptable.
- `pages/solicitudes-actual-detalle-page.tsx`: identidad de condiciones actuales.
- `hooks/use-revision-prestamo-query.ts`: consulta aislada por apertura.
- `services/solicitudes-core-api.ts`: contrato y consulta GET.
- `services/solicitudes-core-query-keys.ts`: clave de revisión.

## Verificaciones y límites

Pruebas de casos de uso, gateway, resolución de línea, controlador y rutas;
compilación de frontend/backend y ESLint de los archivos afectados.
Pruebas locales en Chromium con respuestas controladas: 48 cuotas, encabezados
fijos, scroll horizontal a 390 px, ausencia de campos editables, error/reintento,
datos ausentes, nueva consulta al reabrir y al cambiar de solicitud, conservación
de bloqueos de cancelaciones y cero escrituras al abrir/cancelar.

No se generaron préstamos reales ni se desplegó. La comparación contra cálculos
reales de Vimarx queda pendiente: las verificaciones de integración emplean
respuestas controladas, no una sesión autenticada del entorno dev.

## Datos registrados y fallos parciales

La pantalla muestra nombre, documento, CUIT, número de socio registrado, primera
fecha y cuota registrada desde la solicitud abierta, aunque falle toda la consulta
de revisión. La tasa de la línea se toma del catálogo ya consultado por el detalle;
la solicitud no persiste una tasa propia. Se identifica por separado de la tasa
que devuelve el cálculo, sin usarla para sustituirlo.

El socio resuelto para generar sigue separado del número registrado. Si falla su
consulta no se inventa ese número. Un fallo de simulación conserva el titular y
las condiciones consultadas; un fallo de socio no impide obtener el cálculo.
La fecha registrada nunca se presenta como fecha calculada ni se envía como tal.
