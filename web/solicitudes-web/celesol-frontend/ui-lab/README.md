# Laboratorio de interfaces de Beex

`/padrones` muestra la pestaña CredixSA operativa con padrones ficticios. Los
escenarios `?scenario=none`, `error`, `unconfigured`, `missing-document`,
`credixsa-error` y `bajas` permiten revisar estados independientes, cargos
múltiples, períodos distintos, fuentes sin publicar y cargas que requieren revisión.
Actualizar padrones sólo vuelve a leer fixtures; no realiza conexiones externas.

`/external-legajo` renderiza el panel real de Legajos con cero intentos de MetaMap.
Permite simular la carga y aprobación local de PDF/fotos. `?scenario=approved`
muestra la aprobación externa y `?scenario=error` simula un fallo de almacenamiento
para revisar el reintento. Solo esa ruta de carga tiene una respuesta POST ficticia
cuando se elige este escenario; las demás escrituras y conexiones reales se bloquean.

El laboratorio usa datos ficticios y componentes de la aplicación. Su entrada y
build están separados del sitio operativo. No carga archivos `.env`, no usa
sesiones reales y bloquea llamadas a APIs. Los enlaces de ejemplo usan `.invalid`.

```sh
npm run ui:dev
```

Abre `http://127.0.0.1:5271/`. Para comparar los casos, usar `?view=compare`.
El parámetro `scenario` permite abrir `new`, `compatible`, `mismatch`, `cancelled`,
`unavailable`, `submitted`, `analysis-ready`, `approved` o `requested`.

## Qué revisar

- Generar préstamo mantiene Confirmada; terminar análisis es otra acción.
- Préstamo vigente igual, distinto, anulado y consulta no disponible.
- Monto bloqueado mientras el préstamo está vigente.
- Primer indicador sólo después del envío completo; segundo tras aprobación.
- Firma aprobada antes o después de terminar el análisis.
- Solicitud de nueva firma con motivo, indicadores del nuevo ciclo e historial.
- Una firma extra no retira la aprobación vigente.
- Avisos al vendedor y a Legajos; leer un aviso no resuelve la tarea.

Elegir la vista Vendedor, Analista o Legajos y usar los controles para simular los
eventos. Para repetir, pulsar Restablecer. Se reutilizan el panel resumido de
firma, la barra de acciones y el aviso de préstamo que se usan en la aplicación.

## Validación y proceso local

```sh
npm run ui:build
npm run ui:test
npm run ui:preview
```

Antes de cambiar un flujo, agregar su escenario local, revisar la interfaz con el
equipo y luego conectar sus acciones a la API. Las simulaciones no reemplazan las
pruebas del backend ni prueban integraciones externas. El build del laboratorio
queda en `.local/ui-lab-dist`; el build operativo continúa en `dist`.

## Galerías adicionales

- `/socio-create`: formulario operativo de alta precargado desde un titular
  ficticio, incluyendo CBU y un CBU no habitual distinto. Permite comprobar
  validación, borrado opcional y payload enviado; Guardar sólo modifica memoria.
  `node ui-lab/socio-create.browser-test.mjs` revisa escritorio y 390 px.

- `/headers?layout=slim`: comparación de cabeceras Actual, A, B y C.
- `/production`: ficha real de la aplicación con datos de ejemplo aislados.
- `/cutoffs?scenario=pending`: pantalla operativa de cortes de AMEJUCA, sin fecha confirmada.
- `/cutoffs?scenario=confirmed`: corte confirmado e historial.
- `/cutoffs?scenario=error`: error al guardar que conserva el borrador.

En /cutoffs, Guardar corte modifica sólo la memoria de la galería. Ejecutar
`node ui-lab/cutoffs.browser-test.mjs` con ui:dev levantado para verificar esos
estados y guardar capturas de escritorio y móvil con datos ficticios.

`bootstrap.tsx` instala el transporte de fixtures antes de cargar componentes. Sólo se permiten GET de escenarios y rutas explícitas para las solicitudes ficticias; las mutaciones, rutas no previstas y orígenes externos fallan sin recurrir a la red real. La CSP permite iframes del mismo origen para el viewport móvil y bloquea conexiones externas. No se cargan archivos `.env`.

El proceso general se documenta en [prototipado de UI](../../../../docs/ui-prototyping.md).

## Cabeceras de solicitud

Abrir `http://127.0.0.1:5271/headers?layout=merged` para comparar Actual, A (barra compacta),
B (encabezado integrado) y C (vista de lectura). Se puede desplegar la cabecera, abrir las
acciones de C, recorrer las tres pestañas y probar un viewport móvil real de 390 px.
`clean=1` deja sólo la interfaz para capturas comparables y `expanded=1` abre los datos.

La revisión de firma, los datos rápidos, la barra de acciones y la navegación usan componentes
del producto. Las composiciones de cabecera son propuestas del lab; Evaluación y CredixSA
presentan contenido reducido de ejemplo. No se implementan decisiones, edición ni operaciones.
Los GET de sesión, datos rápidos y revisión documental tienen fixtures explícitos. Las mutaciones
y las rutas no previstas siguen bloqueadas, y la navegación del producto se simula localmente.

## Prueba visual reproducible

