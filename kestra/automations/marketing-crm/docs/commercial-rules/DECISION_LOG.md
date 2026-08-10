# Registro de Decisiones Comerciales

Versión: `2026-08-10`

Este documento conserva decisiones funcionales cerradas para evitar que conceptos
históricos vuelvan a incorporarse por error.

## `COR-DEC-001` — Unificar CBU Recurrente

- **Fecha:** 2026-08-10
- **Estado:** Acordado, pendiente de implementación junto con la clasificación de
  Córdoba.
- **Decisión:** `CBU Comer Recurrente` no entra en ningún caso y se elimina de la
  especificación.
- **Nombre resultante:** la categoría restante se denomina `CBU Recurrente`; se elimina
  también la palabra `Propia`.
- **Regla BCRA:** máximo cinco entidades, ninguna situación mayor que 1 y banco de
  cobro como máximo en situación 1.
- **Resultado aprobado:** etapa **PRESENTACIÓN**, línea `CBU`.
- **Resultado que incumple BCRA:** etapa **SIT. NEG. EN BCRA**, sin línea.
- **Datos insuficientes:** etapa **REVISIÓN MANUAL KESTRA**, sin línea.
- **Decisiones cerradas:** `COR-PEND-001` y `COR-PEND-002`.

Esta decisión elimina cualquier referencia funcional al cálculo “cupo afectado al
0,1”. Los documentos de junio y julio que todavía mencionan Propia o Comer se conservan
únicamente como antecedentes históricos y no son normativos.
