# Documentación Técnica de Marketing CRM

## Documentos vigentes

| Documento | Propósito |
|---|---|
| [`RUNTIME_ARCHITECTURE.md`](RUNTIME_ARCHITECTURE.md) | Flujo actual entre formulario, leads, negociaciones, Kestra y Bitrix24. |
| [`TECHNICAL_REFERENCE.md`](TECHNICAL_REFERENCE.md) | Campos, etapas, usuarios y fronteras técnicas conocidas. |
| [`FORM_WEBHOOK_API.md`](FORM_WEBHOOK_API.md) | Contrato del endpoint que crea contacto y lead. |
| [`COMMERCIAL_PREQUALIFICATION_API.md`](COMMERCIAL_PREQUALIFICATION_API.md) | Contrato de pre-elegibilidad sin persistencia. |
| [`CATAMARCA_DEAL_QUALIFICATION.md`](CATAMARCA_DEAL_QUALIFICATION.md) | Operación del clasificador de negociaciones Catamarca. |
| [`bcra-retry-policy.md`](bcra-retry-policy.md) | Estado persistente, backoff y reanudación automática de consultas BCRA. |
| [`PREQUALIFICATION_CUTOVER_2026-08-07.md`](PREQUALIFICATION_CUTOVER_2026-08-07.md) | Registro y runbook del corte de precalificación hacia Kestra. |

## Regla de mantenimiento

Las reglas comerciales no se duplican aquí. Cuando un documento técnico necesita
explicar una decisión, debe referenciar
[`../commercial-rules/`](../commercial-rules/README.md).

Los IDs y defaults documentados deben verificarse contra los flows y la configuración
de producción antes de una modificación operativa.
