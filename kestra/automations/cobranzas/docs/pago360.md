# Flujos de Kestra para cuotas vencidas de Pago360

Los flujos `pago360_imputar` y `pago360_recuperar` usan `pago360_cuotas.processor.Processor`, incorporado en el PR #744. Ambos flujos y sus disparadores se entregan deshabilitados. [Reglas de pago e imputación](pago360-cuotas.md)

| Flujo | Origen del ID de operación | Entrada al motor |
| --- | --- | --- |
| `pago360_imputar` | `inputs.operacion_id` en una ejecución manual o `trigger.body.operacion_id` en el webhook | Una llamada a `Processor.run` para ese UUID |
| `pago360_recuperar` | Consulta del portal que tiene un cron previsto cada diez minutos | Una llamada al mismo método por cada UUID distinto del lote |

Cada llamada recibe el identificador real de la ejecución de Kestra. El punto de entrada construye el motor sin adaptadores financieros. Su resultado es `BLOCKED` con el motivo `CONTRACTS_NOT_VERIFIED` antes de reservar la operación, consultar Pago360 o escribir en Vimarx. El log registra el ID de la operación y ese resultado. El estado de negocio se consulta en el campo `result` del log. Un error al procesar una entrada marca la ejecución como fallida después de intentar las demás.

## Lectura de trabajos del portal

El recuperador consulta la API v1 propuesta en Etapa 2 del portal. Usa `GET /trabajos` para los estados `pendiente` y `en_proceso`. Esto permite incluir trabajos cuya reserva anterior venció. La implementación futura del portal deberá decidir de forma atómica si una reserva sigue vigente. El listado admite hasta 200 trabajos por estado y carece de paginación. [Contrato v1 del portal](https://github.com/Red-Unisol/prestamos-celesol/blob/4b762cbb0dbb5baf36c64cd80a05a547bd438450/propuestas/pago360-etapa2/contrato-kestra-v1.md)

- `ENV_PAGO360_PORTAL_API_URL` es la base HTTPS que termina en `/functions/v1/kestra-imputaciones/v1`.
- `SECRET_PAGO360_PORTAL_API_SECRET` corresponde al token de servicio Bearer del portal (`KESTRA_SERVICE_TOKEN`).
- `SECRET_PAGO360_WEBHOOK_KEY` es la clave del disparador del flujo de imputación.

Las variables de entorno se preparan por ambiente con el mecanismo cifrado del repositorio. Las credenciales de lectura del portal solo las consume el recuperador. En desarrollo, el despliegue omite los disparadores con `schedule_scope: prod_only`. [Configuración de Kestra](../../../../docs/kestra-configuration.md)

## Pendiente antes de habilitar cobros

1. Integrar la migración y la API v1 del portal, la recepción verificada del evento y el aviso posterior a la confirmación en base. Conservar desde la emisión del cupón el ID real de cada cuota.
2. Implementar los adaptadores de repositorio, proveedor y Vimarx para el motor. Acordar la fecha de pago con zona horaria, la conversión exacta a centavos y el contrato de los reintentos de notificación. Verificar las reservas y los resultados por cuota con el portal.
3. Validar el endpoint de cobro en Vimarx, la cuenta y el cobrador de Pago360, y el comportamiento si caja cobra al mismo tiempo. La verificación posterior debe vincular operación, cuota, importe y comprobante. Si la respuesta es incierta, conservar la intención para conciliación. [Evidencia y pendientes de Vimarx](../../../../docs/apis/vimarx/cobros.md)

Las pruebas locales cubren el ingreso manual, el webhook, la recuperación de un aviso perdido y un timeout de cobro con servicios simulados. Para ejecutarlas desde la raíz del repositorio:

```sh
python -m unittest discover -s kestra/automations/cobranzas/tests -p 'test_pago360*.py' -v
```
