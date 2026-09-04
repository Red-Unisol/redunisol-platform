# Policía Federal + CABA — circuito inicial 2026

## Alcance

Este cambio implementa únicamente el circuito inicial de la tarea Bitrix24 `22889`.

La combinación especial es:

- provincia: `Ciudad Autónoma de Buenos Aires` (`4145`)
- situación laboral: `Policía Federal` (`4165`)

El período se evalúa en `America/Argentina/Buenos_Aires` desde el 31 de agosto de
2026, inclusive, hasta el 14 de septiembre de 2026, exclusivo.

Durante ese período:

- cuenta como precalificación positiva para medición web y Meta;
- `route_to_whatsapp` es `false`;
- el formulario muestra el mismo resultado visible que cualquier rechazo;
- el lead se conserva y continúa por el enriquecimiento habitual;
- la clasificación CRM lo mueve a perdido/rechazado;
- se informa el motivo `POLICÍA FEDERAL CABA - PERÍODO INICIAL` (`4175`);
- no se genera negociación ni se asigna vendedor.

El email del segmento queda a cargo de una automatización de Bitrix24 que puede
usar el motivo `4175` como condición de entrada.

Fuera del período, Policía Federal + CABA conserva por ahora el rechazo general
por provincia. El circuito comercial posterior al 14 de septiembre se implementa
por separado y solo debe aplicar a presentaciones nuevas.

## Esquema Bitrix24

Los dos valores se crearon por REST el 25 de agosto de 2026, preservando los IDs
de todas las opciones existentes:

| Campo | Valor | ID |
| --- | --- | --- |
| `UF_CRM_1714071903` | `Policía Federal` | `4165` |
| `UF_CRM_REJECTION_REASON` | `POLICÍA FEDERAL CABA - PERÍODO INICIAL` | `4175` |

Estos IDs quedan versionados en el catálogo y en las pruebas del dominio.
