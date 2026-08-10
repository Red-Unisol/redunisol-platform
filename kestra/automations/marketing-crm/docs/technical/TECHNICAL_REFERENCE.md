# Referencia Técnica de Bitrix24 y Kestra

Versión: `2026-08-10`

Esta referencia consolida datos técnicos que antes estaban mezclados con borradores
funcionales. Los defaults pueden ser reemplazados por variables del runtime; antes de
una operación se deben verificar los flows y el ambiente desplegado.

## Leads

| Concepto | Identificador o default |
|---|---|
| INGRESO | `UC_5N2OEO` |
| PRECLASIFICACIÓN | `NEW` |
| RESULTADO GANADO | Configuración `BITRIX24_LEAD_STATUS_QUALIFIED` |
| RESULTADO PERDIDO | Configuración `BITRIX24_LEAD_STATUS_REJECTED` |
| NEGOCIACIÓN CON VENDEDOR | `13` |
| CONVERTIDO | `CONVERTED` |
| Motor de decisión comercial | `UF_CRM_COMM_OWNER` |
| CUIL | `UF_CRM_1693840106704` |
| Situación laboral | `UF_CRM_1714071903` |
| Banco de cobro | `UF_CRM_LEAD_1711458190312` |
| Provincia | `UF_CRM_64E65D2B2136C` |
| Origen del formulario | `UF_CRM_1722365051` |
| Motivo de rechazo | `UF_CRM_REJECTION_REASON` |
| Es socio | `UF_CRM_1728998183` |
| Cantidad de créditos activos Vimarx | `UF_CRM_VIMARX_CRED_ACT_CNT` |
| Intentos de prefill | `UF_CRM_KSTRA_BF_ATTEMPTS` |

Los campos de snapshot BCRA se resuelven por configuración de runtime y no tienen un
default confiable en Git; no deben copiarse desde documentos históricos.

## Negociaciones VENTAS

| Concepto | Identificador o default |
|---|---|
| Pipeline VENTAS | Categoría `1` |
| PRESENTACIÓN | `C1:NEW` |
| PENDIENTE CALIFICACIÓN KESTRA | `C1:KESTRA_PENDING` |
| REVISIÓN MANUAL KESTRA | `C1:KESTRA_REVIEW` |
| REVISIÓN DE ENRUTAMIENTO KESTRA | `C1:KESTRA_ROUTE_REVIEW` |
| SIT. NEG. EN BCRA | `C1:5` |
| Línea | `ufCrm_659EBB0445E8E` |
| Bucket de distribución | `ufCrmRouteBucket` |

## Usuarios utilizados por la automatización

| Usuario | ID | Uso actual o acordado |
|---|---:|---|
| Maru López | `57` | Responsable provisional y fallback manual. |
| Diego Frías | `7` | Excluido de la precalificación automática. |
| Susana Contenti | `29` | Pools comerciales. |
| Patricia Contendi | `10451` | Pools comerciales. |
| Gloria Fernández | `53121` | Bucket Córdoba UNC/DASPU propuesto. |
| Daniel Carrera | `68579` | Pools comerciales. |
| Natalia Rojo Moyano | `71159` | Pools comerciales. |
| Nancy Romina Spengler | `74365` | Bucket Córdoba Público/Policía propuesto. |
| Soledad Rojo Moyano | `90231` | Pools comerciales. |
| Agustín Villagra | `110059` | Bucket Córdoba Jubilados propuesto. |
| Daniela Arias | `113455` | Pool Catamarca. |
| Claudia Algarbe | `113457` | Pool Catamarca. |

Los buckets propuestos y sus órdenes completos se encuentran en
[`../commercial-rules/DEAL_ROUTING.md`](../commercial-rules/DEAL_ROUTING.md).
