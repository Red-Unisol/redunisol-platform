# Decisiones Comerciales Pendientes

Versión: `2026-08-26`

## Estado

No quedan decisiones provinciales abiertas para las reglas AMEJUCA, CBU, Caja, DASPU
Haberes y Club Mutual CBU incluidas en la versión `2026-08-26`.

Desde el 13/10/2026 existe una dependencia nueva, independiente del tope de entidades
de la tarea `23321`: identificar el organismo previsional de los pensionados.

| ID | Decisión requerida | Salida actual | Estado |
|---|---|---|---|
| `COR-PEND-PENSIONADOS-23333` | Distinguir pensionados de Caja Córdoba de ANSES por una fuente verificable; evaluar las integraciones CIDI/Caja existentes y definir casos ambiguos. | La categoría genérica Pensionado conserva CBU; no se presume Caja ni ANSES por errores o ausencia en un proveedor. | [Tarea 23333](https://redunisol.bitrix24.es/company/personal/user/71283/tasks/task/view/23333/), responsable Santiago Acosta. |

Las decisiones cerradas y su fundamento están en `DECISION_LOG.md`. Cualquier caso no
cubierto explícitamente utiliza **REVISIÓN MANUAL KESTRA** y no debe resolverse por
inferencia durante la implementación.

## Transversal pendiente

| ID | Decisión requerida | Salida segura actual | Estado |
|---|---|---|---|
| `GEN-PEND-001` | Designar formalmente quién aprueba versiones funcionales por provincia. | Mantener explícito el estado de aprobación y no desplegar cambios futuros sin validación funcional. | Abierta |

## Dependencias de implementación — no son dudas comerciales

- crear y mapear la etapa Bitrix **NO CALIFICA COMERCIAL KESTRA**;
- disponer de cuota social AMEJUCA estructurada;
- disponer de género confiable para límites etarios que dependen de sexo;
- estructurar actividad DASPU, formulario 691 y cupo disponible;
- auditar en producción los alias que vinculan el banco de cobro declarado con las
  entidades del snapshot BCRA.
