# BCRA File API

Servicio interno FastAPI/Uvicorn que consulta los archivos de la Central de
Deudores. Expone contratos compatibles de deudas vigentes e histórico de 24
meses. No hay consumidores de negocio conectados, no escribe en Bitrix y no
consulta la API individual del BCRA. Cheques rechazados queda fuera de alcance.

## Contrato compatible

Autenticación interna: `Authorization: Bearer <token>`.

- `GET /centraldedeudores/v1.0/Deudas/{identificacion}`.
- `GET /centraldedeudores/v1.0/Deudas/Historicas/{identificacion}`.
- También se admite el prefijo `/CentralDeDeudores/v1.0`.

Las rutas validan 11 dígitos y devuelven el código HTTP y el cuerpo del contrato
BCRA: `status`, `results` con `identificacion` numérica, `denominacion` y
`periodos`, o `status` y `errorMessages` para errores. El JSON compatible no
agrega `meta`, códigos internos ni campos de procedencia.

Deudas vigentes selecciona el último mes **por entidad**, sin repetir la misma
entidad en meses anteriores. Incluye los campos `entidad`, `situacion`, `fechaSit1`,
`monto`, `diasAtrasoPago`, `refinanciaciones`, `recategorizacionOblig`,
`situacionJuridica`, `irrecDisposicionTecnica`, `enRevision` y `procesoJud`.
Histórico incluye `entidad`, `situacion`, `monto`, `enRevision` y `procesoJud` por
mes. Sólo se devuelven meses y entidades con información. Los montos están en
**miles de pesos**, con un decimal; internamente se almacenan como enteros.

El padrón ARCA aporta la denominación completa; se conserva el maestro `nomdeu`
como respaldo para identificaciones que no estén en el padrón. Del padrón se
importan exclusivamente identificación y denominación.

`1DSF` aporta el mes desde el que una persona permanece en situación normal en
todas las entidades. Se devuelve `fechaSit1` únicamente si todas las entidades
vigentes están en situación 1 y existe ese dato. Se usa la convención observada
en la API oficial: día 30, limitado al último día de febrero. El archivo sólo
tiene precisión mensual, declarada en `X-BCRA-Normal-Date-Precision: month`.

Los encabezados `X-BCRA-Source`, `X-BCRA-Period`, `X-BCRA-Version` y
`X-BCRA-Checked-At` permiten identificar la publicación usada sin alterar el JSON.
Las respuestas usan `Cache-Control: no-store`.

- HTTP 400: identificación inválida.
- HTTP 404: identificación sin datos en la cobertura cargada.
- HTTP 503: falta una publicación completa y validada para el contrato consultado
  o pasaron más de 72 horas sin su control exitoso. Histórico también devuelve
  503 hasta terminar y validar su primera carga; nunca devuelve filas parciales
  ni un 404 por registros todavía pendientes de importar.

**Deuda vigente funciona mientras el histórico se está cargando.** Primero se
descargan y verifican DEUDORES, INFRET e INFRETPA, y se construye o revalida la
base mensual completa. Se publica antes de descargar/importar los archivos
ampliados. Un fallo posterior del histórico no invalida ese control mensual.
Si el padrón y la fecha normal todavía no están disponibles en una publicación
ampliada vigente y compatible, se usa el nombre del maestro mensual cuando existe
y `fechaSit1` queda en `null`.

Los controles de vigencia son independientes: comprobar la base mensual no
renueva un histórico viejo. Si hay un histórico anterior completo y vigente, se
puede seguir consultando con su propio maestro de entidades. Los encabezados de
cada respuesta identifican la versión, período y control de esa consulta; vigente
e histórico pueden estar usando publicaciones diferentes durante una actualización.

La compatibilidad es de contrato y de la información disponible en archivos.
La API oficial puede tener novedades posteriores al corte mensual, denominaciones
de entidades más largas que los 70 caracteres del maestro o flags que las
rectificaciones no aportan. No se inventan datos: valores no disponibles y
códigos no interpretables se muestran como `null`. No se garantiza igualdad
instantánea con la API oficial ni se determina elegibilidad crediticia.

## Arquitectura y publicación

