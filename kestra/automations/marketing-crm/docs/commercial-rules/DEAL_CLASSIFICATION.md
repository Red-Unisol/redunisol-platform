# Clasificación Comercial de Negociaciones

Versión: `2026-08-26`

## Alcance

Este documento comienza cuando la negociación ya existe. La clasificación determina:

- etapa resultante;
- línea comercial;
- motivo o regla aplicada;
- necesidad de revisión manual.

La distribución de responsables y chats se documenta por separado. Los montos,
plazos, documentación y cálculos de cupo pertenecen a la gestión posterior, salvo que
una regla los mencione expresamente.

## Contrato general de decisión

| Salida | Descripción |
|---|---|
| `rule_id` | Identificador estable de la regla aplicada. |
| `decision` | `approved`, `bcra_rejected`, `commercial_rejected` o `manual_review`. |
| `stage` | Etapa funcional resultante. |
| `commercial_line` | Línea aprobada o `No aplica`. |
| `reason` | Motivo breve, estable y auditable. |

Política conservadora:

1. antes de rechazar por una línea se evalúan las demás líneas habilitadas para el
   perfil;
2. datos faltantes, combinaciones no cubiertas o identificaciones dudosas producen
   **REVISIÓN MANUAL KESTRA**;
3. solamente una exclusión explícita y verificable produce rechazo;
4. `GLOBAL-999` cubre cualquier caso no clasificado con motivo `unclassified_case`.

Los rechazos comerciales no-BCRA tendrán como etapa objetivo **NO CALIFICA COMERCIAL
KESTRA**. Hasta crearla en Bitrix, Kestra debe dejarlos en **REVISIÓN MANUAL KESTRA**
con el motivo de rechazo para que una persona ejecute el cierre.

## Catamarca — AMEJUCA

Estado: **implementado en el PR #218, pendiente de deploy y auditoría en producción**.
El runtime productivo conserva la versión anterior hasta completar ese deploy.

Se utiliza el último período disponible del snapshot BCRA. El banco evaluado es el
banco de cobro declarado; si no aparece en un snapshot válido equivale a situación 0.
Si no puede identificarse de manera confiable, corresponde revisión manual.

### Reglas comunes

| Prioridad | Regla | Condición | Decisión | Etapa | Línea | Motivo |
|---:|---|---|---|---|---|---|
| 10 | `CAT-DATA-010` | Snapshot BCRA faltante, inválido o inconcluso | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | `missing_bcra_snapshot` |
| 20 | `CAT-BCRA-010` | Más de 4 entidades en situación 4 o 5 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | `bcra_more_than_four_high_risk_situations` |
| 30 | `CAT-BCRA-020` | Banco de cobro en situación mayor que 2 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | `payment_bank_situation_above_two` |

Los rechazos comunes aplican tanto a socios como a no socios.

### No socio

| Prioridad | Regla | Condición BCRA | Decisión | Etapa | Línea | Motivo |
|---:|---|---|---|---|---|---|
| 100 | `CAT-LINE-010` | Situaciones 1 sin límite; hasta 5 entidades en situación 2; ninguna situación 3/4/5; banco de cobro hasta situación 2 | Aprobado | PRESENTACIÓN | AMEJUCA Premium | `amejuca_premium` |
| 110 | `CAT-LINE-020` | Banco de cobro hasta situación 1; situaciones 1/2/3 sin límite, o hasta 4 entidades en situación 4/5; no cumple Premium | Aprobado | PRESENTACIÓN | AMEJUCA Especial | `amejuca_special` |
| 120 | `CAT-LINE-030` | Banco de cobro en situación 2 y el perfil no cumple Premium | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | `amejuca_line_ambiguous_for_payment_bank_two` |

Por prioridad, hasta cinco entidades en situación 2 corresponden a Premium. Más de
cinco pasan a Especial solamente cuando el banco de cobro está hasta situación 1.

### Socio recurrente

Para considerar buen comportamiento deben cumplirse simultáneamente: cuota social al
día, cero días de atraso y todas las cuotas vencidas pagadas.

