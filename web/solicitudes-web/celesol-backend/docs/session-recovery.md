# Recuperación de sesión

El acceso conserva su TTL de 15 minutos y la renovación su TTL de 7 días.
La renovación acepta durante **30 segundos** el token inmediatamente reemplazado,
únicamente para devolver su mismo sucesor mientras siga activo y vigente.
Los reintentos no extienden esa ventana ni la fecha de vencimiento del sucesor.
No se recorren cadenas de reemplazos ni se recuperan sesiones revocadas por
logout, cambio de contraseña o baja del usuario.

El sucesor se deriva con HMAC-SHA256 del token original y un prefijo de propósito
usando `ACCESS_TOKEN_SECRET`. Esto permite reproducirlo después de una respuesta
perdida, entre procesos y tras reinicios, sin guardar tokens en claro, agregar
cachés ni cambiar el esquema existente (`replacedByTokenHash`, `revokedAt`).
Los inicios de sesión siguen usando tokens aleatorios. Una rotación de la clave
de acceso impide recuperar reemplazos derivados con la clave anterior; los
tokens de renovación activos siguen pudiendo renovarse con la nueva clave.
Los reemplazos previos al despliegue tampoco pueden recuperarse, porque fueron
generados aleatoriamente; no se cierra ninguna sesión activa por el despliegue.

Las renovaciones concurrentes usan la transacción existente: una crea el
reemplazo y las demás recuperan ese mismo resultado. Si falla la confirmación
de la transacción, se consulta el resultado persistido antes de devolver error.
El middleware de acceso como otro usuario aplica las mismas reglas y conserva
la validación del administrador y del usuario seleccionado.

El cliente comparte una renovación por pestaña y reintenta una sola vez ante
errores de conexión o HTTP 5xx, con timeout de 10 segundos por intento. Los
guards ya no disparan una segunda renovación por separado. Un error temporal
se propaga como tal: no se convierte en el 401 original. En consultas de sesión
en segundo plano se conserva la pantalla montada; en una carga inicial fallida
se ofrece volver a intentar. Una sesión definitivamente inválida vuelve al ingreso.
Las operaciones de negocio con respuesta ambigua nunca se reenvían automáticamente.

`auth_refresh_failed` registra nombre de error, código Prisma y duración para
fallas internas no recuperadas. No registra cookies, tokens, contraseñas ni
mensajes de error que puedan contener parámetros de consultas. El origen del
HTTP 500 del incidente original sigue sin estar determinado.

Validación local:

- Backend: `npm run prisma:generate`, `npm run build`, `npm test`.
- Frontend: `npm test`, `npm run build`.

Para incluir la integración de concurrencia con PostgreSQL, definir
`BEEX_TEST_DATABASE_URL` con una base local aislada cuyo nombre termine en
`_test`, aplicar las migraciones existentes y ejecutar las pruebas. El job
`solicitudes-sessions` de `Validate` prepara esa base y ejecuta autenticación,
recuperación y las pruebas del cliente en cada PR.

Referencia del patrón de ventana breve de recuperación:
[Okta: grace period for token rotation](https://developer.okta.com/docs/guides/refresh-tokens/main/#grace-period-for-token-rotation).
