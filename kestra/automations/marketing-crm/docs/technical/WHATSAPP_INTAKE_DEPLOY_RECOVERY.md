# Recuperación del intake de WhatsApp tras un despliegue parcial

## Incidente del 29/10/2026

El despliegue de Marketing CRM del 28/10 se interrumpió a las 16:40:57 UTC con
HTTP 500 al subir un namespace file. El procesador nuevo quedó publicado, pero
`edna_incoming/intake.py` conservó la versión anterior. Las nueve respuestas
originales de la tanda `website-intake-20-v2` fallaron al importar
`REJECTION_LABELS`, antes de ejecutar cualquier llamada a Bitrix. Las solicitudes
8 a 16 conservaron su respuesta cifrada y quedaron `unknown`.

La revisión contrastó los UUID con Bitrix y los logs de las nueve ejecuciones:
sin lead por UUID y sin posibilidad de escritura, porque falló el import previo
al procesador. No basta con que una solicitud diga `unknown` para repetirla.

## Pausa de emergencia autorizada

Para impedir admisiones nuevas y permitir callbacks y recuperación, mover
temporalmente `EDNA_INTAKE_START_AT` al futuro en la configuración efectiva de
Web y sus workers. No desactivar `EDNA_INTAKE_ENABLED` ni
`EDNA_INTAKE_CRM_ENABLED`: esas banderas también protegen respuestas existentes.
La reserva con `acceptNew=false` sólo devuelve admisiones existentes; un número
nuevo conserva el Router. No editar cohortes, contadores, slots ni destinatarios.

El 29/10 el usuario autorizó esta intervención operativa. Se usó temporalmente
`2099-01-01T00:00:00+00:00` en el `.env` persistente de producción y se recrearon
sólo los cinco servicios de aplicación con sus mismas imágenes. Tras recrear
PHP, recargar Nginx para renovar la resolución del upstream y verificar HTTP 200.
Se comprobó el mismo corte futuro en los cinco servicios, 14/20 admisiones en la
tanda nueva y 10/10 en la anterior.

La configuración Git de operación normal conserva
`2026-10-28T16:42:01+00:00`. Restaurar ese valor sólo después de completar las
comprobaciones siguientes. La pausa es una intervención temporal auditada, no
un nuevo valor permanente ni un reinicio del piloto.

## Despliegue y recuperación

1. Usar los archivos de Git; verificar por lectura el contenido de **todos** los
   namespace files del dominio. Completar los archivos ausentes o distintos con
   el deployer y comparar bytes contra Git. No editar código desde la UI.
2. Comprobar el entrypoint real con el contrato vacío: debe devolver HTTP 200,
   `ok=false`, `action=invalid`. No consulta Bitrix ni consume cupos.
3. Comprobar el procesador y las nueve respuestas originales con un cliente que
   permita sólo lecturas y detenga cualquier `add/update/delete` antes de enviarlo.
   Resolver cualquier fallo previo a escritura antes de recuperar.
4. Volver a consultar el UUID de cada caso en Bitrix y auditar sus ejecuciones.
   Sólo una ausencia comprobada de **intentos** de escritura habilita
   `edna:intake recover ID --expected-case=UUID --confirmed-no-writes --apply`.
   Encolar cada ID una sola vez y comprobar su resultado antes de seguir.
5. Verificar un único lead por UUID, Flow y atribución originales, contacto elegido
   por CUIL, CUIL inválido aislado cuando corresponda y rechazo explícito de las
   opciones Otra. Comprobar evolución comercial de los casos automáticos y que
   no se duplican gestiones previas.
6. Comparar respuesta, UUID, envío, admisión y slot contra la línea base. La
   recuperación no crea mensajes, envíos ni admisiones. Los contadores deben
   permanecer 14/20 y 10/10 antes de reabrir.
7. Restaurar el corte normal, verificar la configuración de los cinco servicios,
   la web y el Router de fallback. Mantener el mismo Flow, tanda y capacidad;
   restan seis lugares, no una tanda nueva de veinte.

El deployer ahora instala las dependencias de intake primero y verifica cada
archivo por SHA-256 antes de actualizar los flows. Un acuse HTTP 500 o de red se
concilia por lectura antes de repetir el envío idempotente del mismo archivo;
los reintentos son acotados. Un archivo no verificado detiene el despliegue.
La relectura usa `Accept: application/octet-stream`: el endpoint de archivos
devuelve 406 si hereda el `Accept: application/json` de las consultas de metadatos.
Esto no vuelve atómica la actualización de un namespace compartido: el contrato
vacío y la verificación completa siguen siendo necesarios antes de admitir casos.

