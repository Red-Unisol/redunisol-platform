# Carga de Evaluación y espacio del visor PDF

## Cambios

- PDF nativo: `#navpanes=0&view=FitH` cierra inicialmente el panel de miniaturas y ajusta el documento al ancho. Conserva la barra de herramientas, las páginas, el zoom, la selección de texto y la posibilidad de reabrir las miniaturas. Verificado en Chromium con el visor PDF nativo; `pagemode=none` no producía el cierre esperado y se descartó.
- La evaluación guardada se monta directamente desde su snapshot autorizado. No necesita descargar ni convertir el Excel original, que no se utiliza en ese camino.
- Los datos de la solicitud se consultan en paralelo con la lectura y el montaje del libro, una sola vez por apertura. Se aplican mediante hydrate y el motor de cálculo actuales, después de montar; no se agrega una caché compartida entre identidades o solicitudes.
- LuckyExcel se importa dinámicamente únicamente cuando hace falta convertir la plantilla. Su importación y la descarga de la plantilla corren en paralelo. La vista independiente conserva la descarga del Excel original.
- Una lectura fallida de la evaluación guardada continúa impidiendo cargar una plantilla que podría sobrescribirla. Los fallos de los datos se mantienen como errores de hidratación. No se cambia el cálculo, el guardado ni las protecciones de salida.

## Comparación reproducida localmente

Chromium, Univer real, snapshot sintético con tres hojas, viewport 1440×900, tres aperturas por versión. Backend simulado con demoras constantes: evaluación guardada 200 ms, Excel 700 ms y datos 800 ms. Se midió desde navegación hasta la planilla montada y la desaparición del indicador de hidratación. Estas cifras son de la prueba local, no una medición de la solicitud real en dev.

| Versión | Aperturas (ms) | Mediana | Descargas de plantilla |
| --- | --- | --- | --- |
| Anterior | 4538, 2866, 2827 | 2866 ms | 3 |
| Optimizada | 2289, 1874, 1804 | 1874 ms | 0 |

Mejora de mediana: aproximadamente 35%. El ahorro real depende de red, legacy, tamaño del snapshot, equipo y caché del navegador; el montaje de Univer y el cálculo siguen siendo necesarios.

## Verificaciones

- Sin evaluación guardada: conversión de la plantilla real y una sola consulta de datos/plantilla correctas.
- Lectura fallida de evaluación guardada: sin montaje ni descarga de plantilla de reemplazo.
- Vista conjunta: misma instancia, cambios en otra hoja y guardado conservados; cambio de recibos, redimensionamiento y cierre sin rehidratar. Casos de descarga fallida/atrasada y conjunto vacío/único/múltiple correctos.
- PDF: estado nativo `sidenavCollapsed_ = true`, documento ajustado al ancho, barra de herramientas disponible y selección/copia por arrastre correctas.
- TypeScript/Vite, ESLint y comprobación de diff correctos.

Los servicios usados en las pruebas se simularon; no se guardaron evaluaciones reales ni se modificaron solicitudes. Queda pendiente medir los tiempos con una sesión autenticada real y confirmar el comportamiento de los parámetros PDF en otros navegadores. Sin despliegue.
