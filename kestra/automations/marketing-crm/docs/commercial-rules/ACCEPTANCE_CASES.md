# Casos de Aceptación Comercial

Versión: `2026-08-11`

Cada caso expresa una expectativa verificable en formato Dado / Cuando / Entonces.
Un caso no reemplaza la tabla normativa de clasificación.

## Catamarca — implementado en PR #218, pendiente de deploy

### `CAT-CASE-001` — Premium limpio

- **Dado** un no socio con snapshot válido, banco de cobro en situación 1 y todas las
  entidades en situación 1.
- **Entonces** aplica `CAT-LINE-010` y queda en **PRESENTACIÓN**, línea `AMEJUCA
  Premium`.

### `CAT-CASE-002` — Una situación 2 también es Premium

- **Dado** un no socio con banco de cobro en situación 1 y una entidad en situación 2.
- **Entonces** aplica `CAT-LINE-010` y queda en `AMEJUCA Premium`.

### `CAT-CASE-003` — Límite Premium de situaciones 2

- **Dado** un no socio con banco de cobro en situación 2 y exactamente cinco entidades
  en situación 2.
- **Entonces** aplica `CAT-LINE-010` y queda en `AMEJUCA Premium`.

### `CAT-CASE-004` — Más de cinco situaciones 2 pasa a Especial

- **Dado** un no socio con banco de cobro en situación 1 y seis entidades en situación
  2.
- **Entonces** aplica `CAT-LINE-020` y queda en `AMEJUCA Especial`.

### `CAT-CASE-005` — Cruce ambiguo del banco de cobro

- **Dado** el mismo caso anterior, pero con banco de cobro en situación 2.
- **Entonces** aplica `CAT-LINE-030` y queda en **REVISIÓN MANUAL KESTRA**.

### `CAT-CASE-006` — Situación 3 es Especial

- **Dado** un no socio con banco de cobro en situación 1 y una entidad en situación 3.
- **Entonces** aplica `CAT-LINE-020` y queda en `AMEJUCA Especial`.

### `CAT-CASE-007` — Límite de entidades 4/5

- **Dado** un perfil con exactamente cuatro entidades en situación 4/5 y banco de
  cobro en situación 1.
- **Entonces** no se rechaza por cantidad y puede aplicar Especial.
- **Pero dado** el mismo perfil con cinco entidades en situación 4/5.
- **Entonces** aplica `CAT-BCRA-010` y queda en **SIT. NEG. EN BCRA**.

### `CAT-CASE-008` — Banco de cobro rechazado

- **Dado** un perfil cuyo banco de cobro está en situación 3.
- **Entonces** aplica `CAT-BCRA-020` y queda en **SIT. NEG. EN BCRA**.

### `CAT-CASE-009` — Rechazo duro también para socios

- **Dado** un socio con cinco entidades en situación 4/5.
- **Entonces** aplica `CAT-BCRA-010` antes que las reglas recurrentes.

### `CAT-CASE-010` — Premium Recurrentes

- **Dado** un socio activo, cuota social al día, cero días de atraso, cuotas vencidas
  pagadas y BCRA Premium.
- **Entonces** aplica `CAT-REC-010` y queda en **PRESENTACIÓN**, línea `AMEJUCA Premium
  Recurrentes`.

### `CAT-CASE-011` — Recurrencia incompleta

- **Dado** un socio cuya cuota social o comportamiento no puede verificarse.
- **Entonces** aplica `CAT-REC-DATA-010` y queda en **REVISIÓN MANUAL KESTRA**.

## Córdoba — implementado en PR #218, pendiente de deploy

### `COR-CASE-001` — CBU aprobado

- **Dado** un perfil CBU con cinco entidades, todas en situación 1, y banco de cobro en
  situación 1.
- **Entonces** aplica `COR-CBU-040` y queda en **PRESENTACIÓN**, línea `CBU`.

### `COR-CASE-002` — CBU con seis entidades

- **Dado** el mismo perfil con seis entidades.
- **Y** no existe otra familia comercial habilitada.
- **Entonces** aplica `COR-CBU-010` y queda en **SIT. NEG. EN BCRA**.

### `COR-CASE-003` — Cruz del Eje Premium

- **Dado** un Policía o Empleado Público Provincial sin préstamo Cruz del Eje activo y
  con todas las entidades en situación 1.
- **Entonces** aplica `COR-CDE-LINE-010`, queda en `Cruz del Eje` y registra categoría
  Premium.

### `COR-CASE-004` — Cruz del Eje Especial sin límite 2/3

- **Dado** el mismo perfil con diez entidades en situación 2 y ninguna en 4/5.
- **Entonces** aplica `COR-CDE-LINE-020` y registra categoría Especial.

### `COR-CASE-005` — Rechazo por entidades 4/5

