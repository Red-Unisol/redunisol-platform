# Vista General del Proceso Comercial

Versión: `2026-08-26`

Estado: vista explicativa. Las tablas de `DEAL_CLASSIFICATION.md` son normativas.

## Proceso completo

```mermaid
flowchart TD
    A[Ingreso y enriquecimiento] --> B{Precalificación}
    B -->|No elegible| C[RESULTADO PERDIDO<br/>con motivo]
    B -->|Derivación externa| D[Vendedor externo]
    B -->|Elegible interno| E[RESULTADO GANADO]
    E --> F[Crear negociación]
    F --> G[PENDIENTE CALIFICACIÓN KESTRA]
    G --> H{Clasificación comercial}
    H -->|Aprobado| I[PRESENTACIÓN<br/>con Línea]
    H -->|Rechazo BCRA explícito| J[SIT. NEG. EN BCRA]
    H -->|Rechazo comercial explícito| K[NO CALIFICA COMERCIAL KESTRA<br/>o fallback manual con Maru]
    H -->|Dato o regla insuficiente| L[REVISIÓN MANUAL KESTRA]
    I --> M[Distribución]
    J --> M
    L --> M
```

Antes de rechazar por una línea, Kestra evalúa las demás familias habilitadas. La
ausencia de datos nunca se interpreta como rechazo.

## Catamarca — AMEJUCA

```mermaid
flowchart TD
    A[Negociación Catamarca] --> B{Snapshot y banco<br/>identificables}
    B -->|No| R[REVISIÓN MANUAL KESTRA]
    B -->|Sí| C{Más de 4 entidades<br/>en situación 4/5}
    C -->|Sí| X[SIT. NEG. EN BCRA]
    C -->|No| D{Banco de cobro<br/>mayor que 2}
    D -->|Sí| X
    D -->|No| E{Socio recurrente}
    E -->|Sí| F{Afiliación, cuota social<br/>y comportamiento completos}
    F -->|No| R
    F -->|Sí y BCRA Premium| RP[PRESENTACIÓN<br/>AMEJUCA Premium Recurrentes]
    F -->|No cumple recurrente| R
    E -->|No| G{Cumple Premium}
    G -->|Sí| P[PRESENTACIÓN<br/>AMEJUCA Premium]
    G -->|No| H{Banco de cobro<br/>hasta situación 1}
    H -->|Sí y cumple Especial| S[PRESENTACIÓN<br/>AMEJUCA Especial]
    H -->|No o combinación ambigua| R
```

## Córdoba

```mermaid
flowchart TD
    A[Negociación Córdoba] --> B{Situación laboral}
    B -->|Policía, Público Provincial,<br/>Docente, Municipal, Salud,<br/>Jubilado Nacional o Pensionado| D[CBU]
    B -->|Jubilado Provincial<br/>o Municipal| E[Caja]
    B -->|DASPU| F[DASPU Haberes]
    B -->|UNC docente/no docente| G[Club Mutual CBU]

    D --> D2[BCRA y reglas completas CBU]

    E --> E1{Edad}
    E1 -->|Faltante| R[REVISIÓN MANUAL KESTRA]
    E1 -->|80 o más| RC[RECHAZO COMERCIAL]
    E1 -->|Menor de 80| E2{Nuevo o recurrente<br/>y BCRA}
    E2 -->|Nuevo limpio| N[Caja Nuevo]
    E2 -->|Nuevo, banco 1<br/>y otras 2/3| I[Caja Irregulares]
    E2 -->|Recurrente limpio| GA[Caja General]
    E2 -->|Recurrente 2/3| I
    E2 -->|4/5, banco limpio<br/>sin entidad excluyente| MO[Caja Morosos]
    E2 -->|Entidad excluyente<br/>o datos dudosos| R

    F --> F1{Activo, formulario 691<br/>y cupo positivo}
    F1 -->|Sí| DH[PRESENTACIÓN<br/>DASPU Haberes]
    F1 -->|No o dudoso| R

    G --> G1{Edad, actividad y BCRA<br/>verificables}
    G1 -->|Hasta 3 entidades 4/5<br/>sin mora Banco Nación| UC[PRESENTACIÓN<br/>Club Mutual CBU]
    G1 -->|No o dudoso| R
```

## Distribución

- Dentro del horario laboral, los casos aprobados y de revisión manual se distribuyen
  según su bucket.
- Fuera del horario laboral quedan con Maru para gestión manual.
- La distribución no modifica etapa, aprobación ni línea comercial.
