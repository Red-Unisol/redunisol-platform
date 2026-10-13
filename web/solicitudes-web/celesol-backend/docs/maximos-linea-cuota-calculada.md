# Máximos de línea y cuota calculada

El legacy administra `MontoMaximo` y `CantidadMaximaCuotas`. Los valores que los
superan se ajustan silenciosamente al máximo; valores iguales o menores se
conservan. No se incorpora un máximo para la cuota resultante ni se corrigen mínimos.

La consulta real encontró 143 líneas vigentes con máximos positivos. No había
casos vacíos o en cero ni documentación sobre su significado. La regla confirmada
por el usuario es tratar esos casos como configuración inválida: no calcular,
guardar ni generar hasta corregir el legacy. También se rechazan máximos no finitos,
cuotas máximas no enteras o mínimos superiores a sus máximos.

## Backend

`AjustarMaximosLinea` centraliza validación y ajuste. Se usa en creación, edición,
simulación, revisión previa y generación. Los máximos siempre se consultan por el
catálogo existente; no se reciben límites del navegador ni se usan valores fijos.

Para las solicitudes existentes se resuelve al vendedor con
`findVendedorLegacyUser`, sin reemplazarlo por quien edita. Al guardar se combinan
los datos existentes con los campos enviados y se comprueban los límites aunque
no cambie la línea. La validación de mínimos existente al cambiar de línea se
conserva. Si cambian las condiciones y falla el cálculo, la cuota guardada queda
null; se elimina el resultado anterior.

La cuota resultante no se acepta como entrada de creación o actualización:
los esquemas y los casos de uso la rechazan, incluso para administradores. Los
contratos de permisos efectivos la muestran como solo lectura, sin invalidar las
reglas antiguas que todavía contienen ese campo.

`POST /solicitudes/simulacion` calcula durante el alta;
`POST /solicitudes/:id/simulacion` calcula con el catálogo del vendedor de la
solicitud identificada. Conserva autenticación y el guard de visibilidad por ID.
La respuesta exitosa contiene los importes y cuotas efectivos. Un error de cálculo
posterior al ajuste devuelve `CALCULO_CON_VALORES_EFECTIVOS` y `effectiveValues`,
para sincronizar los campos sin inventar una cuota. Una respuesta del legacy con
condiciones distintas no se presenta como vigente.

Antes de generar se vuelve a consultar el catálogo. Si se ajustan los valores,
se guardan y se recalcula la cuota antes del llamado de generación. Si el nuevo
monto deja el desembolso en negativo por las cancelaciones, se conserva ese bloqueo.
La interfaz vuelve a consultar la solicitud también cuando la generación falla,
para recoger un ajuste que ya se haya guardado.

`CrearPrestamoGateway` permanece sin cambios: conserva estructura, tipos y orden
de `/api/Simulador/CrearPrestamo`, incluyendo los integrantes y cancelaciones. Solo
los valores de monto y cuotas existentes llegan ajustados. No se agregan fecha,
tasa ni resultado de simulación al envío.

## Frontend

`maximos-linea.ts` centraliza el ajuste de los textos de monto y cuotas. Se aplica
al escribir, pegar, utilizar los controles del campo y cambiar de línea. Solo se
reformatea por esta regla cuando hay un exceso; el componente monetario conserva
el cursor anclado a los dígitos al modificar separadores.

`useCuotaCalculada` agrupa los cambios con 400 ms de espera. Identifica cada cálculo
por condiciones e ID de solicitud, descarta respuestas atrasadas y permite
sincronizar los valores efectivos sin volver a calcular por ese ajuste. Al cambiar
las condiciones oculta el resultado anterior. La interfaz diferencia cálculo
pendiente, error y resultado disponible; la cuota es siempre de solo lectura.

Cuando el servidor ajusta los valores, se refresca el catálogo para actualizar los
límites de los controles. Los catálogos también se consultan de nuevo al regresar
a la pantalla. Actualizar el catálogo no reinicia los valores válidos del simulador.
Los mapeadores de creación y edición omiten cuotaResultante.

## Validación y límites pendientes

- Suite Solicitudes Core y gateway: 674 aprobadas, 1 omitida, 0 fallos, con PostgreSQL local.
- Compilaciones frontend/backend y ESLint sobre los archivos afectados.
- Chromium con datos controlados: ajuste inmediato, escritura, pegado, controles,
  cursor en edición intermedia, misma línea, cambio a máximos menores, cuota de
  solo lectura, respuestas atrasadas, error, ajuste del servidor (con cálculo
  exitoso o fallido) sin duplicar simulaciones y presentación móvil.
