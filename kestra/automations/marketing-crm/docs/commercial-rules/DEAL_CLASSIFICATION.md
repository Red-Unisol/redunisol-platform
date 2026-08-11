# Clasificación Comercial de Negociaciones

Versión: `2026-08-10`

## Alcance

Este documento comienza cuando la negociación ya existe. Las reglas que deciden si
un lead supera la precalificación no se repiten aquí.

La clasificación comercial solamente determina:

- etapa resultante de la negociación;
- línea comercial;
- motivo o regla aplicada;
- necesidad de revisión manual.

La elección del responsable y la transferencia del chat pertenecen a distribución y
se documentan por separado.

## Contrato general de decisión

Toda ejecución debe producir, como mínimo:

| Salida | Descripción |
|---|---|
| `rule_id` | Identificador de la regla que produjo el resultado. |
| `decision` | `approved`, `bcra_rejected` o `manual_review`. |
| `stage` | Nombre funcional de la etapa resultante. |
| `commercial_line` | Línea aprobada, sugerida explícitamente o `No aplica`. |
| `reason` | Explicación breve, estable y auditable. |

Si ninguna fila coincide, aplica `GLOBAL-999`: **REVISIÓN MANUAL KESTRA**, línea `No
aplica`, motivo `unclassified_case`.

## Catamarca

Estado: **vigente e implementado**.

Precondición funcional: negociación de Catamarca pendiente de clasificación. Las
reglas de socio se evalúan antes que las reglas BCRA.

| Prioridad | Regla | Es socio | Snapshot BCRA | Condición BCRA | Decisión | Etapa | Línea | Motivo |
|---:|---|---|---|---|---|---|---|---|
| 10 | `CAT-DATA-010` | Desconocido | Cualquiera | Cualquiera | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | `missing_membership_data` |
| 20 | `CAT-MEMBER-010` | Sí | Cualquiera | No aplica | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | `member_rules_require_manual_review` |
| 30 | `CAT-BCRA-010` | No | Faltante, inválido o inconcluso | Desconocido | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Snapshot no utilizable |
| 40 | `CAT-BCRA-020` | No | Válido | Más de 4 entidades en situación 4 o 5 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Exceso de entidades negativas |
| 50 | `CAT-BCRA-030` | No | Válido | Banco Nación en situación mayor que 2 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Banco de cobro en situación no admitida |
| 60 | `CAT-LINE-010` | No | Válido | Sin situaciones o todas hasta situación 1 | Aprobado | PRESENTACIÓN | AMEJUCA Premium | `amejuca_premium` |
| 70 | `CAT-LINE-020` | No | Válido | Cualquier caso restante que no sea rechazo duro | Aprobado | PRESENTACIÓN | AMEJUCA Especial | `amejuca_special` |

Notas normativas:

- se utiliza el último período disponible del snapshot;
- Banco Nación ausente equivale a situación 0 para esta regla;
- `Es socio` se obtiene de Vimarx; la cantidad de créditos activos no participa en
  esta clasificación;
- un socio no recibe rechazo BCRA automático;
- los datos base faltantes o inválidos también producen revisión manual mediante las
  validaciones técnicas anteriores a esta tabla.

## Córdoba

Estado: **borrador para validación; no implementado**.

Precondición funcional: negociación de Córdoba cuyo lead ya superó provincia,
situación laboral y banco de cobro en la precalificación.

### Reglas comunes de CBU

`CBU Nuevos` y `CBU Recurrente` son reglas internas de evaluación. Cuando se aprueban,
ambas guardan `CBU` en el campo Línea. `CBU Recurrente` no tiene subtipos: las
categorías históricas Propia y Comer fueron eliminadas por `COR-DEC-001`.