Con `ui:dev` ejecutándose, en otra terminal:

```powershell
npx playwright install chromium
npm run ui:visual
```

Si ya existe Chrome instalado, se puede usarlo sin descargar otro navegador:

```powershell
$env:UI_LAB_BROWSER_CHANNEL = 'chrome'
npm run ui:visual
```

El runner abre un navegador de prueba independiente con datos ficticios. Captura los cuatro
diseños en 1365×699, 1024×768 y 390×844; prueba los controles y guarda un `report.json`
junto a los PNG en `.local/ui-header-review/`. `UI_LAB_BASE_URL` permite indicar otro servidor
loopback y `UI_LAB_OUTPUT_DIR` una carpeta absoluta para la evidencia. No se conecta a producción.

## Opción A en la ficha real

`http://127.0.0.1:5271/production` carga `AppLayout` y la ficha operativa completa con
fixtures, incluyendo Evaluación y CredixSA reales. `role=vendedor` o `role=admin` permite
revisar otros permisos; `payment=external` agrega el aviso de una transferencia de ejemplo
y `edit=1` permite probar el modo de edición sin habilitar escrituras en el transporte.

`/production?list=precarga`, `?list=recientes` y `?list=historicas` muestran los
listados reales con la solicitud ficticia `500001` en la primera columna. La
ficha usa ese número como título y permite copiarlo sin prefijo ni separadores.
Los listados del laboratorio no simulan la búsqueda del servidor.

`/production?list=usuarios&role=admin` muestra la vista real de Usuarios con
cuatro registros ficticios. Permite revisar la búsqueda por nombre, apellido,
email o usuario legacy, mayúsculas/tildes, varias palabras, búsqueda sin
coincidencias y limpieza del filtro. Revisar escritorio y 390 px; la tabla
conserva desplazamiento horizontal. Se puede abrir Editar, pero guardar e
ingresar como otro usuario siguen bloqueados por el transporte del laboratorio.

La sección Novedades de `/production` usa la tabla real con cuatro movimientos
ficticios: pago, confirmación de análisis con observación larga y multilínea,
asignación automática sin cambio de estado y corrección administrativa. Permite
revisar fecha/hora de Argentina, autor, motivo y cambios de área visibles sin
abrir eventos. En escritorio presenta cuatro columnas; en móvil apila los datos
de cada movimiento sin truncar la observación.

La barra global del detalle mide 40 px en escritorio y 48 px con puntero táctil. Los datos
comienzan plegados y el navegador recuerda Mostrar/Ocultar encabezado. Las acciones siguen
disponibles y los avisos operativos forman parte del contenido desplazable de Solicitud.

Con el servidor local activo:

```powershell
$env:UI_LAB_BROWSER_CHANNEL = 'chrome'
npm run ui:visual:production
```

El runner guarda capturas e informe en `.local/ui-production-review/`. Verifica la ficha
real con distintos roles, pantallas de poca altura, móvil, las tres pestañas, persistencia
de la preferencia y edición/cancelación. Las operaciones y solicitudes no previstas siguen
bloqueadas; los datos de evaluación son ficticios y no validan reglas financieras.


## Evaluación externa

`/production?state=revision-riesgo` muestra la entrada a Evaluación Externa en
Más acciones. `/production?state=evaluacion-externa` muestra el nuevo estado y
Volver a Revisión Riesgo como acción principal. Usar `role=vendedor` para
revisar la lectura sin permisos de transición. Son fixtures locales de lectura;
confirmar una transición sigue bloqueado por el transporte del laboratorio.

## Suma de cuotas y movimientos

`npm run ui:visual:cuotas` prueba la suma con Ctrl+clic en escritorio y 390 px:
cierre y reapertura por teclado entre cuotas, cambio de columna y Escape.
Usa dos cuotas ficticias de $100 y $200 en la pestaña Préstamos de `/production`.

## Comparación del CBU habitual

`/production?cbu=nonhabitual` muestra el CBU de Vimarx, el de la solicitud y el
destino no habitual con datos ficticios. El runner
`node ui-lab/cbu-comparison.browser-test.mjs` revisa coincidencia, diferencia,
ausencias, errores y recuperación, edición de identidad, escritorio y móvil.
Los escenarios y el contrato están en
[CBU habitual en Beex](../../../../docs/apis/vimarx/cbu-habitual-beex.md).

## Reliquidación conservadora

`/reliquidacion` usa el panel operativo con datos ficticios y mutaciones en memoria.
Escenarios: `?scenario=prepared`, `pending`, `blocked`, `error` y `refresh-error`.
Usa el control real con transporte simulado, incluidas respuestas POST y recargas
de fondo lentas o fallidas. Los errores permanecen visibles después de cerrar el modal.
`node ui-lab/reliquidacion.browser-test.mjs` verifica el circuito en escritorio y
390/320 px y guarda capturas en `.local/reliquidacion-review`.

## Confirmación de envío a firma

`/workflow-action` muestra la confirmación operativa de Enviar a firmar sin
campo de comentario manual. `?scenario=required` conserva un comentario
obligatorio para Devolver a Revisar y `?scenario=transfer` conserva el campo
opcional de Mandar a transferir. La confirmación sólo registra un resultado ficticio.
