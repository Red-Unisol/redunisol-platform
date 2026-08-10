# Documentación de Marketing CRM

Este índice separa la documentación normativa, la operación técnica y la evidencia
histórica. No deben utilizarse documentos de `archive/`, `audits/` o `reports/` para
definir comportamiento nuevo.

## Fuente de verdad funcional

[`commercial-rules/README.md`](commercial-rules/README.md) contiene las reglas
comerciales compartidas, sus estados de aprobación, casos de aceptación, decisiones
pendientes y registro de decisiones cerradas.

La clasificación y la distribución solo pueden modificarse desde esa carpeta.

## Operación técnica

[`technical/README.md`](technical/README.md) contiene contratos HTTP, arquitectura del
runtime, configuración conocida y runbooks operativos.

Estos documentos explican cómo se ejecuta una regla, pero no pueden introducir una
decisión comercial que no exista en `commercial-rules/`.

## Evidencia histórica

- `archive/`: notas técnicas de implementaciones anteriores que pueden servir para
  auditoría.
- `audits/`: relevamientos de datos y configuración observada.
- `reports/`: informes operativos y de management.

Git conserva el historial de los borradores funcionales eliminados. No se mantienen
copias activas porque contenían reglas superadas y aparecían en búsquedas junto a la
especificación vigente.
