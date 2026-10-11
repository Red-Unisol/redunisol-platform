# Recientes: filtro por área del estado actual

## Contrato y alcance

`GET /solicitudes?scope=recientes&vista=mi-area|todas` acepta una vista opcional.
Omitirla mantiene el listado habitual por compatibilidad. El controller transmite
la vista validada y el usuario autenticado; no acepta un owner del cliente.
El caso de uso deriva `estadoOwnerId` de `currentUser.workflowOwnerId` y Prisma
aplica `estadoActual.ownerId` en `where`, antes de `skip` y `take`.
No se filtra por ejecutivo, asignación, participantes ni última intervención.
Se conserva el filtro de creadores visibles que ya existía para vendedores.
Las capacidades de edición, asignación y transición no cambian.

El frontend inicia en Mi área para VENDEDORES, RIESGO y TESORERIA no administradores.
Según confirmación del usuario, administradores y usuarios sin área inician en
Ver todas; Mi área está deshabilitada sin área. Las demás áreas mantienen la vista
habitual. Una petición explícita de Mi área sin área devuelve solicitud inválida.
Los controles de acceso de sesión y asignación de área existentes siguen vigentes.

La clave de consulta incluye vista, usuario, área, búsqueda, fechas y paginación.
Cambiar de vista conserva búsqueda y filtros, reinicia página y selección.
El control usa botones con aria-pressed y acceso por teclado. El aviso de lista
vacía se muestra fuera del ancho desplazable de la tabla para ser visible en móvil.

## Limitaciones conservadas

- Se conserva la ventana de 21 días y las exclusiones existentes de Recientes.
- `Transferir` ya está excluido de Recientes y es el único estado activo de
  TESORERIA en el catálogo actual. Por eso Mi área de Tesorería queda vacía con
  ese catálogo; Ver todas tampoco incorpora Transferir. Se informó este hallazgo
  al usuario y no se amplió el alcance ni se modificó el catálogo.
- El buscador mantiene su comportamiento existente por documento; los filtros de
  columnas mantienen su alcance sobre la página descargada. El nuevo filtro de
  área sí se aplica en backend antes de paginar.
- La selección de vista es de la pantalla; al volver a ingresar se usa el valor inicial.
- No se desplegó ni se modificaron datos de dev/producción. No se probaron sesiones
  reales de usuarios: los escenarios de navegador utilizan sesiones y datos simulados.

## Verificación (2026-10-11)

- Compilaciones backend y frontend aprobadas; lint de archivos afectados aprobado.
- Suite backend: 1003 pruebas aprobadas, 2 opcionales omitidas; frontend: 94 aprobadas.
- Pruebas de controller y esquema: transmisión de vista y descarte de owner externo.
- Caso de uso: alternancia para las tres áreas, owner autenticado, conservación de
  documento, fechas, límites y restricciones existentes de vendedores.
- Prisma: mismo where de área/visibilidad/búsqueda y skip/take, sin assignedToUserId.
- Integración PostgreSQL local con fixtures revertidos: paginación por área,
  solicitudes asignadas y sin asignar, Ver todas, restricción de creadores,
  exclusión por fecha y por estado, salida/entrada tras cambio de área del estado.
- Chromium: seis escenarios (Riesgo, Vendedores, Tesorería, administrador con área,
  administrador sin área y Riesgo móvil a 390 px). Vista inicial, alternancia con
  teclado, página 1, limpieza de selección, búsqueda conservada, vacío con Ver todas
  disponible y actualización respetando la vista. Sin errores JavaScript.

## Archivos modificados

- `celesol-backend/src/modules/solicitudes-core/application/dtos/ListSolicitudes.dto.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/ListSolicitudes.use-case.test.ts`
- `celesol-backend/src/modules/solicitudes-core/application/use-cases/ListSolicitudes.use-case.ts`
- `celesol-backend/src/modules/solicitudes-core/domain/repositories/SolicitudesCoreRepository.ts`
- `celesol-backend/src/modules/solicitudes-core/infrastructure/datasources/SolicitudesCorePrismaDatasource.test.ts`
- `celesol-backend/src/modules/solicitudes-core/infrastructure/datasources/SolicitudesCorePrismaDatasource.ts`
- `celesol-backend/src/modules/solicitudes-core/presentation/SolicitudesCoreController.test.ts`
- `celesol-backend/src/modules/solicitudes-core/presentation/SolicitudesCoreRequest.schema.test.ts`
- `celesol-backend/src/modules/solicitudes-core/presentation/SolicitudesCoreRequest.schema.ts`
- `celesol-frontend/src/modules/solicitudes-core/hooks/use-solicitudes-core-recientes-query.ts`
- `celesol-frontend/src/modules/solicitudes-core/pages/solicitudes-core-recientes-page.tsx`
- `celesol-frontend/src/modules/solicitudes-core/services/solicitudes-core-query-keys.ts`
- `celesol-frontend/src/modules/solicitudes/components/solicitudes-toolbar.tsx`
- `celesol-frontend/src/modules/solicitudes/types/solicitudes-core.ts`
- `celesol-backend/src/modules/solicitudes-core/infrastructure/datasources/SolicitudesRecientesArea.integration.test.ts`
- `celesol-backend/docs/recientes-filtro-area.md`
