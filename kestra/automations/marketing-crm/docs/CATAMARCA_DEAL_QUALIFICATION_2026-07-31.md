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

- Socio con al menos un credito activo: revision manual, porque faltan reglas estructuradas de cuotas, mora y cupo.
- No socio o persona sin creditos activos: evaluar snapshot BCRA.
- Mas de cuatro entidades en situacion 4 o 5 en el periodo mas reciente: rechazo BCRA.
- Banco Nacion en situacion mayor a 1: revision manual mientras la regla siga ambigua.
- Sin situaciones mayores a 1: `AMEJUCA Premium`.
- Con situaciones mayores a 1, hasta cuatro situaciones 4/5 y banco de cobro en situacion 1: `AMEJUCA Especial`.
- Snapshot faltante, error de proveedor o caso sin linea concluyente: revision manual.

## Distribucion

La negociacion nace asignada a Maru. Al aprobar:

- si el contacto tuvo una negociacion previa con alguien del pool, conserva ese vendedor;
- en otro caso se elige el vendedor con menor cantidad de negociaciones en los ultimos 30 dias;
- las recurrencias no incrementan artificialmente la carga del round-robin porque la eleccion usa la carga real ya asignada.

Pool actual: Daniel Carrera (`68579`), Patricia Contenti (`10451`), Natalia Rojo Moyano (`71159`) y Soledad Rojo Moyano (`90231`).

## Operacion

El flow `bitrix24_catamarca_deal_qualification` procesa una negociacion pendiente por minuto. Es idempotente por etapa: si la negociacion ya salio de `C1:KESTRA_PENDING`, no vuelve a decidir ni reasignar.
