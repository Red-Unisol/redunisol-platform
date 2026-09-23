# System Flows

Aqui viven los flows tecnicos u operativos que no pertenecen a un dominio de
negocio especifico.

## Alertas: observador, temporizador y gestor unico

- `alerta_flow_fallos.yaml` recibe los eventos `FAILED` y `SUCCESS` de prod,
  excluyendo el propio namespace `system`. Conserva `concurrency: 1` y entrega
  cada evento al gestor con `wait: true`, preservando el orden de procesamiento.
  Si el gestor reserva una confirmacion, lanza el temporizador con `wait: false`.
- `alerta_flow_fallos_confirmar.yaml` espera `envs.alerta_espera_reintentos`
  (`PT45S` por defecto) y entrega `CONFIRM` al gestor con la generacion original.
  **No tiene una cola de concurrencia 1**: las esperas corren en paralelo.
  No lee ni escribe KV, ni envia mensajes.
- `alerta_flow_fallos_gestionar.yaml` es el **unico escritor** del estado y el
  unico que abre/cierra alertas en Bitrix24. Su `concurrency: 1` serializa los
  tres tipos de evento, incluidos los HTTP y sus marcadores posteriores. No
  contiene esperas ni llama a otros flows.

El grafo de subflows es aciclico: observador -> gestor; observador ->
temporizador -> gestor. El gestor devuelve la decision de programar al
observador en sus outputs, en vez de invocar el temporizador desde el gestor.

## Estado por flow y confirmaciones obsoletas

La clave `alerta.flow_fallos.estado.<namespace>.<flowId>` contiene:

- `generation`: version que aumenta con cada nuevo `SUCCESS` del flow.
- `failed_execution_ids`: hasta tres ejecuciones fallidas confirmadas (una
  para los flows que notifican desde el primer fallo).

Esta clave **no tiene TTL**: la version no puede volver a cero mientras exista
una confirmacion antigua. Se conserva un estado acotado por flow, no el historial.

Cada ejecucion tiene un recibo en
`alerta.flow_fallos.evento.<namespace>.<flowId>.<executionId>` con su `generation`
y estado `pending`, `confirmed` o `success`. Los recibos tienen TTL de 30 dias;
la deduplicacion de eventos repetidos cubre esa ventana. No se refresca su TTL
por un duplicado. Una confirmacion sin recibo se descarta.

1. El primer `FAILED` reserva un recibo `pending` con la generacion actual.
   Repetir ese evento no programa otro temporizador.
2. Un `SUCCESS` nuevo incrementa la generacion, vacia la racha y cierra la
   alerta si existia. Invalida todos los temporizadores anteriores de ese flow,
   aunque pertenezcan a otras ejecuciones. Un `SUCCESS` duplicado no reinicia
   una racha nueva ni cierra una alerta posterior.
3. `CONFIRM` solo cuenta si su generacion coincide tanto con el estado actual
   como con el recibo. Cambia el recibo a `confirmed` para no contar dos veces.
   Un recibo `success` o una generacion vieja no puede abrir una alerta.

Ejemplo: `FAILED(a), SUCCESS(b), FAILED(c), FAILED(d)` deja dos fallos
consecutivos, incluso si todas las confirmaciones llegan despues de `SUCCESS(b)`.
La confirmacion de `a` queda invalidada. Si una confirmacion y un exito llegan
casi juntos, el gestor los procesa en orden: exito primero suprime la alerta;
confirmacion primero puede abrirla y el exito siguiente la cierra. Una
confirmacion vieja nunca la vuelve a abrir despues de esa recuperacion.

Se usa el orden de procesamiento de eventos del observador/gestor, no el orden
de inicio de las ejecuciones concurrentes ni una reconstruccion del historial.

## Politica de notificacion y limites

Para `redunisol.prod.analisis-credito/consulta_quiebra_credix`, se alerta al
tercer fallo confirmado de ejecuciones distintas desde el ultimo exito. Para
los demas flows, al primero. Cualquier `SUCCESS` reinicia la racha, incluidos
cache hits, respuestas sin resultados y pedidos invalidos que terminan bien.
Esto mide resultados del flow, no exclusivamente disponibilidad de CredixSA.

La clave de alerta abierta conserva el nombre anterior
`alerta.flow_fallos.<namespace>.<flowId>` y su TTL de 30 dias. La racha y los
recibos se guardan antes del HTTP; el marcador de alerta abierta solo se guarda
tras el envio. Si falla el envio, una nueva ejecucion fallida o la repeticion
de una confirmacion valida puede volver a notificar sin aumentar la racha.
Si falla una recuperacion, otro exito nuevo vuelve a intentar cerrarla. No hay
una transaccion entre el KV y Bitrix: un corte despues del HTTP y antes de
persistir su marcador puede duplicar el mensaje al reintentar.

Kestra 2 puede emitir `FAILED` antes de terminar los reintentos de una task.
Los 45 segundos son una **ventana de tolerancia**, no una comprobacion del
estado definitivo. Un reintento mas largo puede producir alerta y luego
recuperacion. No se consulta la API ni se agregan credenciales. Cada HTTP tiene
un timeout de 30 segundos; cada flow, SLA de cancelacion a los 5 minutos. La
ventana configurada debe ser menor al SLA y dejar margen para entregar la
confirmacion. La cola del gestor puede agregar latencia, pero ninguna espera
de 45 segundos ocupa esa cola.

## Despliegue y migracion

Desplegar el target `system` completo, solo a prod. El tooling instala los
helpers antes de actualizar el observador activo. No requiere nuevos secrets,
variables, namespace files ni imagenes propias.

La nueva racha comienza vacia. La antigua clave `alerta.flow_fallos.racha.*`
no se consume; las alertas abiertas previas si se reconocen y el siguiente
exito las cierra. El cambio no borra KV ni purga ejecuciones existentes. Una
cola historica atascada requiere recuperacion separada; actualizar los YAML
no la vacia. Ver el [runbook CredixSA](../../../automations/analisis-credito/docs/credixsa-recovery.md).

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
