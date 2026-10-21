# BCRA File API — prueba de concepto

Servicio persistente para consultar la publicación mensual de la Central de
Deudores por CUIT/CUIL/CDI. Ningún proceso existente lo consume, no escribe en
Bitrix y no consulta la API individual del BCRA. No toma decisiones comerciales.

## Arquitectura

- Contenedor con reinicio automático, una instancia por volumen, en la red interna
  `kestra_net`. Sin puerto publicado al host y sin acceso al socket de Docker.
- `bcra_archivo_consultar_poc`: webhook síncrono con una única tarea HTTP nativa
  hacia el contenedor que ya está activo; sin Docker task runner.
- `bcra_archivo_actualizar_poc`: scheduler diario a las 04:00 Argentina; inicia
  un job en el servicio y consulta su estado cada minuto, hasta 12 horas.
- Ambos triggers se publican solamente en `redunisol.prod.analisis-credito`.
  El normalizador elimina los triggers `prod_only` en dev.
- `ENV_BCRA_FILE_POC_ENABLED=true` habilita el trabajo diario en producción.
  La entrada manual `run_now=true` permite una primera carga o reintento.
- Sin cambios de reglas, consumidores, rutas históricas ni DNS.

## Fuente y actualización

Catálogo: https://www5.bcra.gob.ar/ChequesyDeudores/Deudores

Diseños: https://www.bcra.gob.ar/archivos/Pdfs/Texord/t-ceninf.pdf, sección 4.1.1.

Se selecciona el mayor período que tenga `AAAAMMDEUDORES.7Z`,
`AAAAMMINFRET.7Z` y `AAAAMMINFRETPA.7Z`.

El cliente conserva cookies y campos del formulario, registra la aceptación en
`Deudores/Log_Archivo` y envía el formulario por POST a MFT. No registra URLs,
cookies ni campos de sesión. Requiere que el operador haya aceptado las
condiciones/declaración jurada BCRA: rechaza descargas mientras
`BCRA_FILE_TERMS_ACCEPTED=false`. No automatiza el login de ARCA ni evade
controles de acceso. Una página HTML de login con HTTP 200 se considera error.
El 21/10/2026 el registro público `Log_Archivo` devolvió `result: null` mientras
el formulario oficial entregaba archivos 7z válidos. Ese resultado se conserva
como advertencia en el job y el manifiesto; una negativa explícita impide la
descarga. La aceptación del operador sigue siendo obligatoria y quedó registrada
en la configuración cifrada el 21/10/2026.

Por ahora se descargan y calculan las huellas de los tres comprimidos **cada día**.
Así se detectan correcciones que conserven el mismo nombre o enlace. Si los
SHA-256 no cambian, no se descomprime ni importa. La optimización mediante
metadatos remotos queda fuera de esta versión.

Medición remota del 21/10/2026, período `202608`: `DEUDORES.7Z` pesa
325.315.249 bytes, `INFRET.7Z` 233.128 bytes y `INFRETPA.7Z` 7.199.629 bytes:
**332.748.006 bytes en total (333 MB / 317 MiB comprimidos por control diario)**.
El tamaño de la base y de los miembros descomprimidos debe medirse en la carga.

Se transmiten los miembros a stdout de 7-Zip, sin extraer rutas al disco.
Se importan `deudores.txt`, `maeent.txt` y, si existe, `nomdeu.txt`.
Las rectificaciones completas se aplican antes de las parciales; se omiten
las de períodos anteriores en esta base del último mes. Situación y monto cero
eliminan el registro. Se conservan todas las situaciones del archivo base.

SQLite tiene una clave por identificación, entidad y período. Se construye una
base temporal del mismo volumen y se rechazan formatos desconocidos, períodos
inconsistentes, duplicados, entidades sin maestro, menos de 100.000 filas y caídas
de más del 20% frente a la base activa. Sólo después de validar se reemplaza la
base mediante un rename atómico. Las lecturas usan una sola versión inmutable.

Un job fallido conserva la base activa; reiniciar el proceso marca el job
interrumpido como fallido. Actualizaciones simultáneas comparten el job en curso;
`Idempotency-Key` permite retomar el último job. La descarga reintenta errores
de transporte tres veces y el procesamiento tiene un presupuesto de 10 horas.
Kestra falla si el job falla o no termina a tiempo.

## Contrato

Servicio interno, con `Authorization: Bearer <token>`:

