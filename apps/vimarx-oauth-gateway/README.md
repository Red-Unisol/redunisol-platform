# Vimarx OAuth gateway

Puente de consultas por usuario entre ChatGPT y Mutual Celesol. Código y estado
operativo deseado en Git; Docker/Apache en la VPS son el runtime.

- MCP: `https://mcp.redunisol.com.ar/mcp`
- Inicio: `https://mcp.redunisol.com.ar/`
- Borrado de conexiones: `https://mcp.redunisol.com.ar/connections`
- Origen fijo: `https://celesol.dyndns.org:35010`
- Runtime: `/opt/vimarx-oauth-gateway`, bind interno `127.0.0.1:3060`.
- DNS deseado: `deploy/dns.json`. El host tiene su propio certificado y vhost;
  no comparte rutas ni issuer con Kestra.

## Experiencia del usuario

Agregar un MCP personalizado en ChatGPT, autenticación OAuth y registro dinámico
DCR. Instalarlo y conectar el usuario habitual de Vimarx. Para recordar el acceso,
seleccionar **Mantener conectado** en el formulario. Esa elección autoriza guardar
las credenciales cifradas en la VPS; no se envían al modelo, cookies ni herramientas.
Sin esa opción, la contraseña sólo se usa en el login inicial y no se conserva.

El acceso de ChatGPT dura 30 minutos. Con conexión recordada se emite un refresh
token rotatorio y se renueva sin interacción. El JWT de Vimarx se renueva mediante
su login existente cuando quedan menos de dos minutos y se está usando el servicio.
No hay un cron que mantenga usuarios autenticándose sin actividad.

Sólo las llamadas reales a herramientas actualizan la actividad. Discovery,
pings y refresh OAuth no prolongan la conexión. Tras 30 días sin consultas se
rechaza el acceso y se eliminan las credenciales del servicio activo mediante la
limpieza periódica. Una conexión inicial que nunca completa OAuth se elimina en
10 minutos. El formulario de administración verifica nuevamente la contraseña de
Vimarx antes de borrar todas las conexiones recordadas de ese usuario.

Al cambiar la contraseña o deshabilitar el usuario, el primer login de renovación
explícitamente rechazado revoca la conexión y borra sus credenciales. Las caídas
transitorias conservan la conexión y aplican 30 segundos de espera antes de otro
intento de login. Un cambio de credenciales puede requerir conectar otra vez.

## OAuth y concurrencia

Authlib implementa Authorization Code, PKCE S256 obligatorio, DCR y refresh. El
cliente, callback, scope `mcp:read` y resource quedan ligados a cada transacción.
Los callbacks permitidos son las rutas HTTPS conocidas de ChatGPT y las rutas
`/callback` o `/callback/<id>` sobre HTTP loopback (`127.0.0.1`, `localhost` o
`[::1]`) para escritorio. Se admiten puertos efímeros, sin userinfo, query ni
fragmento. Cada autorización e intercambio de código exige la URI exacta
registrada para ese cliente y PKCE S256.
Discovery RFC8414/RFC9728 y respuesta `iss` RFC9207 usan el issuer dedicado.

Los access/refresh tokens se almacenan como SHA-256. El JWT y las credenciales
recordadas se cifran con Fernet. Códigos y rotación se consumen atómicamente.
Reintentos del mismo refresh dentro de 15 segundos reciben el mismo reemplazo,
guardado temporalmente cifrado; su vigencia restante se recalcula. Reutilizarlo
fuera de esa ventana revoca la familia. Rotar refresh no corta access tokens que
ya están en vuelo. Una lease atómica en SQLite serializa la renovación de Vimarx
por conexión; no se mantiene una transacción abierta durante el login HTTP.

Sólo un 401 de Vimarx permite renovar y repetir una consulta una vez. Los errores
de permiso no disparan login ni reintentos. Hay CSRF, formularios simultáneos
acotados, cookies Secure/HttpOnly/SameSite y límites por IP. La CSP permite sólo el
sitio propio y el callback validado para esa transacción; Chromium comprueba
`form-action` también en el salto posterior al POST.

El contenedor usa un worker Gunicorn con ocho threads, usuario sin root, código
de sólo lectura y sin capabilities Linux. SQLite usa WAL y espera acotada por
bloqueo. Las tablas nuevas se crean de forma aditiva: no se cambian columnas de
sesiones existentes. Preservar el volumen y las claves al desplegar/reiniciar.

