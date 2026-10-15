# Recuperacion de BCRA en segundo plano

`recuperar_bcra_cache` corre cada dos minutos, las 24 horas, solo en produccion.
Lee informes version 4 vigentes de SQLite cuyo bloque BCRA quedo como
`CredixSA` con estado `unavailable`, `invalid_response` o `processing_error`.
No consulta CredixSA, no navega el portal y no modifica datos comerciales.

La cola `bcra_recovery`, dentro de la misma base compartida, deduplica por CUIL
y huella del informe. La primera oportunidad llega dos minutos despues de
`cached_at`; ante fallos, las siguientes esperan 5, 15 y 60 minutos desde el
intento anterior. Se agrega jitter de hasta 20%. El cron ejecuta el intento en
la siguiente corrida disponible, por lo que estos son tiempos minimos.
Hay cuatro intentos en segundo plano por version; un informe nuevo reinicia
el contador. Los casos anteriores al despliegue se incorporan automaticamente
si siguen vigentes. Identidades invalidas, informes vencidos y respuestas
BCRA ya completas quedan fuera.

Cada corrida procesa como maximo cinco CUIL (configurable por
`envs.bcra_recovery_max_per_run`, rango 1-10), con un presupuesto operativo de
90 segundos y timeout de tarea de tres minutos. Cada caso hace una sola ronda
paralela de deudas vigentes e historial, con timeout de ocho segundos por
peticion. Las esperas largas se persisten como `next_attempt_at`: no hay
`sleep` ni ocupacion del worker entre corridas. El enriquecimiento inicial
conserva sus tres intentos y pausas de 12 segundos.

El flow tiene concurrencia uno y `allowConcurrent: false`. Ademas, cada CUIL
tiene un lease de cinco minutos con token: una corrida manual o un worker
interrumpido no puede publicar con un token vencido/reemplazado. Los intentos
se cuentan al tomar el lease para acotar tambien las interrupciones repetidas.

Solo se publica cuando ambos endpoints forman un bloque BCRA completo y
validado. Una transaccion corta verifica que la huella original sigue vigente
antes de cambiar `result.normalized.bcra` y los aliases del mismo informe.
Conserva `cached_at`, `expires_at`, datos brutos y demas secciones; recuperar
BCRA no vuelve recientes los datos originales de CredixSA. La base no se
crea silenciosamente si falta el montaje compartido.

SQLite y KV no comparten una transaccion distribuida. Una outbox durable
`bcra_kv_sync` sincroniza las claves recuperadas al KV del mismo namespace,
con TTL limitado al vencimiento original. Los errores de KV quedan pendientes
para otra corrida sin volver a consultar BCRA. Se verifica la version antes
del PUT para evitar reemplazar un KV mas nuevo. Como KV no ofrece CAS, los
lectores compartidos siempre prefieren el informe mas nuevo de SQLite y, a
igual `cached_at`, el bloque BCRA completo mas reciente. Los escritores SQLite
aplican la misma prioridad: un replay de KV no deshace una recuperacion.
Los informes nuevos conservan microsegundos en sus fechas para ordenar tambien
dos generaciones creadas en el mismo segundo.

El worker reutiliza `REPORTS_KESTRA_USERNAME`, `REPORTS_KESTRA_PASSWORD`,
`reports_kestra_url` y `reports_kestra_tenant`, sin nuevos secretos. Los outputs
y stdout contienen solo contadores; no incluyen CUIL, nombres, informes,
URLs ni texto de excepciones. La cola vencida se depura a los siete dias.

Para verificar el deploy: confirmar el cron en el namespace prod, leer los
contadores de una corrida y comprobar en la API de cache un CUIL recuperado,
con fuente BCRA y las fechas originales. No borrar ni regenerar los informes
para forzar la recuperacion.
