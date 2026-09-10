# Herramientas Red Unisol

Aplicacion interna para concentrar herramientas operativas de Red Unisol en un solo punto de acceso.

La primera herramienta implementada es Consulta Renovacion Cruz del Eje. El frontend esta hecho con React y la capa servidor con Laravel. No usa base de datos por ahora: el catalogo de herramientas y la configuracion viven en archivos de configuracion para mantener el despliegue simple.

## Objetivo

- centralizar accesos internos en una sola interfaz
- ocultar endpoints sensibles de Kestra detras de un proxy backend
- dejar una base lista para sumar nuevas herramientas sin redisenar la app
- poder correr localmente y tambien en contenedores Docker

## Estructura relevante

- `app/Http/Controllers/HerramientasController.php`: renderiza la app y proxya la consulta a Kestra
- `config/tools.php`: branding y catalogo de herramientas
- `resources/js/app.jsx`: interfaz React
- `resources/css/app.css`: estilos institucionales de la app
- `routes/web.php`: rutas web y endpoint interno del proxy
- `docker-compose.yml`: arranque local en contenedor
- `Dockerfile`: imagen de produccion con build frontend incluido

## Variables de entorno

Copiar `.env.example` a `.env` y completar al menos:

- `APP_KEY`
- `APP_URL`
- `ANALISIS_CREDITO_RENOVACION_WEBHOOK_URL`
- `ANALISIS_CREDITO_CONSULTA_CAJA`
- `ANALISIS_CREDITO_QUIEBRA_CREDIX_WEBHOOK_URL`
- `ANALISIS_CREDITO_CONSULTA_EMPLEADOR_WEBHOOK_URL`
- `ANALISIS_CREDITO_CONSULTA_CUAD_WEBHOOK_URL`
- `ANALISIS_CREDITO_TIMEOUT_SECONDS`
- `OBJECTIVES_DASHBOARD_SNAPSHOT_PATH`

Cada una de esas URLs debe apuntar al webhook completo expuesto por Kestra para el flow correspondiente. Esas URLs quedan solo del lado servidor y no se exponen al navegador.

## Bandeja de analisis

`/analisis` permite elegir un ejecutivo por su usuario real de Vimarx. Usa una
contrasena compartida, validada en el servidor, y una sesion de Laravel. Tanto la
lista de analistas como las solicitudes requieren esa sesion. El login conserva
la proteccion CSRF y limita los intentos fallidos. Cambiar el hash invalida los
accesos anteriores en la siguiente consulta.

La bandeja se actualiza cada 45 segundos mientras la pagina esta abierta. El
servidor comparte un snapshot durante 15 segundos entre analistas y navegadores,
con un lock para evitar consultas simultaneas iguales. La fuente es exclusivamente
`EvaluateList`; esta herramienta no escribe en Vimarx ni ejecuta transiciones.
No se aplica un corte por fecha de creacion de la solicitud.

Los estados se filtran **por exclusion de IDs**, en `config/analisis.php`.
Entre los estados conocidos al 2026-09-10 quedan incluidos:

| ID | Marcador interno | Nombre visible |
| --- | --- | --- |
| 114 | RevisionRiesgo | RevisionRiesgo |
| 117 | VerificacionDocumentacion | VerificarDocumentacion |
| 121 | Confirmada | Confirmada |
| 123 | A Transferir | A Transferir |

PreAprobado, Revisar y Liquidada pertenecen a vendedores y quedan excluidos,
junto con los demas estados conocidos. El ID 118 (VerificacionRiesgo) corresponde
a "Verificacion de Documentos y Firma" y tambien queda excluido. Un ID nuevo se
incluye por defecto: revisar la lista de exclusion si se modifica el flujo.

