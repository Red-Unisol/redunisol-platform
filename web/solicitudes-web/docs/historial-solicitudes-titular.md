# Historial de solicitudes del titular

La pestaña Solicitudes, junto a Préstamos, consulta al abrirse
`GET /solicitudes/:id/solicitudes-titular`. Conserva la restricción de Préstamos:
no disponible para Vendedores salvo administradores. La ruta autentica mediante
GetCurrentUser (incluido el contexto efectivo de acceso como otro usuario), y el
caso de uso verifica acceso a la solicitud antes de consultar al legado.

El documento sale exclusivamente del titular persistido. Se aceptan de 1 a 12
dígitos, distintos de cero; se recortan espacios exteriores y se rechazan otros
caracteres. Documento ausente o inválido devuelve `status: documento_invalido`
sin llamar al legado. No se usa CUIT, padrón de socios, nombre ni garantes.

El gateway EvaluateList existente envía una sola petición a
`/api/Empresa/EvaluateList`, tipo `PreSolicitud.Module.Solicitud`, criterio
`Socio.NroDoc = <documento>` y máximo 50. No agrega filtros de antigüedad, estado,
área o ejecutivo. Mapea exactamente las 14 posiciones de la proyección solicitada;
una respuesta no matricial o una fila con distinta longitud se trata como error.
Los importes vacíos permanecen null. No hay navegación, edición ni paginación.

La interfaz usa las claves solicitud + documento, carga solo al abrir la pestaña,
y distingue carga, vacío, error con reintento y documento inválido. Reutiliza los
formatos de fecha del legado e importes y ofrece desplazamiento horizontal por
teclado en pantallas pequeñas. La consulta no garantiza un historial completo.

## Verificación

- Builds frontend y backend y ESLint de archivos afectados.
- Suite backend completa: 1015 aprobadas, 2 opcionales omitidas antes de agregar
  la prueba adicional de límite; pruebas específicas del historial ejecutadas
  también después de esa incorporación.
- Gateway con transporte simulado: cuerpo exacto, orden de posiciones, valores
  vacíos, límite, respuesta vacía, forma inválida, fallo remoto y documento inseguro.
- Caso de uso: documento persistido, cambio de solicitud, ausencia de documento,
  solicitud inexistente y autorización de vendedores/administradores.
- Navegador con API simulada: carga diferida, 14 columnas, formatos, cambio de
  titular, estados vacío/error/inválido, restricción de vendedores, desplazamiento
  horizontal móvil y funcionamiento de Préstamos.

No se ejecutan cambios ni operaciones sobre datos reales para esta validación.
El contrato posicional se verificó contra el gateway existente y fixtures; queda
pendiente contrastar los registros del nuevo historial con una sesión real de dev.
