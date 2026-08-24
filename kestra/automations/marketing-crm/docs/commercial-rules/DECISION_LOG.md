# Registro de Decisiones Comerciales

Versión: `2026-08-11`

Este documento conserva decisiones funcionales cerradas para evitar que conceptos
históricos vuelvan a incorporarse por error.

## `COR-DEC-001` — Unificar CBU Recurrente

- **Fecha:** 2026-08-10
- **Estado:** Implementado en el PR #218; pendiente de deploy.
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
- **Estado:** Histórica para el resultado; ampliada por `CAT-DEC-003`. Continúa
  describiendo el runtime hasta implementar la nueva clasificación.
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
- **Estado:** Implementado en el PR #218; pendiente de deploy.
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
- **Estado:** Ampliada por `COR-DEC-007` e implementada en el PR #218; pendiente de deploy.
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
- **Estado:** Implementado en el PR #218; pendiente de deploy.
- **Precondición:** Jubilado Provincial nuevo, menor de 80 años.
- **Caja Nuevo:** si todas las entidades están en situación 1, se aprueba como `Caja
  Nuevo`.
- **Caja Irregulares:** puede tener otras entidades en situación 2/3, siempre que el
  banco de cobro permanezca en situación 1 y ninguna entidad supere situación 3.
- **Rechazo:** si el banco de cobro está en situación mayor que 1, la negociación queda
  en **SIT. NEG. EN BCRA**, sin línea comercial.

## `COR-DEC-005` — Aprobar Caja Irregulares para nuevos y recurrentes

- **Fecha:** 2026-08-11
- **Estado:** Ampliada por `COR-DEC-008` e implementada en el PR #218; pendiente de deploy.
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
- **Estado:** Implementado en el PR #218; pendiente de deploy.
- **Decisión:** toda persona de 80 años o más se rechaza para las líneas Caja.
- **Límite inclusivo:** el rechazo aplica desde el día en que cumple 80 años.
- **Ejecución temporal:** hasta crear la etapa definida en `GEN-DEC-002`, la
  negociación queda en **REVISIÓN MANUAL KESTRA** con motivo de rechazo por edad para
  que una persona ejecute el cierre en Bitrix.

## `GEN-DEC-001` — Preferir revisión manual frente a rechazo ambiguo

- **Fecha:** 2026-08-11
- **Estado:** Acordado.
- **Decisión:** antes de rechazar se evalúan todas las familias habilitadas para el
  perfil. Un dato faltante, una combinación no cubierta o una identificación dudosa
  producen **REVISIÓN MANUAL KESTRA**.
- **Rechazo:** solamente se ejecuta ante una exclusión explícita y verificable.
- **Snapshot limpio:** un banco identificable ausente de un snapshot válido equivale a
  situación 0.

## `CAT-DEC-002` — Nueva frontera Premium y Especial AMEJUCA

- **Fecha:** 2026-08-11
- **Estado:** Implementado en el PR #218; pendiente de deploy.
- **Premium:** situaciones 1 sin límite, hasta cinco entidades en situación 2, ninguna
  situación 3/4/5 y banco de cobro hasta situación 2.
- **Especial:** banco de cobro hasta situación 1, situaciones 1/2/3 sin límite o hasta
  cuatro entidades en situación 4/5, cuando no aplica Premium.
- **Revisión manual:** banco de cobro en situación 2 cuando el perfil no cumple
  Premium; incluye más de cinco entidades en situación 2.
- **Rechazos comunes:** más de cuatro entidades en situación 4/5 o banco de cobro por
  encima de situación 2.
- **Alcance:** los rechazos comunes aplican a socios y no socios.

## `CAT-DEC-003` — Reglas conservadoras para socios AMEJUCA

- **Fecha:** 2026-08-11
- **Estado:** Implementado con salida manual por falta de cuota social en el PR #218;
  pendiente de deploy.
- **Buen comportamiento:** cuota social al día, cero días de atraso y cuotas vencidas
  pagadas.
- **Premium Recurrentes:** requiere buen comportamiento y BCRA Premium.
- **Paralelos:** mínimo cuatro cuotas pagadas para Premium y dos para Especial.
- **Renovación con dos créditos:** 50% pagado del crédito a cancelar y segunda cuota
  pagada del crédito más reciente.
