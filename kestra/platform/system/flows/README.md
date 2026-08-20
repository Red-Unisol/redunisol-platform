# System Flows

Aqui viven los flows tecnicos u operativos que no pertenecen a un dominio de
negocio especifico.

## Estado actual

- `alerta_flow_fallos.yaml`: notifica a Bitrix24 cuando una ejecucion de
  produccion falla, y avisa cuando el flow vuelve a estar sano. Deduplica por KV
  store con TTL de 30 dias para no re-alertar el mismo flow en loop.

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