- `GET /health`: liveness sin autenticación ni datos personales.
- `GET /status`: período, versión, último control exitoso, job y readiness.
- `POST /refresh` con body `{}`: HTTP 202 y `job_id`.
- `GET /jobs/<job_id>`: estado; HTTP 500 si falló.
- `POST /lookup` con `{"identificacion":"20123456786"}`: también admite las
  claves `cuil` o `cuit` y guiones.

Ejemplo de estructura; nombres e identificación sintéticos:

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

Incluye además días de atraso, observaciones, archivo de origen, fechas de
importación/control, huellas, cantidades y limitaciones. Monto se expresa en
**miles de pesos**, con un decimal; se almacena internamente como enteros.

- HTTP 400: entrada inválida.
- HTTP 404: identificación ausente de la publicación mensual cargada.
- HTTP 503: no hay base validada o pasaron más de 72 horas sin un control exitoso
  de los archivos. No equivale a una persona sin datos.
- El período mensual y la fecha de verificación de la fuente se exponen separados.

No reemplaza el contrato completo de la API individual: denominación puede faltar
(no se descarga el padrón ARCA), `fechaSit1` es null (no se importa 1DSF), y las
rectificaciones dejan días/observaciones en null cuando no los proporcionan.
No incluye historia de 24 meses ni cheques. No determina elegibilidad crediticia.

## Endpoint de Kestra

~~~text
POST /api/v1/main/executions/webhook/redunisol.prod.analisis-credito/bcra_archivo_consultar_poc/<BCRA_FILE_POC_WEBHOOK_KEY>
Content-Type: application/json

{"identificacion":"20123456786"}
~~~

Usa `wait: true` y `returnOutputs: true`; devuelve los outputs `status` y `data`
(objeto JSON del servicio). El HTTP exterior corresponde al webhook; el resultado
de la consulta está en `status` y `data.status`. Si cae el servicio, falla la ejecución.

El token del servicio y la key del webhook son distintos. Están cifrados en Git
y guardados también en el archivo local canónico de accesos.

## Despliegue y activación

1. Mergear el PR. La imagen se publica como `sha-<commit>`. Los flows y mapeos
   de entorno siguen sus pipelines habituales.
2. Ejecutar **Deploy BCRA File POC** desde main. Sólo despliega
   `/opt/bcra-file-poc`; no configura Apache. Requiere `kestra_net` y acceso
   de lectura a GHCR en la VPS.
3. Marcar `terms_accepted=true` únicamente cuando el operador haya aceptado las
   condiciones/declaración jurada. False permite probar errores sin descargar.
4. Ejecutar el flow de actualización en prod con `run_now=true` y comprobar
   finalización, período, conteos y consultas conocidas.
5. El trabajo diario está habilitado mediante `ENV_BCRA_FILE_POC_ENABLED=true`
   en el runtime cifrado. El despliegue de infraestructura aplica esa configuración.
   No se conectan consumidores ni se cambian reglas.

El Compose usa el volumen `bcra-file-poc_bcra-file-data`, hasta 2 GiB de memoria
y 1 CPU. Medir espacio antes de importar: pueden coexistir archivos anteriores,
descargas nuevas, base activa y base en construcción. Se conservan los comprimidos
activos y se limpian los anteriores después del cambio exitoso.

Para detenerlo, deshabilitar su flag y detener el Compose. Conservar el volumen
si se pretende conservar la base; no usar `down -v` como rutina.

## Validación

~~~bash
PYTHONPATH=apps/bcra-file-api/src python -m unittest discover -s apps/bcra-file-api/tests -v
python -m unittest kestra.tools.tests.test_bcra_poc_deploy
docker build --target test -t bcra-file-poc:test apps/bcra-file-api
docker compose --env-file apps/bcra-file-api/deploy/.env.example \
  -f apps/bcra-file-api/deploy/docker-compose.yml config -q
~~~

Los tests usan datos sintéticos según el diseño publicado y crean comprimidos 7z
reales cuando está disponible 7z/7zz (siempre en la etapa Docker de tests).
Cubren correcciones/bajas, fallas, contenido sin cambios, autenticación, HTML con
HTTP 200, expiración y lecturas durante una actualización.

La lectura del catálogo real fue verificada. La primera descarga/importación
completa, su comparación con consultas oficiales y el dimensionamiento real
siguen pendientes. CI no descarga datos personales del BCRA.
