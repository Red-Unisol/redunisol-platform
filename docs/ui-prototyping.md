# Maquetado local de interfaces

Los cambios de interfaz con varios estados se pueden revisar en una galería local de escenarios antes de conectarlos a operaciones reales. El prototipo y sus datos ficticios se versionan junto al producto para poder reproducir la revisión.

## Proceso

1. Definir la tarea del usuario, los roles que pueden ejecutarla y los datos que necesita para decidir. Enumerar los casos: inicial, datos preexistentes, incompatibilidad, bloqueo, carga, error recuperable, resultado incierto y éxito.
2. Crear escenarios deterministas con datos ficticios. Reutilizar los componentes visuales del producto y separar los datos y las acciones de sus integraciones. Los controles de simulación deben quedar fuera de la interfaz propuesta.
3. Ejecutar una entrada local independiente del producto, sin credenciales ni acceso a APIs operativas. Una operación simulada solo cambia el estado local. Las peticiones no previstas deben fallar de forma explícita, sin recurrir a la red real.
4. Revisar cada escenario en el navegador: información visible antes de confirmar, texto del botón, motivos de bloqueo, reintentos, scroll del modal y acceso al pie de acciones. Revisar escritorio y una ventana angosta. Guardar capturas de los casos importantes como evidencia de la propuesta.
5. Tras acordar el alcance, implementar las reglas reales en el servidor y conectar la interfaz. Las restricciones visuales no sustituyen validaciones de permisos, consistencia e idempotencia en el servidor. Probar localmente o en el ambiente de integración antes de ejecutar operaciones reales.
6. Incluir en el PR los escenarios revisados, las validaciones ejecutadas y los comportamientos que siguen siendo simulados. Mantener los casos útiles como catálogo de regresión visual para cambios futuros.

No es necesario agregar una herramienta pesada para empezar. Conviene ampliar la galería de cada producto y compartir componentes cuando haya una necesidad concreta.

## Beex

La primera galería vive en `web/solicitudes-web/celesol-frontend/ui-lab/`. Su README describe los comandos y los límites del entorno. Desde la carpeta del frontend:

```powershell
npm run ui:dev
```

La galería se sirve en `http://127.0.0.1:5271/`. Tiene una entrada y una configuración de compilación propias; no forma parte del bundle de producción ni cambia la operativa de solicitudes.

La galería principal presenta el flujo actual de firmas en paralelo al análisis, avisos y control de préstamos. Sus escenarios se mantienen junto a los componentes operativos para poder revisar los cambios sin ejecutar operaciones reales.

Para agregar una propuesta, crear datos de escenarios separados de sus componentes y mantener visible qué se está simulando. No reutilizar nombres, documentos, solicitudes ni préstamos reales.

## Comparación de cabeceras y espacio de lectura

En `http://127.0.0.1:5271/headers` se comparan la cabecera actual y tres propuestas:

- `?layout=current`: referencia con barra global de 64 px y datos completos.
- `?layout=slim`: A, barra global de 40 px y datos plegables.
- `?layout=merged`: B, navegación e identificación integradas en una sola cabecera.
- `?layout=focus`: C, vista de lectura con datos y acciones desplegables.

`expanded=1` abre los datos y `clean=1` oculta los controles del laboratorio. La opción de 390 px usa un iframe del mismo origen, con un viewport real de ese ancho, para que los breakpoints de los componentes compartidos se ejecuten correctamente. El iframe también conserva el bloqueo de red del laboratorio.

La galería importa `AppTopbar`, `AppSidebar`, `DatosRapidosSolicitante`, `SolicitudDetailToolbar` y `DocumentReviewPanel` del producto. La composición alternativa de la cabecera vive sólo en el laboratorio. Los cuerpos de Evaluación y CredixSA son ejemplos reducidos para revisar el espacio; no sustituyen las pantallas operativas ni prueban sus cálculos o integraciones. Las acciones de navegación y edición están simuladas.

Para revisar un diseño:

1. Abrir Actual, A, B y C al mismo tamaño de viewport y con el mismo contenido cargado. Registrar inicio y altura del área de lectura.
2. Probar Mostrar/Ocultar encabezado en las tres pestañas, Acciones en C, menú lateral y menú de usuario. Comprobar que no se pierde identificación ni acceso a los controles.
3. Repetir en una notebook de poca altura, en 1024×768 y en 390×844. Comprobar foco de teclado, navegación por flechas en las pestañas, tablas y scroll. En dispositivos táctiles usar blancos de al menos 44 px.
4. Guardar capturas de las alternativas y del diseño desplegado. Mantener la evidencia local fuera del build de producción.
5. Ejecutar `npm run ui:test` y `npm run ui:build`. Tras integrar un diseño en los componentes operativos, ejecutar también las validaciones del producto y repetir la revisión visual en el entorno autorizado.

## Diseño A integrado

La ficha actual usa la barra global compacta y los datos rápidos plegables de A. El detalle
conserva nombre, documento, estado y acciones; Mostrar/Ocultar encabezado está disponible
en todas las pestañas y la preferencia se guarda localmente. En pantallas cortas, las áreas
de contenido conservan una altura mínima y la ficha puede desplazarse para llegar a ellas.

`/production` en el servidor del laboratorio renderiza los componentes operativos completos,
con sesión y datos ficticios. `npm run ui:visual:production` comprueba esta integración y
guarda evidencia aparte de la comparación de propuestas (`npm run ui:visual`). Revisar
también roles sin acceso a Evaluación, avisos de pago, preferencia tras recargar y visibilidad
de Guardar/Cancelar mientras se pliega el encabezado.
