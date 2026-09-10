# CredixSA: arquitectura y recuperacion de Kestra 2

## Circuitos vigentes

| Componente | Ejecucion | Fuente / salida |
| --- | --- | --- |
| Herramientas | Consulta del operador | API de cache; ante miss, webhook del RPA |
| credixsa-cache-api | HTTP, lectura de SQLite | No consulta al proveedor ni ejecuta RPA |
| consulta_quiebra_credix | Webhook o subflow | KV vigente o Playwright contra el portal CredixSA |
| precalentar_cache_credixsa_v2_sondeo | Cada minuto entre 07 y 18, Buenos Aires | Core; worker solo con candidatos |
| bitrix24_lead_prefill | Cada minuto | Lead pendiente; CredixSA y ARCA cuando corresponda |
| mudon_credixsa_report | Mensual y reanudacion cada 10 minutos | Servicio Python compartido; estado mensual SQLite separado |

consulta_quiebra_credix_http era scraping HTTP con requests/BeautifulSoup,
**no una API oficial**. No ejecutaba las actualizaciones JavaScript del portal.
Fue eliminado del codigo activo, pero quedaron copias invalidas en runtime.
Los YAML deshabilitados de ese ID y consulta_credixsa_cache_warmup son
tombstones: el deploy reemplaza las copias antiguas, elimina sus triggers y
conserva los IDs y el historial. No se debe reactivarlos.

## Correcciones

- Kestra 2 puede registrar una tarea SKIPPED sin sus vars ni sus outputs.
  Las condiciones de persistencia usan valores por defecto; las salidas eligen
  la rama con resultados efectivos, no solo la presencia del ID de tarea.
- Sin candidatos/pending, warmup y prefill deben terminar normalmente, sin
  navegar CredixSA, consultar ARCA ni escribir datos comerciales.
- KV y SQLite usan informes version 4 de hasta 7 dias. El RPA y los workers
  persisten SQLite; un hit KV repara la copia compartida sin renovar fechas.
  Un informe mas antiguo no puede sobrescribir uno mas nuevo en SQLite.
- La carpeta compartida debe existir. El escritor no la crea silenciosamente
  dentro de un contenedor efimero cuando falta el volumen.
- Docker requiere values.volume-enabled: true en Kestra 2.
  Referencia: [implementacion v2.0.0](https://github.com/kestra-io/kestra/blob/v2.0.0/script/src/main/java/io/kestra/plugin/scripts/runner/docker/Docker.java).
- Los entrypoints conservan el contrato completo en outputs de Kestra, pero
  no imprimen otra copia del informe en stdout. Esto no elimina el volumen
  necesario para almacenar outputs; la rotacion no sustituye medir escrituras.
- Herramientas dev debe apuntar al mismo ID de RPA que prod, en su namespace dev.
- Alertas mantiene concurrencia 1 y deduplicacion KV. Usa when en lugar de
  preconditions, limita HTTP a 30 segundos y solicita cancelacion mediante
  SLA MAX_DURATION a los 5 minutos. El SLA no es una garantia de cancelacion
  instantanea ni corrige ejecuciones historicas atascadas.

## Evidencia del 9 de septiembre de 2026

La validacion de los seis YAML contra el API real de Kestra fue satisfactoria.
Se evaluaron 83 expresiones de condiciones/salidas sobre ejecuciones historicas:
hit KV con RPA omitido, RPA exitoso, warmup sin/con candidatos y prefill sin
pendientes. No se reejecutaron consultas al proveedor ni escrituras en Bitrix
para esta validacion.

Una tarea diagnostica sin triggers, con volumen de solo lectura y la misma
imagen del worker, recibio la variable de ruta SQLite pero no vio la carpeta
ni la base. Esto confirma el montaje ausente antes del cambio de configuracion.
La prueba posterior al despliegue sigue siendo obligatoria.

Habia una alerta RUNNING desde el dia anterior, detenida en
marcar_alerta_abierta despues de enviar el mensaje, y mas de 6000 alertas
QUEUED. Son observaciones historicas: releer estados antes de intervenir.

## Orden de despliegue y cierre

**Antes del merge o de reiniciar Kestra:** recuperar la cola historica segun
el punto 6, dejando temporalmente pausados los triggers de alertas. Un reinicio
podria liberar la ejecucion atascada y despachar miles de mensajes antiguos.
Los workflows de infra y flows se disparan por main de forma independiente:
el orden siguiente requiere coordinacion operativa, no lo garantiza el CI.

1. Aplicar la configuracion de infra Git-managed y comprobar, desde una tarea
   Docker de prueba de solo lectura, que existe el montaje y la base compartida.
   El contenedor de Kestra y un docker exec en el host no prueban el montaje
   de los contenedores de tareas. El reinicio afecta el runtime compartido.
2. Desplegar namespace files y flows de analisis-credito y marketing-crm.
   Probar hit KV, miss con RPA, none y multiple; conservar errores tecnicos
   como errores, no convertirlos en consultas exitosas vacias.
3. Verificar que el hit KV conserva cached_at/expires_at al reflejarse en
   SQLite y que la API compartida devuelve el mismo informe. Una consulta
   online posterior debe persistir fuera del contenedor de la tarea.
4. Promover tambien a dev y desplegar Herramientas dev. Un merge a main no
   ejecuta Deploy Dev: ese workflow escucha la rama dev. Revisar el destino
   del webhook descifrado sin mostrar su clave.
5. Confirmar los dos flows retirados deshabilitados y sin triggers en ambos
   namespaces. Conservar el backfill de empleadores deshabilitado.
6. Recuperar las alertas en una intervencion controlada: pausar sus triggers,
   inventariar y conservar IDs/estados de la cola exacta de
   redunisol.prod.system/alerta_flow_fallos, cancelar las notificaciones
   historicas sin borrar ejecuciones y SOLO entonces terminar la ejecucion
   atascada. No liberar primero la concurrencia: enviaria notificaciones
   antiguas. Verificar la clave de deduplicacion del mensaje ya enviado, sin
   reenviarlo. Desplegar/restaurar el flow nuevo y confirmar avance de la cola.
   La pausa y cancelacion de historicos preceden a los pasos 1 y 2; la
   restauracion ocurre despues de verificar los flows corregidos.
7. En las busquedas API de Kestra 2 usar QueryFilters:
   filters[namespace][EQUALS], filters[flowId][EQUALS] y
   filters[state][EQUALS]; comprobar cada resultado antes de mutar.
   Los parametros planos antiguos pueden ser ignorados.
8. Observar nuevas corridas normales de warmup, prefill y MUDON, y comparar
   escritura en disco y bytes nuevos de logs durante un intervalo medido.
   Separar FAILED real, error del proveedor y severidad del stream stderr.
   No contar cada linea ERROR como una consulta fallida.

No borrar SQLite, KV, historiales de ejecucion ni reejecutar en masa consultas
para reconstruir la cache. Esta recuperacion debe quedar vinculada al commit
desplegado; un PR aprobado o un healthcheck HTTP no demuestran el cierre.