| Prioridad | Regla | Tipo de evaluación | Condición BCRA | Decisión | Etapa | Línea | Motivo |
|---:|---|---|---|---|---|---|---|
| 10 | `COR-CBU-DATA-010` | Cualquiera | Snapshot faltante, inválido o inconcluso | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Datos BCRA insuficientes |
| 20 | `COR-CBU-010` | CBU Nuevos o CBU Recurrente | Más de 5 entidades | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Exceso de entidades |
| 30 | `COR-CBU-020` | CBU Nuevos o CBU Recurrente | Alguna entidad en situación mayor que 1 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Situación BCRA no admitida |
| 40 | `COR-CBU-030` | CBU Nuevos o CBU Recurrente | Banco de cobro en situación mayor que 1 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Banco de cobro no admitido |
| 50 | `COR-CBU-040` | CBU Nuevos o CBU Recurrente | Hasta 5 entidades, todas hasta situación 1, y banco de cobro hasta situación 1 | Aprobado | PRESENTACIÓN | CBU | CBU aprobada |

### Policía y Empleado Público Provincial

Ambas situaciones laborales utilizan la misma clasificación comercial de Cruz del
Eje. Ser socio o tener préstamos activos en líneas CBU propias no deriva el caso a
CBU ni impide aprobar Cruz del Eje.

| Prioridad | Regla | Préstamos activos Cruz del Eje | Condición BCRA o comercial | Decisión | Etapa | Línea | Motivo |
|---:|---|---|---|---|---|---|---|
| 200 | `COR-CDE-DATA-010` | Cualquiera | Snapshot BCRA faltante, inválido o inconcluso | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Datos BCRA insuficientes |
| 210 | `COR-CDE-REN-010` | Tiene; corresponde renovación con buen cumplimiento | BCRA REN no definido | Revisión manual | REVISIÓN MANUAL KESTRA | Sugerida: REN Premium o REN Especial | Falta regla BCRA REN |
| 220 | `COR-CDE-CREDIT-010` | Tiene; corresponde renovación con mal cumplimiento, paralelo o mora | Cierre automático no definido | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Revisión de comportamiento de pago |
| 230 | `COR-CDE-010` | No tiene | Banco de Córdoba en situación 2 o superior | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Regla Banco de Córdoba pendiente |
| 240 | `COR-CDE-020` | No tiene | Más de 2 entidades en situación 4 o 5 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Exceso de entidades negativas |
| 250 | `COR-CDE-030` | No tiene | Solo situaciones 1 | Aprobado | PRESENTACIÓN | Cruz del Eje | Categoría Premium |
| 260 | `COR-CDE-040` | No tiene | Situaciones 2 o 3, o hasta 2 entidades en situación 4/5 | Aprobado provisional | PRESENTACIÓN | Cruz del Eje | Categoría Especial; validar alcance |
| 270 | `COR-CDE-DATA-020` | Desconocido | Cualquiera | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | No se pudo determinar si existe un préstamo Cruz del Eje activo |

`COR-CDE-040` no debe implementarse hasta confirmar `COR-PEND-004`, porque la
cantidad permitida de entidades en situación 2 o 3 no está cerrada.

### Docente, Empleado Público Municipal, Personal de Salud, Jubilado Nacional y Pensionado

| Prioridad | Regla | Condición de socio/crédito | Evaluación | Decisión inicial | Línea |
|---:|---|---|---|---|---|
| 300 | `COR-CBU-GEN-010` | Cliente nuevo o no socio | CBU Nuevos | Aplicar tabla CBU | Según resultado CBU |
| 310 | `COR-CBU-GEN-020` | Socio sin crédito vigente | CBU Recurrente | Aplicar tabla CBU | Según resultado CBU |
| 320 | `COR-CBU-GEN-030` | Crédito vigente y encuadra como recurrente | CBU Recurrente | Aplicar tabla CBU | Según resultado CBU |
| 330 | `COR-CBU-GEN-040` | Crédito vigente y no encuadra como recurrente | Cierre automático no definido | REVISIÓN MANUAL KESTRA | No aplica |
| 340 | `COR-CBU-GEN-050` | Condición desconocida | Datos insuficientes | REVISIÓN MANUAL KESTRA | No aplica |

