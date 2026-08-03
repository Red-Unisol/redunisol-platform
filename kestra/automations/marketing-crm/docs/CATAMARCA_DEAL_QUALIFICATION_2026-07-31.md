# Calificacion De Negociaciones Catamarca

Estado: implementado en rama, pendiente de merge y despliegue.

## Objetivo

Separar dos decisiones que antes ocurrian sobre el lead:

1. La precalificacion usa solamente provincia, situacion laboral y banco.
2. La calificacion comercial definitiva usa los datos enriquecidos y ocurre despues de crear la negociacion.

Kestra solo toma estas decisiones para leads con `Motor decision comercial = Kestra`.

## Circuito

```text
Lead en PRECLASIFICACION
        |
        | criterios locales, sin BCRA
        v
RESULTADO GANADO
        |
        v
Deal VENTAS
Etapa: PENDIENTE CALIFICACION KESTRA
Responsable provisional: Maru Lopez (57)
        |
        v
Calificacion definitiva Catamarca
        |-- aprobable -> PRESENTACION + vendedor definitivo + linea AMEJUCA
        |-- rechazo duro BCRA -> SIT. NEG. EN BCRA
        `-- dato insuficiente/regla ambigua -> REVISION MANUAL KESTRA
```

## Etapas Bitrix

- `C1:KESTRA_PENDING`: `PENDIENTE CALIFICACION KESTRA`
- `C1:KESTRA_REVIEW`: `REVISION MANUAL KESTRA`
- `C1:NEW`: `PRESENTACION`
- `C1:5`: `SIT. NEG. EN BCRA`

Las dos etapas Kestra fueron creadas por API sin mover negociaciones existentes.

## Reglas Automatizadas

- Socio recurrente (`Es socio = Si`) o persona con creditos activos: revision manual, sin aplicar rechazo BCRA automatico.
- Socio nuevo (`Es socio = No`): evaluar snapshot BCRA.
- Para socios nuevos, mas de cuatro entidades en situacion 4 o 5 en el periodo mas reciente: rechazo BCRA.
- Para socios nuevos, banco de cobro (Banco Nacion) en situacion mayor a 2: rechazo BCRA duro. Si Banco Nacion no aparece en el snapshot, equivale a situacion 0.
- Sin situaciones mayores a 1: `AMEJUCA Premium`.
- Si no corresponde rechazo duro ni `AMEJUCA Premium`: `AMEJUCA Especial`.
- Snapshot faltante o error de proveedor: revision manual.

## Distribucion

La negociacion nace asignada a Maru. Al aprobar:

- si el contacto tuvo una negociacion previa con alguien del pool, conserva ese vendedor;
- en otro caso se elige el vendedor con menor cantidad de negociaciones en los ultimos 30 dias;
- las recurrencias no incrementan artificialmente la carga del round-robin porque la eleccion usa la carga real ya asignada.

Pool actual: Daniel Carrera (`68579`), Patricia Contenti (`10451`), Natalia Rojo Moyano (`71159`) y Soledad Rojo Moyano (`90231`).

## Operacion

El flow `bitrix24_catamarca_deal_qualification` procesa una negociacion pendiente por minuto. Es idempotente por etapa: si la negociacion ya salio de `C1:KESTRA_PENDING`, no vuelve a decidir ni reasignar.
