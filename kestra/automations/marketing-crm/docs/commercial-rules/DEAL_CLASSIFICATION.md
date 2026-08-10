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

| Prioridad | Regla | Es socio | Créditos activos | Snapshot BCRA | Condición BCRA | Decisión | Etapa | Línea | Motivo |
|---:|---|---|---:|---|---|---|---|---|---|
| 10 | `CAT-DATA-010` | Desconocido | Cualquiera | Cualquiera | Cualquiera | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | `missing_membership_data` |
| 20 | `CAT-MEMBER-010` | Sí | Cualquiera | Cualquiera | No aplica | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | `member_rules_require_manual_review` |
| 30 | `CAT-MEMBER-020` | No | Mayor que 0 | Cualquiera | No aplica | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | `member_rules_require_manual_review` |
| 40 | `CAT-BCRA-010` | No | 0 | Faltante, inválido o inconcluso | Desconocido | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Snapshot no utilizable |
| 50 | `CAT-BCRA-020` | No | 0 | Válido | Más de 4 entidades en situación 4 o 5 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Exceso de entidades negativas |
| 60 | `CAT-BCRA-030` | No | 0 | Válido | Banco Nación en situación mayor que 2 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Banco de cobro en situación no admitida |
| 70 | `CAT-LINE-010` | No | 0 | Válido | Sin situaciones o todas hasta situación 1 | Aprobado | PRESENTACIÓN | AMEJUCA Premium | `amejuca_premium` |
| 80 | `CAT-LINE-020` | No | 0 | Válido | Cualquier caso restante que no sea rechazo duro | Aprobado | PRESENTACIÓN | AMEJUCA Especial | `amejuca_special` |

Notas normativas:

- se utiliza el último período disponible del snapshot;
- Banco Nación ausente equivale a situación 0 para esta regla;
- un socio o una persona con créditos activos no recibe rechazo BCRA automático;
- los datos base faltantes o inválidos también producen revisión manual mediante las
  validaciones técnicas anteriores a esta tabla.

## Córdoba

Estado: **borrador para validación; no implementado**.

Precondición funcional: negociación de Córdoba cuyo lead ya superó provincia,
situación laboral y banco de cobro en la precalificación.

### Reglas comunes de CBU

`CBU Nuevos` y `CBU Propia Recurrentes` son reglas internas de evaluación. Cuando se
aprueban, ambas guardan `CBU` en el campo Línea.

| Prioridad | Regla | Tipo de evaluación | Condición BCRA | Decisión | Etapa | Línea | Motivo |
|---:|---|---|---|---|---|---|---|
| 10 | `COR-CBU-DATA-010` | Cualquiera | Snapshot faltante, inválido o inconcluso | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Datos BCRA insuficientes |
| 20 | `COR-CBU-OWN-010` | CBU Nuevos o CBU Propia Recurrentes | Más de 5 entidades | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Exceso de entidades |
| 30 | `COR-CBU-OWN-020` | CBU Nuevos o CBU Propia Recurrentes | Alguna entidad en situación mayor que 1 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Situación BCRA no admitida |
| 40 | `COR-CBU-OWN-030` | CBU Nuevos o CBU Propia Recurrentes | Banco de cobro en situación mayor que 1 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Banco de cobro no admitido |
| 50 | `COR-CBU-OWN-040` | CBU Nuevos o CBU Propia Recurrentes | Hasta 5 entidades, todas hasta situación 1, y banco de cobro hasta situación 1 | Aprobado | PRESENTACIÓN | CBU | CBU aprobada |
| 60 | `COR-CBU-COMER-010` | CBU Comer Recurrentes | No puede calcularse “cupo afectado al 0,1” | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Cálculo comercial no definido |

La variante Comer admite situaciones negativas sin tope conocido, pero no puede
automatizarse hasta resolver `COR-PEND-002`.

### Empleado Público Provincial y Personal de Salud

| Prioridad | Regla | Condición de socio/crédito | Evaluación | Decisión inicial | Línea |
|---:|---|---|---|---|---|
| 100 | `COR-EPPS-010` | Cliente nuevo o no socio | CBU Nuevos | Aplicar tabla CBU | Según resultado CBU |
| 110 | `COR-EPPS-020` | Socio sin crédito vigente | CBU Recurrentes | Aplicar tabla CBU | Según resultado CBU |
| 120 | `COR-EPPS-030` | Crédito vigente y corresponde renovación | BCRA REN no definido | REVISIÓN MANUAL KESTRA | Sugerida: REN Premium o REN Especial |
| 130 | `COR-EPPS-040` | Crédito vigente y corresponde paralelo o mora | Requiere análisis de pagos/regularización | REVISIÓN MANUAL KESTRA | No aplica |
| 140 | `COR-EPPS-050` | Condición de socio o crédito desconocida | Datos insuficientes | REVISIÓN MANUAL KESTRA | No aplica |