- La topología productiva administrada con Ansible ejecuta un contenedor y un
  proceso Uvicorn en el dedicado, con bind persistente
  `/srv/redunisol/state/bcra-file-api` y puerto `127.0.0.1:18082`.
  La VPS conserva únicamente un proxy TCP sin datos ni token, conectado por SSH
  al dedicado; mantiene el alias `bcra-file-api-poc:8080` en `kestra_net`.
  No se expone la API públicamente ni se monta el socket Docker.
- `1 CPU`, `2 GiB` de RAM. No se agregan throttling de I/O ni prioridades de disco.
- El arranque sólo lee la publicación existente, sin descargas ni importación.
- `BCRA_FILE_EXTENDED_ENABLED=true` en Compose habilita la publicación ampliada.
  Los defaults de la aplicación mantienen el importador anterior para pruebas.
- Cinco componentes SQLite inmutables: `current`, `history`, `corrections`,
  `normal` y `padron`. `current.json` selecciona la base mensual validada;
  `active.json` selecciona la publicación ampliada completa, incluido el maestro
  mensual con el que se validaron sus entidades históricas.
- Las descargas temporales usan `refresh-*`; los componentes en construcción se
  conservan en `pending/`, en el mismo volumen. El manifiesto cambia mediante
  rename atómico después de completar las validaciones de cada contrato. La
  publicación histórica exige todos los componentes y sus entidades. Las
  consultas mantienen una versión completa durante la lectura;
  el importador trabaja en otro hilo y las consultas SQLite usan un thread pool.
- Un fallo conserva la última publicación validada de cada contrato y los bloques
  confirmados de la construcción. Una base mensual ya publicada sigue disponible
  aunque falle la ampliación. No se publica un histórico parcial. Se retiran
  componentes y comprimidos que ya no se usan, conservando los necesarios para
  ambas publicaciones. Al iniciar se limpian únicamente
  las descargas temporales abandonadas; los puntos de continuación se conservan.
- Se reutilizan componentes cuyo contenido no cambió. Una corrección diaria se
  guarda en una tabla separada y se aplica al consultar; no obliga a reconstruir
  las 60 millones de filas históricas. Cambiar sólo nombres tampoco reconstruye
  el histórico.
- La migración reutiliza por hardlink el snapshot mensual ya validado si coincide
  su huella. `snapshot.sqlite` se conserva como respaldo de la migración; futuras
  publicaciones usan `components/`. No se borra el volumen al desplegar.

El histórico guarda una fila por identificación/entidad con sus 24 meses en un
blob compacto e indexado, en lugar de multiplicar cada fila por 24. La consulta
lee sólo las filas de la identificación pedida. Los textos descomprimidos se
transmiten desde 7-Zip a stdout y nunca se escriben completos al disco.

No aumentar workers ni réplicas sin agregar coordinación compartida: tanto el
coordinador de refresh como el bloqueo de publicación viven en un único proceso.

## Fuentes y validación de datos

Catálogo: https://www5.bcra.gob.ar/ChequesyDeudores/Deudores

Diseños: https://www.bcra.gob.ar/archivos/Pdfs/Texord/t-ceninf.pdf y los documentos
`LEAME DEUDORES.pdf` y `LEAME PADRON.pdf` incluidos en los comprimidos.

Se requiere la publicación mensual completa: `AAAAMMDEUDORES.7Z`,
`AAAAMMINFRET.7Z`, `AAAAMMINFRETPA.7Z`, `24DSFAAAAMM.7Z` y `1DSFAAAAMM.7Z`,
más el padrón `AAAAMMDDPADRON.7Z` más reciente. Todos los archivos mensuales deben
corresponder al mayor período de DEUDORES, sin retroceder frente al activo.

El cliente conserva cookies y campos oficiales del formulario, registra la
aceptación en `Deudores/Log_Archivo` y descarga por POST a MFT. No registra URLs,
cookies ni campos de sesión. Requiere la aceptación del operador
`BCRA_FILE_TERMS_ACCEPTED=true`, registrada en la configuración cifrada el
21/10/2026. No automatiza login ARCA. Una página HTML con HTTP 200 no es un 7z.
El registro público devolvió `result: null` en las verificaciones del 21–23/10;
se conserva esa advertencia, mientras una negativa explícita impide descargar.

