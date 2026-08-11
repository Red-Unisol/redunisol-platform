# Auditoría De Clasificación Y Distribución Comercial

Versión: `2026-08-11`

## Objetivo

Conservar una evidencia legible de cada negociación procesada por Kestra sin acoplar
la distribución a la generación del reporte. Una falla del Excel no bloquea ni revierte
una decisión comercial en Bitrix24.

## Fuente de datos

Cada ejecución de `bitrix24_catamarca_deal_qualification` publica un resultado
estructurado. La ejecución Kestra y su revisión identifican el evento original. Los
runs `no_pending`, que no procesan una negociación, no forman parte del informe.

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
| `no_online_sellers_manual` | Ningún vendedor del bucket está online; queda con Maru. |
| `commercial_rejection_manual` | Rechazo comercial con fallback manual en Maru. |
| `no_matching_bucket` | No pudo determinarse un bucket. |
| `technical_error` | La ejecución no pudo completar la operación. |

Si una ejecución histórica registró el mensaje `No hay vendedores online disponibles`,
el reporte la identifica como `Sin vendedor disponible` y no como error técnico. Desde
la versión vigente, esa condición mueve la negociación a revisión manual, conserva la
línea y el bucket determinados, y la deja asignada a Maru sin transferir el chat.

## Reporte

`commercial_distribution_report_daily` se ejecuta todos los días a las 07:25 de
Argentina y consulta las ejecuciones mediante la API de Kestra. Publica:

```text
marketing/distribucion-negociaciones/ultimo.xlsx
marketing/distribucion-negociaciones/historico/YYYY-MM-DD.xlsx
```

El workbook contiene:

- `Resumen`: métricas generales y fecha de inicio del universo auditable;
- `Por vendedor`: eventos, distribuciones y chats por responsable;
- `Eventos`: detalle completo y enlaces a Bitrix;
- `Excepciones`: errores, revisiones y casos que no terminaron como distribución automática;
- `Histórico incompleto`: eventos posteriores al corte que excepcionalmente no tengan
  el contrato completo de trazabilidad, separados para que no se interpreten como
  excepciones comerciales.

Filament ya expone cualquier `.xlsx` debajo del volumen de reportes, por lo que no
requiere una pantalla ni una tabla nueva.

## Retención y límites

El histórico diario conserva una fotografía del reporte generado. La fuente primaria
del detalle es la ejecución de Kestra mientras esté dentro de su política de retención.
Si en el futuro se necesita retención indefinida, consultas interactivas o grandes
volúmenes, estos mismos eventos deben persistirse en una tabla append-only sin cambiar
el contrato del reporte.
