# Propuesta: extraer recibos y cargar Evaluación

Estado: PR borrador para acordar el alcance. Este cambio contiene solamente documentación: no incorpora endpoints, botones, llamadas a Mistral ni escrituras en planillas. No se despliega esta etapa. El piloto acordado es AMEJUCA, con revisión en un pop-up y carga de importes de descuentos. Las reglas pendientes se detallan abajo; no se implementa todavía la ejecución.

## Experiencia propuesta

Desde la vista conjunta de Evaluación y recibos:

1. Elegir el recibo en el panel derecho y solicitar «Extraer datos» explícitamente.
2. Abrir un pop-up de preparación. Elegir la calculadora destino; el piloto usa AMEJUCA. Esta elección prepara inmediatamente la asignación de descuentos dentro de un borrador temporal del pop-up, sin escribir en la evaluación activa.
3. Mostrar para cada descuento el código y concepto leídos, el importe original, el importe interpretado y su destino propuesto en el modelo elegido. Conservar la referencia al documento cuando esté disponible.
4. Permitir corregir datos y agregar descuentos en ese borrador. Los conceptos sin correspondencia o con destinos ambiguos requieren revisión; no elegir una celda arbitraria.
5. Revisar las diferencias respecto de los valores actuales y pulsar «Cargar en calculadora». Cancelar descarta solamente la preparación del pop-up.
6. Aplicar los importes revisados sobre la misma instancia de la planilla. «Guardar evaluación» conserva su circuito y permisos actuales; la extracción y la aplicación no guardan automáticamente.

La selección de una calculadora no autoriza por sí sola a reemplazar datos ya cargados. El tratamiento de esas diferencias debe quedar visible en la propuesta y acordado antes del primer piloto.

El pop-up es una revisión transitoria solicitada por el usuario; el visor habitual del recibo continúa en el panel derecho. Su presentación exacta —lista editable de descuentos o representación de la hoja AMEJUCA— queda pendiente de elección. En ambos casos, el borrador está separado de la evaluación activa y cerrar el pop-up conserva el trabajo previo.

## Primera etapa acordada: AMEJUCA y descuentos

El primer modelo es AMEJUCA. No se implementa en esta etapa un administrador de múltiples modelos ni se asigna una hoja por el nombre del empleador, convenio o archivo.

El alcance de carga comprende únicamente los descuentos y sus importes. Se extraen sus códigos, conceptos, importes y signos originales para proponer las correspondencias. Período e identificación pueden servir como contexto de revisión; no se escriben automáticamente datos del titular, haberes, ingresos, neto, condiciones de la solicitud ni otros valores de negocio.

Un campo ausente o ilegible queda sin valor y con estado de revisión; no se completa con cero, no se adivina y no se presenta un porcentaje de confianza inventado. El usuario puede corregir la lectura y agregar un descuento faltante antes de aplicar. Agregarlo al borrador no implica insertar filas en la plantilla: su destino permitido debe resolverse antes de cargarlo.

## Vinculación con el modelo existente

La inspección de solo lectura de `celesol-backend/docs/calculadora-riesgo/CALCULADORA MUTUAL.xlsx`, hoja `AMEJUCA`, encontró 43 filas con códigos de descuento. En ellas, la columna B contiene el código, C el concepto y D el importe de entrada. Ejemplos observados:

| Código | Concepto de la plantilla | Importe de entrada observado |
| --- | --- | --- |
| 499 | Descuento O.S.E.P. | D9 |
| 501 | Aportes Jubilatorios | D10 |
| 332 | CAPRESCA - CREDITO AGAP | D30 |
| 332 | AGJYS - Crdito AGAP | D32 |
| 2559 | SI.D.C.A, servicio | D50 |
| 2559 | SI.D.C.A, cuota | D51 |

Este inventario describe la plantilla actual, no una implementación de coordenadas fijas ni una aprobación de reglas financieras. La futura asignación debe validar la versión del modelo y las entradas permitidas. Los importes de estas filas no contienen fórmulas en la plantilla inspeccionada.

Reutilizar las correspondencias ya representadas por códigos y conceptos. Como 332 y 2559 están repetidos, el código aislado no alcanza para todos los casos: distinguir el concepto y pedir revisión si sigue siendo ambiguo. No escribir en ambas filas ni elegir la primera silenciosamente.

Algunos recibos muestran dos identificadores numéricos en una línea: un código interno y el código del concepto. Conservar ambos cuando existan y contrastar el código del concepto con el modelo; no asumir que el primer número es el que corresponde a AMEJUCA.

## Reglas que vamos a construir con el usuario

La extracción describe el recibo. La asignación a la calculadora usa reglas explícitas, versionadas y comprobables. Mistral no decide arbitrariamente las celdas ni devuelve fórmulas ejecutables.

| Decisión | Estado |
| --- | --- |
| Calculadora del piloto | AMEJUCA |
| Revisión previa | Pop-up con borrador editable; elegir calculadora prepara la asignación allí |
| Datos a cargar | Importes de descuentos, vinculados por código y concepto existentes |
| Correcciones | Corregir datos y agregar descuentos antes de aplicar |
| Código sin correspondencia | Revisar y resolver destino permitido; no inventar una fila |
| Código ambiguo | Considerar concepto; no asignar automáticamente si no alcanza |
| Importe y signo | Pendiente: columna fuente y tratamiento del signo según modelo |
| Conceptos repetidos en el recibo | Pendiente: sumar, separar o seleccionar según instrucciones |
| Datos actuales | Pendiente: tratamiento de importes existentes y cambios sin guardar |
| Diseño del pop-up | Pendiente: lista editable o diseño de la hoja AMEJUCA |
| Reglas adicionales | Pendientes: variantes de conceptos, inclusiones y exclusiones explícitas |

No hay mapeos ejecutables ni reglas nuevas de descuento implementados. No se implementa todavía configuración de múltiples modelos.

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
- Abrir el pop-up de preparación desde la vista conjunta. Mantener montada la evaluación activa debajo; el borrador y su selección de modelo no ejecutan la hidratación inicial ni alteran el libro.

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
- Probar separadores argentinos, centavos, signos, conceptos repetidos, códigos internos frente a códigos de concepto y datos ilegibles. Incluir las ambigüedades 332 y 2559 del modelo actual.
- Confirmar el mapeo de cada entrada con ejemplos proporcionados por el usuario; conservar los casos como pruebas sin datos personales.
- Verificar que la propuesta no escriba en la planilla hasta la acción de aplicar, y que cancelar conserve el libro intacto.
- Verificar fórmulas, recálculo, seguimiento de cambios, guardado actual y recuperación de la evaluación.
- Probar cambios rápidos de recibo/solicitud/hoja, edición manual mientras llega una respuesta y aplicación repetida de una propuesta.
- Revisar permisos, ausencia de datos de otra solicitud, pantalla dividida y legibilidad en distintos tamaños.

No se afirma precisión ni se da por implementada ninguna de estas verificaciones: son el plan de aceptación del futuro desarrollo.

## Próxima definición

Revisar juntos un recibo y AMEJUCA para acordar signos, códigos ambiguos, descuentos nuevos y tratamiento de importes existentes. Confirmar el diseño del pop-up y completar la tabla de reglas antes de programar la carga.
