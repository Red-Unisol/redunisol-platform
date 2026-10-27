# Laboratorio de interfaces de Beex

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

- `/headers?layout=slim`: comparación de cabeceras Actual, A, B y C.
- `/production`: ficha real de la aplicación con datos de ejemplo aislados.

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