### Jubilado Provincial

| Prioridad | Regla | Condición de socio/crédito | Condición BCRA o comercial | Decisión | Etapa | Línea |
|---:|---|---|---|---|---|---|
| 400 | `COR-CAJA-AGE-DATA-010` | Cualquiera | Fecha de nacimiento faltante o inválida | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |
| 410 | `COR-CAJA-AGE-010` | Cualquiera, 80 años o más | Rechazo comercial por edad | Rechazo con cierre manual | REVISIÓN MANUAL KESTRA | No aplica |
| 420 | `COR-CAJA-DATA-010` | Cualquiera, menor de 80 años | Snapshot faltante, inválido o inconcluso | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |
| 430 | `COR-CAJA-NEW-010` | Cliente nuevo, menor de 80 años | Solo situaciones 1 | Aprobado | PRESENTACIÓN | Caja Nuevo |
| 440 | `COR-CAJA-NEW-020` | Cliente nuevo, menor de 80 años | Alguna situación mayor que 1 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica |
| 450 | `COR-CAJA-IRREG-010` | Socio recurrente, menor de 80 años | Todas las entidades hasta situación 3 y al menos una en situación 2 o 3 | Aprobado | PRESENTACIÓN | Caja Irregulares |
| 460 | `COR-CAJA-REC-010` | Socio recurrente, menor de 80 años | Solo situaciones 1 | Pendiente de selección de línea | REVISIÓN MANUAL KESTRA | Sugerida: Caja General |
| 470 | `COR-CAJA-REC-020` | Socio recurrente, menor de 80 años | Alguna situación 4 o 5 | Pendiente de validación | REVISIÓN MANUAL KESTRA | Sugerida: Caja Morosos |
| 480 | `COR-CAJA-BANK-010` | Cualquiera | Irregularidad bancaria no resuelta por una regla anterior | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |
| 490 | `COR-CAJA-CREDIT-010` | Crédito vigente | Paralelo, mora o condición mínima de pago | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |

`Caja Nuevo` y `Caja Irregulares` tienen reglas de aprobación explícitas. `Caja
General` y `Caja Morosos` permanecen manuales porque todavía faltan criterios para
cerrar su clasificación.

Para un cliente nuevo, cualquier situación mayor que 1 es un rechazo BCRA explícito.
No se evalúa Caja Irregulares.

`Caja Irregulares` aplica únicamente a socios recurrentes. El banco de cobro declarado
no interviene. La edad se calcula a la fecha de clasificación a partir de la fecha de
nacimiento disponible en Bitrix. Los montos, plazos y documentación requerida
corresponden a la gestión posterior y no participan en la clasificación comercial de
la negociación.

Cumplir 80 años produce rechazo comercial. Hasta definir una etapa específica para
rechazos no-BCRA en `COR-PEND-008`, Kestra debe dejar la negociación en **REVISIÓN
MANUAL KESTRA** para ejecutar el cierre, registrando el motivo de edad.

### UNC y DASPU

| Prioridad | Regla | Situación laboral | Decisión | Etapa | Línea | Motivo |
|---:|---|---|---|---|---|---|
| 500 | `COR-UNC-010` | Empleado de la UNC o DASPU | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Línea y evaluación comercial no definidas |

## Regla segura para rechazos por análisis

La documentación histórica indica varios resultados como “rechazo por análisis”,
pero no define si Kestra debe cerrar automáticamente la negociación ni qué etapa debe
utilizar.

Hasta resolver `COR-PEND-008`, esos casos quedan en **REVISIÓN MANUAL KESTRA** para que
una persona confirme el cierre. Esta regla no modifica los rechazos BCRA explícitos,
que sí terminan en **SIT. NEG. EN BCRA**.
