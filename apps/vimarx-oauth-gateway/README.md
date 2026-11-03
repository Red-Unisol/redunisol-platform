# Vimarx OAuth gateway

Puente de consultas por usuario entre clientes MCP y Mutual Celesol. Código y estado
operativo deseado en Git; Docker/Apache en la VPS son el runtime.

El mismo código tiene dos perfiles. Cada uno necesita su propia conexión OAuth:

| Perfil | MCP | Issuer / inicio | Alcance |
| --- | --- | --- | --- |
| Interno (`internal`) | `https://mcp.redunisol.com.ar/mcp` | `https://mcp.redunisol.com.ar` | Catálogo completo de 26 herramientas de lectura y permisos de Vimarx. |
| Directorio (`directory`) | `https://mcp.redunisol.com.ar/directorio/mcp` | `https://mcp.redunisol.com.ar/directorio` | Ocho herramientas específicas, búsqueda por nombre o número interno y campos permitidos. |

La edición del directorio 2.2.0 está en preparación. Su presencia en Git o en un
ZIP no acredita un despliegue, compatibilidad con el esquema productivo ni una
revisión aprobada; las verificaciones pendientes se detallan más abajo.

- Borrado de conexiones: `/connections` respecto del issuer de cada perfil.
- Origen fijo: `https://celesol.dyndns.org:35010`
- Runtime compartido de código: `/opt/vimarx-oauth-gateway`. Instancia interna
  `127.0.0.1:3060`; instancia de directorio `127.0.0.1:3061`.
- DNS deseado: `deploy/dns.json`. El host tiene su propio certificado y vhost;
  no comparte rutas ni issuer con Kestra.

## Experiencia del usuario

Agregar un MCP personalizado en ChatGPT, autenticación OAuth y registro dinámico
DCR, usando la URL correspondiente a la edición elegida. Instalarlo y conectar
el usuario habitual de Vimarx. Instalar ambas ediciones no amplía el alcance de
la del directorio: una consulta debe conservar su conexión, cuenta y ambiente.
Para recordar el acceso,
seleccionar **Mantener conectado** en el formulario. Esa elección autoriza guardar
las credenciales cifradas en la VPS; no se envían al modelo, cookies ni herramientas.
Sin esa opción, la contraseña sólo se usa en el login inicial y no se conserva.

El token OAuth del cliente dura 30 minutos. Con conexión recordada se emite un refresh
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

## Claude: edición interna con DNI/CUIT

Compartir **https://mcp.redunisol.com.ar/claude**. Esa ruta abre el formulario
oficial de Claude con el nombre `Celesol · Vimarx Interno` y la dirección
`https://mcp.redunisol.com.ar/mcp` ya cargados. No lleva tokens ni conecta una
cuenta automáticamente. Cada persona confirma el alta y autoriza su propio
usuario de Vimarx; en Claude debe elegir **Registrar automáticamente**
(**Register automatically** en inglés) para DCR.
La opción **Mantener conectado** habilita refresh y renovación de Vimarx con
los mismos controles de cifrado, actividad y revocación descritos arriba.

La compatibilidad de Claude se limita al perfil interno. Conserva las 26
herramientas de lectura, incluidas las búsquedas por DNI/CUIT, y los permisos del
usuario. El perfil del directorio conserva su catálogo y sus callbacks; no se
habilita Claude en esa edición ni se reemplaza su conexión de OpenAI.

El callback alojado admitido es exclusivamente
`https://claude.ai/api/mcp/auth_callback`, con coincidencia literal. El formulario
muestra el hostname del cliente validado antes de autorizar. No se admiten
subdominios, puertos, query strings o rutas alternativas de Claude.

La verificación debe distinguir las pruebas locales y del protocolo OAuth de
un recorrido real en Claude: DEMO, búsqueda de su DNI ficticio y una consulta
posterior a renovar. No presentar una prueba de servidor como una conexión
real de Claude ni usar una cuenta productiva para el recorrido sintético.

