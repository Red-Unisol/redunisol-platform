# Receptor persistente de actualizaciones de leads

Estado: implementacion preparada para despliegue manual desde Git. El merge por
si solo no cambia el webhook publico. No demuestra una mejora de 2x en produccion.

`Bitrix ONCRMLEADUPDATE -> Apache -> receptor/SQLite -> crm.lead.get -> Kestra`

El receptor autentica la URL y el application token, guarda el aviso antes de
responder 200 y agrupa avisos pendientes por ID de lead. Dos consumidores leen
el estado actual, con una separacion global minima de 750 ms entre consultas.
Solo deriva estados de preclasificacion y calificado que no haya completado ya.
La logica comercial y sus argumentos siguen en Kestra. El nuevo flow conserva
concurrencia 1 y usa la imagen kestrapy fijada por digest, sin instalar paquetes
por evento. Como maximo hay dos recibos comerciales pendientes en el receptor.

## Garantias y limites

- SQLite usa WAL, synchronous FULL y un volumen persistente. No borrar el volumen
  ni ejecutar dos replicas compartiendo el archivo. Respaldar con SQLite backup,
  no copiando solamente el archivo principal mientras esta activo.
- Un aviso durante una consulta o una ejecucion obliga a releer el lead al
  terminar. Un POST ambiguo a Kestra reusa el recibo; solo una ejecucion puede
  reclamarlo. No hacer replay/restart manual de ejecuciones comerciales.
- El exito requiere `vars.ok=true`, no solo SUCCESS. Los callbacks perdidos se
  reconcilian cada 30 segundos consultando estado y outputs persistidos de Kestra.
  Un resultado desconocido queda pendiente, nunca se presume exitoso.
- No garantiza exactly-once de cada escritura REST. Un fallo despues de una
  escritura depende de la idempotencia existente en la logica comercial.
- Se procesa el estado actual, no un historial de transiciones: Bitrix no informa
  los campos cambiados. Una transicion intermedia que se revierte antes de la
  lectura no se detecta. Cambios de otros campos dentro de un estado ya completado
  no vuelven a disparar la logica comercial.
- Lecturas fallidas se reintentan a los 30 segundos; fallos comerciales a los 60.
  Leads borrados o sin permiso siguen pendientes para revision. Tras tres envios
  sin claim, el recibo queda visible como no confirmado y requiere investigacion.
  No liberar automaticamente esos recibos: podria existir una ejecucion demorada.
- El servicio reduce trabajo innecesario; no corrige el incidente de despacho
  interno de workers de Kestra ni prueba su causa.

## Despliegue y activacion

Usar el workflow **Deploy Bitrix Lead Receiver**, desde `main`, despues del merge.
Mantener la misma revision de main entre sus tres fases. El workflow esta limitado
al operador `Nasst` y al environment `vps-infra`.

1. **install**: instala el artefacto Git en `/opt/bitrix-lead-receiver`, genera
   `.env` con permisos 0600 desde `/opt/kestra/.env`, construye/inicia el servicio,
   espera su healthcheck y publica solamente el nuevo flow. La primera instalacion
   queda `paused`; una actualizacion conserva el modo anterior. No cambia Apache.
2. Verificar `python3 operate.py stats` y `python3 operate.py preview` en ese
   directorio. Para una prueba de solo lectura, importar IDs de prueba al endpoint
   administrativo `/internal/enqueue` y seleccionar `python3 operate.py shadow`.
   Shadow consulta Bitrix pero no dispara Kestra. Terminar con `python3 operate.py
   pause`. No enviar secretos en argumentos o logs. Revisar resultados antes de
   habilitar el ingreso.
3. **enable-ingress**: respalda el vhost, habilita exclusivamente la ruta antigua
   del webhook en Apache, valida configuracion y verifica rechazo de una peticion
   sin autenticacion valida. El receptor permanece pausado y guarda nuevos avisos.
   Si falla la prueba, restaura la configuracion anterior.
   Selecciona el virtual host que efectivamente proxya Kestra; preserva el virtual
   host de redireccion HTTP y las demas rutas. En HTTPS prueba el dominio publico
   con validacion de certificado, sin depender de un POST redirigido desde HTTP.