Al ingresar por primera vez se muestra la lista sin avisar por el backlog. Se
guardan por navegador y analista solamente IDs, firmas de asignacion y marcas
de novedades, sin nombres ni documentos. Las siguientes entradas y reentradas
generan avisos una sola vez. La firma combina la ultima novedad de cambio de
ejecutivo y la ultima novedad en un estado excluido, para detectar regresos entre
sondeos o visitas. Los comentarios en estados incluidos no producen avisos.
Esto depende de que Vimarx registre esas novedades. Las asignaciones que entran
y salen antes del siguiente sondeo no se muestran si ya no estan pendientes.

El usuario activa las notificaciones con un boton. Si deniega el permiso, la
lista sigue funcionando. No se implementa Web Push: hay que mantener la pagina
abierta. Los navegadores pueden retrasar consultas de pestanas suspendidas; al
volver a la pagina o recuperar conexion se consulta inmediatamente. Con Web
Locks se coordinan las marcas entre pestanas del mismo navegador; sin ese API
se usa la deduplicacion local y el tag de la notificacion. No hay sincronizacion
de leidos entre computadoras. Abrir Credixsa quita la marca de novedad de esa fila.

Una consulta fallida conserva la ultima lista, muestra el error y reintenta. No
se interpreta una respuesta incompleta como una bandeja vacia. Si el limite de
10.000 filas resulta insuficiente, el servidor responde 503 para evitar omisiones.

El enlace abre `/credixsa` en otra pestana, precarga CUIT/CUIL (o DNI como
alternativa) y nombre, y consulta automaticamente una vez. Se reutiliza la consulta
existente, incluido su cache. Los parametros viajan en el fragmento de la URL,
que se quita tras leerlos; no se envian en la URL del request al servidor.

Configuracion (solo servidor):

- `ANALISIS_PASSWORD_HASH`: hash bcrypt de la clave compartida.
- `ANALISIS_CORE_URL`: base de la API Evaluate de Vimarx.
- `ANALISIS_CORE_TOKEN`: bearer opcional.
- `ANALISIS_CORE_VERIFY_TLS`: `true` por defecto; los ambientes preparados usan
  el valor del acceso operativo existente.
- `ANALISIS_CACHE_STORE`: `file` por defecto; usar un store compartido con locks
  si se despliega mas de una replica.

Sin hash o URL, la pantalla de acceso queda deshabilitada. Los archivos cifrados
de dev/prod contienen la configuracion preparada y Compose la pasa al contenedor.
La clave compartida se conserva en el registro local canonico de accesos bajo
`ANALISIS_HERRAMIENTAS_PASSWORD`; nunca debe enviarse al frontend ni a Git.
El deploy sigue el circuito habitual de esta aplicacion.

Validacion local:

```bash
npm test
php vendor/phpunit/phpunit/phpunit --filter AnalisisTest
```

`npm test` construye la aplicacion y prueba la deteccion de novedades y los flujos
de React sobre DOM simulado (incluida la apertura automatica de Credixsa). Las
pruebas PHP cubren autenticacion, filtros, cache, reasignaciones y fallas de fuente.

## Dashboard de objetivos

La pantalla interna de objetivos vive en:

```text
/objetivos/{OBJECTIVES_DASHBOARD_PRIVATE_SLUG}
```

Los promedios del mes en curso usan las mismas métricas y feriados nacionales obligatorios
que el informe de comisiones. El objetivo es la media simple de los tres promedios
mensuales anteriores; con un mes sin datos queda pendiente. Verde hasta el objetivo,
amarillo hasta el 110% y rojo por encima.

El backend lee un snapshot JSON desde `OBJECTIVES_DASHBOARD_SNAPSHOT_PATH` y lo expone al frontend sin cache. Kestra debe publicar ese archivo con este contrato minimo:

```json
{
  "periodo_actual": "2026-05",
  "actualizado_en": "2026-05-21T10:30:00-03:00",
  "metricas": [
    {
      "id": "first_response",
      "nombre": "Tiempo de Primera Respuesta",
      "actual_min": 20.4,
      "objetivo_min": 21.95,
      "casos": 850,
      "estado": "verde"
    },
    {
      "id": "transfer",
      "nombre": "Tiempo de Transferencia",
      "actual_min": 27.6,
      "objetivo_min": 26.19,
      "casos": 420,
      "estado": "amarillo"
    }
  ]
}
```

