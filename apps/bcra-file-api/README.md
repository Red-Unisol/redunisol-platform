# BCRA File API â€” prueba de concepto

Servicio persistente para consultar la publicaciÃ³n mensual de la Central de
Deudores por CUIT/CUIL/CDI. NingÃºn proceso existente lo consume, no escribe en
Bitrix y no consulta la API individual del BCRA. No toma decisiones comerciales.

## Arquitectura

- Contenedor con reinicio automÃ¡tico, una instancia por volumen, en la red interna
  `kestra_net`. Sin puerto publicado al host y sin acceso al socket de Docker.
- `bcra_archivo_consultar_poc`: webhook sÃ­ncrono con una Ãºnica tarea HTTP nativa
  hacia el contenedor que ya estÃ¡ activo; sin Docker task runner.
- `bcra_archivo_actualizar_poc`: scheduler diario a las 04:00 Argentina; inicia
  un job en el servicio y consulta su estado cada minuto, hasta 12 horas.
- Ambos triggers se publican solamente en `redunisol.prod.analisis-credito`.
  El normalizador elimina los triggers `prod_only` en dev.
- `ENV_BCRA_FILE_POC_ENABLED=true` habilita el trabajo diario en producciÃ³n.
  La entrada manual `run_now=true` permite una primera carga o reintento.
- Sin cambios de reglas, consumidores, rutas histÃ³ricas ni DNS.

## Fuente y actualizaciÃ³n

CatÃ¡logo: https://www5.bcra.gob.ar/ChequesyDeudores/Deudores

DiseÃ±os: https://www.bcra.gob.ar/archivos/Pdfs/Texord/t-ceninf.pdf, secciÃ³n 4.1.1.

Se selecciona el mayor perÃ­odo que tenga `AAAAMMDEUDORES.7Z`,
`AAAAMMINFRET.7Z` y `AAAAMMINFRETPA.7Z`.

El cliente conserva cookies y campos del formulario, registra la aceptaciÃ³n en
`Deudores/Log_Archivo` y envÃ­a el formulario por POST a MFT. No registra URLs,
cookies ni campos de sesiÃ³n. Requiere que el operador haya aceptado las
condiciones/declaraciÃ³n jurada BCRA: rechaza descargas mientras
`BCRA_FILE_TERMS_ACCEPTED=false`. No automatiza el login de ARCA ni evade
controles de acceso. Una pÃ¡gina HTML de login con HTTP 200 se considera error.
El 21/10/2026 el registro pÃºblico `Log_Archivo` devolviÃ³ `result: null` mientras
el formulario oficial entregaba archivos 7z vÃ¡lidos. Ese resultado se conserva
como advertencia en el job y el manifiesto; una negativa explÃ­cita impide la
descarga. La aceptaciÃ³n del operador sigue siendo obligatoria y quedÃ³ registrada
en la configuraciÃ³n cifrada el 21/10/2026.

Por ahora se descargan y calculan las huellas de los tres comprimidos **cada dÃ­a**.
AsÃ­ se detectan correcciones que conserven el mismo nombre o enlace. Si los
SHA-256 no cambian, no se descomprime ni importa. La optimizaciÃ³n mediante
metadatos remotos queda fuera de esta versiÃ³n.

MediciÃ³n remota del 21/10/2026, perÃ­odo `202608`: `DEUDORES.7Z` pesa
325.315.249 bytes, `INFRET.7Z` 233.128 bytes y `INFRETPA.7Z` 7.199.629 bytes:
**332.748.006 bytes en total (333 MB / 317 MiB comprimidos por control diario)**.
Los miembros suman **7,42 GB descomprimidos**; deudores.txt ocupa 7,23 GB.
Se procesan por streaming: ese texto no se escribe descomprimido al disco.
El tamaÃ±o de la base SQLite debe medirse en la carga.

Se transmiten los miembros a stdout de 7-Zip, sin extraer rutas al disco.
Se importan `deudores.txt`, `maeent.txt` y, si existe, `nomdeu.txt`.
El maestro `nomdeu.txt` de 202608 agrega once espacios al diseño documentado;
se admiten sólo si están en blanco. Bytes indefinidos de Windows-1252 en nombres
se muestran como `U+FFFD` y se cuentan en `name_encoding_replacements` con una
advertencia; se conserva el archivo original y no se adivina otra codificación.
Las rectificaciones completas se aplican antes de las parciales; se omiten
las de perÃ­odos anteriores en esta base del Ãºltimo mes. SituaciÃ³n y monto cero
eliminan el registro. Se conservan todas las situaciones del archivo base.

SQLite tiene una clave por identificaciÃ³n, entidad y perÃ­odo. Se construye una
base temporal del mismo volumen y se rechazan formatos desconocidos, perÃ­odos
inconsistentes, duplicados, entidades sin maestro, menos de 100.000 filas y caÃ­das
de mÃ¡s del 20% frente a la base activa. SÃ³lo despuÃ©s de validar se reemplaza la
base mediante un rename atÃ³mico. Las lecturas usan una sola versiÃ³n inmutable.

Un job fallido conserva la base activa; reiniciar el proceso marca el job
interrumpido como fallido. Actualizaciones simultÃ¡neas comparten el job en curso;
`Idempotency-Key` permite retomar el Ãºltimo job. La descarga reintenta errores
de transporte tres veces y el procesamiento tiene un presupuesto de 10 horas.
Kestra falla si el job falla o no termina a tiempo.

## Contrato

Servicio interno, con `Authorization: Bearer <token>`:

- `GET /health`: liveness sin autenticaciÃ³n ni datos personales.
- `GET /status`: perÃ­odo, versiÃ³n, Ãºltimo control exitoso, job y readiness.
- `POST /refresh` con body `{}`: HTTP 202 y `job_id`.
- `GET /jobs/<job_id>`: estado; HTTP 500 si fallÃ³.
- `POST /lookup` con `{"identificacion":"20123456786"}`: tambiÃ©n admite las
  claves `cuil` o `cuit` y guiones.

Ejemplo de estructura; nombres e identificaciÃ³n sintÃ©ticos:

~~~json
{
  "status": 200,
  "results": {
    "identificacion": "20123456786",
    "denominacion": null,
    "periodos": [{
      "periodo": "202608",
      "entidades": [{
        "codigoEntidad": "00007",
        "entidad": "BANCO SINTETICO",
        "situacion": 1,
        "monto": 123.5
      }]
    }]
  },
  "meta": {
    "source": "bcra_monthly_file_poc",
    "period": "202608",
    "version": "sha256-de-la-publicacion"
  }
}
~~~

Incluye ademÃ¡s dÃ­as de atraso, observaciones, archivo de origen, fechas de
importaciÃ³n/control, huellas, cantidades y limitaciones. Monto se expresa en
**miles de pesos**, con un decimal; se almacena internamente como enteros.

- HTTP 400: entrada invÃ¡lida.
- HTTP 404: identificaciÃ³n ausente de la publicaciÃ³n mensual cargada.
- HTTP 503: no hay base validada o pasaron mÃ¡s de 72 horas sin un control exitoso
  de los archivos. No equivale a una persona sin datos.
- El perÃ­odo mensual y la fecha de verificaciÃ³n de la fuente se exponen separados.

No reemplaza el contrato completo de la API individual: denominaciÃ³n puede faltar
(no se descarga el padrÃ³n ARCA), `fechaSit1` es null (no se importa 1DSF), y las
rectificaciones dejan dÃ­as/observaciones en null cuando no los proporcionan.
No incluye historia de 24 meses ni cheques. No determina elegibilidad crediticia.

## Endpoint de Kestra

~~~text
POST /api/v1/main/executions/webhook/redunisol.prod.analisis-credito/bcra_archivo_consultar_poc/<BCRA_FILE_POC_WEBHOOK_KEY>
Content-Type: application/json

{"identificacion":"20123456786"}
~~~

Usa `wait: true` y `returnOutputs: true`; devuelve los outputs `status` y `data`
(objeto JSON del servicio). El HTTP exterior corresponde al webhook; el resultado
de la consulta estÃ¡ en `status` y `data.status`. Si cae el servicio, falla la ejecuciÃ³n.

El token del servicio y la key del webhook son distintos. EstÃ¡n cifrados en Git
y guardados tambiÃ©n en el archivo local canÃ³nico de accesos.

## Despliegue y activaciÃ³n

1. Mergear el PR. La imagen se publica como `sha-<commit>`. Los flows y mapeos
   de entorno siguen sus pipelines habituales.
2. Ejecutar **Deploy BCRA File POC** desde main. SÃ³lo despliega
   `/opt/bcra-file-poc`; no configura Apache. Requiere `kestra_net` y acceso
   de lectura a GHCR. El workflow utiliza su token efÃ­mero en un DOCKER_CONFIG
   temporal, eliminado al terminar; no cambia el login global de Docker en la VPS.
3. Marcar `terms_accepted=true` Ãºnicamente cuando el operador haya aceptado las
   condiciones/declaraciÃ³n jurada. False permite probar errores sin descargar.
4. Ejecutar el flow de actualizaciÃ³n en prod con `run_now=true` y comprobar
   finalizaciÃ³n, perÃ­odo, conteos y consultas conocidas.
5. El trabajo diario estÃ¡ habilitado mediante `ENV_BCRA_FILE_POC_ENABLED=true`
   en el runtime cifrado. El despliegue de infraestructura aplica esa configuraciÃ³n.
   No se conectan consumidores ni se cambian reglas.

El Compose usa el volumen `bcra-file-poc_bcra-file-data`, hasta 2 GiB de memoria
y 1 CPU. Medir espacio antes de importar: pueden coexistir archivos anteriores,
descargas nuevas, base activa y base en construcciÃ³n. Se conservan los comprimidos
activos y se limpian los anteriores despuÃ©s del cambio exitoso.

Para detenerlo, deshabilitar su flag y detener el Compose. Conservar el volumen
si se pretende conservar la base; no usar `down -v` como rutina.

## ValidaciÃ³n

~~~bash
PYTHONPATH=apps/bcra-file-api/src python -m unittest discover -s apps/bcra-file-api/tests -v
python -m unittest kestra.tools.tests.test_bcra_poc_deploy
docker build --target test -t bcra-file-poc:test apps/bcra-file-api
docker compose --env-file apps/bcra-file-api/deploy/.env.example \
  -f apps/bcra-file-api/deploy/docker-compose.yml config -q
~~~

Los tests usan datos sintÃ©ticos segÃºn el diseÃ±o publicado y crean comprimidos 7z
reales cuando estÃ¡ disponible 7z/7zz (siempre en la etapa Docker de tests).
Cubren correcciones/bajas, fallas, contenido sin cambios, autenticaciÃ³n, HTML con
HTTP 200, expiraciÃ³n y lecturas durante una actualizaciÃ³n.

La lectura del catÃ¡logo real fue verificada. La primera descarga/importaciÃ³n
completa, su comparaciÃ³n con consultas oficiales y el dimensionamiento real
siguen pendientes. CI no descarga datos personales del BCRA.
