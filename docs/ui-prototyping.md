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

El primer conjunto presenta la propuesta de generación de préstamo y liquidación. Incluye préstamos compatibles, diferencias de monto o condiciones, anulación verificada, indisponibilidad de Core, operación en curso, resultado incierto y éxito. Los importes se comparan con el monto solicitado, sin confundirlo con el capital que incluye gastos. La firma sigue después de Liquidada.

Para agregar una propuesta, crear datos de escenarios separados de sus componentes y mantener visible qué se está simulando. No reutilizar nombres, documentos, solicitudes ni préstamos reales.