### Policía

| Prioridad | Regla | Condición de socio/crédito | Condición BCRA o comercial | Decisión | Etapa | Línea | Motivo |
|---:|---|---|---|---|---|---|---|
| 200 | `COR-POL-DATA-010` | Cualquiera | Snapshot BCRA faltante, inválido o inconcluso | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Datos BCRA insuficientes |
| 210 | `COR-POL-REN-010` | Renovación con buen cumplimiento | BCRA REN no definido | Revisión manual | REVISIÓN MANUAL KESTRA | Sugerida: REN Premium o REN Especial | Falta regla BCRA REN |
| 220 | `COR-POL-CREDIT-010` | Renovación con mal cumplimiento, paralelo o mora | Cierre automático no definido | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Revisión de comportamiento de pago |
| 230 | `COR-POL-CDE-010` | No socio o sin crédito vigente | Banco de Córdoba en situación 2 o superior | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Regla Banco de Córdoba pendiente |
| 240 | `COR-POL-CDE-020` | No socio o sin crédito vigente | Más de 2 entidades en situación 4 o 5 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Exceso de entidades negativas |
| 250 | `COR-POL-CDE-030` | No socio o sin crédito vigente | Solo situaciones 1 | Aprobado | PRESENTACIÓN | Cruz del Eje | Categoría Premium |
| 260 | `COR-POL-CDE-040` | No socio o sin crédito vigente | Situaciones 2 o 3, o hasta 2 entidades en situación 4/5 | Aprobado provisional | PRESENTACIÓN | Cruz del Eje | Categoría Especial; validar alcance |
| 270 | `COR-POL-DATA-020` | Desconocido | Cualquiera | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Condición de socio/crédito desconocida |

`COR-POL-CDE-040` no debe implementarse hasta confirmar `COR-PEND-004`, porque la
cantidad permitida de entidades en situación 2 o 3 no está cerrada.

### Docente, Empleado Público Municipal, Jubilado Nacional y Pensionado

| Prioridad | Regla | Condición de socio/crédito | Evaluación | Decisión inicial | Línea |
|---:|---|---|---|---|---|
| 300 | `COR-CBU-GEN-010` | Cliente nuevo o no socio | CBU Nuevos | Aplicar tabla CBU | Según resultado CBU |
| 310 | `COR-CBU-GEN-020` | Socio sin crédito vigente | CBU Recurrentes | Aplicar tabla CBU | Según resultado CBU |
| 320 | `COR-CBU-GEN-030` | Crédito vigente y encuadra como recurrente | CBU Recurrentes | Aplicar tabla CBU | Según resultado CBU |
| 330 | `COR-CBU-GEN-040` | Crédito vigente y no encuadra como recurrente | Cierre automático no definido | REVISIÓN MANUAL KESTRA | No aplica |
| 340 | `COR-CBU-GEN-050` | Condición desconocida | Datos insuficientes | REVISIÓN MANUAL KESTRA | No aplica |

### Jubilado Provincial

| Prioridad | Regla | Condición de socio/crédito | Condición BCRA o comercial | Decisión | Etapa | Línea |
|---:|---|---|---|---|---|---|
| 400 | `COR-CAJA-DATA-010` | Cualquiera | Snapshot faltante, inválido o inconcluso | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |
| 410 | `COR-CAJA-NEW-010` | Cliente nuevo | Solo situaciones 1 | Aprobado | PRESENTACIÓN | Caja Nuevo |
| 420 | `COR-CAJA-NEW-020` | Cliente nuevo | Alguna situación distinta de 1 | Revisión manual de cierre | REVISIÓN MANUAL KESTRA | No aplica |
| 430 | `COR-CAJA-REC-010` | Socio/recurrente sin crédito vigente | Situaciones 1, 2 o 3 | Pendiente de selección de línea | REVISIÓN MANUAL KESTRA | Sugerida: Caja General o Caja Irregulares |
| 440 | `COR-CAJA-REC-020` | Socio/recurrente sin crédito vigente | Situaciones 4 o 5 | Pendiente de validación | REVISIÓN MANUAL KESTRA | Sugerida: Caja Morosos |
| 450 | `COR-CAJA-BANK-010` | Cualquiera | Irregularidad con Bancor o Macro | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |
| 460 | `COR-CAJA-CREDIT-010` | Crédito vigente | Paralelo, mora o condición mínima de pago | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |

Las líneas Caja permanecen manuales salvo `Caja Nuevo` porque se superponen las
condiciones de `Caja General` y `Caja Irregulares`, y faltan criterios para resolver
la prioridad y las irregularidades del banco de cobro.

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