## Herramientas y permisos

`READ_TOOLS` contiene 26 herramientas explícitas de lectura, incluidas
`query_entidad`, `query_socios`, búsquedas de socios y metadatos. El listado y la
ejecución usan la misma lista. Las consultas genéricas admiten 1–200 filas, con
50 por omisión y longitudes de criterios acotadas. El esquema publicado refleja
ese límite. Cada herramienta anuncia OAuth y sus annotations de lectura.

Para las últimas solicitudes: descubrir la entidad y propiedades con
`get_entidades` y `get_propiedades`, después usar `query_entidad` con los campos
correctos, orden de fecha descendente y `limit: 3`. Las instrucciones iniciales
explican los nombres snake_case reales de las herramientas.

No se habilitan escrituras, acciones de negocio, batches, recursos ni prompts.
Cada consulta usa el JWT de su propio usuario; no hay cuenta compartida ni token
general. Vimarx sigue validando sus permisos. El origen es fijo y HTTPS se valida;
la respuesta upstream se limita a 8 MiB. Nunca se registran contraseñas, tokens,
cuerpos ni URLs OAuth. Hay eventos operativos sin identificadores personales:
`vimarx_session_renewed`, `vimarx_credentials_rejected`, `oauth_refresh_reuse_revoked`.

## Despliegue y operación

1. Verificar/aplicar el registro de `deploy/dns.json`.
2. Subir **sólo el árbol de esta app de una revisión Git concreta** al runtime.
3. Ejecutar `python3 deploy/install.py --revision FULL_GIT_COMMIT_SHA`.

El instalador toma primero un snapshot consistente SQLite privado (modo 0600),
sin copiar las claves, con retención de siete días y poda diaria; luego construye, publica el desafío ACME HTTP sin detener Apache,
obtiene un certificado con Certbot/webroot y conserva las claves del `.env`.
Comprueba la revisión y DB del contenedor, valida Apache y activa el vhost dedicado.
Retira únicamente el include de la ruta anterior de Kestra. En fallo restaura el
`.env`, vhost y publicación anteriores y vuelve a levantar la imagen anterior.
No actualiza otros contenedores ni limpia imágenes. El certificado guarda su
hook de reload; el timer propio `vimarx-mcp-cert-renew.timer` verifica dos veces al
día únicamente este certificado, sin modificar la renovación de otros sitios. El timer `vimarx-oauth-cleanup.timer` ejecuta limpieza diaria aunque no
haya tráfico; también se limpia cada cinco minutos con tráfico y en cada deploy.

Verificar `/health` (revisión + DB), discovery HTTPS y el formulario publicado.
Revisar `docker compose ... ps`, los eventos del contenedor y
`systemctl status vimarx-oauth-cleanup.timer`. No habilitar logs de acceso para
investigar OAuth. Para recuperar cuentas deshabilitadas, el operador puede usar
`flask --app gateway.app:create_app revoke-account --username USUARIO`.

El cifrado protege una copia aislada de SQLite; no protege contra control total
de la VPS y su clave. Un backup debe proteger volumen y claves por separado,
con permisos privados: el borrado del servicio activo no borra de inmediato
copias históricas, que pueden conservar los cifrados hasta siete días. Nunca subir `.env`, SQLite, backups o credenciales a Git.
Para rollback, volver al árbol e imagen de la revisión anterior conservando claves
 y volumen; volver al dominio anterior requiere restaurar también su issuer y
vhost. Las sesiones emitidas para un issuer no son intercambiables con otro.

## Verificación

```sh
python -m pip install -r requirements-dev.txt
python -m pytest tests -q
```

Las pruebas cubren expiración, renovación con contraseña cifrada, rotación y
reintentos concurrentes, aislamiento, revocación, inactividad, reinicios, CSRF,
permisos, límites de lectura y rollback de despliegue. CI propio para esta app.

Prueba publicada con un JSON privado o `--credentials-file -` para recibirlo por
stdin (evita crear una copia plana). Nunca pasar secretos como argumentos:

```sh
python deploy/probe.py --issuer https://mcp.redunisol.com.ar \
  --credentials-file /ruta/privada/probe.json --remember
```

