# Pago360: ejecutor y activación coordinada

El runtime conecta `Repository`, `Provider` y `Legacy` al motor. La API del
portal persiste lease/fencing, journal y cupo acumulado; sólo Kestra llama
`/fapi/PagoDeuda`. Los YAML siguen deshabilitados hasta comprobar la instalación
real del portal y sus credenciales. No se desplegó ni se reenvió un pago desde
esta revisión.

## Comportamiento aprobado

- ARS; aplicar exactamente el importe efectivamente cobrado de cada cuota del
  snapshot. El saldo actual del legacy no exige igualdad ni debe quedar en cero.
- Conservar identidad de préstamo/cuota, vencimiento y verificación fresca del
  pago en Pago360. La consulta autenticada la hace el portal con su clave existente.
- Fecha contable: día de ejecución en Argentina. Conservar por separado el día
  original del pago, sin inventar su hora.
- Cobrador ID 42, verificado por nombre/activo antes de escribir; cuenta AMV nula,
  sin permitir fuera de orden. Cupo acumulado del piloto: ARS 50.000.
- Una sola petición financiera por intento. Timeout/respuesta desconocida deja
  incertidumbre y reserva: nunca se vuelve a cobrar automáticamente ese intento.
- Referencia: ID entero de `CuotaPrestamoCobro`; releer préstamo, cobrador,
  `TotalPago` negativo e identidad de cuota mediante `MovimientoPrestamo` y
  `TransaccionAjuste.ID`. No usar `MontoTotal` como importe cobrado.
- La reserva global de cuota se libera al verificar TODA la operación. Otra
  operación distinta puede pagar un remanente; la original aplicada es terminal.

## Variables

Kestra usa `PAGO360_PORTAL_API_URL` (URL completa terminada en
`/functions/v1/kestra-imputaciones/v1`), `PAGO360_PORTAL_API_SECRET` (mismo valor
que `KESTRA_SERVICE_TOKEN` del portal), `VIMARX_EVAL_BASE_URL` y
`PAGO360_MODE=enabled`. Los YAML las enlazan a la configuración del runtime.
No copiar claves al repositorio. Sin configuración, no hay ejecución financiera.

## Orden de activación

1. Aplicar la migración aditiva de Etapa 2 en el portal; no ejecutar el esquema
   de referencia 0000 contra la base compartida. Verificar backup y versión actual.
2. Publicar API de servicio y proxy con ID real de cuota; después reemplazar el
   webhook existente. Conservar el secreto del webhook y la confirmación de Pago360.
3. Configurar el token compartido y URL del portal en Kestra. Comprobar sólo GET
   autenticado, snapshot y `verificar-pago`; verificar campos del legacy con lecturas.
4. Conciliar/excluir el pago manual previo que ya tiene comprobante. No reenviarlo.
5. Activar los dos flows y sus triggers por Git y desplegar. El workflow productivo
   manual sólo admite `Nasst` desde `main`; no se elude esa restricción.
6. Para el pago nuevo, recuperar UUID del portal y snapshot original de sus dos
   cuotas. Si faltan IDs/ambiente, conciliarlos explícitamente: no inferirlos del
   enlace de checkout ni fabricar el reparto con saldos actuales.
7. Reenviar sólo el aviso de esa operación al mismo ejecutor. Verificar recibos
   y resultado aplicado en el portal. No generar ni pagar otro cupón.

## Evidencia y límites

Una prueba real anterior devolvió un recibo que se releyó por ID y vinculó a su
cuota. El usuario aprobó el comportamiento contable y la fecha de ejecución.
Ese pago NO se repite. Los tests de esta revisión usan dobles HTTP y PostgreSQL
local aislado; no equivalen a verificar la API de Etapa 2 publicada.

La activación sigue pendiente de acceso al runtime del portal y Kestra, del
orden de migración/publicación y de las revisiones requeridas de GitHub.
