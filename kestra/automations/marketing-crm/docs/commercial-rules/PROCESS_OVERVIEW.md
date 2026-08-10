# Vista General del Proceso Comercial

Versión: `2026-08-10`

Estado: vista explicativa del modelo objetivo. Las tablas de decisión son la
especificación normativa.

Actualmente Catamarca ejecuta el ciclo completo de clasificación sobre la negociación.
Córdoba todavía crea la negociación directamente en PRESENTACIÓN; su paso por
PENDIENTE CALIFICACIÓN KESTRA corresponde al diseño que se está validando y aún no fue
implementado.

## Proceso completo

```mermaid
flowchart TD
    A[Ingreso del lead] --> B[Enriquecimiento]
    B --> C{Precalificación}
    C -->|No elegible| D[RESULTADO PERDIDO<br/>con motivo]
    C -->|Derivación externa| E[Vendedor externo<br/>sin negociación interna]
    C -->|Elegible interno| F[RESULTADO GANADO]
    F --> G[Crear negociación]
    G --> H[PENDIENTE CALIFICACIÓN KESTRA]
    H --> I{Clasificación comercial}
    I -->|Aprobado| J[PRESENTACIÓN<br/>con Línea]
    I -->|Rechazo BCRA explícito| K[SIT. NEG. EN BCRA]
    I -->|Dato o regla insuficiente| L[REVISIÓN MANUAL KESTRA]
    J --> M{Distribución}
    K --> M
    L --> M
    M -->|Dentro de horario| N[Bucket y vendedor]
    M -->|Fuera de horario| O[Maru<br/>sin distribución automática]
```

## Lectura por responsabilidad

```mermaid
flowchart LR
    A[Precalificación] -->|Autoriza negociación| B[Clasificación comercial]
    B -->|Define etapa y línea| C[Distribución]
    C -->|Define responsable y chat| D[Gestión comercial]
```

- **Precalificación** no elige vendedores ni líneas.
- **Clasificación comercial** no elige vendedores.
- **Distribución** no cambia aprobación, etapa comercial ni línea.

## Clasificación de Córdoba — vista resumida

Estado: **borrador para validación; no implementado**.

```mermaid
flowchart TD
    A[Negociación Córdoba<br/>ya precalificada] --> B{Situación laboral}

    B -->|Policía o<br/>Empleado Público Provincial| D{Condición comercial}
    B -->|Docente, Municipal, Salud,<br/>Jubilado Nacional o Pensionado| E{Condición comercial}
    B -->|Jubilado Provincial| F{Condición comercial}
    B -->|UNC o DASPU| R[REVISIÓN MANUAL KESTRA]

    E -->|Nuevo o no socio| G
    E -->|Recurrente| H
    E -->|No encuadra o faltan datos| R

    G --> I{Regla BCRA CBU}
    H --> I
    I -->|Aprueba| P[PRESENTACIÓN<br/>Línea CBU]
    I -->|Rechazo explícito| Q[SIT. NEG. EN BCRA]
    I -->|Datos insuficientes| R

    D -->|Sin préstamo activo<br/>Cruz del Eje| K[Cruz del Eje]
    D -->|Con préstamo activo<br/>Cruz del Eje| J{Renovación, paralelo<br/>o mora}
    J --> R
    K --> L{Regla BCRA Cruz del Eje}
    L -->|Premium o Especial válido| S[PRESENTACIÓN<br/>Línea Cruz del Eje]
    L -->|Más de 2 entidades en 4/5| Q
    L -->|Condición pendiente| R

    F -->|Cliente nuevo| M[Caja Nuevo]
    F -->|Recurrente| N[Caja General / Irregulares / Morosos]
    F -->|Crédito vigente o condición ambigua| R
    M -->|Solo situación 1| T[PRESENTACIÓN<br/>Línea Caja Nuevo]
    M -->|No cumple o faltan datos| R
    N -->|Selección todavía no definida| R
```

Para Policía y Empleado Público Provincial, ser socio o tener préstamos activos de
líneas CBU propias no cambia el camino: siempre se evalúan por Cruz del Eje. Solamente
un préstamo activo de una línea Cruz del Eje habilita el análisis de renovación,
paralelo o mora de esa familia.

Esta vista muestra dónde están las decisiones, pero no contiene todos los límites ni
prioridades. Para aprobar o implementar Córdoba se debe revisar
[`DEAL_CLASSIFICATION.md`](DEAL_CLASSIFICATION.md),
[`ACCEPTANCE_CASES.md`](ACCEPTANCE_CASES.md) y
[`OPEN_DECISIONS.md`](OPEN_DECISIONS.md).