Los campos ocultos del catálogo, incluido `sessionid`, se renuevan **antes de
cada descarga**, también después de construir la base mensual. No se reutiliza
una sesión obtenida media hora antes. Se vuelve a registrar la aceptación con
esa sesión y se pide exactamente el mismo nombre, tipo y período elegidos al
iniciar el job. Si el catálogo ya retiró ese archivo, el job falla sin mezclar
períodos ni sustituir silenciosamente el padrón por uno más reciente.

Si MFT devuelve HTML u otra respuesta sin firma 7z, o HTTP 401/403, se renueva
el catálogo y se reintenta, con un máximo de tres intentos por archivo. Una
negativa explícita a las condiciones, una descarga truncada o los límites de
tiempo/disco/tamaño siguen deteniendo el job. No se registran el formulario,
la respuesta HTML ni los enlaces de sesión. Esta recuperación no inicia trabajo
fuera de la ventana nocturna.

Se descargan y calculan los SHA-256 de los seis comprimidos **cada noche**,
para detectar cambios que conserven el nombre. Si no cambian, se omite toda la
importación. No se confía en metadatos remotos no verificados.

- Mensual: `deudores.txt`, `maeent.txt`, `nomdeu.txt` opcional, más rectificaciones
  completas y luego parciales para los meses presentes en la base.
- Histórico: `24DSF.txt`, 24 meses desde el mes de publicación hacia atrás. Sus
  rectificaciones completas y parciales se superponen para toda esa cobertura;
  situación y monto cero eliminan el registro.
- Fecha normal: `1DSF.txt`, tipo de identificación 11 y mes de origen válido.
- Nombres: `Padron_ARCA.txt`, ancho fijo de 220 caracteres. No se almacenan
  nacimiento, sexo, domicilio, actividades ni otras columnas del padrón.

Se rechazan diseños desconocidos, duplicados, entidades sin maestro, fechas
inconsistentes, componentes principales con menos de 100.000 filas y caídas de
más del 20% respecto de la versión previa. Cada SQLite pasa `quick_check`.
El código `9 = No aplicable` y códigos no interpretables no se convierten en
verdadero. Las rectificaciones sólo aportan situación y monto: sus días y
observaciones se devuelven `null`. Los bytes indefinidos de Windows-1252 se
muestran como `U+FFFD` y se cuentan; se conservan los comprimidos originales.
Los puntos y coma dentro de nombres de ancho fijo son texto.

## Horario, recursos y carga inicial

El flow Git-managed `bcra_archivo_actualizar_poc`, namespace de runtime
`redunisol.prod.analisis-credito`, ejecuta diariamente a las **21:00 Argentina**
con `ENV_BCRA_FILE_POC_ENABLED=true`. Inicia un job del servicio y consulta su
estado cada minuto. No hace falta crear otro scheduler para la carga ampliada.
El despliegue de esta versión prepara la primera carga para el **23/10/2026 a
las 21:00**, sin modificar consumidores.

El servicio sólo admite trabajo pesado entre las 21:00 y las 07:00, incluso con
`run_now=true`. El presupuesto de diez horas se acorta al cierre de la ventana y
se controla en descarga, descompresión y SQL. Al agotarse, el job queda fallido y
se conserva la base activa, junto con los bloques confirmados en `pending/`.
Reiniciar también marca el job interrumpido como fallido; no dispara trabajo de
día. El scheduler habitual lo retoma la siguiente noche con un nuevo job.

Histórico, padrón, fecha normal y rectificaciones confirman bloques de **100.000
registros de entrada**. Cada transacción SQLite guarda los datos, la posición
del archivo y los contadores juntos, con journal de rollback y sincronización
`EXTRA`. Una interrupción puede repetir únicamente el bloque sin confirmar.
El fin de cada miembro se confirma después de validar la descompresión; los
metadatos de componente completo se escriben después del `quick_check`.

