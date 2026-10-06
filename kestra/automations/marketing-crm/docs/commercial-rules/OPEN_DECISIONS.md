# Decisiones Comerciales Pendientes

Versión: `2026-08-26`

## Estado

No quedan decisiones provinciales abiertas para las reglas AMEJUCA, CBU, Caja, DASPU
Haberes y Club Mutual CBU incluidas en la versión `2026-08-26`.

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
