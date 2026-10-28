# Diagnóstico técnico de generación de préstamos

BEEX conserva los diagnósticos de generación, reemplazo y recuperación en la tabla
PostgreSQL `technical_diagnostic_events`. Es un registro técnico privado: no tiene
rutas de consulta en la aplicación y no se agrega a notificaciones, adjuntos ni
historiales visibles para vendedores. La auditoría de negocio sigue separada.

## Qué se guarda

Cada llamada a `/api/Simulador/CrearPrestamo` registra:

- `REQUEST`: URL de destino, método, ruta, encabezados y cuerpo completo preparado para Vimarx.
  El cuerpo conserva el orden y los tipos enviados; el diagnóstico no modifica
  la petición de negocio.
- `RESPONSE`: código y texto HTTP, encabezados y cuerpo completo recibido,
  incluso cuando contiene un rechazo, HTML o JSON inválido. Si falla la lectura
  del cuerpo, se conserva el error original y `body` puede ser `null`.
- `FAILURE`: clasificación del fallo (`rejection`, `http_error`, `network_error`,
  `timeout`, `invalid_json` o `invalid_response`) y el error original disponible.
- `SUCCESS`: ID de préstamo confirmado por Vimarx. Un ID positivo acompañado de
  `Ok: true` se conserva también si el código HTTP fue anómalo; ambas evidencias
  quedan registradas.

Los orquestadores agregan etapas como `CREATED_REMOTE`, `LINKED`, `LINK_FAILED`,
`PERSISTENCE_FAILED`, `ERROR` y `RECOVERY_STARTED`. Permiten distinguir la creación
remota, la persistencia local, la vinculación y la recuperación administrativa.
Los errores conservan nombre, mensaje, stack, código y causas disponibles.
La recuperación registra su resultado y fallos; no realiza otra creación remota.
Los cuerpos HTTP completos corresponden a `CrearPrestamo`; las consultas de
verificación durante la recuperación registran su contexto y errores, sin
instrumentar todos los cuerpos de lectura del Core.

No se truncan los cuerpos. Antes de persistir o emitir el respaldo de emergencia
se redactan credenciales reconocibles: autorización, cookies, contraseñas,
tokens, claves, cadenas de conexión y credenciales embebidas en URLs. La
redacción también se aplica a textos crudos y causas de errores. Los datos
operativos necesarios para diagnosticar, incluidos datos personales de la
operación, permanecen en este registro: su consulta corresponde al soporte
técnico con acceso autorizado a la base.

## Correlación y tiempos

| Campo | Uso |
| --- | --- |
| `operation_id` | Identifica el intento lógico. En el flujo con reserva coincide con el `requestId` persistido; la recuperación conserva esa referencia. |
| `call_id` | UUID de cada llamada HTTP real. No se asigna a eventos del orquestador que no representan una llamada. |
| `solicitud_id` | UUID de la solicitud BEEX; no es el número de préstamo. |
| `actor_id` | Usuario efectivo que ejecutó esa acción. |
| `real_actor_id` | Administrador real cuando existe suplantación; en otro caso coincide con el usuario efectivo. |
| `operation` | `loan_generation`, `loan_replacement` o `loan_recovery`. |
| `stage` | Etapa del gateway o del orquestador. |
| `recorded_at` | Instante con zona horaria (`TIMESTAMPTZ`), independiente de la zona de la sesión SQL. |
| `elapsed_ms` | Tiempo transcurrido desde el inicio del gateway, incluidas las esperas previas de diagnóstico; no es exclusivamente latencia HTTP. |
| `id` | Secuencia para ordenar los eventos guardados. |

Una recuperación puede tener un operador distinto del intento inicial: cada
evento conserva el actor que la ejecutó y ambos quedan unidos por `operation_id`.
Las columnas de identidad no tienen claves foráneas para conservar el diagnóstico
si falla una transacción de negocio o cambia el registro asociado.

## Persistencia y resultado incierto

La reserva de generación se confirma antes de contactar Vimarx. Luego, `REQUEST`
debe persistirse antes de iniciar la llamada HTTP. Si ese guardado falla o excede
el plazo, no se contacta Vimarx. Un `REQUEST` persistido significa **petición
preparada**: un cierre del proceso entre el guardado y el envío puede impedir que
el proveedor la reciba. Por sí solo no prueba que se haya creado un préstamo.

Los eventos posteriores esperan como máximo dos segundos por escritura. Si la
base falla o vence ese plazo, se emite a stderr un evento JSON
`loan_diagnostic_storage_failed` con la información completa ya redactada y el
error de almacenamiento. La escritura pendiente puede terminar más tarde; el
respaldo puede coexistir con la fila de base. El diagnóstico no descarta un ID
conocido ni provoca un nuevo intento de generación. El plazo HTTP también cubre
la lectura del cuerpo de la respuesta.

Esto no garantiza una respuesta si el proceso termina abruptamente después de
contactar al proveedor o si fallan tanto la base como el colector de logs. La
reserva durable y la recuperación existente siguen protegiendo contra duplicados.
Este registro no libera reservas `UNCERTAIN`, no introduce reintentos automáticos
y no reconstruye las respuestas de incidentes anteriores a su despliegue.

## Consulta operativa de solo lectura

Acceder por SSH con el procedimiento y las credenciales operativas locales.
Consultar la base del ambiente afectado; no copiar estos datos a comentarios de
PR ni a documentación. El siguiente ejemplo usa un UUID ficticio de solicitud:

```sql
BEGIN READ ONLY;
SELECT id, recorded_at, operation_id, operation, stage, call_id, elapsed_ms,
       actor_id, real_actor_id, data
FROM technical_diagnostic_events
WHERE solicitud_id = '00000000-0000-0000-0000-000000000001'::uuid
ORDER BY id;
COMMIT;
```

Para reunir generación y recuperación del mismo intento, usar el `operation_id`
obtenido en la consulta anterior o en la reserva de negocio:

```sql
BEGIN READ ONLY;
SELECT id, recorded_at, solicitud_id, operation, stage, call_id, elapsed_ms, data
FROM technical_diagnostic_events
WHERE operation_id = '00000000-0000-0000-0000-000000000002'::uuid
ORDER BY id;
COMMIT;
```

Comparar `REQUEST`, `RESPONSE`, `SUCCESS` y los eventos de vinculación. Ante un
resultado incierto, verificar el préstamo en Vimarx por las vías existentes antes
de realizar cualquier recuperación; consultar este registro no modifica datos.

## Despliegue y conservación

La migración `20261027190000_technical_diagnostics` crea la tabla, sus índices y
triggers que rechazan `UPDATE`, `DELETE` y `TRUNCATE`. El registro es append-only
para las operaciones normales de la aplicación; la administración de PostgreSQL
conserva sus facultades de mantenimiento.

El arranque habitual del backend ejecuta `prisma migrate deploy` antes del
servicio. La versión nueva requiere esta migración y el cliente Prisma generado.
No requiere credenciales, variables de ambiente ni cambios de frontend nuevos.

Los registros sobreviven al reemplazo del contenedor porque viven en PostgreSQL.
Durante la beta no hay borrado automático ni una política de vencimiento en el
código. Deben incluirse en los respaldos de la base del ambiente y verificarse
como parte de su restauración. El respaldo a stderr depende de la conservación
de logs del runtime y no reemplaza esos backups. Una futura política de purga
requiere una migración y una decisión explícita sobre conservación.
