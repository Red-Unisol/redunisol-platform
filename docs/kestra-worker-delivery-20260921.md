# Kestra 2.0.0: entrega de tareas durante reconexiones

Diagnostico del 21 de septiembre de 2026. Las observaciones de produccion se
obtuvieron por SSH con consultas de solo lectura. El usuario autorizo modificar
solamente la instancia de diagnostico `kestra-worker-probe-runtime`.

## Alcance y estado inicial

- Produccion usa `kestra/kestra:v2.0.0`, `server standalone` y cola PostgreSQL.
- Al comenzar esta revision, el contenedor productivo ya habia sido reiniciado
  a las 12:57 UTC. El prefill volvia a completar lotes: se verificaron siete
  ejecuciones SUCCESS iniciadas entre las 13:09 y las 13:24 UTC.
- Persistian ejecuciones RUNNING/SUBMITTED de varios flows desde el 8 de
  septiembre. Habia siete registros de trabajos asociados a workers INACTIVE;
  algunos pertenecian a ejecuciones antiguas y otros al sistema de alertas.
  Un registro residual por si solo no demuestra que una ejecucion siga abierta.
- No habia falta de espacio ni agotamiento de memoria en la primera muestra:
  aproximadamente 8 GiB disponibles y disco al 42%. Se observaron demoras del
  scheduler; una muestra de recursos no descarta presion historica.
- Durante el ensayo compartiendo la VPS, `iostat` midio el dispositivo `sda`
  al 99,9% de utilizacion, aproximadamente 272-334 escrituras/s y solo
  2,8 MiB/s de escritura. `vmstat` midio 41-59% de iowait. Ambos PostgreSQL
  mostraban esperas `WALWrite`/`WALSync`. Hay un cuello de botella de latencia
  de almacenamiento en esa muestra; el ensayo agrega carga y no permite
  atribuir estos valores al periodo previo ni al viernes. No aumentar workers
  sin medirlo, ni desactivar `fsync`/`synchronous_commit` para ocultarlo.
- Los logs conservados no llegan al atasco del viernes. No se puede demostrar
  retrospectivamente que el incidente del prefill tuvo exactamente esta causa.

## Reproduccion aislada

Se reutilizo la instancia de diagnostico existente, con su PostgreSQL separado,
API vinculada a localhost, limite de 2 CPU y 2 GiB de memoria para Kestra y
8 hilos de worker. No tiene integraciones con ARCA, Bitrix ni datos de clientes.

La prueba preexistente `worker_delivery_baseline` lanzo 120 ejecuciones con
8 tareas `io.kestra.plugin.core.flow.Sleep` de `PT0.2S` cada una. Su configuracion
forzaba `max-connection-age: PT5S` y `max-connection-age-grace: PT0.1S`.
Esto amplifica los cortes y **no reproduce los tiempos por defecto de produccion**.

Su informe a los 160 segundos mostraba 120 ejecuciones abiertas. Ese resultado
no basta para diagnosticar perdida: habia tambien trabajo pendiente que avanzaba.

Para el control se cambio solamente `max-connection-age` a `PT0S`, se reinicio
el contenedor de diagnostico y se lanzaron otras 120 ejecuciones identicas
(`worker_delivery_no_rotation`). Se conservaron las ejecuciones previas para
observar recuperacion, por lo que el control tambien soporta su backlog.
El plazo inicial de 160 segundos resulto insuficiente y se amplio la observacion.

La correlacion entre PostgreSQL y los logs completos del ensayo identifico
49 tareas del worker anterior con estas propiedades:

1. El controlador registro `Dispatched job`.
2. No existe el correspondiente `Received job` del worker en esos logs.
3. La tarea permanece SUBMITTED y su registro durable sigue asociado al worker
   anterior, ahora INACTIVE.

Por ejemplo, la tarea `7FYX1ctFW1Ni5AUrMmz9wF` se registro como despachada a las
13:22:12 UTC, junto a un cierre gRPC `GOAWAY / max_age`, sin recepcion posterior.
Los 49 casos tienen despacho registrado y cero recepciones registradas.

Resultado final verificado a las 13:45 UTC:

