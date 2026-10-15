# Evaluación y recibos de sueldo

La pestaña Evaluación conserva una única instancia de CalculadoraMutualSheet y agrega un visor lateral no modal. La acción «Ver recibos de sueldo» abre el panel; previsualizar un adjunto de esa categoría desde Adjuntos abre la misma vista cuando canAccessRiesgoTools lo permite. Otros archivos y usuarios conservan el modal habitual.

Se usa exclusivamente el listado autorizado de la solicitud actual con tipoAdjunto exactamente «Recibo de Sueldo». El orden es el del listado. La selección conserva solicitudId e id; no depende del File ni de nombres o extensiones. Una descarga cancelada no actualiza el archivo seleccionado. Las URLs de los documentos se revocan al sustituirlos o cerrar su visor.

El panel izquierdo comienza cerca del 45% en pantallas grandes y reserva unos 840 px para A–H cuando el ancho disponible lo permite (hasta 65% en ventanas menores). Se ajusta de 35% a 75% mediante arrastre o teclado (flechas, Inicio y Fin); una vez ajustado manualmente, el reparto elegido no se sobrescribe al redimensionar la ventana. Al entrar en Evaluación se cierra el menú lateral mediante el mismo estado que usa su botón, conservando la posibilidad de reabrirlo. Conserva el zoom de cada hoja, las columnas, sus desplazamientos y el guardado existente. En ventanas estrechas el conjunto admite desplazamiento horizontal; el selector y «Cerrar recibos» permanecen en la barra superior. No se encoge automáticamente el libro.

## Redimensionamiento verificado

Univer 0.25.1, engine-render/lib/es/index.js: Engine.setContainer instala un ResizeObserver sobre el contenedor y llama resize mediante requestIdleCallback. La vista cambia el ancho del mismo nodo, sin crear otro workbook, llamar a hydrate, cambiar source ni modificar los efectos de CalculadoraMutualSheet. La key solo cambia al cambiar de solicitud. Las confirmaciones existentes al abandonar Evaluación y beforeunload se conservan.

## Comprobaciones

- Build TypeScript/Vite y ESLint de los archivos afectados.
- Prueba de selección exacta, orden, otra solicitud y adjuntos eliminados: 1 caso aprobado.
- Pruebas existentes de listado, descarga y guardado de evaluación: 16 aprobadas.
- Chromium con Univer real y respuestas sintéticas: la instancia de canvas permanece conectada, se consulta y se hidrata una sola vez, y el guardado conserva un texto escrito en otra hoja tras abrir, navegar, ajustar y cerrar el visor.
- Un recibo sin navegación; múltiples recibos con límites; ninguno con mensaje vacío. Error de descarga y cambio rápido que cancela una respuesta tardía. Separador por teclado, imagen con zoom, revocación de URLs, pegado desde el portapapeles en una celda y modal habitual de otro archivo.
- Viewports 1440×900, 800×700 y 390×844. El ancho de 800 representa también el espacio reducido por un menú lateral. Sin cambios de zoom automáticos.

Las pruebas de navegador utilizaron un entorno local aislado y datos simulados, sin guardar evaluaciones ni archivos reales. La carga del PDF se mantiene en el visor nativo mediante iframe, sin rasterización ni OCR. En la revisión previa al despliegue se esperó la carga completa del visor PDF nativo de Chromium y se verificaron su presentación, los controles de páginas/zoom y la selección mediante arrastre seguida de copia al portapapeles del texto «Recibo de sueldo - texto seleccionable». La comprobación integrada con una sesión real en dev queda pendiente. No se desplegó.

Revisión de ancho y menú: Chromium con AppLayout y Univer reales, sesión/datos sintéticos. A 1920 px, el contenido pasó de 1632 a 1919 px al cerrar el menú y el reparto inicial fue 45%. A 1440 px, Evaluación midió aproximadamente 840 px. Tras un ajuste manual y otro cambio de ventana, el porcentaje se conservó y hubo una única lectura/hidratación de la evaluación. Compilación y ESLint correctos; sin despliegue de este ajuste.