La prueba reproduce DCR de ChatGPT, login/PKCE, rotación con reintento, discovery,
`get_version`, `contexto_cliente` y consulta vacía de `Solicitud`, bloqueo de
escrituras y código repetido. Revoca y borra su conexión al finalizar. La función
`probe(..., before_renew=hook)` permite que un operador venza **sólo su propia
sesión de prueba** y compruebe la renovación real en la próxima consulta.
No imprime credenciales ni datos de negocio. La renovación efectiva del cliente
ChatGPT y sus posibles avisos se valida además en esa interfaz.

Al migrar desde la URL de Kestra, cambiar la URL del plugin a la nueva, refrescar
metadatos y conectar una vez seleccionando Mantener conectado. Las sesiones
anteriores no guardaban contraseña y no se convierten silenciosamente.

Fuentes del contrato:
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://docs.authlib.org/en/stable/oauth2/authorization-server/flask/authorization-server.html


## Paquetes privados

Nombre visible: **Celesol · Vimarx**. Fuente: `plugin/vimarx-celesol/`.
El símbolo se toma sin modificar de `https://redunisol.com.ar/logo.jpeg`.

OpenAI marca **Desktop only** cualquier plugin importado con declaraciones MCP,
incluso si sólo incluyen una URL HTTPS. Esa variante funciona en Codex local,
pero no habilita herramientas en el chat normal. Se verificó al reproducir el
problema de 2.0.1: el cliente local devuelve datos y el chat normal no recibe tools.

Exportar para escritorio/Codex local:

```sh
python deploy/build_plugin.py --output /salida/celesol-vimarx-desktop-2.0.4.zip
```

Para ChatGPT, registrar primero la conexión privada al endpoint OAuth mediante
**Agregar servidor MCP personalizado**. Obtener su App ID real, no el plugin ID,
y exportar la variante que referencia esa conexión registrada:

```sh
python deploy/build_plugin.py --registered-app-id APP_ID_VERIFICADO \
  --output /salida/celesol-vimarx-chatgpt-2.0.4.zip
```

El App ID se suministra al exportar y no queda fijo en Git. Esta variante contiene
`.app.json` (dependencia requerida), manifiesto portable y overlay compatible,
sin archivos ni declaraciones MCP. Conserva skills, prompts e identidad. Cada
destinatario debe tener acceso a la App y completar OAuth; un App ID personal
privado no se hace distribuible a otras cuentas por incluirlo en un ZIP.

Al actualizar la importación 2.0.1 con el editor de archivos, borrar explícitamente
`mcp.json`, `.mcp.json` y `assets/icon.png`, porque los archivos omitidos se conservan.
El overlay actualizado ya no declara `mcpServers`; el logo pasa a `assets/icon.jpeg`.
Verificar con una lectura posterior que no haya declaraciones MCP residuales,
que la ficha web permita abrir el plugin y que la conexión espere OAuth del usuario.

Referencia: https://learn.chatgpt.com/docs/enterprise/plugin-management

## Preparación para el directorio público

La instalación privada 2.0.4 y sus App IDs se conservan fuera de Git.
`python deploy/build_public_plugin.py --output /ruta/celesol-vimarx-public-2.1.0-draft.zip`
genera una copia para revisión pública, con OAuth descubierto desde el endpoint
HTTPS, sin `.app.json`, credenciales ni referencias a la conexión privada.
El logo es una recodificación PNG de los mismos píxeles del JPEG aprobado.
La configuración confirmada del publicador, países, ausencia de cobros y los
cinco casos positivos y tres negativos están en `plugin/public-submission.json`.
Los datos del socio 900001 y préstamo 910001 son fixtures ficticios implementados
en el backend sintético, no registros existentes en Vimarx. Los cinco recorridos
positivos se verifican por API en tests/test_demo.py sin acceso de red. La
grabación real en ChatGPT cubre los cinco recorridos y dos rechazos de escritura;
la regresión de otra conexión se verificó por separado con el plugin 2.0.4.
Todavía deben ejecutarse los casos en la versión guardada en el portal de envío.

Páginas: `/`, `/support`, `/privacy`, `/terms`; contacto confirmado:
info@redunisol.com.ar. Las URL del ZIP deben comprobarse en producción tras
desplegar esta revisión antes de considerar el paquete listo.

