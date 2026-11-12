# Reliquidación conservadora en Beex

## Operación

1. El área a cargo (Legajos Digitales en Verificar firma y documentación, o
   Tesorería en Transferir) elige **Preparar reliquidación**, con motivo.
   También puede hacerlo un administrador desde su propia sesión.
2. Beex comprueba las condiciones y guarda una pausa duradera. Desde ese
   momento se bloquean firma, cambios de condiciones y transiciones financieras.
   El operador anula el préstamo manualmente en Vimarx.
3. **Verificar anulación y volver a Riesgo** consulta Vimarx. Se exige préstamo
   anulado en ambos estados, sin vigencia y con saldo cero. Beex retira el vínculo
   y el enlace de firma anteriores, reinicia el análisis y vuelve a Revisión Riesgo.
4. Riesgo conserva el analista asignado y sigue el circuito habitual: editar,
   enviar al vendedor, confirmar y generar el nuevo préstamo. Se verifican sus
   condiciones antes de vincularlo. Sólo su propia firma puede habilitar el pago.

La anulación remota y la generación posterior son operaciones separadas.
Beex no anula préstamos en Vimarx. La pausa no vence automáticamente y no hay
una acción de desbloqueo en esta versión. Si no se puede comprobar la anulación,
se conserva la pausa y el vínculo anterior para conciliación.

## Bloqueos de esta versión

- Cualquier reserva de desembolso, incluso sin iniciar. No se elimina ni cancela.
  Incluye autorización iniciada, pagos parciales y desembolsos completados.
- Pago externo registrado o cualquier antecedente de estado Pagada.
- Cualquier selección o cobro de refinanciación registrado. Tampoco se permite
  agregar refinanciación durante el nuevo ciclo pendiente de préstamo.
- Generación/reemplazo pendiente, incierto o sin vincular.
- Analista ausente/inactivo, área o estado incorrectos, archivo o sesión suplantada.
- Versión desactualizada o evidencia remota incompleta/incompatible.

Los préstamos se generan directamente desde Beex y no necesitan una PreSolicitud
histórica ni una Solicitud asociada en Vimarx. Beex es la fuente de los controles
de reserva y pago de este circuito. Se verifican bajo el lock de la solicitud al
preparar, al reabrir y antes de generar el préstamo nuevo. Una respuesta vacía de
`Solicitud.Estado.Descripcion` del core no es un bloqueo de reliquidación.
Vimarx sigue siendo la fuente para verificar la anulación real del préstamo;
esa consulta se repite antes de generar/vincular el préstamo nuevo.
La auditoría de la reapertura registra `paymentValidationSource: BEEX`.
Esta primera entrega no agrega integración bancaria para conciliar operaciones
manuales realizadas fuera de Beex.

## Concurrencia y auditoría

Preparación y reapertura usan el lock de la solicitud que comparten reservas,
autorización bancaria y cambios de estado. Se repiten los controles locales bajo
ese lock después de las lecturas remotas. La pausa invalida la aprobación de firma
para transferir. El ID de operación evita duplicar la reapertura; reutilizarlo con
otro cuerpo se rechaza. Las pausas se registran como RELIQUIDATION_PREPARED y las
reaperturas como RELIQUIDATION_REOPENED, con actor, motivo y evidencia del préstamo
anterior, enlace de firma, ciclo y controles previos.

El préstamo activo se limpia al confirmar la anulación y la referencia anterior
permanece en el historial y en `administrativeCoreControl.reliquidation`.
La generación habitual reserva su intento antes del POST a Vimarx. Un resultado
incierto conserva la reserva y exige recuperación administrativa, sin volver a generar.
Los estados históricos del ciclo cerrado dejan de impedir el retorno habitual
Confirmada → Revisar; cualquier antecedente de pago sigue bloqueando.

No requiere migración de esquema. A futuro, admitir reservas cancelables o
refinanciación exige un circuito explícito de cancelación/conciliación y auditoría;
no alcanza con quitar estos bloqueos.

## Validación local

Las pruebas de integración se habilitan con `BEEX_TEST_DATABASE_URL` y exigen un
host de loopback y una base terminada en `_test`. Usan migraciones y datos ficticios;
los gateways del core son simulados. No ejecutar el seed operativo para estas pruebas.

En el frontend, iniciar `npm run ui:dev` y abrir `/reliquidacion`. Los escenarios
`?scenario=prepared`, `pending`, `blocked`, `error` y `refresh-error` funcionan en memoria.
El laboratorio usa el control real con transporte simulado: verifica que los errores
se muestren de inmediato aunque las recargas de fondo sean lentas y que la pausa
confirmada se vea aun si falla una consulta posterior. Ejecutar
`node ui-lab/reliquidacion.browser-test.mjs` para verificar preparación, confirmación,
bloqueos, error, ausencia de solicitudes externas y anchos 1365, 390 y 320 px.
`UI_LAB_BASE_URL` admite otro puerto de loopback si el habitual está ocupado.
