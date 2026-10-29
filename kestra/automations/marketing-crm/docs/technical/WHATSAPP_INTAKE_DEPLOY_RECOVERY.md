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

Infraestructura y Marketing CRM de producción comparten un lock de despliegue
con `cancel-in-progress=false`. Marketing usa el commit disparador, evitando
mezclar una ejecución anterior con un `main` más nuevo.
