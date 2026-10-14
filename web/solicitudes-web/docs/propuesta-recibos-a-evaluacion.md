# Propuesta: extraer recibos y cargar Evaluación

Estado: PR borrador para acordar el alcance. Este cambio contiene solamente documentación: no incorpora endpoints, botones, llamadas a Mistral ni escrituras en planillas. No se despliega esta etapa. La primera calculadora y sus reglas de carga están pendientes de definición con el usuario.

## Experiencia propuesta

Desde la vista conjunta de Evaluación y recibos:

1. Elegir el recibo en el panel derecho y solicitar «Extraer datos» explícitamente.
2. Revisar los datos leídos del documento, manteniendo visibles el recibo y la planilla.
3. Elegir qué calculadora/hoja corresponde. Puede haber una sugerencia futura, pero la decisión inicial será del operativo.
4. Aplicar las instrucciones acordadas para esa calculadora a una propuesta de carga: qué concepto se toma, su importe, cómo se trata y a qué entrada de la planilla iría.
5. Revisar las diferencias respecto de las celdas actuales y pulsar «Cargar en calculadora».
6. Continuar trabajando sobre la misma instancia de la planilla. «Guardar evaluación» conserva su circuito y permisos actuales; la extracción no guarda automáticamente.

La selección de una calculadora no autoriza por sí sola a reemplazar datos ya cargados. El tratamiento de esas diferencias debe quedar visible en la propuesta y acordado antes del primer piloto.

## Primera etapa propuesta

Trabajar primero con una calculadora y una familia de recibos. Las hojas observadas en la configuración existente incluyen Evaluacion, AMEJUCA, CAJA, CRUZ DE EJE, AMPERPAG, MUDON y CBU; no todas son necesariamente destinos de importación. No se asigna una hoja por el nombre del empleador, convenio o archivo sin una regla acordada.

Datos candidatos para extraer y revisar, según lo que exista en el recibo:

- Período de liquidación.
- Identificación del empleado, legajo y empleador, como contexto de revisión.
- Conceptos de haberes y descuentos: código si existe, descripción, importe y signo originales.
- Totales informados de haberes, descuentos y neto a pagar/cobrar.
- Página y referencia al texto o zona del documento de donde surge cada dato cuando el proveedor lo permita.

Estos son campos candidatos, no una obligación de completar todos los recibos. Un campo ausente o ilegible queda sin valor y con estado de revisión; no se completa con cero, no se adivina y no se presenta un porcentaje de confianza inventado. No se altera la identidad ni ningún dato de la solicitud a partir de la extracción.

## Reglas que vamos a construir con el usuario

La extracción describe el recibo. La asignación a la calculadora usa reglas explícitas, versionadas y comprobables. Mistral no decide arbitrariamente las celdas ni devuelve fórmulas ejecutables.

Para cada concepto o grupo se completará esta definición:

| Decisión | A definir |
| --- | --- |
| Calculadora destino | Primera hoja y versión de plantilla del piloto |
| Dato fuente | Concepto, código, descripción o total del recibo |
| Identificación del concepto | Criterio estable y variantes aceptadas |
| Tratamiento | Incluir, excluir, sumar, mantener separado u otra instrucción explícita |
| Importe y signo | Qué columna se toma y cómo tratar el signo original |
| Destino | Entrada o rango editable validado en la plantilla |
| Duplicados | Qué hacer si el mismo concepto aparece más de una vez |
| Datos actuales | Qué hacer si la celda ya tiene un importe o cambios sin guardar |
| Faltantes o dudas | Qué queda pendiente de revisión manual |

Todavía no hay celdas, porcentajes, reglas de descuento ni mapeos implementados o aprobados.

## Conservación del trabajo y cálculos

