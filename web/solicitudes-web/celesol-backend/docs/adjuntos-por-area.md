# Carga de adjuntos por área

Riesgo, Vendedores y Tesorería pueden agregar adjuntos en cualquier estado de una solicitud a la que tengan acceso. La autorización no depende del área del estado, de la asignación del ejecutivo ni del permiso para editar los datos de la solicitud. El backend resuelve el código del área desde el workflowOwnerId del usuario autenticado; no recibe un código de área desde el formulario. Se aplica a la carga individual y por lote.

Solo los administradores de sistemas pueden eliminar adjuntos. La acción Reemplazar, que sube un archivo nuevo y elimina el anterior, también se reserva a administradores. Los demás usuarios pueden agregar archivos nuevos conservando los existentes.

La interfaz muestra Agregar adjunto en la pestaña Adjuntos sin exigir Editar. No se modifican las validaciones de archivos, la clasificación, el almacenamiento, la auditoría ni los permisos para editar datos, cancelaciones o cambiar de estado.

Validación: pruebas de permisos y casos de uso para ambas cargas y borrado, controles de detalle/listado y controlador; builds del frontend y backend, lint de archivos modificados. Prueba de navegador con respuestas simuladas para las tres áreas, sin editar datos y sin acciones de eliminación o reemplazo. No se suben archivos ni se eliminan datos del entorno real durante estas pruebas.
