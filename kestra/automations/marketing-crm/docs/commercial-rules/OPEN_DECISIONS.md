# Decisiones Comerciales Pendientes

Versión: `2026-08-11`

## Estado

No quedan decisiones provinciales abiertas para las reglas AMEJUCA, CBU, Cruz del
Eje, Caja, DASPU Haberes y Club Mutual CBU incluidas en la versión `2026-08-11`.

Las decisiones cerradas y su fundamento están en `DECISION_LOG.md`. Cualquier caso no
cubierto explícitamente utiliza **REVISIÓN MANUAL KESTRA** y no debe resolverse por
inferencia durante la implementación.

## Transversal pendiente

| ID | Decisión requerida | Salida segura actual | Estado |
|---|---|---|---|
| `GEN-PEND-001` | Designar formalmente quién aprueba versiones funcionales por provincia. | Mantener la versión como acordada, sin promoverla a implementada hasta aprobación y pruebas. | Abierta |

## Dependencias de implementación — no son dudas comerciales

- crear y mapear la etapa Bitrix **NO CALIFICA COMERCIAL KESTRA**;
- obtener el catálogo exacto de nombres/códigos Vimarx que pertenecen a Cruz del Eje;
- identificar de forma confiable el banco de cobro dentro del snapshot BCRA;
- disponer de cuota social AMEJUCA estructurada;
- disponer de género confiable para límites etarios que dependen de sexo;
- estructurar actividad DASPU/UNC, formulario 691 y cupo disponible;
- confirmar los valores exactos del campo Línea en Bitrix para las líneas nuevas.
