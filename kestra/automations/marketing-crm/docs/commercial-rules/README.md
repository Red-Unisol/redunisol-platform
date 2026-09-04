# Reglas Comerciales Compartidas

Versión documental: `2026-08-26`

## Propósito

Esta carpeta es el punto de encuentro entre Marketing, Comercial, Operaciones y
Tecnología para definir cómo se procesan los leads y las negociaciones en Bitrix24.

La documentación está organizada en distintos niveles de abstracción para que una
misma decisión pueda revisarse sin necesidad de leer código:

1. este documento explica el proceso y los límites de cada responsabilidad;
2. las tablas de decisión definen el comportamiento comercial exacto;
3. los casos de aceptación muestran ejemplos concretos y verificables;
4. las decisiones pendientes hacen visible todo lo que todavía no puede automatizarse;
5. la documentación técnica existente vincula las reglas con Bitrix24 y Kestra.

## Fuente de verdad

La fuente de verdad funcional son las **tablas de decisión aprobadas** de
[`DEAL_CLASSIFICATION.md`](DEAL_CLASSIFICATION.md).

Los diagramas ayudan a conversar sobre el proceso, pero no reemplazan las tablas. Un
diagrama puede omitir condiciones, prioridades o datos faltantes para mantenerse
legible.

El código de `main` y el runtime verificado son la fuente de verdad del comportamiento
desplegado. Una rama o PR puede contener una implementación todavía no desplegada; ese
estado debe declararse explícitamente. Si una tabla aprobada y producción no coinciden,
existe una desviación que debe corregirse o documentarse.

## Documentos

| Documento | Audiencia | Para qué sirve |
|---|---|---|
| [`PROCESS_OVERVIEW.md`](PROCESS_OVERVIEW.md) | Todos | Explica visualmente el proceso y sus responsabilidades. |
| [`GLOSSARY.md`](GLOSSARY.md) | Todos | Define términos y resultados permitidos. |
| [`DEAL_CLASSIFICATION.md`](DEAL_CLASSIFICATION.md) | Negocio y Tecnología | Contiene las reglas de clasificación de negociaciones. |
| [`DEAL_ROUTING.md`](DEAL_ROUTING.md) | Negocio y Tecnología | Contiene los buckets acordados de distribución. |
| [`ACCEPTANCE_CASES.md`](ACCEPTANCE_CASES.md) | Negocio, QA y Tecnología | Permite validar las reglas mediante ejemplos concretos. |
| [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md) | Business owners y Tecnología | Enumera las decisiones y dependencias que todavía bloquean automatizaciones. |
| [`DECISION_LOG.md`](DECISION_LOG.md) | Todos | Conserva las decisiones cerradas y su impacto en las reglas. |
| [`RULE_CHANGE_TEMPLATE.md`](RULE_CHANGE_TEMPLATE.md) | Quien solicite un cambio | Formato obligatorio para proponer o modificar una regla. |

Documentación técnica complementaria:

- [`../technical/RUNTIME_ARCHITECTURE.md`](../technical/RUNTIME_ARCHITECTURE.md): arquitectura vigente;
- [`../technical/PREQUALIFICATION_CUTOVER_2026-08-07.md`](../technical/PREQUALIFICATION_CUTOVER_2026-08-07.md): corte operativo de precalificación;
- [`../technical/CATAMARCA_DEAL_QUALIFICATION.md`](../technical/CATAMARCA_DEAL_QUALIFICATION.md): implementación técnica de Catamarca.

## Separación de responsabilidades

Las reglas se dividen en tres decisiones independientes:

| Momento | Pregunta que responde | Resultado principal |
|---|---|---|
| Precalificación del lead | ¿El caso puede continuar y generar una negociación? | Ganado, perdido o derivación externa. |
| Clasificación de la negociación | ¿Qué evaluación comercial corresponde? | Etapa de negociación y línea comercial. |
| Distribución | ¿Quién debe atender la negociación? | Bucket, responsable y transferencia de chat. |

Una regla de distribución nunca debe modificar la conclusión comercial. Una regla de
clasificación nunca debe elegir un vendedor.

## Estados documentales

Cada conjunto de reglas debe usar uno de estos estados:

- **Vigente e implementado:** está aprobado y coincide con producción.
- **Acordado, pendiente de implementación:** fue aprobado pero el runtime todavía no
  lo ejecuta.
- **Implementado, pendiente de deploy:** existe código y pruebas en una rama o PR, pero
  producción todavía no fue actualizada ni auditada.
- **Borrador para validación:** permite conversar, pero no autoriza implementación.
- **Pendiente de definición:** no existe una decisión comercial suficiente.
- **Histórico:** conserva contexto, pero no debe usarse para cambios nuevos.

## Convenciones de las tablas

- Cada regla tiene un identificador estable, por ejemplo `CAT-BCRA-010`.
- Las reglas se evalúan por prioridad ascendente.
- `Cualquiera` significa que el valor no modifica esa regla.
- `Desconocido` significa que el dato no está disponible o no es confiable.
- `No aplica` significa que el concepto no corresponde al caso.
- Una celda vacía no tiene significado válido y no debe utilizarse.
- Cada fila debe producir un único resultado.
- Si dos reglas pueden aplicar al mismo caso, debe definirse cuál tiene prioridad.
- Si falta un dato imprescindible, el resultado seguro es **REVISIÓN MANUAL KESTRA**;
  nunca se presume una aprobación ni un rechazo.

## Flujo de aprobación y cambio

1. El solicitante completa [`RULE_CHANGE_TEMPLATE.md`](RULE_CHANGE_TEMPLATE.md).
2. Negocio revisa las condiciones, los límites y los ejemplos, no el código.
3. Toda pregunta sin respuesta se registra en [`OPEN_DECISIONS.md`](OPEN_DECISIONS.md).
4. El business owner aprueba una versión concreta de la tabla y sus casos de
   aceptación.
5. Tecnología implementa cada regla conservando su identificador.
6. Los casos de aceptación se transforman en pruebas automatizadas.
7. Después del deploy se auditan casos reales y se registra la fecha de verificación.

Una conversación por chat puede iniciar un cambio, pero no constituye aprobación por
sí sola. La decisión final debe quedar incorporada a estos documentos y asociada a una
versión.

## Registro de aprobación

| Versión | Alcance | Estado | Aprobación funcional | Implementación |
|---|---|---|---|---|
| 2026-08-26 | Córdoba: Policía y Público Provincial a CBU | Acordado e implementado | Tarea Bitrix24 `22895` y definición comercial complementaria | PR de tarea `22895` |
| 2026-08-11 | Catamarca | Implementado, pendiente de deploy | Criterios incorporados; aprobador formal pendiente de registrar | PR #218; producción conserva la versión anterior |
| 2026-08-11 | Córdoba | Implementado, pendiente de deploy | Criterios incorporados; aprobador formal pendiente de registrar | PR #218 |
| 2026-08-10 | Distribución de negociaciones | Implementado, pendiente de deploy | Criterio acordado | PR #218 |
