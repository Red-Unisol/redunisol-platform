# Pase a Respuesta por WhatsApp activo

Tarea Bitrix 22903. `bitrix24_deal_chat_response` revisa cada dos minutos las
negociaciones de categoría 1 en Presentación (`C1:NEW`) y Revisión Manual
(`C1:KESTRA_REVIEW`). Sólo escribe `stageId = C1:UC_ZH5DGU` (Respuesta).

## Decisión comercial

La clasificación guarda `approved`, `manual_review`, `rejected` o
`commercial_rejected` en `UF_CRM_K_COMM_DECISION` (`ufCrmKCommDecision` en
`crm.item`). Se persiste antes de sacar la negociación de Pendiente Calificación.
Si falla la escritura, la clasificación no continúa. La cola de distribución
conserva este campo.

Las escrituras usan el nombre original `UF_CRM_K_COMM_DECISION` y
`useOriginalUfNames: Y`, con lectura posterior obligatoria: en este portal se
verificó que escribir el nombre camelCase podía devolver éxito sin guardarlo.

Revisión Manual también puede contener rechazos comerciales: no se debe inferir
aprobación a partir de la etapa, el vendedor o la existencia de chat. Sólo
`approved` y `manual_review` habilitan el cambio; campo vacío o desconocido omite
el caso. La automatización no vuelve a consultar BCRA/Vimarx ni decide crédito.

Crear el campo antes de publicar los archivos que lo escriben:

```powershell
$env:PYTHONPATH='kestra/automations/marketing-crm/files'
python -m bitrix24_form_flow.provision_deal_commercial_decision
```

Usa las variables Bitrix habituales del runtime. La provisión es idempotente,
rechaza tipos incompatibles y no se ejecuta desde el scheduler.

## Conversación y concurrencia

Consulta chats activos vinculados a negociación, lead o contacto; deduplica por
chat. Exige conector `whatsappbyedna`, Canal Abierto VENTAS (`1`), sesión presente
y escritura habilitada por Bitrix. No inicia sesiones, envía mensajes, acepta
conversaciones ni cambia responsables. Una sesión histórica o de otro canal no
habilita el cambio.

El cambio de etapa sí dispara los robots existentes de Bitrix. Al publicar se
revisó la plantilla 135 de Respuesta: contiene el correo «¿Seguimos con tu
solicitud?», no una apertura de WhatsApp. Esta implementación no modifica ese
robot ni sus condiciones de envío.

Relee etapa, decisión, vínculos y fecha de modificación inmediatamente antes de
escribir. Cualquier cambio durante la inspección omite el caso. Bitrix REST no
ofrece una actualización condicional de versión en este método: hay una pequeña
ventana residual entre lectura y escritura. No es un bloqueo sobre el asesor.

El flow permite una ejecución y cancela nuevas tandas si la anterior sigue
activa. Recorre todas las páginas por ID creciente; mover registros fuera del
filtro no saltea otros. El presupuesto es diez minutos por barrido y doce para
la tarea completa. Si el volumen supera ese presupuesto se registra un fallo,
no un éxito incompleto; revisar capacidad antes de aumentar concurrencia.

Ritmo máximo local aproximado: 1,8 llamadas/segundo. Sólo las lecturas transitorias
tienen hasta tres intentos con espera. Una escritura de resultado incierto se
verifica por lectura y nunca se repite a ciegas. Un caso fallido no impide atender
los siguientes; el resultado conserva los IDs, motivos y conteos, sin textos de
clientes. La ejecución falla al terminar si hubo errores, para usar las alertas
existentes. Las siguientes tandas reevalúan el estado actual.

## Negociaciones anteriores a la incorporación del campo

No convertir valores vacíos en aprobaciones. Se pueden recuperar decisiones de
las salidas originales de Kestra para los casos todavía en las dos etapas de
origen: validar namespace/flow, ID de negociación y lead, decisión explícita,
etapa resultante y ausencia de modificaciones posteriores. Releer el registro
antes de escribir exclusivamente el campo nuevo. Conservar ejecución fuente,
valor aplicado y omisiones en el artefacto privado de la intervención.

Un caso sin evidencia concluyente conserva su etapa hasta una revisión explícita.
Esta recuperación no debe recalificar ni reproducir ejecuciones históricas.

## Publicación y verificación

Subir primero los namespace files nuevos, después los consumidores modificados y
por último el flow con su cron. Verificar el tipo y el nombre camelCase del campo
mediante `crm.item.fields`, los archivos activos y una ejecución real. El despliegue
de desarrollo elimina el cron por `schedule_scope: prod_only`.

Para detener la automatización, deshabilitar su flow desde una revisión Git y
publicarla; conservar el campo y las decisiones registradas. No revertir etapas
en masa, porque el asesor puede haber continuado la gestión.
