# Padrones de empleados en CredixSA

La pestaña CredixSA incorpora una consulta independiente a los padrones publicados
en Herramientas. Ambas consultas se muestran aunque la otra fuente falle. Beex no
importa planillas, publica versiones ni toma decisiones automáticas con esos datos.

`GET /solicitudes/:id/padrones` autentica la sesión, excluye vendedores como el
informe de CredixSA y comprueba el acceso a la solicitud. El DNI/CUIL se obtiene
del titular vigente del servidor; no se admite elegir otra persona por parámetros.
La respuesta es privada y no se cachea en HTTP. El navegador mantiene su snapshot
de pantalla durante un minuto y permite actualizarlo explícitamente.

Configurar en el backend `PADRONES_API_URL` con la URL HTTPS completa de
`/api/internal/padrones/lookup` de Herramientas, y `PADRONES_API_TOKEN` con el mismo
valor que su `PADRONES_SERVICE_TOKEN` (mínimo 32 caracteres). La credencial nunca
llega al navegador. La consulta tiene un timeout de 5 segundos, no sigue redirects
y valida identidad, estructura y tamaño de la respuesta (máximo 2 MiB).
Los runtimes cifrados dev/prod ya contienen las URLs y credenciales coordinadas
con Herramientas, con tokens distintos por ambiente. Publicar primero el proveedor.

Los estados globales distinguen `available`, `unavailable`, `not_configured` y
`missing_document`. Cada fuente conserva nombre, tipo, período y fecha de carga,
todas sus filas coincidentes y el estado `ready`, `unpublished` o `needs_review`.
Una fuente no publicada o con una carga que requiere revisión nunca se muestra
como ausencia del empleado. Las coincidencias de bajas se destacan explícitamente.

Requiere primero la API de Herramientas del PR #708. La carga de Administración
observada el 11/11/2026 requiere corregir la selección de encabezados mediante la
interfaz habitual; mientras tanto se muestra su estado de revisión sin datos.
Los otros padrones siguen disponibles. Sin configurar la integración, el resto
del informe y la operativa de solicitudes siguen funcionando.

La galería `/padrones` de `ui-lab` usa componentes reales y datos ficticios para
revisar escritorio/móvil, errores, fuentes incompletas y caída de CredixSA.