Referencias oficiales: [autenticación de Claude](https://claude.com/docs/connectors/building/authentication)
y [enlaces de instalación](https://claude.com/docs/connectors/building/directory-vs-custom).

Para actualizar únicamente esta instancia, exportar primero el árbol exacto del
commit revisado bajo `/opt/vimarx-oauth-gateway` y ejecutar allí:

```bash
python3 deploy/update_internal.py --revision SHA_COMPLETO
```

Este actualizador requiere ambos perfiles ya instalados. Construye la imagen,
respalda la base interna y cambia únicamente su `APP_IMAGE`. Conserva claves,
credenciales, volumen y puerto. Verifica que la identidad del contenedor del
directorio, su entorno y los videos permanezcan iguales; no modifica Apache,
DNS, timers ni reinicia el directorio. Ante un error revierte sólo la instancia
interna. El instalador general `deploy/install.py` actualiza ambos perfiles y
no corresponde a una intervención limitada como ésta.

`deploy/probe.py --client claude --remember` comprueba el protocolo con la cuenta
DEMO: DCR, PKCE, catálogo interno, DNI/CUIT ficticios y rotación/reintentos de
refresh. Las credenciales se leen de stdin o de un archivo privado, nunca de
argumentos. Los callbacks se verifican y parsean localmente sin pedir la URL de
Claude. Los hooks de vencimiento de su API Python deben resolver el hash del
access token de esa prueba y actuar exclusivamente sobre esa sesión DEMO;
nunca reducir el plazo global ni modificar otras conexiones. Esta prueba de
protocolo no sustituye comprobar el ingreso y uso en el cliente real de Claude.

## OAuth y concurrencia

Authlib implementa Authorization Code, PKCE S256 obligatorio, DCR y refresh. El
cliente, callback, scope `mcp:read` y resource quedan ligados a cada transacción.
Los callbacks permitidos son las rutas HTTPS conocidas de ChatGPT, el callback
exacto de Claude sólo en el perfil interno, y las rutas
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

El perfil interno usa `READ_TOOLS`: 26 herramientas explícitas de lectura, incluidas
`query_entidad`, `query_socios`, búsquedas de socios y metadatos. El listado y la
ejecución usan la misma lista. Las consultas genéricas admiten 1–200 filas, con
50 por omisión y longitudes de criterios acotadas. El esquema publicado refleja
ese límite. Cada herramienta anuncia OAuth y sus annotations de lectura.

En el perfil interno, para las últimas solicitudes: descubrir la entidad y propiedades con
`get_entidades` y `get_propiedades`, después usar `query_entidad` con los campos
correctos, orden de fecha descendente y `limit: 3`. Las instrucciones iniciales
explican los nombres snake_case reales de las herramientas.

El perfil del directorio usa exclusivamente `gateway/directory.py:SPECS`:

| Herramienta | Entrada / límite |
| --- | --- |
| `contexto_cliente` | Sin argumentos; confirma empresa, perfil y ambiente. |
| `get_fecha_trabajo` | Sin argumentos; devuelve `resultado.fechaTrabajo`. |
| `buscar_socios` | `nombre` de 2–100 caracteres, sólo letras, espacios, apóstrofes y guiones; `limit` 1–50, por omisión 20. |
| `get_socio_por_numero` | `nroSocio` interno. |
| `get_solicitudes_recientes` | `limit` 1–50, por omisión 3; sólo solicitudes con fecha, en orden descendente de fecha. |
| `get_solicitudes_socio` | `nroSocio`; `limit` 1–50, por omisión 20; sólo solicitudes fechadas de ese socio, en orden descendente de fecha. |
| `get_prestamos` | `nroSocio`; hasta 50 registros. |
| `get_cuotas_prestamo` | `idPrestamo` único obtenido de `get_prestamos`; hasta 50 registros; sin argumento de fecha. |

Los identificadores de entrada son enteros positivos de hasta 2147483647. No se
aceptan argumentos adicionales. Las respuestas se construyen con un DTO propio: socio
(`nroSocio`, `nombre`, `apellido`, `estado`), solicitud (`nroSolicitud`, `fecha`,
`monto`, `estado`, `nroSocio`), préstamo (`idPrestamo`, `nroPrestamo`, `nroSocio`,
`capital`, `saldo`, `fecha`, `estado`, `moneda`) o cuota (`nroCuota`, `idPrestamo`, `nroPrestamo`,
`fecha`, `capital`, `interes`, `pagado`, `saldo`). `pagado` suma capital e interés
pagados y no incluye otros cargos. La fecha de cuota no se presenta como
vencimiento porque su semántica no está confirmada. La moneda conserva el valor
devuelto por Vimarx; no se fuerza una conversión de enumerados a códigos ISO.
El sobre incluye `empresa`, `ambiente`, `datosFicticios`, `perfil=directorio`,
`soloLectura`, `resultado`, `truncado` y `aviso`. Una lista truncada no permite
inferir el total ni calcular una deuda completa.
Los números de préstamo pueden repetirse entre sucursales. Para consultar cuotas,
el cliente obtiene primero los préstamos del socio y usa el `idPrestamo` único
devuelto; nunca interpreta `nroPrestamo` como ID ni mezcla cuotas por ese número.
`nroCuota` es un contador Int32 con signo: admite cero y valores negativos para
cuotas especiales, sin renumerarlos ni confundirlos con identificadores.

Ambas listas de solicitudes excluyen registros sin fecha asignada y llevan un
aviso propio que lo indica. Sólo se garantiza fecha descendente; entre fechas
iguales no se promete un orden por número de solicitud. Una lista vacía no prueba
la inexistencia de solicitudes sin fecha; tampoco se infieren totales globales.
Únicamente en el DTO de solicitud, un `NroSocio` de origen cero o nulo se representa
como `nroSocio: null`, sin socio asignado. No se inventa un ID ni se habilita cero
o nulo como argumento para consultas de socio.

Esta edición no expone DNI/CUIT, contactos, domicilios, movimientos de cuentas,
consultas genéricas ni metadatos arbitrarios. La barrera está en el servidor:
valida las entradas, construye proyecciones fijas y no entrega registros crudos.
Un esquema o respuesta no reconocidos producen un error sin fallback al perfil
interno. Los mappings productivos requieren una auditoría y una prueba real;
una consulta DEMO exitosa no demuestra compatibilidad con Vimarx productivo.

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

El estado deseado despliega ambos perfiles desde la misma revisión, con proyectos
Compose y volúmenes separados: `vimarx-oauth-gateway` usa `.env` y
`vimarx-oauth-directory` usa `.env.directory`. El segundo archivo sigue
`deploy/directory.env.example`, con `GATEWAY_PROFILE=directory`, issuer
`/directorio`, puerto 3061 y claves propias. El instalador conserva la instancia
interna, sus claves y sesiones; crea claves independientes para el directorio y
sólo puede reutilizar el hash del login sintético habilitado, nunca sus claves.
No copiar una base de sesiones ni tokens entre perfiles. Las cookies tienen
nombres y rutas propios; los resource/issuer de OAuth también son distintos.

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

Verificar `/health` y `/directorio/health` (revisión + DB), discovery HTTPS y
el formulario de cada issuer. Comprobar que un token no autorice el otro perfil.
Revisar `docker compose ... ps`, los eventos del contenedor y
`systemctl status vimarx-oauth-cleanup.timer`. No habilitar logs de acceso para
investigar OAuth. Para recuperar cuentas deshabilitadas, el operador puede usar
`flask --app gateway.app:create_app revoke-account --username USUARIO`.
Ejecutar la revocación dentro del proyecto Compose de la conexión afectada;
revocar en un perfil no elimina conexiones creadas en el otro. La limpieza
diaria y los backups recorren ambos perfiles; el directorio usa
`backups/directory/` y mantiene su retención independiente.

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

La instalación privada 2.0.4 y sus App IDs se conservan. El builder público usa
su manifiesto y logo aprobados, pero sustituye README, skill, instrucciones y
endpoint por los de `plugin/directory-content/`. No modifica la fuente privada.
El ZIP no contiene `.app.json`, credenciales ni bindings a Apps privadas.
El logo PNG conserva exactamente los píxeles del JPEG aprobado.
La edición pública usa el nombre técnico `celesol-vimarx-directorio`, separado
del paquete interno `vimarx-celesol`; conserva la identidad visible Celesol · Vimarx.
Su única declaración MCP pública se llama `vimarx-celesol-directorio`.

Generar el candidato de revisión con el video verificado de la metadata:

```sh
python deploy/build_public_plugin.py \
  --require-demo-recording \
  --output /ruta/celesol-vimarx-public-2.2.0.zip
```

La identidad confirmada de Santiago Agustín Acosta, todos los países disponibles,
ausencia de cobros, traducción es-419 y los cinco casos positivos y tres negativos
están en `plugin/public-submission.json`. Los recorridos positivos usan las ocho
herramientas específicas con los fixtures ficticios del socio 900001 y préstamo
910001: últimas solicitudes, búsqueda por nombre, préstamos de un socio, fecha
de trabajo y cuotas con fechas/pagos/saldos registrados, y solicitudes de un socio.
Los negativos cubren documentos gubernamentales, escrituras y cambio de mutual
mediante otra conexión. `tests/test_directory_profile.py` verifica el servidor;
`tests/test_public_plugin.py` verifica el paquete y sus casos. Estas pruebas no
sustituyen la ejecución con el modelo de la versión guardada en el portal.

Las páginas de esta edición son `/directorio/`, `/directorio/support`,
`/directorio/privacy` y `/directorio/terms`, con info@redunisol.com.ar como contacto.
El despliegue dual, la aceptación HTTPS, el aislamiento y el contrato productivo
acotado ya se comprobaron; las evidencias y límites figuran al final de esta guía.
Revalidar las URL y el acceso de revisión al preparar el envío, sin usar datos
reales de socios para la revisión pública.

El nuevo [video del directorio](https://mcp.redunisol.com.ar/demo/directorio/celesol-vimarx-directorio-demo-2026-11-02.mp4)
está publicado y su reproducción por HTTPS fue verificada. La grabación anterior
de `/demo/` muestra las 26 herramientas y se conserva como evidencia histórica;
el candidato 2.2.0 referencia exclusivamente la grabación restringida.

El flag `--require-demo-recording` del comando de construcción anterior impide
generar el candidato sin una URL de video; no comprueba por sí solo su reproducción
ni convierte el ZIP en una versión aprobada. En el portal,
verificar la App y URL efectivamente guardadas: volver a cargar el ZIP preserva
conexión, autenticación y escaneos previos y no migra automáticamente `/mcp` a
`/directorio/mcp`. No ejecutar los casos ni enviarlo si sigue asociada la conexión
interna. El nuevo nombre de servidor tampoco garantiza una migración de App.
Si el borrador anterior 2.1.1 no admite reemplazar la URL y conserva su App
interna, crear un nuevo borrador **público** en RED UNISOL con el ZIP final;
conservar el borrador anterior y no crear un plugin privado duplicado. Verificar
que el borrador elegido tenga exactamente una conexión `/directorio/mcp`, sin
una App interna residual. Reconectar DEMO, ejecutar los ocho prompts contra la versión restringida,
repetir escaneos y completar acceso del revisor y declaraciones del publicador.
Las credenciales sólo van en los campos privados del portal, nunca en el ZIP,
ficha o video. Carga, envío a revisión y publicación son estados distintos.

## Cuenta de demostración sintética

Cada perfil OAuth/MCP puede aceptar la cuenta reservada `__demo_celesol__`.
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

En el perfil interno, los 26 nombres de herramientas y sus argumentos de lectura tienen un catálogo
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
El perfil del directorio reutiliza ese fixture mediante proyecciones internas
fijas y entrega sólo sus ocho herramientas y DTO permitidos; no publica el
catálogo genérico del simulador. Las claves y sesiones DEMO siguen separadas
entre perfiles aunque se autorice el mismo usuario sintético.

Para la revisión pública, declarar en las instrucciones seguras que esta cuenta
simula datos localmente y no está conectada a una instalación demo de Vimarx.
Probar los prompts con esta cuenta y grabar el flujo real en ChatGPT. El acceso
solo no equivale a una revisión aprobada. No publicar sus credenciales en la
ficha, README, video ni ZIP.

## Estado operativo deseado del demo y checkpoint — 30/10/2026

En `mcp.redunisol.com.ar`, el demo sintético está habilitado mediante
`DEMO_ENABLED=1`. La cuenta reservada es `__demo_celesol__`; su contraseña,
hash y clave exclusiva se mantienen solo en los accesos privados y en el
`.env` operativo necesario. El valor 0 del archivo de ejemplo es el valor
seguro para instalaciones nuevas, no el estado deseado de esta VPS.
Preservar `GATEWAY_SECRET_KEY`, `TOKEN_ENCRYPTION_KEY`, `VIMARX_ORIGIN`,
`DATABASE_URL` y el volumen existente en los despliegues siguientes.

Evidencia del despliegue del 30 de octubre de 2026: revisión mergeada
`479b407b650b43182d72d9e54e235fe44f26e5f7`, contenedor saludable sin reinicios,
timers de limpieza y certificado activos. La prueba HTTPS verificó las 26
herramientas demo, los cinco recorridos positivos por API, rechazo de escrituras
y consultas no soportadas, rotación y reintento del refresh, renovación tras
vencer solo la sesión demo de prueba y revocación de esa conexión al finalizar.
La cuenta productiva previamente conectada continuó respondiendo. Las páginas
`/`, `/support`, `/privacy` y `/terms` fueron verificadas públicamente.
Esta es evidencia histórica; verificar `/health` para conocer la revisión actual.

Al cierre de ese checkpoint seguían pendientes la ejecución de los casos por
ChatGPT, su grabación, las verificaciones del publicador y dominio y el envío al
directorio. Los checkpoints posteriores de este documento registran la evolución
de esas etapas. No interpretar la verificación de la API como evidencia de
aprobación de OpenAI.

## Video público histórico del catálogo completo

Este video corresponde a las 26 herramientas anteriores, no a la nueva edición
restringida 2.2.0. Página: `https://mcp.redunisol.com.ar/demo/`. El MP4 aprobado, de 144 segundos y
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

Actualización del 02/11/2026: la organización RED UNISOL
(`org-QL8GvReAuolL0HojLlzh4k5I`) figura como Verified, con la verificación
individual Approved. El portal aceptó el borrador público 2.1.1 de
`plugin_asdk_app_6ae8866ac7c481919ea7be2a7d30ff59`, con Santiago Agustín Acosta
como Developer, los cinco casos positivos y tres negativos completos, todos
los países disponibles, traducción es-419 y video público importados. La
descripción ya no incluye precios; metadata sin hallazgos y skill con Checks
passed. El plugin sigue Not submitted y Not published.

La ruta pública exacta `/.well-known/openai-apps-challenge` entrega el token
de verificación de dominio de ese borrador como texto plano. Es información
pública de comprobación de propiedad; no autoriza consultas MCP. Su test
comprueba cuerpo exacto, ausencia de llamadas a Vimarx y que el MCP conserva
el rechazo anónimo 401. Suite local completa: 160 tests aprobados.

Despliegue autorizado y comprobado el 02/11/2026: revisión
`4d0b0925438ad15298c46b44b999b8a8cef280f5` activa en la VPS, con `/health`
correcto por HTTPS. El desafío público respondió 200, `text/plain` y cuerpo
exacto; MCP sin autenticación siguió respondiendo 401. Se creó el backup privado
de SQLite y se conservaron las claves, configuración DEMO, volumen y sesiones
vigentes. No se cambiaron DNS ni la publicación del video.

La aceptación por HTTPS con una conexión demo nueva comprobó los cinco
recorridos, las 26 herramientas, OAuth DCR/PKCE, rotación y reintento de refresh,
límites y rechazo de escrituras. No se forzaron vencimientos ni se modificaron
sesiones existentes; sólo se revocó la conexión creada por esa prueba al terminar.
La conexión OAuth del portal ya figura Authorized con la cuenta sintética
`__demo_celesol__` y Mantener conectado, corroborada mediante una lectura
acotada de su sesión. El portal confirmó Domain verified y guardó las
credenciales e instrucciones sólo en los campos privados del revisor.

El escaneo MCP terminó con las 26 herramientas descubiertas y tres hallazgos
no bloqueantes en `get_socio_por_dni`, `get_socio_por_cuit` y `query_socios` por
identificadores gubernamentales; el filtro Blocking no muestra entradas.
Las reglas del directorio en
https://developers.openai.com/plugins/plugin-guidelines#data-collection
prohíben solicitar o procesar esa categoría. En ese checkpoint estaba pendiente
decidir el alcance de una edición pública que excluyera esos datos realmente,
incluidas las consultas genéricas y las respuestas, conservando aparte el MCP
interno. La decisión posterior es la edición restringida 2.2.0 descrita arriba;
los resultados de este escaneo de 26 herramientas no validan su nuevo catálogo.
Los recorridos por API no equivalen a ejecutar los ocho prompts con el modelo
en la versión guardada del portal; esa comprobación sigue pendiente junto a
las declaraciones del publicador. El plugin continúa sin enviarse a revisión
ni publicarse.

## Aceptación acotada del perfil de directorio — 02/11/2026

Las consultas autorizadas al MCP real confirmaron un comportamiento que los
probes vacíos no demostraban: las proyecciones simples con alias `as` devuelven
filas `{}`. El perfil público usa ahora proyecciones directas, incluidas las
rutas de relaciones con puntos, y construye el DTO localmente. Se comprobaron
las formas de respuesta de SocioMutual, Solicitud, Prestamo y CuotaPrestamo,
incluidos los enumerados como strings dentro de los valores permitidos.

La aceptación de las ocho herramientas terminó con `success: true` en la
evidencia local `2026-11-02-directory-production-contract.json`. El informe
conserva sólo formas, tipos y resultados de comprobaciones; no persiste valores
de registros ni credenciales. Es una comprobación acotada de lectura con un
usuario autorizado; incluye una lista de solicitudes del socio vacía y no
acredita todas las combinaciones de datos, permisos o instalaciones de Vimarx.

La evidencia también motivó el alcance explícito de solicitudes fechadas: las
dos listas excluyen registros sin fecha, usan `Fecha DESC` sin un desempate por
número y anuncian esa exclusión. Un socio no asignado se representa como `null`
sólo en solicitudes. Los contadores especiales de cuota admiten cero o negativos;
los identificadores de entrada siguen siendo positivos.

Esta aceptación del adaptador, por sí sola, no acreditaba un despliegue de la
nueva instancia `/directorio`, una conexión del borrador 2.2.0 en el portal ni
los recorridos del modelo en ChatGPT. Las verificaciones posteriores se
registran a continuación. Los ZIP previos a este contrato no son candidatos
válidos para el envío.

## Estado operativo y video del directorio — 02/11/2026

Los dos perfiles están desplegados y aceptados por HTTPS en la revisión
`00ab38cb68802c55701123c60827d4b2c9388f67`: interno con 26 herramientas y
directorio con ocho. Se verificaron OAuth, refresh, revocación y aislamiento;
se conservaron las claves, volumen y sesiones internas. La metadata del catálogo
y `initialize` es igual entre cuentas: el ambiente se confirma exclusivamente
con `contexto_cliente` y los marcadores de cada resultado, sin inferirlo de
descripciones o `serverInfo`.

Una instalación de desarrollo App-backed 1.0.1 se conectó a DEMO en ChatGPT Work.
El recorrido real respondió los cinco prompts positivos con los fixtures
esperados y rechazó los tres negativos; una consulta extra al socio inexistente
999999 devolvió ausencia de resultado manteniendo DEMO. Todos los casos usaron
la misma conversación y reutilizaron contexto: no equivalen a cinco ejecuciones
independientes. La interfaz mostró uso de integración y respuestas, pero no los
argumentos MCP detallados. Los rechazos sin tarjeta de integración son evidencia
de la interfaz, no una auditoría de red que pruebe ausencia absoluta de llamadas.
Esta prueba de desarrollo no ejecuta los casos de una versión guardada del portal.

El corte aprobado dura 229 segundos, tiene resolución 1280×666, H.264 sin audio y
ocupa 3.416.489 bytes. Nombre, duración, tamaño, URL y SHA-256 se registran en
`deploy/demo-directory-media.json`; la resolución y reproducción se comprobaron
en la QA del video. SHA-256:
`e00d548e38e79358348ab3c0c8386f406f676574f774b700f71ee1e835a7e3d1`.
La publicación devolvió HTTP 200, MIME de video y rangos 206; FFmpeg decodificó
por HTTPS los 6.870 frames sin errores y todos sus hashes coincidieron con el
candidato revisado. También se inspeccionó visualmente un frame remoto de cuotas.

El publicador de la revisión `f3df8f2beadddddc6757dbe1708d132ee27eecfb` permite
reproducir la publicación autorizada con:

```sh
python3 /opt/vimarx-oauth-gateway/deploy/publish_demo.py \
  --edition directory --media /ruta/al/mp4-aprobado
```

Esta edición valida el archivo aprobado y usa el Alias `/demo/` ya instalado.
Publica sólo su subcarpeta `directorio`, sin modificar ni recargar Apache y sin
reiniciar el gateway; conserva el video anterior y las sesiones.

El paquete está preparado para revisión; la etapa del portal permanece pendiente. Siguen
pendientes la conexión de la App pública al endpoint restringido, los ocho
prompts contra esa versión guardada, acceso privado del revisor, escaneos y
declaraciones del publicador. No se enviaron a revisión ni se publicaron en el
directorio estas nuevas capacidades.