| Prioridad | Regla | Condición | Decisión | Etapa | Línea | Motivo |
|---:|---|---|---|---|---|---|
| 200 | `CAT-REC-DATA-010` | Afiliación, cuota social o comportamiento desconocidos | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | `missing_recurrent_membership_data` |
| 210 | `CAT-REC-030` | Paralelo Premium con menos de 4 cuotas pagadas, o Paralelo Especial con menos de 2 | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | `parallel_minimum_installments_not_met` |
| 220 | `CAT-REC-040` | Renovación con 2 créditos sin 50% pagado del crédito a cancelar o sin la segunda cuota pagada del crédito más reciente | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | `renewal_minimum_installments_not_met` |
| 230 | `CAT-REC-010` | Socio activo, buen comportamiento, mínimos de cuotas cumplidos y regla BCRA Premium cumplida | Aprobado | PRESENTACIÓN | AMEJUCA Premium Recurrentes | `amejuca_recurrent_premium` |
| 240 | `CAT-REC-020` | Socio que no cumple Premium Recurrentes pero podría acceder a línea común | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | `recurrent_requires_common_line_review` |

Los límites AMEJUCA son 60 años para mujeres y 65 para hombres. Las
dependencias/categorías específicas del manual y estos límites no producen rechazo
automático mientras el dato no sea estructurado y confiable. Un caso que podría
superarlos queda en revisión manual.

## Córdoba

Estado: reglas vigentes para Córdoba actualizadas al `2026-08-26`.

Precondición: negociación que ya superó provincia, situación laboral y banco de cobro
en la precalificación.

### Reglas comunes de CBU

`CBU Nuevos` y `CBU Recurrente` guardan `CBU` en el campo Línea. No existen los
subtipos históricos Propia ni Comer.

| Prioridad | Regla | Condición BCRA | Decisión | Etapa | Línea | Motivo |
|---:|---|---|---|---|---|---|
| 10 | `COR-CBU-DATA-010` | Snapshot faltante, inválido o inconcluso | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica | Datos BCRA insuficientes |
| 20 | `COR-CBU-010` | Más de 5 entidades | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Exceso de entidades |
| 30 | `COR-CBU-020` | Alguna entidad en situación mayor que 1 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Situación BCRA no admitida |
| 40 | `COR-CBU-030` | Banco de cobro en situación mayor que 1 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica | Banco de cobro no admitido |
| 50 | `COR-CBU-040` | Hasta 5 entidades, todas hasta situación 1, y banco de cobro hasta situación 1 | Aprobado | PRESENTACIÓN | CBU | CBU aprobada |

Antes de ejecutar un rechazo CBU se evalúan Caja, DASPU o UNC cuando la situación
laboral habilita alguna de esas familias. Para activos, los límites CBU son
60 años para mujeres y 65 para hombres; para pasivos, 80 años. Los límites que dependen
de sexo permanecen manuales hasta disponer de género confiable.

### Policía, Empleado Público Provincial, Docente, Empleado Público Municipal, Personal de Salud, Jubilado Nacional y Pensionado

Desde el 26/08/2026, Policía y Empleado Público Provincial utilizan las mismas reglas
CBU vigentes que los demás perfiles de esta sección. La existencia de préstamos Cruz
del Eje activos no cambia esta primera capa: el caso se evalúa igualmente como CBU.

| Prioridad | Regla | Condición | Evaluación | Resultado |
|---:|---|---|---|---|
| 300 | `COR-CBU-GEN-010` | Cliente nuevo o no socio | CBU Nuevos | Aplicar tabla CBU |
| 310 | `COR-CBU-GEN-020` | Socio sin crédito vigente | CBU Recurrente | Aplicar tabla CBU |
| 320 | `COR-CBU-GEN-030` | Crédito vigente que encuadra como recurrente | CBU Recurrente | Aplicar tabla CBU |
| 330 | `COR-CBU-GEN-040` | Condición de recurrencia o datos insuficientes | Revisión manual | Sin línea |

### Jubilado Provincial y Jubilado Municipal — Caja

Ambas situaciones laborales siguen las mismas reglas de Caja. La edad se calcula al
momento de clasificar. Desde los 80 años inclusive corresponde rechazo comercial.
Fecha de nacimiento faltante produce revisión manual.

