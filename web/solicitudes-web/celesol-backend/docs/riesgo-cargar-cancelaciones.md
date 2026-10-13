# Carga de cancelaciones por Riesgo

Riesgo puede crear cancelaciones mientras el área del estado actual de la solicitud coincide con su área autenticada. No depende del permiso de gestionar adjuntos ni de que haya campos generales editables. La interfaz ofrece Nueva cancelación en la pestaña Cancelaciones sin exigir entrar a Editar.

La capacidad canCreateCancelaciones y la acción CREATE_CANCELACION se separan de canManageCancelaciones. El backend resuelve el código del área desde el usuario autenticado y su catálogo; no utiliza un área enviada en el formulario. Si la solicitud está en otra área, la excepción no aplica. Los administradores y los permisos anteriores de otras áreas se conservan.

No se amplían los permisos para modificar o borrar cancelaciones, editar solicitudes, cambiar estados ni operar en otras áreas. Se conservan validaciones y bloqueos financieros existentes. Se utilizan las rutas de carga y auditoría habituales.

Comprobaciones: 80 pruebas de permisos, detalle/listado y CRUD de cancelaciones, incluidas llamadas directas de creación dentro y fuera de Riesgo y conservación de los permisos de edición/borrado. Builds y lint de frontend/backend. Chromium con el detalle real y API simulada: nueva cancelación y formulario accesibles sin Editar mientras está en Riesgo; acción ausente en otra área. No se crearon cancelaciones reales.
