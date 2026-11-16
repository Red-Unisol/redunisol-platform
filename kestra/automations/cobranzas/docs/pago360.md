# Pago360 → Celesol: ejecutor durable

Tarea Bitrix 23595. PR coordinada con `Red-Unisol/prestamos-celesol`.

## Estado de esta entrega

Se implementa la orquestacion y la recuperacion de pendientes. El adaptador
`UnverifiedVimarx` **no implementa escrituras reales** y permanece bloqueado
por codigo, incluso si se ejecuta manualmente el flow. No hay una flag que
lo habilite. Ambos flows y triggers estan deshabilitados; el cron se entrega
como configuracion para una habilitacion posterior, no como actividad operativa.
No se ejecutaron cobros ni simulaciones en Vimarx.

El contrato financiero no pudo comprobarse mediante lecturas solamente.
[Contratos actuales y evidencia del 16/11/2026](../../../../docs/apis/vimarx/cobros.md):
`PagoDeuda` publica importe e ID de cuota, sin esquema de respuesta ni garantia
de idempotencia. El gateway de refinanciaciones calcula el total con
`pagoTotal: true`. La consulta de Celesol encontro el cobrador activo 42
(PAGOS 360), pero falta verificar su contrapartida y cuenta AMV. No se reutiliza
el cobrador ni el motivo de refinanciacion.

## Circuito

El portal vuelve a consultar Pago360 y persiste evento, confirmacion y outbox
en una transaccion. Notifica el ID por un webhook de Kestra autenticado con
clave. El mismo `Executor` atiende el webhook, el ingreso manual y la lista de
recuperacion. El ledger y sus bloqueos viven en PostgreSQL del portal.

1. `tomar`: reserva durable con token y lease; excluye otros cupones para las
   mismas cuotas. La concurrencia global del flow es una defensa adicional.
2. `inspect`: el futuro adaptador debe releer e identificar la cuota interna,
   validar prestamo/numero/vencimiento, saldo e importe exacto. Una cuota pagada
   por otro medio requiere conciliacion, no se da por aplicada.
3. `iniciar`: guarda la intencion antes de llamar a Vimarx. Si esta transicion
   no confirma su commit, el proceso se detiene sin llamar al proveedor.
4. `write`: una sola llamada. Toda excepcion posterior a la intencion es
   incierta; no se repite. Esta frontera solamente se ejercita con un fake en
   las pruebas hasta contar con el adaptador revisado.
5. `respuesta`: conserva cobro e importe antes de verificar. Si falla esta
   persistencia, la intencion permanece bloqueada para conciliacion.
6. `verify` + `confirmar`: relee cobro y saldo y exige vinculo inequivoco con la
   operacion, ID de cuota, importe y cobro. Saldo cero solo es insuficiente.
7. `finalizar`: solo cuando todas las cuotas tienen evidencia confirmada.

La recuperacion de un lease vencido con intencion `escribiendo` lo lleva a
conciliacion. Si la respuesta esta guardada, solo se verifica; una cuota ya
confirmada nunca se vuelve a escribir. Las reservas no se borran al resolver
una notificacion fallida. El portal no realiza cobros por su cuenta y no se
agrega un boton manual alternativo.

Los estados del proveedor y la aplicacion a cuotas son independientes. La
interfaz del portal permite al socio y al administrador ver ambos estados.
Devoluciones, rechazos y vencimientos no disparan escrituras ni reversas.

## Configuracion prevista

- `ENV_PAGO360_PORTAL_API_URL`: endpoint HTTPS `/functions/v1/pagos-imputacion`.
- `SECRET_PAGO360_PORTAL_API_SECRET`: secreto del cliente Kestra; su valor
  resuelto debe coincidir con `PAGO360_KESTRA_API_SECRET` en el portal.
- `SECRET_PAGO360_WEBHOOK_KEY`: clave del trigger de `pago360_imputar`.
- En el portal, `PAGO360_KESTRA_WEBHOOK_URL` apunta al webhook con esa clave.

Compose mapea las tres variables y el runtime cifrado las declara vacias.
Completar usando el tooling de env cifrado; no copiar valores secretos a Git
ni editar el runtime por SSH. Consultar las convenciones de
[configuracion Kestra](../../../../docs/kestra-configuration.md).

En modo manual se recibe `inputs.operacion_id`; en webhook se recibe
`trigger.body.operacion_id`. La recuperacion consulta hasta 50 pendientes,
continua con otras operaciones si una falla y deja la ejecucion fallida si
alguna requirio recuperacion. No se imprimen cuerpos de respuesta ni secretos.
El cliente HTTP tiene timeout y no sigue redirects ni repite peticiones.

## Orden y habilitacion pendiente

1. Revisar e integrar primero la PR del portal: migracion, RPC y funciones,
   seguida de esta PR del consumidor. Esta tarea no incluye despliegue.
2. Para una intervencion posterior autorizada, aplicar el contrato del portal
   antes de configurar/publicar los flows. Revalidar cupones historicos y
   ambiente, sin inventar metadata que antes no se guardaba.
3. Obtener evidencia operativa de Pago360 (ambiente, headers y evento 5156).
4. Completar el adaptador Vimarx mediante una nueva revision: endpoint de
   importe exacto, autenticacion, idCuota, cobrador/cuenta, fecha, identidad del
   cobro y proteccion ante pagos concurrentes por otros canales. Establecer
   timeouts de escritura/verificacion acotados por debajo del lease y probar
   fallos despues de una posible escritura. Ningun resultado financiero debe
   derivarse solamente de que una cuota este pagada.
5. Revisar pruebas y habilitacion; solo despues configurar secretos y activar
   flow y trigger. La recuperacion periodica requiere activacion explicita.

No hay una accion automatica que libere una escritura incierta o la declare
pagada sin evidencia. La conciliacion debe inspeccionar los registros por
operacion y cuota y documentar los cobros encontrados. No borrar intenciones
ni reservas para forzar reintentos; incorporar cualquier resolucion como
intervencion especifica, revisada y auditada.

## Pruebas

`python -m unittest kestra.automations.cobranzas.tests.test_pago360 -v` prueba
barrera de escritura, duplicados y concurrencia, cambio de deuda, pago externo,
exito parcial, timeout, fallo al guardar resultado/confirmacion y recuperacion
sin repetir cobros. Los datos y el gateway son sinteticos. La PR coordinada
prueba el contrato HTTP y transacciones, carreras y permisos en PostgreSQL real.

Validaciones adicionales: `python kestra/tools/validate_kestra.py` y
`python kestra/tools/deploy_kestra.py --environment dev --domain cobranzas --dry-run`.
El dry-run no contacta Kestra ni publica cambios. CI ejecuta las pruebas del
nuevo ejecutor; los checks remotos quedan pendientes al abrir la PR.