- **Dado** un perfil Cruz del Eje con tres entidades en situación 4/5.
- **Entonces** aplica `COR-CDE-BCRA-010` y queda en **SIT. NEG. EN BCRA**.

### `COR-CASE-006` — Rechazo por Banco de Córdoba

- **Dado** un perfil Cruz del Eje con Banco de Córdoba en situación 2.
- **Entonces** aplica `COR-CDE-BANK-010` y queda en **SIT. NEG. EN BCRA**.

### `COR-CASE-007` — Préstamo CBU no bloquea Cruz del Eje

- **Dado** un Empleado Público Provincial socio con préstamo CBU activo, sin préstamo
  Cruz del Eje activo y con BCRA Premium.
- **Entonces** se evalúa Cruz del Eje común y queda aprobado.

### `COR-CASE-008` — REN Premium

- **Dado** un préstamo Cruz del Eje activo, cero días de atraso, cuotas vencidas
  pagadas y BCRA Premium.
- **Entonces** aplica `COR-CDE-REN-010`, queda en línea `Cruz del Eje` y registra
  categoría `REN Premium`.

### `COR-CASE-009` — Renovación con mora

- **Dado** un préstamo Cruz del Eje activo con mora.
- **Entonces** aplica `COR-CDE-MORA-010` y queda en **REVISIÓN MANUAL KESTRA** para
  resolver la deuda antes de evaluar una línea común.

### `COR-CASE-010` — Caja Nuevo sin entidades BCRA

- **Dado** un Jubilado Provincial o Municipal nuevo de 79 años con snapshot válido sin
  entidades.
- **Entonces** aplica `COR-CAJA-NEW-010` y queda en `Caja Nuevo`.

### `COR-CASE-011` — Caja Irregulares para nuevo

- **Dado** un Jubilado Provincial nuevo de 79 años, banco de cobro en situación 1 y
  otra entidad en situación 2.
- **Entonces** aplica `COR-CAJA-IRREG-NEW-010` y queda en `Caja Irregulares`.

### `COR-CASE-012` — Caja Irregulares para recurrente

- **Dado** un Jubilado Provincial recurrente de 79 años cuyo banco de cobro está en
  situación 2 y ninguna entidad supera situación 3.
- **Entonces** aplica `COR-CAJA-IRREG-REC-010` y queda en `Caja Irregulares`.

### `COR-CASE-013` — Caja General

- **Dado** un Jubilado Provincial recurrente de 79 años con todas las situaciones en
  0/1.
- **Entonces** aplica `COR-CAJA-GENERAL-010` y queda en `Caja General`.

### `COR-CASE-014` — Caja Morosos

- **Dado** un Jubilado Provincial de 79 años con una entidad en situación 4, banco de
  cobro en situación 1 y ninguna entidad excluyente.
- **Entonces** aplica `COR-CAJA-MORA-010` y queda en `Caja Morosos`.

### `COR-CASE-015` — Caja Morosos con entidad excluyente

- **Dado** el mismo caso cuya situación irregular pertenece a Banco del Sol.
- **Entonces** aplica `COR-CAJA-MORA-REVIEW-010` y queda en **REVISIÓN MANUAL KESTRA**.

### `COR-CASE-016` — Caja rechaza desde los 80

- **Dado** un Jubilado Provincial el día que cumple 80 años.
- **Entonces** aplica `COR-CAJA-AGE-010` y la decisión es rechazo comercial.
- **Y** usa el fallback manual hasta que exista **NO CALIFICA COMERCIAL KESTRA**.

### `COR-CASE-017` — DASPU Haberes

- **Dado** un empleado activo de DASPU con formulario 691 válido y cupo mayor que cero.
- **Entonces** aplica `COR-DASPU-010` y queda en **PRESENTACIÓN**, línea `DASPU
  Haberes`.

### `COR-CASE-018` — DASPU sin formulario

- **Dado** un empleado DASPU sin formulario 691 verificable.
- **Entonces** aplica `COR-DASPU-DATA-010` y queda en **REVISIÓN MANUAL KESTRA**.

### `COR-CASE-019` — Club Mutual CBU

- **Dado** un docente/no docente activo UNC dentro del límite etario, sin mora con
  Banco Nación y con tres entidades en situación 4/5.
- **Entonces** aplica `COR-UNC-010` y queda en **PRESENTACIÓN**, línea `Club Mutual
  CBU`.

### `COR-CASE-020` — UNC con cuatro entidades negativas

- **Dado** el mismo perfil con cuatro entidades en situación 4/5.
- **Entonces** aplica `COR-UNC-BCRA-010` y queda en **REVISIÓN MANUAL KESTRA**, no
  rechazado.

### `COR-CASE-021` — Datos insuficientes

- **Dado** cualquier negociación que necesita edad, afiliación, banco o BCRA para
  decidir y el dato no es confiable.
- **Entonces** queda en **REVISIÓN MANUAL KESTRA** y nunca se rechaza por presunción.