Pendientes externos: identidad verificada de Santiago Agustín Acosta,
credenciales demo cargadas de forma privada en el portal, casos ejecutados con
dicha cuenta en la versión de envío, verificación de dominio y conexión
en el portal. El ZIP es un borrador: no enviarlo como listo ni confundir upload,
envío a revisión y publicación. Las credenciales del revisor se ingresan solo
en los campos seguros del portal. Nunca usar la cuenta personal de producción.

## Cuenta de demostración sintética

El mismo endpoint OAuth/MCP puede aceptar la cuenta reservada `__demo_celesol__`.
Está deshabilitada por omisión. Habilitarla requiere `DEMO_ENABLED=1`, un
`DEMO_PASSWORD_HASH` Werkzeug scrypt o pbkdf2:sha256, y una `DEMO_TOKEN_KEY`
Fernet exclusiva, distinta de `TOKEN_ENCRYPTION_KEY`. Guardar contraseña y claves
solo en el archivo local canónico de accesos y en el `.env` operativo necesario.
No hay una contraseña de fábrica, ni se incluyen credenciales en el ZIP.

El token interno del demo es opaco, autenticado con la clave propia y ligado al
issuer, la cuenta, la generación de contraseña y una hora de vigencia. Nunca
sale al cliente como respuesta de herramienta. El OAuth externo usa PKCE,
rotación y renovación existentes; con Mantener conectado renueva el demo
localmente, sin llamar al login de Vimarx. El borrado de conexiones usa la misma
cuenta reservada. No cambia el esquema ni convierte sesiones productivas.

El router decide por el token autenticado de la sesión, nunca por argumentos,
headers, criterios ni una entidad elegida por el modelo. Login demo incorrecto,
cuenta deshabilitada, token vencido/alterado/de otro issuer, herramienta ausente
o consulta no soportada fallan sin fallback al backend productivo. Desactivar
la cuenta o rotar su hash/clave impide volver a usar sus tokens internos.
`flask --app gateway.app:create_app revoke-account --username __demo_celesol__`
revoca también sus conexiones OAuth. Las cuentas reales conservan su ruta y sus
permisos. Los tests usan un backend que falla si recibe cualquier llamada y
bloquean httpx/socket para comprobar el aislamiento del demo.

### Selección de cuenta en ChatGPT

El aislamiento del router cubre cada token autenticado. No controla las otras
Apps o cuentas que una persona haya conectado por separado en ChatGPT. En una
prueba del 30/10/2026, el modelo consultó metadatos de una conexión de producción
al buscar otra mutual desde una conversación DEMO; no consultó socios reales.
Eso es un cambio de conexión en el host, no un fallback del router sintético.

La skill desde 2.0.4 exige mantener conexión, cuenta y ambiente durante consultas,
metadatos, errores y reconexiones; prohíbe descubrir o probar alternativas cuando
se eligió DEMO y rechaza pedidos de otra mutual sin invocar herramientas. Un
cambio explícito de cuenta invalida el contexto previo y exige reconfirmación.
Estas instrucciones reducen cambios indebidos del modelo, pero no son una barrera
de autorización sobre otras Apps. Para una revisión con aislamiento estricto,
usar una cuenta o perfil de ChatGPT que sólo tenga acceso al demo. No deshabilitar
cuentas productivas del usuario como efecto de una prueba.

La regresión de host debe comenzar en un chat nuevo del plugin actualizado:
confirmar DEMO, pedir el servidor de otra mutual aun con otra conexión autorizada,
comprobar el rechazo sin actividad de herramientas y confirmar que sigue en DEMO.
Repetir con un resultado vacío o función no soportada; nunca usar producción para
completar el resultado. La prueba automática del router y esta prueba del host
son evidencias distintas; una no sustituye a la otra.

Verificación del 30/10/2026 con el plugin privado 2.0.4 en un chat nuevo de
ChatGPT (GPT-5.6 Sol): confirmó la cuenta DEMO, rechazó buscar el servidor Fiat
mediante otra conexión autorizada sin mostrar actividad de herramientas en esa
respuesta, y devolvió socio 999999 inexistente sin completar con producción.
Son resultados observados de dos regresiones del host, no una garantía de que
un modelo nunca pueda elegir otra App disponible. La suite local pasó 156 tests.

