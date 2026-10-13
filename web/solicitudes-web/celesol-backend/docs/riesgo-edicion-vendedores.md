# Correcciones de Riesgo cuando la solicitud está en Vendedores

Un usuario del área autenticada RIESGO puede editar datos de una solicitud cuyo estado actual pertenece a VENDEDORES. El área se obtiene por workflowOwnerId mediante el repositorio del backend; la clasificación del estado viene de estadoActual.owner.code. No se utiliza el nombre del analista, vendedor, ejecutivo o creador para conceder esta excepción.

La consulta de detalle y los listados devuelven canEdit de forma consistente. El guardado aplica la misma política antes de validar los campos del estado, máximos de la línea y demás reglas. No se convierte al analista en administrador ni se activa el antiguo flag isAnalista que habilita todos los campos.

«Editar» aparece cuando el estado habilita al menos un campo. La excepción no salta el catálogo de campos editables: un campo no permitido continúa rechazado por la API. Cuota resultante sigue calculada y el vendedor permanece fijo. No cambia el área, la asignación de la solicitud ni el catálogo de estados/transiciones.

La excepción es únicamente EDIT_DATA. Los permisos de cambios de estado, adjuntos, cancelaciones y asignación se conservan. Guardar Evaluación exige expresamente tener la solicitud a cargo (o ser administrador), tanto en la interfaz como en el backend; no hereda la nueva excepción de edición.

Validación: 160 pruebas aprobadas de permisos, campos, detalle, listados, actualización, asignación, cambio de estado y guardado de evaluación. Casos nuevos verifican correcciones de Riesgo en PreAprobada de Vendedores, el mismo permiso en detalle/listado/API, una sola consulta de área por listado, el rechazo de otros actores/áreas y de campos protegidos, y que no se amplía el guardado de la planilla. Compilaciones frontend/backend, ESLint de archivos afectados y diff correctos.

No se editaron solicitudes reales ni se desplegó. Queda pendiente la comprobación del botón y guardado con una sesión real en solicitudes-dev después de autorizar el despliegue.
