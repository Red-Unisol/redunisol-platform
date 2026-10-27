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