- **Incumplimiento o dato faltante:** revisión manual, no rechazo automático.

## `COR-DEC-007` — Cerrar reglas Cruz del Eje y REN

- **Fecha:** 2026-08-11
- **Estado:** Implementado en el PR #218; pendiente de deploy.
- **Premium:** solo situaciones 1.
- **Especial:** situaciones 2/3 sin límite o hasta dos entidades en situación 4/5.
- **Rechazos:** más de dos entidades en situación 4/5 o Banco de Córdoba en situación
  2 o superior.
- **REN:** utiliza la misma separación BCRA, requiere cero días de atraso y cuotas
  vencidas pagadas.
- **Mora y paralelos:** revisión manual; la mora se resuelve antes de evaluar una línea
  común y no se aprueba un paralelo automáticamente.
- **Persistencia:** el campo Línea guarda `Cruz del Eje`; Premium, Especial y REN se
  registran en el motivo auditable.
- **Decisiones cerradas:** `COR-PEND-003`, `COR-PEND-004`, `COR-PEND-005`,
  `COR-PEND-009` y `COR-PEND-012`.

## `COR-DEC-008` — Completar líneas Caja

- **Fecha:** 2026-08-11
- **Estado:** Implementado en el PR #218; pendiente de deploy.
- **Caja General:** recurrente menor de 80 con situaciones 0/1 o snapshot válido sin
  entidades.
- **Caja Morosos:** nuevo o recurrente menor de 80, alguna situación 4/5, banco de
  cobro hasta situación 1 y ninguna entidad excluyente.
- **Banco irregular:** en Caja Morosos produce rechazo BCRA.
- **Entidad excluyente:** produce revisión manual exhaustiva, no rechazo.
- **Paralelos:** menos de una cuota pagada para General, o menos de cuatro para
  Irregulares/Morosos, producen revisión manual.
- **Refinanciación Morosos:** revisión manual; no se aprueba automáticamente.
- **Decisiones cerradas:** `COR-PEND-007` y `COR-PEND-011`.

## `COR-DEC-009` — Separar DASPU Haberes y Club Mutual CBU

- **Fecha:** 2026-08-11
- **Estado:** Implementado con las salidas manuales documentadas en el PR #218;
  pendiente de deploy.
- **DASPU Haberes:** activo DASPU, formulario 691 válido y cupo mayor que cero; no tiene
  rechazo BCRA automático documentado.
- **Club Mutual CBU:** docente/no docente activo UNC dentro del límite etario, hasta
  tres entidades en situación 4/5 y sin mora con Banco Nación.
- **Datos faltantes, Banco Nación irregular o cuatro entidades 4/5 o más:** revisión
  manual, no rechazo.
- **Decisión cerrada:** `COR-PEND-010`.

## `COR-DEC-010` — Ampliar aceptación de jubilados y pensionados

- **Fecha:** 2026-08-24.
- **Origen:** tarea Bitrix24 `22745`.
- **Pensionado:** se considera pensionado provincial y precalifica con cualquier banco.
- **Jubilado Municipal:** precalifica únicamente con Bancor.
- **Negociación:** Jubilado Municipal usa las reglas de Caja y el bucket de jubilados,
  igual que Jubilado Provincial.
- **Compatibilidad:** ningún caso previamente aceptado pasa a rechazarse.

## `GEN-DEC-002` — Etapa para rechazos comerciales

- **Fecha:** 2026-08-11
- **Estado:** Acordado, pendiente de configuración en Bitrix.
- **Etapa objetivo:** **NO CALIFICA COMERCIAL KESTRA**.
- **Fallback:** hasta crearla, usar **REVISIÓN MANUAL KESTRA** con motivo de rechazo
  para que una persona ejecute el cierre.
- **Decisión cerrada:** `COR-PEND-008`.

## `GEN-DEC-003` — Tratamiento de revisión manual

- **Fecha:** 2026-08-11
- **Estado:** Acordado.
- **Distribución:** dentro de horario utiliza el bucket normal; fuera de horario queda
  con Maru.
- **Línea oficial:** permanece vacía.
- **Sugerencia:** se registra únicamente en el resultado auditable.
- **Vencimiento:** una revisión manual nunca se rechaza automáticamente por demora.
- **Decisiones cerradas:** `GEN-PEND-002` y `GEN-PEND-003`.