Estados esperados: `verde`, `amarillo`, `rojo`. Si `estado` no viene, el frontend calcula una clasificacion provisoria contra el objetivo.

## Desarrollo local

Requisitos:

- PHP 8.4+
- Composer
- Node 22+
- npm

Instalacion:

```bash
php ../../composer install
npm install
cp .env.example .env
php artisan key:generate
```

Ejecucion:

```bash
php artisan serve --host=127.0.0.1 --port=3010
npm run dev
```

## Tareas de VS Code

Desde `Terminal > Run Task...` quedan disponibles estas tareas:

- `Herramientas: Start Local Dev`: levanta Laravel en `http://127.0.0.1:3010` y Vite en `http://127.0.0.1:5173`
- `Herramientas: Laravel Serve`: levanta solo el backend Laravel
- `Herramientas: Vite Dev`: levanta solo el frontend con recarga en caliente
- `Herramientas: Build Frontend`: genera el build de produccion
- `Herramientas: Docker Up`: prueba la app con Docker Compose

Para la prueba local normal alcanza con correr `Herramientas: Start Local Dev` y abrir `http://127.0.0.1:3010`.

## Docker

La app incluye una imagen basada en Apache + PHP y un `docker-compose.yml` simple para correrla aislada.

```bash
docker compose up --build
```

Expone la app en `http://127.0.0.1:3010`.

## Deploy Git-managed

La forma recomendada de deploy para esta app es que GitHub Actions construya la imagen Docker desde Git y despliegue en la VPS usando un `docker-compose.yml` de runtime.

Archivos de deploy:

- `.github/workflows/deploy-herramientas-dev.yml`
- `.github/workflows/deploy-herramientas-prod.yml`
- `deploy/docker-compose.vps.yml`

Comportamiento esperado:

- `dev`: deploy automatico al hacer push a `dev` si hubo cambios en la app,
  la API de cache CredixSA o los workflows de Herramientas.
- `prod`: deploy automatico al mergear a `main` cambios en `web/herramientas/`,
  `apps/credixsa-cache-api/` o el workflow de produccion. Tambien se conserva
  el deploy manual via `workflow_dispatch` desde `main` por `Nasst`.

El evento automatico es `push` a `main`, por lo que tambien incluye pushes
directos autorizados. Los cambios de otros sistemas de la monorepo no disparan
este despliegue. Cada ejecucion usa el commit que la disparo y los despliegues
de produccion se serializan sin cancelar uno que ya este en curso.

El runtime no vive en GitHub secrets. Vive en archivos cifrados versionados en Git:

- `deploy/herramientas.dev.env.enc`
- `deploy/herramientas.prod.env.enc`

Sus plaintext locales ignorados son:

- `deploy/herramientas.dev.env`
- `deploy/herramientas.prod.env`

En GitHub solo hace falta un environment operativo compartido:

- `vps-infra`

Secrets operativos esperados en `vps-infra`:

- `VPS_SSH_HOST`
- `VPS_SSH_PORT`
- `VPS_SSH_USER`
- `VPS_SSH_PRIVATE_KEY`
- `RUNTIME_ENV_KEY`

Con este esquema, Git queda como fuente de verdad para el runtime: Actions construye una imagen desde el commit, descifra el `.env.enc` correspondiente en el runner y luego actualiza la instancia remota via Docker Compose.

## Agregar una nueva herramienta

1. sumar la metadata en `config/tools.php`
2. agregar la UI React correspondiente en `resources/js/app.jsx` o extraerla a componentes
3. crear un metodo backend si hace falta proxy o logica sensible
4. exponer la ruta en `routes/web.php`

## Nota operativa

Esta app no reemplaza Kestra como runtime. Solo ofrece una interfaz interna controlada desde Git para consumir automatizaciones y futuras herramientas operativas.