| Grupo | SUCCESS | RUNNING con tarea SUBMITTED huerfana |
| --- | ---: | ---: |
| Con cortes forzados (baseline) | 71 | 49 |
| Sin rotacion (control) | 120 | 0 |

Las 960 tareas del control completaron. La primera ejecucion comenzo a las
13:33:18 UTC y la ultima termino a las 13:45:22 UTC; no se registraron eventos
`max_age` desde su reinicio. El ensayo es evidencia de entrega, no una medicion
aislada de rendimiento: comparte disco con produccion y dreno parte del backlog
anterior. El runtime de diagnostico se detuvo al finalizar para retirar esa
carga; se conserva su PostgreSQL y la evidencia local del ensayo.

## Mitigacion propuesta

En `kestra/platform/infra/application.yaml`:

```yaml
kestra:
  controller:
    max-connection-age: PT0S
```

Kestra usa por defecto una edad maxima de una hora y una gracia de 30 segundos.
La rotacion sirve para redistribuir conexiones entre controladores. En este
despliegue hay un unico controlador, dentro del mismo proceso standalone.
Se verificaron cierres productivos `max_age` a las 11:00, 11:56 y 12:52 UTC.

Desactivar esta rotacion elimina ese desencadenante programado. **Es una
mitigacion, no una correccion del protocolo de entrega ni una garantia frente a
cualquier desconexion.** No recupera automaticamente trabajos ya huerfanos.
No se modifica cada flow ni se aumenta el numero de workers como supuesto remedio.

Antes de aplicar en produccion, conservar evidencia y evaluar las ejecuciones
en curso; el reinicio puede interrumpir tareas con efectos externos. La aprobacion
de este ensayo no autoriza ese reinicio productivo. Verificar despues nuevos
lotes SUCCESS, antiguedad de tareas SUBMITTED, trabajos asociados a workers
inactivos y ausencia de cierres programados `max_age`. El rollback consiste en
retirar la propiedad y recrear el runtime con la configuracion anterior.

## Correccion de fondo y limites

El caso reducido permite investigar el protocolo controlador/worker y su
recuperacion sin involucrar integraciones de negocio. Para considerar resuelto
el defecto de fondo, una version corregida debe completar el mismo ensayo con
cortes y recuperar trabajos pendientes tras la salida del worker, sin perdidas
ni efectos duplicados. No basta con que el contenedor o su API esten saludables.

El issue upstream #18005 documenta que FORCE RUN vuelve a enviar la ejecucion
al executor, pero no necesariamente reenvia las tareas SUBMITTED al worker.
No usarlo como recuperacion garantizada ni reemitir masivamente trabajos de
negocio: se deben comprobar sus efectos para evitar duplicaciones.

Existen versiones 2.0.1 y 2.0.2. Sus notas incluyen correcciones del scheduler
y del drenado de workers al apagar. No se verifico que solucionen este caso;
no se recomienda una actualizacion como solucion garantizada por el numero de
version solamente.

Validacion local: `python kestra/tools/validate_kestra.py`, parseo YAML de la
configuracion y `git diff --check`. La configuracion `PT0S` tambien arranco y
ejecuto el control en el runtime v2.0.0. No se aplico el cambio productivo.
Mergear este cambio a `main` activa el workflow `Deploy Infra`: revisar y
autorizar ese despliegue antes del merge.

Fuentes primarias:

- [Configuracion del controlador en v2.0.0](https://github.com/kestra-io/kestra/blob/v2.0.0/worker-controller/src/main/java/io/kestra/controller/config/ControllerConfiguration.java).
- [Despacho de trabajos en v2.0.0](https://github.com/kestra-io/kestra/blob/v2.0.0/worker-controller/src/main/java/io/kestra/controller/grpc/services/WorkerJobDispatcher.java).
- [Recuperacion de workers en v2.0.0](https://github.com/kestra-io/kestra/blob/v2.0.0/executor/src/main/java/io/kestra/executor/DefaultServiceLivenessCoordinator.java).
- [Notas de v2.0.2](https://github.com/kestra-io/kestra/releases/tag/v2.0.2).
- [Limitacion de FORCE RUN y tareas SUBMITTED, #18005](https://github.com/kestra-io/kestra/issues/18005).