## Incidente del 03/11/2026: primera respuesta v3

La solicitud `23`, ligada al envío `1472`, recibió una respuesta auténtica del
Flow v3. Web quedó `unknown / crm_acknowledgement_uncertain`; la ejecución
`63g5PPS8QXgw6B9n9nKW7x` terminó técnicamente en SUCCESS, pero su resultado fue
`ok=false / error / intake_processing_uncertain`. El último método registrado
fue `crm.lead.get`, al resolver el posible Guest del canal. No hubo intentos de
`add`, `update` o `delete`, ni lead asociado al UUID del caso.

El entrypoint anterior descartaba la excepción, de modo que no se puede afirmar
su tipo o causa exactos a partir de aquel log. La respuesta original, evaluada
después con un cliente que bloquea escrituras, supera las lecturas de identidad y
la preparación de campos. El código publicado coincide con Git; no se confirmó
un defecto de normalización del teléfono ni se cambia esa política de identidad.

El cliente de intake incorpora hasta tres intentos únicamente para una lista
explícita de lecturas transitorias de Bitrix, con pausas de 1 y 2 segundos y una
ventana global de inicio de reintentos de 15 segundos. La ventana no interrumpe
una consulta en curso: cada llamada conserva el timeout configurado del
transporte; un primer timeout que agote la ventana no se vuelve a intentar.
No reintenta escrituras ni el
procesamiento completo. El entrypoint registra tipo de excepción, función y
método, intentos y si el cliente había intentado escribir. Conserva también el
tipo de causa y código HTTP, cuando existen, sin registrar el mensaje de
error del proveedor, credenciales, payloads ni datos personales.

Santiago autorizó expresamente el 03/11 la corrección por Git, su despliegue y la
recuperación de este caso. Aplicar la CLI documentada una sola vez después de
verificar el código activo, auditar todas las ejecuciones del UUID y repetir la
búsqueda de ausencia de escrituras y lead por caso. Conservar en RAM la línea
base del UUID, respuesta cifrada, envío, evento, admisión, tanda y slot para
compararla después. La recuperación debe reutilizar la solicitud `23`, sin
enviar otro WhatsApp ni reservar otra admisión; debe resultar en un único lead
por UUID y un contacto por CUIL, o reutilizar los ya existentes conforme a las
reglas de identidad. Las entradas concurrentes se cuentan separadamente: no
atribuir sus admisiones a la recuperación ni reiniciar los contadores.

Infraestructura y Marketing CRM de producción comparten un lock de despliegue
con `cancel-in-progress=false`. Marketing usa el commit disparador, evitando
mezclar una ejecución anterior con un `main` más nuevo.

### Cuota Bitrix confirmada durante la recuperación

El PR #651 desplegó los reintentos y el diagnóstico; se verificaron los 106
namespace files contra el merge `ef7061b5`. La recuperación auditada de la
solicitud `23` produjo la ejecución `3Q4wQ0htuW8agVdnru0xj7`: falló en
`crm.lead.fields` con HTTP 503 después de tres intentos, con
`write_attempted=false`. La búsqueda posterior confirmó cero leads por UUID y
cero contactos por CUIL. Respuesta, envío, admisión y slot permanecieron iguales.
No se volvió a encolar el caso ante ese resultado incierto.

Tres lecturas acotadas desde la VPS confirmaron el error de proveedor
`QUERY_LIMIT_EXCEEDED` (200, 503, 200), sin cabecera `Retry-After`. La cuota se
comparte con otras automatizaciones; una pausa local no garantiza disponibilidad.
El intake ahora reutiliza una sola respuesta exitosa de `crm.lead.fields` por
instancia de cliente y separa los comienzos de llamadas HTTP al menos un segundo.
La caché es optativa, conserva copias independientes y no almacena identidad,
fallos ni otros endpoints. Las respuestas explícitas de cuota esperan 2 y 4
segundos; los demás errores transitorios conservan 1 y 2 segundos. Se mantiene
la ventana global de inicio de reintentos de 15 segundos y no se repite ninguna
escritura, aunque su respuesta indique cuota.

Una nueva recuperación requiere volver a auditar **todas** las ejecuciones del
UUID, confirmar ausencia de intentos de escritura y buscar otra vez el caso y
el contacto en Bitrix. Sólo después de desplegar y comprobar esta mitigación se
puede aplicar de nuevo la recuperación autorizada, una vez, conservando la
misma respuesta original. Si hubo cualquier intento de escritura, conciliar sus
efectos antes de considerar otra intervención.