Cada noche se descargan y verifican nuevamente los comprimidos. Los puntos de
continuación están ligados a la huella del contenido de cada componente: un
cambio descarta sólo el avance de ese componente. Un padrón o una rectificación
nueva no descartan el histórico si su archivo sigue igual. Como 7z es secuencial,
se vuelve a descomprimir el prefijo confirmado, pero se omiten su interpretación
y su inserción SQL; no se guarda el texto completo en disco.

Los componentes ya terminados también se conservan entre noches y se reutilizan
después de verificar sus huellas. La base mensual se conserva cuando termina;
una base mensual interrumpida antes de terminar se reconstruye. La publicación
histórica sigue exigiendo todos los componentes completos y todas las validaciones.
Los límites de almacenamiento incluyen los bloques pendientes, y la reserva de
inicio descuenta el espacio de construcción que esos bloques ya ocupan.

Protecciones Compose, ajustables mediante configuración de la aplicación:

| Variable | Valor de producción | Propósito |
| --- | --- | --- |
| `BCRA_FILE_MIN_FREE_BYTES` | 21.474.836.480 (20 GiB) | Reserva libre durante descargas/importación |
| `BCRA_FILE_MAX_BUILD_BYTES` | 37.580.963.840 (35 GiB) | Máximo de archivos temporales por construcción |
| `BCRA_FILE_MIN_EXTENDED_ROWS` | 100.000 por defecto | Mínimo de filas de histórico, padrón y normal |

Antes de comenzar se exige espacio para la reserva más hasta 25 GiB adicionales.
Los límites se comprueban periódicamente y antes de publicar. Si faltan recursos,
el job falla con una causa operativa y no toca la publicación activa.

Mediciones de partida (23/10/2026, no son una garantía de capacidad futura):

- Primera carga mensual: 31m29s del servicio, 41.804.946 filas, SQLite 2,34 GB.
  Control posterior sin cambios: 30,44s del servicio.
- Seis comprimidos: 3.995.606.525 bytes (~4,0 GB) por control diario. Los tres
  archivos adicionales suman unos 37,7 GB de texto que se procesará por streaming.
- Histórico: 60.226.446 filas por entidad/persona. Fecha normal: 14.782.763 filas.
  Padrón: unos 65 millones de registros.
- VPS: 8 CPU, 16 GiB RAM, unos 79 GB libres antes de la ampliación.
- Estimación de diseño, pendiente de medir la carga completa: 20–30 GB de bases
  activas y 50–70 GB de uso máximo con versiones anterior/nueva y comprimidos.
  La primera carga permanece acotada a la ventana nocturna; no se presupone que
  terminará hasta observar el job real.

## Operación y despliegue

La fuente del despliegue productivo es Ansible: roles `bcra_file_api` y
`bcra_private_link` en [`infra/ansible`](../../infra/ansible/README.md).
El [procedimiento de migración y recuperación](../../docs/bcra-dedicated-migration.md)
define las guardas, la copia consistente, los recibos de validación y el corte.

Kestra sigue usando `http://bcra-file-api-poc:8080`, con su token y webhook key
existentes. El nombre resuelve al proxy liviano de la VPS; el enlace SSH llega a
la API loopback del dedicado. `kestra_net` no conecta ambas máquinas. Para acceso
administrativo desde otra máquina, usar el túnel SSH documentado y el acceso
canónico local. No se agrega dominio, configuración Apache ni autenticación API
nueva.

- `GET /health`: liveness sin autenticación ni datos personales.
- `GET /status`: `ready`, `check_stale`, `dataset` y `last_successful_check_at`
  describen deuda vigente. `history_ready`, `history_check_stale`,
  `history_dataset` y `last_successful_history_check_at` describen el histórico.
  También incluye capacidades (`current`, `history`, `padron`, `normal_since`)
  y el estado/progreso del job. Un job de ampliación fallido puede coexistir con
  `ready=true` y `history_ready=false`; no se trata como un histórico completado.
- `POST /refresh`, body `{}`: HTTP 202 y `job_id`. `Idempotency-Key` retoma el
  mismo job; ejecuciones simultáneas comparten el que esté activo.
