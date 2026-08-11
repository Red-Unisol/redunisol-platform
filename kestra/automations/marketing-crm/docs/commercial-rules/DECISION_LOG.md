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

## `COR-DEC-004` — Banco de cobro para clientes nuevos de Caja

- **Fecha:** 2026-08-11
- **Estado:** Acordado, pendiente de implementación junto con la clasificación de
  Córdoba.
- **Precondición:** Jubilado Provincial nuevo, menor de 80 años.
- **Caja Nuevo:** si todas las entidades están en situación 1, se aprueba como `Caja
  Nuevo`.
- **Caja Irregulares:** puede tener otras entidades en situación 2/3, siempre que el
  banco de cobro permanezca en situación 1 y ninguna entidad supere situación 3.
- **Rechazo:** si el banco de cobro está en situación mayor que 1, la negociación queda
  en **SIT. NEG. EN BCRA**, sin línea comercial.

## `COR-DEC-005` — Aprobar Caja Irregulares para nuevos y recurrentes

- **Fecha:** 2026-08-11
- **Estado:** Acordado, pendiente de implementación junto con la clasificación de
  Córdoba.
- **Segmento:** Jubilado Provincial nuevo o recurrente.
- **Edad:** menor de 80 años, calculada a la fecha de clasificación.
- **BCRA común:** todas las entidades como máximo en situación 3 y al menos una entidad
  en situación 2 o 3.
- **Cliente nuevo:** el banco de cobro debe estar en situación 1; las situaciones 2/3
  deben pertenecer a otras entidades.
- **Socio recurrente:** el banco de cobro también puede estar en situación 2/3.
- **Resultado:** etapa **PRESENTACIÓN**, línea `Caja Irregulares`.
- **Datos o límites incumplidos:** fecha de nacimiento faltante o una situación 4/5
  quedan en **REVISIÓN MANUAL KESTRA** mientras no exista una regla final más
  específica.
- **Decisión cerrada:** `COR-PEND-006`; las situaciones 2/3 dentro del límite de edad
  corresponden a Caja Irregulares y no requieren elegir entre Caja General e
  Irregulares.

## `COR-DEC-006` — Rechazar Caja desde los 80 años

- **Fecha:** 2026-08-11
- **Estado:** Acordado, pendiente de implementación junto con la clasificación de
  Córdoba.
- **Decisión:** toda persona de 80 años o más se rechaza para las líneas Caja.
- **Límite inclusivo:** el rechazo aplica desde el día en que cumple 80 años.
- **Ejecución temporal:** hasta cerrar `COR-PEND-008`, la negociación queda en
  **REVISIÓN MANUAL KESTRA** con motivo de rechazo por edad para que una persona
  ejecute el cierre en Bitrix.
