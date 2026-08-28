# Auditoría De Clasificación Y Distribución Comercial

Versión: `2026-08-26`

## Objetivo

Conservar una evidencia legible de cada negociación procesada por Kestra sin acoplar
la distribución a la generación del reporte. Una falla del Excel no bloquea ni revierte
una decisión comercial en Bitrix24.

## Fuente de datos

Cada ejecución de `bitrix24_catamarca_deal_qualification` publica un resultado
estructurado. La ejecución Kestra y su revisión identifican el evento original. Los
runs `no_pending`, que no procesan una negociación, no forman parte del informe.

Desde el contrato `deal-commercial-distribution-trace.v2`, el evento se construye dentro del mismo
flujo que toma la decisión. Es autosuficiente: el reporte no vuelve a consultar Bitrix
ni intenta reconstruir posteriormente qué ocurrió.

Cada evento de negociación contiene cuatro grupos de información:

- identidad: negociación, lead, contacto y título;
- contexto de entrada: provincia, situación laboral, banco de cobro y origen;
- decisión comercial: acción, razón, línea y etapa comercial resultante;
- decisión de distribución: acción, razón, bucket, responsable y estrategia;
- operación: versión de reglas, fecha, horario, pools y detalle de transferencia de chats.

Desde `deal-commercial-distribution-trace.v4`, cada distribución conserva los IDs de
los chats encontrados, transferidos y omitidos. Para cada chat omitido también registra
si no tenía una sesión transferible o si Bitrix no permitió inspeccionarlo. Los eventos
anteriores mantienen el contador disponible y el Excel los identifica como trazabilidad
histórica sin detalle, sin inferir una causa que no fue registrada.

Desde `deal-commercial-distribution-trace.v5`, `assignment_strategy=sticky_chat_owner`
y `chat_transfer_status=preserved` identifican los casos donde se conserva al operador
del chat en vez de ejecutar una nueva transferencia.

Los chats se transfieren únicamente cuando pertenecen a una línea de Open Lines
incluida en `BITRIX24_DISTRIBUTABLE_OPEN_LINE_IDS`. La configuración usa una
allowlist y omite de forma segura cualquier línea desconocida, mal formada o no
comercial. El evento registra cuántos chats no distribuibles fueron omitidos.

La clasificación comercial y la distribución son dos ejes independientes. Por
ejemplo, una negociación puede quedar aprobada para una línea y, al mismo tiempo,
quedar en cola o con Maru porque todavía no existe un vendedor disponible. La
distribución nunca reemplaza la decisión ni la razón comercial.

Los eventos emitidos al reintentar o cerrar una cola conservan la decisión comercial
original almacenada en la negociación. De esta manera, la trazabilidad no reclasifica
un caso por el resultado operativo de un intento posterior de asignación.

Los resultados fuera de horario, ya procesados y con error técnico respetan el mismo
contrato. Ante un error, el flujo hace una recuperación de contexto de solo lectura y
emite el evento antes de terminar; no modifica nuevamente la negociación.

Los datos incluyen IDs y contexto operativo, pero no copian CUIL, DNI ni el snapshot
BCRA completo al Excel.

## Inicio del universo auditable

El reporte operativo incluye únicamente eventos procesados desde el
`2026-08-11 13:00:00` de Argentina, inclusive. De esta forma, la medición comienza con
las reglas comerciales vigentes y no mezcla decisiones tomadas anteriormente con
otras versiones de la lógica.

El corte se configura mediante `REPORTS_AUDIT_FROM` y su valor predeterminado es
`2026-08-11T13:00:00-03:00`. El generador descarta toda ejecución anterior y muestra
el inicio del universo en la hoja `Resumen`.

## Estrategias de asignación

| Valor | Significado |
|---|---|
| `contact_history` | Conserva al vendedor previo del mismo contacto y bucket. |
| `legacy_contact_history` | Conserva al vendedor previo usando la provincia histórica. |
| `round_robin` | Continúa el round-robin del bucket. |
| `legacy_round_robin` | Continúa el round-robin usando negociaciones históricas sin bucket. |
| `round_robin_initial` | No existe antecedente; toma el primer vendedor online del pool. |
| `single_seller` | El bucket tiene un único vendedor configurado. |
| `outside_hours_manual` | Fuera de horario queda con Maru. |
| `assignment_queue_waiting` | Ningún vendedor del bucket está disponible; espera en la cola de ese bucket. |
| `assignment_queue_distributed` | Un reintento de la cola encontró vendedor y completó la asignación. |
| `assignment_queue_closed_manual` | Cerró la ventana semanal; sale de la cola y queda con Maru. |
| `rejection_without_distribution` | Rechazo comercial aplicado sin buscar vendedor. |
| `no_matching_bucket` | No pudo determinarse un bucket. |
| `technical_error` | La ejecución no pudo completar la operación. |

Si una ejecución histórica registró el mensaje `No hay vendedores online disponibles`,
el reporte la identifica como `Sin vendedor disponible` y no como error técnico. En
la versión vigente, los casos creados dentro de la ventana de distribución esperan en
una cola independiente por bucket. Al cerrar la ventana semanal salen de la cola y
quedan con Maru, sin perder la línea ni la explicación comercial originales.

## Reporte

`commercial_distribution_report_daily` se ejecuta todos los días a las 07:25 de
Argentina y consulta las ejecuciones mediante la API de Kestra. Publica:

```text
marketing/distribucion-negociaciones/ultimo.xlsx
marketing/distribucion-negociaciones/historico/YYYY-MM-DD.xlsx
```

El workbook contiene:

- `Resumen`: métricas generales, fecha de inicio y versión vigente;
- `Casos`: una fila por negociación con su resultado más reciente, ordenada de más
  nueva a más antigua;
- `Por vendedor`: negociaciones, distribuciones y chats por responsable;
- `Excepciones`: última situación de los casos que requieren atención;
- `Trazabilidad técnica`: todas las ejecuciones e intentos, incluidos los repetidos;
- `Histórico incompleto`: eventos posteriores al corte que excepcionalmente no tengan
  el contrato completo de trazabilidad, separados para que no se interpreten como
  excepciones comerciales.

`Casos` separa `Decisión tomada` de `Razón de la decisión`. La primera expresa el
resultado de negocio, por ejemplo `Asignado a la línea AMEJUCA Premium` o `Rechazado`;
la segunda explica en lenguaje comercial qué condición produjo ese resultado.

La versión de reglas, el ID del flow y su revisión aparecen junto al resultado para
distinguir la política comercial aplicada del artefacto técnico que la ejecutó. Las
revisiones se comparan dentro de cada flow: la revisión del clasificador no se compara
con la revisión independiente del procesador de cola. Las filas de una revisión anterior
del mismo flow se muestran atenuadas, sin ocultarlas. Los responsables y pools se
muestran como `Nombre Apellido (ID)`; el nombre se resuelve con `user.get` de Bitrix y
el ID permanece visible como identificador estable.

Filament ya expone cualquier `.xlsx` debajo del volumen de reportes, por lo que no
requiere una pantalla ni una tabla nueva.

## Retención y límites

El histórico diario conserva una fotografía del reporte generado. La fuente primaria
del detalle es la ejecución de Kestra mientras esté dentro de su política de retención.
Si en el futuro se necesita retención indefinida, consultas interactivas o grandes
volúmenes, estos mismos eventos deben persistirse en una tabla append-only sin cambiar
el contrato del reporte.
