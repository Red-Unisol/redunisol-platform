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
Los callbacks permitidos son únicamente las rutas HTTPS conocidas de ChatGPT.
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


## Paquete privado distribuible

Fuente del paquete: `plugin/vimarx-celesol/`. Usa Agent Plugins 1.0, OAuth DCR y
el endpoint verificado del servicio. No incluye credenciales, App IDs personales,
código del servidor ni tokens. Cada destinatario autentica su propia cuenta.

```sh
python deploy/build_plugin.py --output /ruta/de/salida/vimarx-celesol-2.0.0.zip
```

El builder valida JSON/YAML, componentes y assets, crea un ZIP reproducible con
una sola carpeta raíz y rechaza archivos no previstos. En ChatGPT: Complementos
→ Agregar → Cargar archivo del complemento, instalar y conectar. También puede
compartirse una versión del workspace con su equipo. La importación puede estar
restringida por políticas del workspace. El ZIP no publica en el directorio público.
El plugin personal anterior no se cambia ni se comparte al generar este archivo.
