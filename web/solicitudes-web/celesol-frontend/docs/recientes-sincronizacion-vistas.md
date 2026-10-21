# Recientes: actualización y vistas por área

Base revisada: dev, `3b62147` (PR #558). No requiere dependencias, migraciones ni variables nuevas.

## Comportamiento

Recientes reutiliza React Query y consulta cada **15 segundos** mientras la pestaña está visible y hay conexión. Se conserva el intervalo de 60 segundos de Precarga e Históricas. No se encontró infraestructura de WebSocket/SSE en este circuito. React Query pausa el transporte sin conexión y recupera la consulta al reconectar o regresar a la pestaña. El intervalo no garantiza una respuesta cada 15 segundos: depende de conexión, duración de la petición y temporizadores del navegador.

El botón Actualizar sigue disponible. Pulsar Recientes estando en esa ruta invalida la consulta activa, sin cancelar ni duplicar una petición ya en curso. Guardar, enviar, reasignar, crear o generar invalidan los listados afectados mediante los hooks existentes; los listados inactivos quedan obsoletos y se consultan al volver.

El indicador usa `dataUpdatedAt`, la fecha del último éxito de la consulta activa. Muestra «Actualizando…», «Actualizado hace X segundos» o «No se pudo actualizar». Sin conexión, una consulta pausada muestra «Sin conexión». Un error conserva los datos anteriores y su fecha. El reloj se renderiza en un componente separado de la tabla.

No se reinician filtros, página, selección, ni el simulador durante una actualización de la misma consulta. Cambiar de vista reinicia la página y selección de filas, conserva búsqueda y filtros de columnas. La caché separa vista, perfil efectivo, área, búsqueda, rango de fechas y página, sin mostrar los datos de la vista anterior como resultado de la siguiente. La navegación al abandonar/regresar conserva el comportamiento vigente de montaje de la página; no se añade persistencia de selección entre pantallas.

## Vendedores y permisos

Los usuarios efectivos no administradores de VENDEDORES disponen de:

| Vista | Área propietaria del estado actual |
| --- | --- |
| Vendedores (inicial) | VENDEDORES |
| Analistas | RIESGO |
| Todas | VENDEDORES o RIESGO |

El parámetro `vista` admite `vendedores`, `analistas` y `todas`, además de `mi-area` por compatibilidad con otros perfiles. El backend recibe el área del usuario autenticado, no del query string. Filtra mediante `estadoActual.owner.code` del catálogo, junto con la visibilidad existente por creadores del vendedor/equipo. Todos esos criterios y la búsqueda se aplican en la misma consulta Prisma antes de `skip`/`take`. No se filtra por ejecutivo ni se agregan capacidades operativas.

La tabla de vendedores incorpora Área actual. Riesgo, Tesorería y administradores mantienen su selector/vista inicial vigente; Todas de esos perfiles conserva su alcance anterior. La impersonación usa el perfil efectivo que ya entrega autenticación.

Se mantienen la ventana de **21 días**, las exclusiones de Recientes y el tratamiento vigente de estados finales. Los filtros desplegables por columna siguen siendo los filtros locales de la página actual; no se convierten en filtros globales del servidor en este cambio. El filtro nuevo de área y la búsqueda sí son anteriores a la paginación.

## Archivos principales

- Backend: DTO y esquema del listado; `SolicitudesCoreController`; `ListSolicitudesUseCase`; contrato del repositorio y `SolicitudesCorePrismaDatasource` con sus pruebas.
- Frontend: página/hook de Recientes, tipos y claves de consulta; utilidades `recientes-view` y `recientes-refresh-options`; `RecientesRefreshIndicator`; toolbar y navegación lateral.
- Invalidaciones: hooks de creación, edición, transición y generación. Las invalidaciones existentes de reasignación se conservan.

## Validación local

- Backend: typecheck correcto; 104 pruebas de caso de uso, datasource y controller correctas. Incluyen áreas de catálogo, visibilidad, perfil efectivo, búsqueda, paginación y rechazo de área suplantada desde parámetros.
- Frontend: compilación de producción y tipos correctos; lint de archivos modificados correcto; 17 pruebas de vistas, claves, indicador, rango temporal, actualización manual y observadores React Query correctas.
- Los observadores ejercitan caché real de React Query con transporte simulado y reloj acelerado de 20 ms: intervalo, pausa al ocultarse, reconexión, deduplicación, conservación de datos/fecha ante error y respuesta atrasada de otra vista. El intervalo de producción se verifica aparte en 15.000 ms.
- La compilación conserva avisos de tamaño de chunks y `eval` de una dependencia Excel existente.

No se probaron cambios de estado ni solicitudes reales. No se desplegó. La revisión visual del selector/indicador, conservación de diálogos y filtros, y seguimiento de una transferencia entre áreas con dos sesiones quedan pendientes para el entorno de pruebas. Las pruebas del datasource inspeccionan consultas Prisma con un cliente simulado; no son pruebas contra la base de dev.

## Guía de prueba tras un despliegue autorizado

1. Entrar con perfil vendedor y comprobar Vendedores como vista inicial. Contrastar cada fila con Área actual.
2. Alternar Analistas/Todas, buscar un titular accesible y comprobar que la página se reinicia y la búsqueda se conserva. Verificar que no aparecen solicitudes ajenas a su acceso ni de Tesorería en Todas.
3. Abrir el simulador y esperar varios ciclos de 15 segundos. Comprobar que conserva entradas y permanece abierto. Probar filtros de columnas, selección y paginación.
4. Pulsar Actualizar y Recientes desde el menú, revisar la consulta y el indicador. Ocultar la pestaña, volver y simular pérdida de conexión desde herramientas del navegador.
5. Usar solicitudes de prueba autorizadas y dos sesiones para enviar de Vendedores a Riesgo y devolver. Comprobar el cambio de vista tras actualizar y que permisos operativos no cambian.
6. Repetir con Riesgo, Tesorería e impersonación para comprobar sus contextos y el comportamiento anterior de sus vistas.
