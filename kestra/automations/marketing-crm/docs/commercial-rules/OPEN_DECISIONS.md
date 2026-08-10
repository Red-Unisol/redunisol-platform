# Decisiones Comerciales Pendientes

Versión: `2026-08-10`

## Uso

Esta lista contiene preguntas que deben responder los business owners antes de
automatizar las ramas afectadas. Mientras una decisión permanezca abierta, Kestra
debe usar la salida segura indicada y no inferir el comportamiento.

Para cerrar una decisión se debe registrar:

- respuesta exacta;
- nombre del business owner que la aprueba;
- fecha de aprobación;
- ejemplos de borde;
- reglas y casos de aceptación modificados.

## Córdoba

| ID | Decisión requerida | Ejemplo que debe resolverse | Salida segura actual | Estado |
|---|---|---|---|---|
| `COR-PEND-003` | ¿Cuáles son las reglas BCRA completas para REN Premium y REN Especial? | Policía con renovación y situación 2. | REVISIÓN MANUAL KESTRA | Abierta |
| `COR-PEND-004` | En Cruz del Eje Especial, ¿hay un límite para entidades en situación 2 o 3? | Diez entidades en situación 2 y ninguna en 4/5. | REVISIÓN MANUAL KESTRA | Abierta |
| `COR-PEND-005` | ¿Banco de Córdoba en situación 2 o superior siempre impide Cruz del Eje? ¿Se identifica por entidad BCRA o por banco declarado? | Policía cuyo snapshot contiene Banco de Córdoba en situación 2. | REVISIÓN MANUAL KESTRA | Abierta |
| `COR-PEND-006` | ¿Qué diferencia comercial elige Caja General frente a Caja Irregulares cuando ambas admiten situaciones 2 o 3? | Jubilado recurrente con una entidad en situación 2. | REVISIÓN MANUAL KESTRA | Abierta |
| `COR-PEND-007` | ¿Cómo se decide Caja Morosos y qué ocurre si la irregularidad corresponde a Bancor o Macro? | Jubilado recurrente con situación 4 en Bancor. | REVISIÓN MANUAL KESTRA | Abierta |
| `COR-PEND-008` | ¿Qué etapa final debe usarse para “rechazo por análisis”? | Renovación con mal cumplimiento. | REVISIÓN MANUAL KESTRA | Abierta |
| `COR-PEND-009` | Para un préstamo activo de Cruz del Eje, ¿qué datos y umbrales definen renovación, paralelo, mora y cumplimiento mínimo? | Policía con un préstamo Cruz del Eje activo y tres cuotas pagadas. | REVISIÓN MANUAL KESTRA | Abierta |
| `COR-PEND-010` | ¿Qué línea y reglas BCRA corresponden a Empleado de la UNC y DASPU? | Empleado UNC, no socio, BCRA limpio. | REVISIÓN MANUAL KESTRA | Abierta |
| `COR-PEND-011` | ¿“Solo situación 1” admite un snapshot sin entidades o con situación 0? | Jubilado nuevo sin entidades informadas. | REVISIÓN MANUAL KESTRA | Abierta |
| `COR-PEND-012` | ¿La categoría Premium/Especial de Cruz del Eje debe persistirse en otro campo o solo como motivo auditable? | Policía aprobado como Especial. | Guardar línea `Cruz del Eje`; categoría solo en motivo | Abierta |
| `COR-PEND-013` | ¿Qué valores o códigos de línea de Vimarx identifican un préstamo como Cruz del Eje? | Socio con préstamos activos CBU y Cruz del Eje. | REVISIÓN MANUAL KESTRA si no puede identificarse la línea | Abierta |

## Transversales

| ID | Decisión requerida | Salida segura actual | Estado |
|---|---|---|---|
| `GEN-PEND-001` | Definir quién puede aprobar versiones funcionales por provincia. | No promover borradores a “acordado”. | Abierta |
| `GEN-PEND-002` | Definir el SLA y la persona responsable de los casos en REVISIÓN MANUAL KESTRA. | Mantener el caso visible sin cierre automático. | Abierta |
| `GEN-PEND-003` | Definir si una línea sugerida debe escribirse durante la revisión manual o permanecer vacía. | Mantener Línea vacía y registrar la sugerencia en el resultado auditable. | Abierta |