- Pruebas de generación con gateways simulados; cuerpo y orden de la API original
  verificados por las pruebas existentes.

DASPU mantiene una inconsistencia en el legacy: su catálogo declara 48 cuotas,
pero una simulación de 36 o 48 devuelve 24. No se reemplaza el máximo del catálogo
por 24 ni se acepta esa cuota para condiciones distintas. Corregir esa diferencia
en Vimarx sigue pendiente. No se generaron préstamos reales, no se hizo una
corrección masiva ni se desplegaron estos cambios.

## Archivos modificados

- `celesol-backend/src/modules/solicitudes-core/application/services/AjustarMaximosLinea.test.ts`
- `celesol-backend/src/modules/solicitudes-core/application/services/AjustarMaximosLinea.ts`
- `celesol-backend/src/modules/solicitudes-core/application/services/SimularCuotaSolicitud.ts`
- `celesol-backend/src/modules/solicitudes-core/application/services/SolicitudFieldAccess.test.ts`
- `celesol-backend/src/modules/solicitudes-core/application/services/SolicitudFieldAccess.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/CreatePrestamoLegacy.use-case.test.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/CreatePrestamoLegacy.use-case.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/CreateSolicitud.use-case.test.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/CreateSolicitud.use-case.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/GetRevisionPrestamo.use-case.test.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/GetRevisionPrestamo.use-case.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/GetSolicitudById.use-case.test.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/SimularPrestamo.use-case.test.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/SimularPrestamo.use-case.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/UpdateSolicitud.use-case.test.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/UpdateSolicitud.use-case.ts`
- `celesol-backend/src/modules/solicitudes-core/domain/solicitudes-core-errors.ts`
- `celesol-backend/src/modules/solicitudes-core/presentation/SolicitudesCoreController.test.ts`
- `celesol-backend/src/modules/solicitudes-core/presentation/SolicitudesCoreController.ts`
- `celesol-backend/src/modules/solicitudes-core/presentation/SolicitudesCoreRequest.schema.test.ts`
- `celesol-backend/src/modules/solicitudes-core/presentation/SolicitudesCoreRequest.schema.ts`
- `celesol-backend/src/modules/solicitudes-core/presentation/SolicitudesCoreRoutes.test.ts`
- `celesol-backend/src/modules/solicitudes-core/presentation/SolicitudesCoreRoutes.ts`
- `celesol-backend/src/modules/solicitudes-core/solicitudes-core-module.ts`
- `celesol-backend/src/modules/solicitudes/infrastructure/services/PrestamosSimulacionGateway.test.ts`
- `celesol-backend/src/modules/solicitudes/infrastructure/services/PrestamosSimulacionGateway.ts`
- `celesol-frontend/src/modules/solicitudes-core/hooks/use-create-prestamo-legacy-mutation.ts`
- `celesol-frontend/src/modules/solicitudes-core/hooks/use-cuota-calculada.ts`
- `celesol-frontend/src/modules/solicitudes-core/hooks/use-lineas-prestamo-query.ts`
- `celesol-frontend/src/modules/solicitudes-core/pages/solicitudes-actual-detalle-page.tsx`
- `celesol-frontend/src/modules/solicitudes-core/services/solicitudes-core-api.ts`
- `celesol-frontend/src/modules/solicitudes-core/utils/solicitud-core-edit-mappers.ts`
- `celesol-frontend/src/modules/solicitudes-editor/components/SolicitudMainSection.tsx`
- `celesol-frontend/src/modules/solicitudes-editor/hooks/useLineasPrestamo.ts`
- `celesol-frontend/src/modules/solicitudes-editor/hooks/useSolicitudEditorForm.ts`
- `celesol-frontend/src/modules/solicitudes-editor/pages/solicitudes-nueva-page.tsx`
- `celesol-frontend/src/modules/solicitudes-editor/utils/solicitud-core-mappers.ts`
- `celesol-frontend/src/modules/solicitudes-shared/utils/cuotas-linea.ts`
- `celesol-frontend/src/modules/solicitudes-shared/utils/maximos-linea.ts`
- `celesol-frontend/src/modules/solicitudes/components/simulador-prestamo-modal.tsx`
- `celesol-frontend/src/modules/solicitudes/types/solicitudes-core.ts`
- `celesol-frontend/src/shared/components/forms/money-input-field.tsx`
