# Vimarx OAuth gateway

Puente OAuth por usuario para conectar ChatGPT con el MCP de Celesol, sin cambiar
el servidor Vimarx. Servicio independiente del resto de las aplicaciones.

- URL MCP: `https://kestra.redunisol.com.ar/vimarx-oauth/mcp`
- Página de conexión: `https://kestra.redunisol.com.ar/vimarx-oauth/`
- Origen fijo: `https://celesol.dyndns.org:35010`
- Docker Compose: `/opt/vimarx-oauth-gateway`, bind interno `127.0.0.1:3060`.

## Autenticación y permisos

Authlib implementa Authorization Code con PKCE S256 obligatorio. La página de
consentimiento valida el usuario y contraseña contra `/api/auth/login_user` de
Vimarx. La contraseña no se guarda. El JWT de Vimarx queda cifrado con Fernet en
SQLite y el cliente recibe un token opaco distinto, guardado solamente como hash.
Los códigos de autorización se guardan como hash y se consumen una sola vez,
incluso con intercambios concurrentes. El cliente, callback, PKCE, scope y resource
quedan ligados a la transacción. Hay protección CSRF y límites por IP.

La vigencia del token del puente es de hasta 30 minutos y nunca supera la del JWT
de Vimarx, descontando 15 segundos de margen. No se publican refresh tokens: al
vencer se vuelve a conectar la cuenta. El proveedor Vimarx no ha demostrado un
mecanismo de renovación que permita hacerlo sin conservar contraseñas.

Discovery RFC8414/RFC9728, DCR RFC7591 y respuesta `iss` RFC9207 se publican para
ChatGPT. El registro solamente acepta callbacks HTTPS de ChatGPT con rutas
conocidas. No hay fetch de URLs arbitrarias ni clientes CIMD en esta versión.
El registro acepta la preferencia `refresh_token` que envía ChatGPT junto con
`authorization_code`, pero devuelve y registra solamente `authorization_code`,
según la negociación de metadatos de RFC7591 §3.2.1. Un scope omitido, nulo o vacío
usa `mcp:read`. Esto no habilita refresh tokens ni cambia la duración de sesiones.
Otros grants o scopes se rechazan. La prueba publicada reproduce esta solicitud
real de ChatGPT, en lugar de probar sólo un cliente que pide el grant mínimo.

Se admite cliente público (`none`) o secreto de cliente por POST/Basic; los
secretos de cliente se almacenan como hash. Sólo se ofrece el scope `mcp:read`.

El proxy reenvía cada consulta con el JWT del usuario correspondiente. No usa
tokens generales de Vimarx ni una cuenta compartida. El upstream conserva la
decisión final sobre permisos. `READ_TOOLS` en `gateway/app.py` contiene la lista
explícita de herramientas habilitadas (16); se filtra tanto `tools/list` como
`tools/call`. Métodos desconocidos, batches y herramientas de escritura se
rechazan antes de contactar Vimarx. No se publica acceso a recursos ni prompts.
Se reconstruye el envelope JSON-RPC y se reemplazan las capacidades/instrucciones
de inicialización. La conexión upstream es Streamable HTTP stateless, como se
verificó en esta instalación. Un upstream que exija sesiones necesitaría soporte
adicional antes de cambiarlo.

El frontend HTTPS conserva la validación de certificados hacia Vimarx. El
contenedor corre sin root, filesystem de código de sólo lectura y sin capacidades
Linux adicionales. Los logs de acceso de Gunicorn están deshabilitados y las
rutas OAuth se excluyen del access log de Apache. No se registran credenciales ni
cuerpos de solicitudes/respuestas. Usuarios, códigos y tokens vencidos se purgan
cada cinco minutos con tráfico y también en cada deploy. `flask --app
gateway.app:create_app cleanup` permite ejecutar la limpieza manualmente.

## Configuración y deploy

Copiar las variables de `deploy/.env.example` a `.env` operativo, fuera de Git.
`deploy/install.py` genera las claves al primer despliegue y las preserva después;
rotarlas invalida las sesiones existentes. El volumen `gateway_data` contiene
SQLite; preservar volumen y claves juntos en un backup protegido.

Después de subir **el contenido de esta app de una revisión Git concreta** a
`/opt/vimarx-oauth-gateway`:

```sh
python3 deploy/install.py --revision FULL_GIT_COMMIT_SHA
```

El instalador construye la imagen con el SHA, valida Compose, espera el healthcheck
interno, instala el include `deploy/apache-route.conf` dentro del VirtualHost HTTPS
de `kestra.redunisol.com.ar` antes del proxy catch-all y agrega `env=!dontlog` a los
access logs para proteger las transacciones OAuth. Valida `apachectl -t` antes del
graceful reload. Conserva una copia previa del vhost; si falla la validación,
restaura el original. Ningún otro contenedor se actualiza ni se limpian imágenes.
Requiere Docker/Compose y el Apache existente de `/opt/apache`.

El SHA efectivo se obtiene en `/vimarx-oauth/health`. Para rollback, subir el árbol
de una revisión anterior y ejecutar el mismo instalador con ese SHA. Las claves y
el volumen se conservan. Para retirar la publicación, quitar el include del vhost,
validar/reload de Apache y detener únicamente el proyecto `vimarx-oauth-gateway`.

No desplegar desde archivos sin commit ni cambiar Vimarx, firewall o DNS como
parte de este servicio. El instalador sólo agrega rutas al dominio ya publicado.

## Pruebas

```sh
python -m pip install -r requirements.txt pytest
python -m pytest tests -q
```

Las pruebas aíslan el upstream y cubren OAuth/PKCE, reutilización de códigos,
sustitución de resource/callback, CSRF, límites de login, expiración, revocación,
aislamiento de usuarios y bloqueo de escrituras/discovery no permitido.

La prueba de punta a punta contra una instalación publicada usa un JSON local
ignorado con `user_name` y `user_password`; nunca pasar secretos como argumentos:

```sh
python deploy/probe.py --issuer https://kestra.redunisol.com.ar/vimarx-oauth \
  --credentials-file /ruta/privada/probe.json
```

No sigue el callback a ChatGPT: comprueba localmente `state` e `iss`, intercambia
el código con PKCE, llama `get_version` y `contexto_cliente`, verifica bloqueo de
escrituras/replay y revoca su token al terminar. No imprime credenciales ni datos
de negocio. Esta prueba verifica el protocolo publicado; la instalación efectiva
del plugin en una cuenta de ChatGPT es una validación separada.

## Agregar a ChatGPT

En ChatGPT web: Plugins → `+` → Add custom MCP server. Usar la URL MCP indicada,
autenticación OAuth y registro dinámico (DCR), sin pegar tokens generales de
Vimarx. Instalar el plugin y conectar la cuenta con el usuario habitual de Vimarx.
No agregar el callback de una aplicación distinta a la lista permitida.

Fuentes del contrato de integración:

- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/api/docs/guides/custom-mcp-server
- https://docs.authlib.org/en/stable/oauth2/authorization-server/flask/authorization-server.html
