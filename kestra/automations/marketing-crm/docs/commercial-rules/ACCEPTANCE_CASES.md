# Casos de Aceptación Comercial

Versión: `2026-08-10`

## Cómo usar este documento

Cada caso expresa una expectativa verificable en formato **Dado / Cuando / Entonces**.
Negocio debe aprobar el resultado esperado. Tecnología debe convertir cada caso
aprobado en una prueba automatizada antes de implementar la regla.

Un caso no reemplaza la tabla de decisión: demuestra una fila concreta y sus límites.

## Catamarca — vigentes

### `CAT-CASE-001` — Premium

- **Dado** un no socio de Catamarca, sin créditos activos y con snapshot BCRA válido.
- **Y** todas las entidades están como máximo en situación 1.
- **Cuando** Kestra clasifica la negociación.
- **Entonces** aplica `CAT-LINE-010`.
- **Y** la negociación queda en **PRESENTACIÓN** con línea `AMEJUCA Premium`.

### `CAT-CASE-002` — Especial

- **Dado** un no socio de Catamarca, sin créditos activos y con snapshot BCRA válido.
- **Y** existe una entidad en situación 2.
- **Y** no existe ninguna condición de rechazo duro.
- **Cuando** Kestra clasifica la negociación.
- **Entonces** aplica `CAT-LINE-020`.
- **Y** la negociación queda en **PRESENTACIÓN** con línea `AMEJUCA Especial`.

### `CAT-CASE-003` — Banco Nación rechazado

- **Dado** un no socio de Catamarca, sin créditos activos y con snapshot BCRA válido.
- **Y** Banco Nación está en situación 3.
- **Cuando** Kestra clasifica la negociación.
- **Entonces** aplica `CAT-BCRA-030`.
- **Y** la negociación queda en **SIT. NEG. EN BCRA** sin línea.

### `CAT-CASE-004` — Límite de entidades negativas

- **Dado** un no socio de Catamarca y un snapshot con exactamente cuatro entidades en
  situación 4 o 5.
- **Entonces** no se rechaza por `CAT-BCRA-020`.
- **Pero dado** el mismo caso con cinco entidades en situación 4 o 5.
- **Entonces** aplica `CAT-BCRA-020` y queda en **SIT. NEG. EN BCRA**.

### `CAT-CASE-005` — Socio recurrente

- **Dado** un socio de Catamarca, aunque su snapshot cumpla una condición de rechazo
  BCRA.
- **Cuando** Kestra clasifica la negociación.
- **Entonces** aplica `CAT-MEMBER-010` antes que las reglas BCRA.
- **Y** la negociación queda en **REVISIÓN MANUAL KESTRA**.

## Córdoba — borradores para validación

### `COR-CASE-001` — CBU Nuevos aprobado

- **Dado** un empleado público provincial de Córdoba que no es socio.
- **Y** su snapshot contiene cinco entidades, todas en situación 1.
- **Y** su banco de cobro está en situación 1.
- **Cuando** se evalúa CBU Nuevos.
- **Entonces** aplica `COR-CBU-040`.
- **Y** la negociación queda en **PRESENTACIÓN** con línea `CBU`.

### `COR-CASE-002` — Límite de entidades CBU

- **Dado** el mismo caso con seis entidades, aunque todas estén en situación 1.
- **Entonces** aplica `COR-CBU-010`.
- **Y** la negociación queda en **SIT. NEG. EN BCRA**.

### `COR-CASE-003` — Situación no admitida en CBU

- **Dado** un docente de Córdoba no socio.
- **Y** una de sus entidades está en situación 2.
- **Cuando** se evalúa CBU Nuevos.
- **Entonces** aplica `COR-CBU-020`.
- **Y** la negociación queda en **SIT. NEG. EN BCRA**.

### `COR-CASE-004` — Policía Premium

- **Dado** un policía de Córdoba no socio y sin crédito vigente.
- **Y** todas sus entidades están en situación 1.
- **Cuando** se evalúa Cruz del Eje común.
- **Entonces** aplica `COR-POL-CDE-030`.
- **Y** la negociación queda en **PRESENTACIÓN** con línea `Cruz del Eje` y categoría
  Premium.

### `COR-CASE-005` — Policía con tres entidades negativas

- **Dado** un policía de Córdoba no socio y sin crédito vigente.
- **Y** tiene tres entidades en situación 4 o 5.
- **Cuando** se evalúa Cruz del Eje común.
- **Entonces** aplica `COR-POL-CDE-020`.
- **Y** la negociación queda en **SIT. NEG. EN BCRA**.

### `COR-CASE-006` — Renovación sin regla BCRA

- **Dado** un policía de Córdoba, socio, con crédito vigente y buen cumplimiento.
- **Cuando** corresponde analizar una renovación.
- **Entonces** aplica `COR-POL-REN-010`.
- **Y** la negociación queda en **REVISIÓN MANUAL KESTRA** porque BCRA REN no está
  definido.

### `COR-CASE-007` — Caja Nuevo

- **Dado** un jubilado provincial nuevo cuyo snapshot solamente contiene situación 1.
- **Cuando** se evalúa Caja Nuevo.
- **Entonces** aplica `COR-CAJA-NEW-010`.
- **Y** la negociación queda en **PRESENTACIÓN** con línea `Caja Nuevo`.

### `COR-CASE-008` — Caja con reglas superpuestas

- **Dado** un jubilado provincial recurrente, sin crédito vigente y con entidades en
  situación 2.
- **Cuando** se intenta elegir entre Caja General y Caja Irregulares.
- **Entonces** aplica `COR-CAJA-REC-010`.
- **Y** la negociación queda en **REVISIÓN MANUAL KESTRA** hasta definir la prioridad
  entre ambas líneas.

### `COR-CASE-009` — UNC

- **Dado** un empleado de la UNC que ya superó la precalificación.
- **Cuando** se clasifica su negociación.
- **Entonces** aplica `COR-UNC-010`.
- **Y** la negociación queda en **REVISIÓN MANUAL KESTRA** porque todavía no existe una
  regla de línea comercial.

### `COR-CASE-010` — Dato faltante

- **Dado** cualquier negociación de Córdoba que necesita BCRA para decidir.
- **Y** el snapshot está ausente o es inválido.
- **Cuando** Kestra intenta clasificarla.
- **Entonces** la negociación queda en **REVISIÓN MANUAL KESTRA**.
- **Y** nunca se aprueba ni rechaza por presunción.

### `COR-CASE-011` — CBU Recurrente unificado

- **Dado** un socio de Córdoba que encuadra como recurrente.
- **Cuando** se determina el tipo de evaluación CBU.
- **Entonces** se utiliza directamente `CBU Recurrente`.
- **Y** no se intenta clasificarlo como Propia ni Comer.
- **Y** se aplican las mismas reglas BCRA estrictas documentadas para CBU Nuevos.
