# System Flows

Aqui viven los flows tecnicos u operativos que no pertenecen a un dominio de
negocio especifico.

## Estado actual

- `alerta_flow_fallos.yaml`: notifica a Bitrix24 cuando una ejecucion de
  produccion falla, y avisa cuando el flow vuelve a estar sano. Deduplica por KV
  store con TTL de 30 dias para no re-alertar el mismo flow en loop.

Para `redunisol.prod.analisis-credito/consulta_quiebra_credix`, la notificacion
se abre al alcanzar 3 ejecuciones distintas consecutivas en `FAILED`. Los
demas flows conservan la alerta desde el primer fallo. Se cuentan eventos
en el orden en que los procesa el observador serializado (`concurrency: 1`),
no por el orden de inicio de las consultas concurrentes.

La clave `alerta.flow_fallos.racha.<namespace>.<flowId>` guarda hasta 3 IDs
fallidos, sin TTL; eventos repetidos de esos IDs no incrementan la racha.
Un `SUCCESS` vacia la lista, incluso si la consulta respondio desde cache,
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