| Prioridad | Regla | Perfil y condición | Decisión | Etapa | Línea |
|---:|---|---|---|---|---|
| 400 | `COR-CAJA-AGE-DATA-010` | Fecha de nacimiento faltante o inválida | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |
| 410 | `COR-CAJA-AGE-010` | 80 años o más | Rechazo comercial | NO CALIFICA COMERCIAL KESTRA, con fallback manual | No aplica |
| 420 | `COR-CAJA-DATA-010` | Menor de 80; snapshot BCRA faltante o inconcluso | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |
| 430 | `COR-CAJA-NEW-010` | Nuevo; solo situaciones 0/1 o sin entidades informadas | Aprobado | PRESENTACIÓN | Caja Nuevo |
| 440 | `COR-CAJA-NEW-020` | Nuevo; banco de cobro mayor que 1 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica |
| 450 | `COR-CAJA-IRREG-NEW-010` | Nuevo; banco de cobro hasta 1; otras entidades hasta 3 y al menos una en 2/3 | Aprobado | PRESENTACIÓN | Caja Irregulares |
| 460 | `COR-CAJA-GENERAL-010` | Recurrente; solo situaciones 0/1 o sin entidades informadas | Aprobado | PRESENTACIÓN | Caja General |
| 470 | `COR-CAJA-IRREG-REC-010` | Recurrente; todas las entidades hasta 3 y al menos una en 2/3, incluido banco de cobro | Aprobado | PRESENTACIÓN | Caja Irregulares |
| 480 | `COR-CAJA-MORA-BANK-010` | Nuevo o recurrente; alguna situación 4/5 y banco de cobro mayor que 1 | Rechazo BCRA | SIT. NEG. EN BCRA | No aplica |
| 490 | `COR-CAJA-MORA-REVIEW-010` | Alguna situación 4/5 en una entidad excluyente | Revisión manual exhaustiva | REVISIÓN MANUAL KESTRA | No aplica |
| 500 | `COR-CAJA-MORA-010` | Nuevo o recurrente; alguna situación 4/5; banco de cobro hasta 1; sin entidad excluyente | Aprobado | PRESENTACIÓN | Caja Morosos |

Entidades que fuerzan revisión exhaustiva en Caja Morosos:

- Cooperativa de Vivienda, Crédito, Consumo y Servicios Sociales Candelaria Ltda.;
- Banco del Sol S.A.;
- Credikot Cooperativa de Vivienda, Crédito y Consumo Ltda.;
- Asociación Mutual de Protección Familiar;
- Compañía Financiera Argentina S.A.;
- Firenze Cooperativa de Crédito, Consumo, Vivienda, Turismo y Servicios Asistenciales
  Ltda.

Préstamos paralelos con menos de una cuota pagada para Caja General, o menos de cuatro
para Caja Irregulares/Morosos, quedan en revisión manual. Caja Morosos no permite
refinanciación automática; si la necesita, queda en revisión manual.

### UNC y DASPU

| Prioridad | Regla | Perfil y condición | Decisión | Etapa | Línea |
|---:|---|---|---|---|---|
| 600 | `COR-DASPU-DATA-010` | Actividad, formulario 691 o cupo no verificables | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |
| 610 | `COR-DASPU-010` | Empleado activo de DASPU, formulario 691 válido y cupo mayor que 0 | Aprobado | PRESENTACIÓN | DASPU Haberes |
| 620 | `COR-UNC-DATA-010` | Actividad, edad, género o snapshot BCRA no verificables | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |
| 630 | `COR-UNC-BCRA-010` | Docente/no docente activo UNC con más de 3 entidades en situación 4/5 | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |
| 640 | `COR-UNC-BANK-010` | Banco Nación con mora o situación irregular | Revisión manual | REVISIÓN MANUAL KESTRA | No aplica |
| 650 | `COR-UNC-010` | Activo UNC dentro del límite etario y hasta 3 entidades en situación 4/5 | Aprobado | PRESENTACIÓN | Club Mutual CBU |

DASPU Haberes no tiene rechazo BCRA automático documentado. Para Club Mutual CBU,
cuatro o más entidades en situación 4/5 producen revisión manual, no rechazo. Los
límites de Club Mutual CBU son 60 años para mujeres y 65 para hombres; si el género o
la edad no son confiables, corresponde revisión manual.
