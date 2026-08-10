# Registro de Decisiones Comerciales

Versión: `2026-08-10`

Este documento conserva decisiones funcionales cerradas para evitar que conceptos
históricos vuelvan a incorporarse por error.

## `COR-DEC-001` — Unificar CBU Recurrente

- **Fecha:** 2026-08-10
- **Estado:** Acordado, pendiente de implementación junto con la clasificación de
  Córdoba.
- **Decisión:** `CBU Comer Recurrente` no entra en ningún caso y se elimina de la
  especificación.
- **Nombre resultante:** la categoría restante se denomina `CBU Recurrente`; se elimina
  también la palabra `Propia`.
- **Regla BCRA:** máximo cinco entidades, ninguna situación mayor que 1 y banco de
  cobro como máximo en situación 1.
- **Resultado aprobado:** etapa **PRESENTACIÓN**, línea `CBU`.
- **Resultado que incumple BCRA:** etapa **SIT. NEG. EN BCRA**, sin línea.
- **Datos insuficientes:** etapa **REVISIÓN MANUAL KESTRA**, sin línea.
- **Decisiones cerradas:** `COR-PEND-001` y `COR-PEND-002`.

Esta decisión elimina cualquier referencia funcional al cálculo “cupo afectado al
0,1”. Los borradores de junio y julio que mencionaban Propia o Comer fueron eliminados
del árbol activo; Git conserva su historial.

## `CAT-DEC-001` — Clasificar la afiliación únicamente por Es socio

- **Fecha:** 2026-08-10
- **Estado:** Acordado e implementado.
- **Decisión:** la clasificación de Catamarca utiliza el campo `Es socio` enriquecido
  por Vimarx. La cantidad de créditos activos no constituye una condición comercial
  independiente.
- **Fundamento de datos:** cuando Vimarx no encuentra una afiliación, informa
  conjuntamente `Es socio = No` y cero créditos activos; cuando la encuentra, informa
  `Es socio = Sí` y la cantidad correspondiente.
- **Resultado:** `Es socio = Sí` pasa a **REVISIÓN MANUAL KESTRA**; `Es socio = No`
  continúa a las reglas BCRA; un valor desconocido pasa a **REVISIÓN MANUAL KESTRA**.
- **Regla eliminada:** `CAT-MEMBER-020`.

## `COR-DEC-002` — Empleado Público Provincial utiliza Cruz del Eje

- **Fecha:** 2026-08-10
- **Estado:** Acordado, pendiente de implementación junto con la clasificación de
  Córdoba.
- **Decisión:** Empleado Público Provincial utiliza la misma evaluación comercial de
  Cruz del Eje que Policía.
- **Alcance:** aplica tanto a los resultados Premium y Especial como a sus rechazos y
  revisiones manuales.
- **Separación:** Personal de Salud conserva el camino CBU documentado; no forma parte
  de esta modificación.
- **Nomenclatura:** las reglas compartidas dejan de usar el prefijo `COR-POL-*` y pasan
  a `COR-CDE-*`.
