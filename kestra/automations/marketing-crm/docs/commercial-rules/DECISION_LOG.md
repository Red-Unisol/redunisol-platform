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
- **Separación:** Personal de Salud forma parte del grupo CBU general junto con
  Docente, Empleado Público Municipal, Jubilado Nacional y Pensionado.
- **Nomenclatura:** las reglas compartidas dejan de usar el prefijo `COR-POL-*` y pasan
  a `COR-CDE-*`.

## `COR-DEC-003` — Renovaciones Cruz del Eje dependen de la línea del préstamo

- **Fecha:** 2026-08-10
- **Estado:** Acordado, pendiente de implementación junto con la clasificación de
  Córdoba.
- **Decisión:** para Policía y Empleado Público Provincial, solamente un préstamo
  activo de una línea Cruz del Eje habilita el análisis de renovación, paralelo o
  mora de Cruz del Eje.
- **No bloquean:** ser socio y tener préstamos activos en líneas CBU propias no cambian
  la evaluación a CBU y no impiden obtener una línea Cruz del Eje.
- **Sin préstamo Cruz del Eje activo:** se aplican las reglas BCRA comunes de Cruz del
  Eje.
- **Con préstamo Cruz del Eje activo:** se aplican las reglas de renovación, paralelo
  o mora, todavía pendientes de completar.

## `COR-DEC-004` — Caja Nuevo rechaza Bancor mayor que situación 1

- **Fecha:** 2026-08-10
- **Estado:** Acordado, pendiente de implementación junto con la clasificación de
  Córdoba.
- **Precondición:** Jubilado Provincial clasificado como cliente nuevo para Caja Nuevo.
- **Decisión:** si Bancor está en situación mayor que 1, la negociación se rechaza.
- **Resultado:** etapa **SIT. NEG. EN BCRA**, sin línea comercial.
- **Resto de incumplimientos:** cualquier otra condición que no satisfaga la aprobación
  de Caja Nuevo permanece en **REVISIÓN MANUAL KESTRA** hasta contar con una regla más
  específica.

## `COR-DEC-005` — Aprobar Caja Irregulares por edad y BCRA

- **Fecha:** 2026-08-10
- **Estado:** Acordado, pendiente de implementación junto con la clasificación de
  Córdoba.
- **Segmento:** Jubilado Provincial, cliente nuevo o recurrente.
- **Edad:** hasta 82 años inclusive, calculada a la fecha de clasificación.
- **BCRA:** todas las entidades como máximo en situación 3 y al menos una entidad en
  situación 2 o 3.
- **Banco de cobro:** no interviene en esta evaluación.
- **Resultado:** etapa **PRESENTACIÓN**, línea `Caja Irregulares`.
- **Datos o límites incumplidos:** fecha de nacimiento faltante, edad mayor a 82 o una
  situación 4/5 quedan en **REVISIÓN MANUAL KESTRA** mientras no exista una regla final
  más específica.
- **Decisión cerrada:** `COR-PEND-006`; las situaciones 2/3 dentro del límite de edad
  corresponden a Caja Irregulares y no requieren elegir entre Caja General e
  Irregulares.
