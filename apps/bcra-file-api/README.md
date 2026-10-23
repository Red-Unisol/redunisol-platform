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
- HTTP 503: falta una publicación validada, pasaron más de 72 horas sin control
  exitoso o aún no terminó la carga inicial del histórico. No significa ausencia
  de deudas. Hasta la primera carga ampliada, deudas vigentes sigue disponible
  con la base anterior y sus campos todavía incompletos.

La compatibilidad es de contrato y de la información disponible en archivos.
La API oficial puede tener novedades posteriores al corte mensual, denominaciones
de entidades más largas que los 70 caracteres del maestro o flags que las
rectificaciones no aportan. No se inventan datos: valores no disponibles y
códigos no interpretables se muestran como `null`. No se garantiza igualdad
instantánea con la API oficial ni se determina elegibilidad crediticia.

## Arquitectura y publicación

- Un contenedor, un proceso Uvicorn y un volumen persistente
  `bcra-file-poc_bcra-file-data`. Red interna `kestra_net` y puerto
  `127.0.0.1:18082`; sin exposición pública ni socket Docker.
- `1 CPU`, `2 GiB` de RAM. No se agregan throttling de I/O ni prioridades de disco.
- El arranque sólo lee la publicación existente, sin descargas ni importación.
- `BCRA_FILE_EXTENDED_ENABLED=true` en Compose habilita la publicación ampliada.
  Los defaults de la aplicación mantienen el importador anterior para pruebas.
- Cinco componentes SQLite inmutables: `current`, `history`, `corrections`,
  `normal` y `padron`. Un único `active.json` selecciona la versión completa.
- Se construye en `refresh-*`, en el mismo volumen. El manifiesto cambia mediante
  rename atómico únicamente después de validar todos los componentes y sus
  entidades. Las consultas mantienen una versión completa durante la lectura;
  el importador trabaja en otro hilo y las consultas SQLite usan un thread pool.
- Un fallo conserva la publicación anterior. No se publica un histórico parcial.
  Después del cambio se retiran componentes y comprimidos que ya no se usan.
  Las construcciones abandonadas se limpian al comenzar el siguiente refresh.
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
se controla en descarga, descompresión y SQL. Al agotarse, se descarta el temporal
y se conserva la base activa. Reiniciar marca el job interrumpido como fallido.
No hay reanudación dentro de un componente incompleto; la siguiente noche
reintenta. Los componentes terminados de una primera carga interrumpida justo
antes de publicar pueden reutilizarse después de verificar sus huellas.

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

Servicio interno: `http://bcra-file-api-poc:8080`. Para acceso desde otra máquina,
usar un túnel SSH al puerto loopback siguiendo el acceso canónico local.
No se agrega dominio ni configuración Apache.

- `GET /health`: liveness sin autenticación ni datos personales.
- `GET /status`: readiness, capacidades (`current`, `history`, `padron`,
  `normal_since`), versión, componentes, último control y progreso del job.
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
No se registran peticiones, identificaciones ni respuestas. Logs con rotación
a 10 MiB y tres archivos.

1. Mergear el PR y ejecutar **Deploy BCRA File POC** desde main.
2. El workflow construye/prueba la imagen `sha-<commit>` y despliega sólo
   `/opt/bcra-file-poc`, conservando el volumen, con credenciales GHCR temporales.
3. Mantener `terms_accepted=true` con la aceptación ya registrada del operador.
4. Verificar imagen, `/health`, snapshot preservado, contrato GET actual y el
   scheduler de Kestra habilitado. El despliegue no dispara una importación.
5. Después de la carga nocturna, comprobar job `completed`, cuatro capacidades
   activas, filas/bytes por componente, disco libre y consultas actuales/históricas.
   Una falla sigue siendo visible en Kestra y en `/jobs`; no conectar consumidores
   hasta validar el resultado completo.

Para detenerlo, deshabilitar su flag y detener Compose. Conservar el volumen;
no usar `down -v`. Una reversión de imagen a la versión anterior vuelve a usar
`snapshot.sqlite`, que puede estar menos actualizado; requiere revisar vigencia.

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
La integración usa seis comprimidos de prueba y sirve ambas rutas GET.