- `GET /jobs/{job_id}`: estado y progreso sin datos de deudores; HTTP 500 si falló.
- `POST /lookup`: conserva el contrato diagnóstico previo, incluido `meta`, ID
  textual y códigos de fuente. También admite claves `cuil`/`cuit` y guiones.
  Las rutas compatibles GET son las destinadas a una futura migración.

`bcra_archivo_consultar_poc` conserva el webhook síncrono existente y devuelve
los outputs `status` y `data` de `/lookup`. Sus triggers se publican sólo en prod.
El token del servicio y la key de webhook son distintos y están cifrados en Git;
los accesos se consultan en el archivo local canónico sin copiarlos a ejemplos.
No se registran peticiones, identificaciones ni respuestas. El contenedor del
dedicado rota logs locales a 20 MiB y cinco archivos; el proxy no registra tráfico.

1. Mantener el importador original detenido y el destino sin arrancar durante la
   copia. Conservar publicaciones, checkpoints, journals y comprimidos completos.
2. Validar hashes y SQLite, revocar el receptor temporal y preparar/verificar el
   backup frío inicial antes de activar el destino. Mantener la aceptación ya
   registrada de las condiciones BCRA.
3. Aplicar `bcra-file-api-deploy.yml` y verificar con `bcra-file-api-verify.yml`.
   La imagen está fijada por digest y el arranque no dispara una importación.
4. Aplicar/verificar `bcra-private-link.yml` y comprobar el alias desde Kestra.
   Validar `/health`, `/status` autenticado y rechazo sin token, sin hacer una
   consulta de persona ni un `POST /refresh` como prueba de conectividad.
5. Conservar el único scheduler existente. Después de una actualización nocturna,
   comprobar job `completed`, capacidades, filas/bytes por componente y vigencia;
   un histórico incompleto no se declara listo por trasladarlo.

`publish-bcra-file-api.yml` sigue probando y publicando imágenes `sha-<commit>` al
cambiar `apps/bcra-file-api/**` en main, incluido este README. Publicar una imagen
no despliega ni reinicia servicios. Esta migración mantiene la imagen actual
`ghcr.io/red-unisol/bcra-file-api@sha256:78d3b2536caf2c9a281804b9a5fe21aa5e030c8240cad75a88a7d339481af6e4`;
un tag publicado posteriormente no cambia ese digest aplicado por Ansible.

Se retiró el workflow de despliegue legacy a la VPS para evitar reactivar allí
el importador. `deploy/docker-compose.yml`, su configuración cifrada y el volumen
original `bcra-file-poc_bcra-file-data` se conservan para pruebas y rollback
explícito; no son el camino productivo habitual ni se reinician automáticamente.
Un rollback exige detener primero el destino, retirar el proxy/enlace y revisar
versiones y vigencia antes de arrancar el origen. No usar `down -v` ni copiar
automáticamente escrituras nuevas sobre el respaldo conservado.

## Validación local

```bash
pip install -r apps/bcra-file-api/requirements-test.txt
PYTHONPATH=apps/bcra-file-api/src python -m unittest discover -s apps/bcra-file-api/tests -v
python -m unittest kestra.tools.tests.test_bcra_poc_deploy
docker build --target test -t bcra-file-poc:test apps/bcra-file-api
docker compose --env-file apps/bcra-file-api/deploy/.env.example \
  -f apps/bcra-file-api/deploy/docker-compose.yml config -q
```

Los tests usan datos sintéticos y 7z reales cuando está disponible 7z/7zz
(`BCRA_FILE_7Z` permite elegir el ejecutable; la etapa Docker siempre lo incluye).
Cubren contratos, rectificaciones históricas, montos, fechas, meses vacíos,
publicación fallida, cambios por componente, migración sin copiar, lecturas
concurrentes, autenticación, vigencia, límites de recursos y ventana nocturna.
También cubren reanudación entre noches, cambio de huellas, descompresión fallida
y salida abrupta de un proceso con un bloque SQL sin confirmar.
La disponibilidad por contrato se prueba con histórico parcialmente confirmado,
reinicio, descargas fallidas, caducidad independiente y maestros de entidades de
versiones diferentes; un control mensual fallido no renueva la vigencia anterior.
La integración usa seis comprimidos de prueba y sirve ambas rutas GET.