Los 26 nombres de herramientas y sus argumentos de lectura tienen un catálogo
sintético local en gateway/demo_tools.json. Todos los resultados anuncian DEMO,
datosFicticios y synthetic-v1; initialize también identifica el simulador.
La fecha de trabajo del fixture es 2026-10-30. Los correos usan example.invalid.
Los calendarios, herencia y cálculos de deuda son ilustrativos; no afirman
reproducir el motor financiero ni el esquema completo de Vimarx.

`query_entidad` admite las entidades locales devueltas por get_entidades,
comparaciones (=, !=, <>, <, <=, >, >=), And/Or/Not, In, Contains/StartsWith/EndsWith,
fechas #ISO#, propiedades simples, orden múltiple y un agregado Count/Sum/Avg/Min/Max
con agrupación opcional. No ejecuta SQL, Python ni XPO real. Otros operadores y
expresiones fallan explícitamente. Límites: 200 filas, 4096 caracteres, 256 tokens
y 16 niveles de paréntesis. El campo de orden debe figurar en la proyección.
El fixture es inmutable entre consultas y no contiene ninguna exportación real.

Para la revisión pública, declarar en las instrucciones seguras que esta cuenta
simula datos localmente y no está conectada a una instalación demo de Vimarx.
Probar los prompts con esta cuenta y grabar el flujo real en ChatGPT. El acceso
solo no equivale a una revisión aprobada. No publicar sus credenciales en la
ficha, README, video ni ZIP.

## Video público de revisión

Página: `https://mcp.redunisol.com.ar/demo/`. El MP4 aprobado, de 144 segundos y
1280×720 sin audio, sólo muestra datos ficticios. No se distribuye la grabación
original que contiene pruebas adicionales. El checksum y nombre inmutables están
en `deploy/demo-media.json`; el binario se conserva como artefacto de publicación,
fuera del ZIP del plugin y de las carpetas privadas del gateway.

El vhost sirve exclusivamente `public-demo/` para `/demo/`, sin listar directorios.
La publicación usa un archivo explícito y valida su tamaño y SHA-256 antes de
copiarlo; no recorre carpetas ni publica credenciales. Para reproducir el estado,
desplegar los archivos de `deploy/` y ejecutar en la VPS autorizada:

```sh
python3 /opt/vimarx-oauth-gateway/deploy/publish_demo.py --media /ruta/al/mp4-aprobado
```

El script valida Apache y hace una recarga graceful, sin reiniciar el gateway;
restaura el vhost anterior si la validación o recarga falla. Verificar HTTPS,
`Content-Type: video/mp4`, respuestas parciales 206 y reproducción en navegador.
El catálogo demo describe sólo las capacidades del simulador, incluyendo sus
límites XPO, calendario ilustrativo y ausencia de cálculos financieros reales.

Verificación operativa del 30/10/2026: revisión
`5da455d63aefefc19bdf2fbd5187fd68532daae2` desplegada, claves y configuración
productivas conservadas. Estado deseado de esta VPS: `DEMO_ENABLED=1`, con hash y
clave demo propios tomados del registro local de accesos; no hay valores secretos
en Git. Página y MP4 publicados, checksum coincidente, tipo `video/mp4`, rangos
HTTP 206 y reproducción en Chrome comprobados sin autenticación.

Revisión final: 159 tests locales; los cinco recorridos por HTTPS, las 26 tools,
OAuth DCR/PKCE, renovación, límites y rechazo de escrituras pasaron nuevamente.
La renovación se forzó sólo sobre una sesión demo creada para la prueba y esa
conexión se revocó al terminar. El ZIP público 2.1.0 incluye la URL del video,
metadatos base en inglés y traducción es-419, icono PNG y cinco casos positivos
más tres negativos. El caso de préstamos describe el único préstamo del fixture.

El portal de la organización Personal exige verificar la identidad individual
antes de aceptar la carga. El ZIP no se subió ni se envió a revisión en esta
comprobación. Tras verificar la identidad quedan la carga, verificación de dominio,
conexión demo y pruebas del portal, credenciales privadas del revisor y
declaraciones del publicador. La aprobación y publicación no se deducen de estas
comprobaciones locales.