- Mantener una única instancia de CalculadoraMutualSheet. Extraer, elegir una hoja, revisar o cancelar no debe recrear Univer ni rehidratar la evaluación.
- Conservar hojas, columnas, zoom, posición de trabajo y cambios sin guardar; A–H continúa como referencia visual del análisis.
- Escribir únicamente valores de entrada en celdas declaradas para la calculadora y plantilla compatibles. No reemplazar fórmulas, formatos, nombres de hojas ni estructura del libro.
- Utilizar la API de escritura del libro ya montado y el motor de cálculo existente. Verificar agrupación de la operación y deshacer/rehacer con la versión instalada antes de implementarlo.
- Marcar la aplicación como cambios sin guardar y mantener «Guardar evaluación» como acción explícita.
- Conservar texto e importe originales y normalizar números argentinos para la propuesta, reutilizando los mecanismos existentes cuando sean compatibles.
- No mezclar datos de recibos distintos, solicitudes distintas o versiones anteriores de extracción/reglas. Aplicar una propuesta debe verificar otra vez la identidad del archivo, solicitud, hoja y estado del libro que la originaron.

Se debe definir cómo tratar varios recibos, períodos o cargos: sustituir, acumular o mantener separados. No se implementa una suma automática antes de acordarlo.

## Integración técnica a revisar durante el desarrollo

Frontend:

- EvaluacionRecibosView ya conserva solicitudId y selectedId, y el visor obtiene el archivo privado mediante la descarga autenticada existente.
- CalculadoraMutualSheet mantiene workbookRef y univerApiRef. Ya utiliza getSheetByName/getRange/setValue para hidratar la hoja Datos y recalcula con el motor existente. La importación debe ser una operación distinta de esa hidratación inicial.
- El guardado actual toma workbook.save(); las escrituras propuestas deben incorporarse a ese trabajo en memoria, preservando el seguimiento de cambios.
- Mostrar la revisión dentro de la vista conjunta sin tapar ni bloquear la planilla con un modal.

Backend:

- Reutilizar la conexión privada de Mistral, límites de archivos, validación y control de acceso. El ajuste de conexión dedicada de dev se trabaja por separado en el PR #513.
- Incorporar un contrato de extracción estructurado separado del resultado booleano/categórico de reconocimiento de recibos; reconocer «Recibo de Sueldo» no extrae por sí solo los conceptos.
- Verificar acceso a la solicitud, descarga del adjunto y Evaluación. La aplicación de datos requiere los permisos actuales para trabajar/guardar Evaluación; no concede permisos nuevos.
- No crear ni modificar solicitud, adjunto o evaluación por pedir una extracción. Toda persistencia adicional de extracciones, su conservación y su auditoría requieren definición de alcance.
- Tratar instrucciones escritas dentro de documentos como contenido no confiable. Validar el JSON extraído y resolver destinos mediante la lista de entradas permitidas de la plantilla, nunca mediante coordenadas o código sugerido libremente por el proveedor.
- Distinguir documento ilegible, extracción parcial, error del proveedor y respuesta inválida. Mantener la carga manual disponible.

Decisión pendiente: cómo habilitar esta segunda etapa y si requiere una configuración propia. El interruptor actual de reconocimiento automático al adjuntar no habilita esta propuesta de extracción y aplicación a Evaluación.

## Validación propuesta para el piloto

- Contrastar extracción de cada concepto/importe con recibos reales de la calculadora elegida, incluyendo imágenes y PDF.
- Probar separadores argentinos, centavos, signos, conceptos repetidos, totales y datos ilegibles.
- Confirmar el mapeo de cada entrada con ejemplos proporcionados por el usuario; conservar los casos como pruebas sin datos personales.
- Verificar que la propuesta no escriba en la planilla hasta la acción de aplicar, y que cancelar conserve el libro intacto.
- Verificar fórmulas, recálculo, seguimiento de cambios, guardado actual y recuperación de la evaluación.
- Probar cambios rápidos de recibo/solicitud/hoja, edición manual mientras llega una respuesta y aplicación repetida de una propuesta.
- Revisar permisos, ausencia de datos de otra solicitud, pantalla dividida y legibilidad en distintos tamaños.

No se afirma precisión ni se da por implementada ninguna de estas verificaciones: son el plan de aceptación del futuro desarrollo.

## Próxima definición

Elegir con el usuario la primera calculadora y qué datos desea completar. Después revisar juntos un recibo y la hoja correspondiente para llenar la tabla de reglas con destinos concretos, antes de programar la carga.
