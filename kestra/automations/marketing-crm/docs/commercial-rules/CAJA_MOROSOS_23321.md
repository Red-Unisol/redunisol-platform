# Caja Morosos — tarea 23321

Versión: `2026-10-13`. Estado: implementado y probado, pendiente de deploy.
Contrato registrado con el formato de `RULE_CHANGE_TEMPLATE.md`.

## Identificación y aprobación

- **Título:** máximo de ocho entidades para clientes nuevos de Caja Córdoba.
- **Provincia:** Córdoba.
- **Proceso:** clasificación de negociación.
- **Reglas:** `COR-CAJA-MORA-010` y nueva `COR-CAJA-MORA-NEW-LIMIT-010`.
- **Solicitante funcional:** Marketing, Maru Lopez, según la
  [tarea 23321](https://redunisol.bitrix24.es/company/personal/user/71283/tasks/task/view/23321/).
- **Aprobación de implementación:** Santiago Acosta, autorización explícita en la
  conversación del 13/10/2026 posterior al contraste con producción.
- **Fecha requerida:** antes de promover el cambio a producción; la tarea original
  exige pruebas con casos representativos.

## Decisión

Un Jubilado Provincial nuevo con BCRA 4/5 puede continuar por Caja Morosos hasta
ocho entidades totales; desde nueve corresponde rechazo BCRA. La admisión de nuevos
con 4/5 ya existía en producción; esta entrega agrega el límite faltante.

| Dato | Condición |
|---|---|
| Provincia | Córdoba |
| Situación laboral | Jubilado Provincial |
| Cliente nuevo | Sin créditos activos de la familia Caja, `linea_superior_id=2756`, según la definición vigente |
| Datos Vimarx | Disponibles; ausencia mantiene revisión manual |
| Edad | Menor de 80; ausencia mantiene revisión manual y desde 80 rechazo comercial |
| Banco de cobro | Identificable y hasta situación 1; ausencia mantiene revisión manual |
| Snapshot BCRA | Válido; período más reciente |
| Situaciones BCRA | Al menos una entidad en 4/5 |
| Cantidad de entidades | Total informado, no solo las entidades en 4/5; incluye el banco de cobro si aparece |
| Condiciones adicionales | Conserva revisión por entidades excluyentes y las demás condiciones vigentes de Caja |

## Resultado, prioridad y límites

- **Hasta ocho:** puede aprobar en PRESENTACIÓN, línea Caja Morosos, sujeto a las
  restantes condiciones.
- **Desde nueve:** `rejected`, etapa SIT. NEG. EN BCRA, sin línea, sin distribución
  ni transferencia de chat. Motivo auditable:
  `caja_morosos_new_more_than_eight_entities`.
- **Prioridad:** edad/datos y banco de cobro preceden al límite; el límite precede a
  revisión por entidades excluyentes y aprobación Morosos.
- **Faltan datos:** conserva la revisión manual vigente; no se infiere elegibilidad.
- **Fuera de alcance:** recurrentes Caja, Jubilado Municipal, Caja Nuevo,
  Caja Irregulares, CBU, otras provincias y otras líneas.
- **Pensionados:** la identificación Caja Córdoba/ANSES se resuelve separadamente en
  la [tarea 23333](https://redunisol.bitrix24.es/company/personal/user/71283/tasks/task/view/23333/).
  Hasta contar con esa identificación, Pensionado conserva su circuito CBU.

## Ejemplos y validación

- **Aprueba:** nuevo provincial menor de 80, ocho entidades, banco 1, otra entidad
  4/5 y sin exclusiones.
- **Rechazo BCRA:** mismo perfil con nueve entidades, aunque solo una tenga 4/5;
  también conserva rechazo por banco de cobro mayor que 1 con ocho o nueve.
- **Rechazo comercial:** persona de 80 años o más, por la regla de edad vigente.
- **Manual:** entidad excluyente en 4/5 dentro del límite, o datos imprescindibles
  ausentes.
- **Bordes:** ocho/nueve entidades; situaciones 4 y 5; banco 2/4/5; período antiguo
  con nueve y actual con ocho; perfiles fuera del alcance.
- **Casos normativos:** `COR-CASE-014A`, `COR-CASE-014B`, `COR-CASE-014C` y casos Caja
  previos de `ACCEPTANCE_CASES.md`.
- **Implementación:** evaluador Caja, motivo legible en trazas y reporte comercial,
  pruebas del circuito de calificación con cliente Bitrix simulado.
- **Origen y conversiones:** no modifica la precalificación web, los eventos Ads ni
  la persistencia de origen/UTM.
- **Despliegue y auditoría:** pendientes; no se reprocesan solicitudes históricas.
