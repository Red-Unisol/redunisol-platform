# Excel de evaluación al generar y liquidar

La última evaluación guardada se convierte a XLSX y se incorpora a los adjuntos de la misma solicitud como Documentación Adicional. No se toman cambios sin guardar ni se utiliza la plantilla original como sustituto. La copia conserva todas las hojas, valores y resultados disponibles, fórmulas, estilos y el logo de la calculadora.

El archivo identifica generación o liquidación y la fecha de guardado. Sus metadatos conservan al usuario que ejecuta la operación y el comentario identifica al analista que guardó la evaluación. Se utilizan el almacenamiento, listado y descarga habituales de adjuntos, sin conceder permisos de carga manual nuevos ni modificar el catálogo de tipos.

Se deduplica por solicitud y snapshot: reintentar o liquidar con la misma evaluación no crea otra fila. Si la evaluación cambia entre generar y liquidar, se conserva la copia inicial y se agrega una nueva. Cada guardado utiliza una ubicación JSON inmutable para evitar que una edición concurrente reemplace la versión que se está archivando; las referencias antiguas siguen siendo legibles.

El archivo se guarda después de validar permisos y condiciones, pero antes de llamar a CrearPrestamo o ejecutar el cambio de estado. Si falla exportación o almacenamiento, la operación no se ejecuta. Si posteriormente falla el legacy o el cambio de estado, la copia ya adjunta se conserva como evaluación del intento; un reintento reutiliza esa copia. El mensaje y la descripción no afirman que el préstamo se haya generado por el mero hecho de existir el archivo. Si no hay evaluación guardada, no se inventa un Excel ni se incorpora una obligación nueva para generar o liquidar.

No se cambia el cuerpo de CrearPrestamo. La interfaz actualiza la consulta de adjuntos al terminar las operaciones, también si hubo un error posterior al archivo.

## Exportación

Se reutiliza LuckyExcel 1.1.6, la misma versión utilizada para importar la planilla. El adaptador traduce las fórmulas de `f` al formato que espera el exportador y normaliza las posiciones de imágenes a enteros OOXML. El snapshot original no se modifica. Una fórmula compartida sin expresión recuperable se rechaza antes de operar, en lugar de adjuntar una fórmula incorrecta.

## Comprobaciones

Pruebas de archivo, deduplicación, concurrencia, distintas solicitudes, versiones de generación/liquidación, ausencia de evaluación y fallos de almacenamiento. Exportación del libro real de 11 hojas y lectura independiente con ExcelJS: valores editados, resultados y fórmulas de todas las hojas, estilos y logo. Pruebas de generación y workflow con gateways simulados: orden de archivo y operación, bloqueo ante fallos y cuerpo de generación conservado. Builds y lint de backend y frontend. No se generan ni liquidan préstamos reales ni se escriben archivos en el entorno remoto durante las pruebas.