4. **cutover**: exige receptor pausado e ingreso habilitado; guarda un snapshot
   de ejecuciones e IDs de leads en `migrations/`, importa los leads de forma
   durable y despues cancela las ejecuciones QUEUED por la API de Kestra. Deja
   terminar las que inicialmente estaban RUNNING. Espera que no quede ninguna
   ejecucion antigua abierta y revisa contenedores con sus IDs en etiquetas antes
   de activar consumidores. Una carrera o timeout deja el receptor pausado para
   investigar/reintentar. No borra registros ni modifica directamente la base.

Las credenciales se conservan en la VPS: no se suben al artefacto. Las llamadas
internas usan la red `kestra_net`; el puerto 8092 solo se publica en loopback.
El administrador usa un token aleatorio diferente; los callbacks usan el token
existente de Bitrix. La reconciliacion usa el acceso administrativo de Kestra ya
disponible en el runtime. Apache no publica endpoints `/internal/*` del receptor.

## Verificacion posterior

Consultar `python3 operate.py stats`: mode, jobs por estado, events_received,
events_coalesced, filtered, business_requested, business_ok, business_failed,
read_errors, unconfirmed_submissions y stale_business_receipts. La antiguedad
reportada usa el primer aviso retenido del lead y puede sobreestimar una nueva
espera si el lead vuelve a activarse. Los recibos se conservan sin purga automatica.

Comparar durante una hora: leads distintos completados, edad de pendientes,
errores REST, nuevas ejecuciones del flow antiguo (deben cesar), y correspondencia
entre estado del lead y negociacion en Bitrix. No comparar solamente ejecuciones:
precisamente se busca dejar de ejecutar los avisos redundantes. Verificar el
objetivo de 2x con estas medidas y una carga comparable. Revisar tambien prefill.

## Pausa y vuelta atras

`python3 operate.py pause` detiene nuevas derivaciones. Puede quedar una lectura
en curso; las ejecuciones ya reclamadas y la reconciliacion siguen terminando.
No restaurar el webhook viejo mientras haya ejecuciones comerciales nuevas.

Para volver al receptor anterior: pausar, esperar/resolver recibos y ejecuciones,
preservar el volumen y snapshots, retirar el include habilitado de Apache mediante
un cambio operacional autorizado, validar/reload y verificar la ruta. Los avisos
ya aceptados por el receptor siguen en SQLite: hay que reinyectar sus leads
pendientes o completar su drenaje antes de retirar el servicio. No borrar ni
cancelar esa cola como parte de un rollback. Documentar cualquier intervencion en
Git. No hay rollback automatico que descarte el trabajo recibido.

## Pruebas locales

Desde este directorio: `python -m unittest -v` (Python 3.11+, PyYAML para contratos).
El servicio usa solo la biblioteca estandar; los helpers de la VPS soportan
Python 3.6. CI valida tambien Compose y las pruebas comerciales existentes.

## Registro de instalacion: 2026-09-22

- Revision instalada: `d9a3755f71d8f167971734958c97a8daf16dfa92`, mediante
  [workflow install](https://github.com/Red-Unisol/redunisol-platform/actions/runs/35740427751).
  Servicio healthy, modo paused; shadow completo 10 lecturas sin acciones comerciales.
- Con autorizacion explicita se guardo el lead `386333` antes de solicitar por la
  API la cancelacion de `2KLeU3lu3uHdTO7mLAothC`, RUNNING desde el 8/9 sin contenedor
  asociado. La ejecucion termino en FAILED. Snapshot conservado en la VPS en
  `migrations/authorized-orphan-20260922/executions.json`; no se borraron registros.
- El primer [intento de ingreso](https://github.com/Red-Unisol/redunisol-platform/actions/runs/35741594372)
  se detuvo antes de modificar Apache porque habia dos virtual hosts (HTTP con
  redireccion y HTTPS). La correccion selecciona el vhost que sirve el proxy.
  Al cerrar esta revision, el ingreso antiguo sigue activo y el receptor pausado.
- Tras mergear la correccion, repetir install y luego enable-ingress/cutover con
  la misma revision de main. El volumen conserva el lead importado y las muestras.
