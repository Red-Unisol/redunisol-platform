# System Flows

Aqui viven los flows tecnicos u operativos que no pertenecen a un dominio de
negocio especifico.

## Estado actual

- `alerta_flow_fallos.yaml`: observa las ejecuciones de produccion. Ante un
  `FAILED` delega en `alerta_flow_fallos_confirmar`; ante un `SUCCESS` registra
  la ejecucion como resuelta, cierra la alerta abierta y avisa la recuperacion.
- `alerta_flow_fallos_confirmar.yaml`: espera a que terminen los reintentos y
  recien entonces notifica a Bitrix24. Deduplica por KV store con TTL de 30 dias
  para no re-alertar el mismo flow en loop.

## Por que la alerta se confirma en un segundo flow

Con `retry` en una task, Kestra 2 publica `FAILED` a nivel ejecucion **antes**
de reintentar: el trigger no distingue ese estado transitorio del fallo
definitivo. Alertar en el acto genera avisos de ejecuciones que terminan bien.

La confirmacion espera `envs.alerta_espera_reintentos` (`PT45S` por defecto) y
luego busca la clave `alerta.flow_fallos.resuelta.<executionId>`, con TTL de una
hora. El observador la escribe al recibir el `SUCCESS`, que llega con el mismo
`executionId` de su `FAILED` transitorio. Si la clave existe, no hay alerta.

La espera vive en la confirmacion, no en el observador: ambos usan
`concurrency: 1`, y dormir dentro del observador bloquearia la misma cola que
debe registrar ese `SUCCESS`. La confirmacion tampoco consulta la API de Kestra,
que exige autenticacion y un secreto adicional en la infraestructura.

Un fallo definitivo de una ejecucion con reintentos publica un segundo `FAILED`
al agotarlos; esa confirmacion no encuentra la clave y alerta. Alertar queda
demorado por la espera, y un reintento que tarde mas que la ventana vuelve a
producir un aviso seguido de su recuperacion. Si Kestra deja de publicar el
`SUCCESS` con el mismo `executionId`, se pierde la supresion y se vuelve al
comportamiento anterior: avisa de mas, no de menos.

Para `redunisol.prod.analisis-credito/consulta_quiebra_credix`, la notificacion
se abre al alcanzar 3 ejecuciones distintas consecutivas en `FAILED`. Los
demas flows conservan la alerta desde el primer fallo confirmado. Se cuentan
eventos en el orden en que los procesa la confirmacion serializada
(`concurrency: 1`), no por el orden de inicio de las consultas concurrentes.

La clave `alerta.flow_fallos.racha.<namespace>.<flowId>` guarda hasta 3 IDs
fallidos, sin TTL; eventos repetidos de esos IDs no incrementan la racha.
Solo la incrementan los fallos confirmados: un `FAILED` transitorio cuyo
reintento termina bien ya no cuenta. Un `SUCCESS` borra la clave, incluso si la consulta respondio desde cache,
sin resultados o con un pedido invalido. Por eso mide fallos consecutivos
del flow, no disponibilidad exclusiva del portal CredixSA. La racha se
persiste antes de notificar: si falla el envio, el siguiente fallo vuelve
a intentar abrir la alerta. El marcador de alerta abierta se escribe solo
despues de enviar, y mantiene su deduplicacion y TTL de 30 dias.

Una recuperacion se envia solo cuando existe ese marcador; superar uno o
dos fallos y luego tener exito no envia mensajes. El primer exito tambien
cierra una alerta abierta con la politica anterior. Al instalar esta
politica la racha comienza vacia; no se reconstruye del historial.

Los filtros de triggers usan when (Kestra 2). Cada HTTP tiene timeout de
30 segundos y el flow un SLA de cancelacion a los 5 minutos. Una cola historica
atascada requiere recuperacion separada; no se vacia por actualizar el YAML.
Ver [runbook CredixSA](../../../automations/analisis-credito/docs/credixsa-recovery.md).

## Ambientes: este target se despliega solo a prod

A diferencia de los dominios de `kestra/automations/`, el target `system` **no
se despliega a dev**.

El motivo es que los triggers del flow filtran por
`NAMESPACE STARTS_WITH redunisol.prod.`. Una copia desplegada en
`redunisol.dev.system` no vigila dev: vigila **produccion**, igual que la de
prod. El resultado es que cada alerta llega dos veces al mismo chat de Bitrix, y
que la carga de ejecuciones sobre Postgres se duplica.

Si en algun momento se quiere alertar sobre flows de dev, el camino no es
desplegar esta misma copia a dev, sino darle al flow filtros propios por
ambiente.
