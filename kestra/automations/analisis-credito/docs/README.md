# Analisis Credito

Dominio para automatizaciones de analisis y calificacion de credito.

## Flows

- `renovacion_cruz_del_eje`
- `tope_descuento_caja`
- `afip_contacto_por_dni`
- `incoming_metamap_bridge`
- `consulta_quiebra_credix`
- `precalentar_cache_credixsa_v2_sondeo`
- `consulta_padron_a13`
- `consulta_empleador`
- `consulta_cuad`

## renovacion_cruz_del_eje

Evalua si un socio puede renovar un prestamo de las lineas Cruz del Eje.

### Entrada

Webhook `POST` con JSON:

```json
{ "cuil": "20-12345678-3" }
```

Tambien acepta un string con el CUIL como body.

### Salida

- `ok` (bool)
- `puede_renovar` (bool)
- `saldo_renovacion` (float)
- `motivo` (string | vacio)
- `cuil` (string)
- `error` (string | vacio)

Motivos posibles:

- `no_tiene_prestamo_cruz_del_eje`
- `tiene_mas_de_un_prestamo`
- `tiene_deuda`
- `menos_del_50_por_ciento`
- `cuotas_invalidas`
- `error`

### Variables

Config en `envs`:

- `vimarx_timeout_seconds`
- `vimarx_verify_tls`

Secrets:

- `DEVEXPRESS_EVALUATE_API_BASE_URL`
- `ANALISIS_CREDITO_WEBHOOK_KEY`

### Namespace files

- `kestra/automations/analisis-credito/files/analisis_credito_renovacion/**`

## tope_descuento_caja

Consulta el tope de descuento en Caja Jubilaciones a partir de un CUIL.

### Entrada

Webhook `POST` con JSON:

```json
{ "cuil": "20-12345678-3" }
```

Tambien acepta un string con el CUIL como body.

### Salida

- `ok` (bool)
- `cuil` (string)
- `nombre` (string)
- `apellido` (string)
- `disponible` (float)
- `tope_descuento` (float)
- `error` (string | vacio)

### Variables

Config en `envs`:

- `cidi_base_url`
- `cidi_client_id`
- `caja_base_url`
- `caja_id_tipo_usuario`

Secrets:

- `CIDI_USER`
- `CIDI_PASS`
- `CIDI_CLIENT_SECRET`
- `CAJA_ENCRYPT_PASS`
- `ANALISIS_CREDITO_CAJA_WEBHOOK_KEY`

Notas:

- `CAJA_SEED_TOKEN`, `CAJA_PERMISSIONS_BODY` y `CAJA_PERMISSIONS_PLAINTEXT` son opcionales
- si no estan cargados, el flow intenta obtener o construir esos valores durante la ejecucion

### Namespace files

- `kestra/automations/analisis-credito/files/tope_descuento_caja/**`

## afip_contacto_por_dni

Consulta AFIP/ARCA por tipo y numero de documento y devuelve nombre mas CUIL normalizados.

### Entrada

Webhook `POST` con JSON:

```json
{ "dni": "34.838.205", "tipo_doc": 96 }
```

Tambien acepta:

- `dni`, `nro_doc` o `documento` dentro de un objeto JSON
- un numero o string simple en el body, tratado como DNI
- si no se informa `tipo_doc`, usa `96`

### Salida

Outputs principales:

- `ok` (bool)
- `found` (bool)
- `dni` (string)
- `tipo_doc` (string)
- `cuil` (string)
- `nombre` (string)
- `response_json` (string JSON con el contrato minimo)
- `raw_response_json` (string JSON con el payload bruto de AFIP)
- `error` (string | vacio)

Contrato serializado en `response_json`:

- `{"ok":true,"found":true,"dni":"34838205","tipo_doc":"96","cuil":"27348382050","nombre":"...","error":"","source":"afip_crmcit"}`
- `{"ok":true,"found":false,...}` si AFIP no devuelve filas
- `{"ok":false,...}` si el request es invalido o la consulta falla

### Variables

Configuracion inline en el flow:

- `AFIP_CRM_BASE_URL=https://servicioscf.afip.gob.ar/publico/crmcit/`
- `AFIP_TIMEOUT_SECONDS=60`
- `AFIP_USER_AGENT=Mozilla/5.0 (...) Chrome/147.0.0.0 Safari/537.36`

Notas:

- el flow primero carga `consulta.aspx` y despues consulta `data/apis/Contactos.aspx/GetContactoPorTipoDocumento`
- `AFIP_TIMEOUT_SECONDS` quedo en `60` para absorber latencia observada en runtime
- hoy el trigger usa una key literal de desarrollo en el YAML; antes de promotion a un circuito mas estable conviene moverla a `secret(...)` para alinearlo con la politica general del repo

### Namespace files

- `kestra/automations/analisis-credito/files/afip_contacto_por_dni/**`

## incoming_metamap_bridge

Recibe payloads arbitrarios por webhook, los registra en logs y trata de reenviarlos a un endpoint HTTP accesible desde la tarea de Kestra. Esta pensado para probar un servicio local expuesto en la VPS por un tunel SSH entrante.

### Entrada

Webhook `POST` con cualquier body JSON. Si el body es un objeto JSON, admite dos claves de control opcionales:

- `_bridge_forward_url`: URL destino a la que se reenvia el payload. Ejemplo sugerido: `http://host.docker.internal:8787/metamap`
- `_bridge_timeout_seconds`: timeout opcional para el reenvio HTTP

Ejemplo:

```json
{
  "_bridge_forward_url": "http://host.docker.internal:8787/metamap",
  "_bridge_timeout_seconds": 5,
  "event": "verification.finished",
  "lead_id": "abc123",
  "result": {
    "status": "approved"
  }
}
```

Las claves de control no se incluyen en el body reenviado.

### Salida

- `ok` (bool)
- `forward_attempted` (bool)
- `forward_connected` (bool)
- `forward_target` (string)
- `forward_status_code` (string | vacio)
- `forward_error` (string | vacio)
- `payload_sha256` (string)
- `payload_preview` (string)

Notas:

- si no se informa `_bridge_forward_url`, el flow no falla; solo deja registro de que no habia destino configurado
- si el endpoint local no esta disponible por falta de tunel SSH o conexion rechazada, el flow no falla; deja el error registrado en logs y outputs

### Variables

Secrets:

- `ANALISIS_CREDITO_INCOMING_METAMAP_WEBHOOK_KEY`

### Namespace files

- `kestra/automations/analisis-credito/files/incoming_metamap_bridge/**`

## consulta_quiebra_credix

Consulta CredixSA y devuelve `none`, `multiple` o `single`.

Cuando hay un unico resultado, el flow entra al detalle, ejecuta `Actualizar Todo` si CredixSA muestra el paso de actualizaciones online, espera a que terminen los `Procesando...` y devuelve las secciones disponibles del informe final.

Antes de navegar, calcula claves de cache por CUIL y por nombre normalizado. Si existe una entrada de menos de 7 dias, devuelve esa respuesta con `cache_hit=true` sin consultar CredixSA. Cuando consulta CredixSA y obtiene un resultado `single`, guarda el mismo informe por:

- `credixsa.cuil.<cuil>`
- `credixsa.name.<sha256_nombre_normalizado>`

### Entrada

Webhook `POST` con JSON:

```json
{ "cuit": "20-12345678-3", "nombre": "Juan Perez" }
```

Tambien acepta:

- solo `cuit`
- solo `nombre`
- un string simple en el body, tratado como CUIL
- ejecucion como subflow con input `cuit` y/o `nombre`

Debe venir al menos uno de los dos criterios.

### Salida

Outputs principales:

- `ok` (bool)
- `status` (`none` | `multiple` | `single` | `error`)
- `rows_json` (string JSON)
- `data_json` (string JSON con las secciones/tablas del informe CredixSA)
- `response_json` (string JSON con el contrato legacy)
- `error` (string | vacio)
- `cache_hit` (bool)
- `cached_at` (string ISO | vacio)

Contrato serializado en `response_json`:

- `{"status":"none","rows":[]}`
- `{"status":"multiple","rows":[...]}`
- `{"status":"single","data":[{"title":"Datos Filiatorios","source":"","headers":[],"rows":[...],"records":[...],"text":"..."}]}`

### Variables

Secrets:

- `ANALISIS_CREDITO_QUIEBRA_WEBHOOK_KEY`
- `CREDIX_CLIENTE`
- `CREDIX_USER`
- `CREDIX_PASS`

Configuracion inline en el flow:

- `CREDIX_LOGIN_URL=https://www.credixsa.com/nuevo/login.php`
- `CREDIX_TIMEOUT_SECONDS=30`
- `CREDIX_DEBUG=false`
- `CREDIX_CACHE_MAX_AGE_DAYS=7`

### Namespace files

- `kestra/automations/analisis-credito/files/consulta_quiebra_credix/**`

## precalentar_cache_credixsa_v2_sondeo

Sondea solicitudes nuevas de CredixSA y solo ejecuta el worker pesado cuando hay candidatos.

Este flow reemplaza el uso operativo normal del flow legacy `consulta_credixsa_cache_warmup`.

Corre cada minuto en horario util con concurrencia `1`. En cada corrida:

1. lee el indice diario `credixsa.daily.index`
2. consulta solicitudes de hoy en `PreSolicitud.Module.Solicitud`
3. completa CUIL desde `F.Module.SocioMutual` si la solicitud trae solo DNI
4. omite solicitudes ya procesadas/cacheadas hoy
5. arma un preview acotado de candidatos
6. solo si hay candidatos ejecuta el worker pesado de warmup
7. el worker consulta CredixSA con retry por candidato
8. guarda cache por CUIL y por nombre si el resultado es `single`
9. actualiza el indice diario

Si CredixSA falla para un candidato dentro del worker, ese candidato no se marca como procesado; la siguiente corrida vuelve a intentarlo.

### Variables

Secrets:

- `DEVEXPRESS_EVALUATE_API_BASE_URL`
- `CREDIX_CLIENTE`
- `CREDIX_USER`
- `CREDIX_PASS`

Config en `envs`:

- `vimarx_timeout_seconds`
- `vimarx_verify_tls`
- `local_tz` opcional, default `America/Argentina/Buenos_Aires`
- `credix_debug` opcional, default `false` en los tasks del flow
- `credixsa_warmup_max_per_run` opcional, default `5`
- `credixsa_warmup_core_max_rows` opcional, default `1000`
- `credixsa_warmup_retry_attempts` opcional, default `2`

### Namespace files

- `kestra/automations/analisis-credito/files/precalentar_cache_credixsa_v2/**`
- `kestra/automations/analisis-credito/files/consulta_quiebra_credix/**`

## consulta_padron_a13

Consulta ARCA Padron A13 por CUIT o CUIL y devuelve los datos basicos de la persona.

### Entrada

Webhook `POST` con JSON:

```json
{ "cuit_cuil": "20-35966130-5" }
```

Tambien acepta:

- `cuit`
- `cuil`
- un string simple en el body, tratado como CUIT/CUIL

Debe venir un identificador de 11 digitos.

### Salida

- `ok` (bool)
- `cuit_cuil` (string)
- `cuit_representada` (string)
- `id_persona` (string)
- `nombre` (string)
- `apellido` (string)
- `razon_social` (string)
- `estado_clave` (string)
- `tipo_persona` (string)
- `tipo_clave` (string)
- `numero_documento` (string)
- `ta_expiration_time` (string)
- `persona_json` (string JSON)
- `response_json` (string JSON)
- `error` (string | vacio)

### Variables

Config en `envs`:

- `arca_padron_a13_cuit_representada`
- `arca_padron_a13_timeout_seconds`

Secrets:

- `ARCA_PADRON_A13_CERT_PEM_B64`
- `ARCA_PADRON_A13_KEY_PEM_B64`
- `ANALISIS_CREDITO_ARCA_PADRON_A13_WEBHOOK_KEY`

### Namespace files

- `kestra/automations/analisis-credito/files/arca_padron_a13/**`

## consulta_empleador

Consulta PYPDatos por DNI o CUIT/CUIL. El servicio externo requiere login previo para obtener un token y luego una consulta POST con header `x-token`.

### Entrada

Webhook `POST` con JSON:

```json
{ "dni": "32.786.693" }
```

Tambien acepta:

- `cuit`, `cuil` o `cuit_cuil`
- `documento` o `nro_doc`
- un string simple en el body
- `tipo` opcional: `M` para DNI o `S` para CUIT/CUIL

Si no se informa `tipo`, el flow usa `S` para identificadores de 11 digitos y `M` para DNI de 7/8 digitos.

### Salida

- `ok` (bool)
- `found` (bool)
- `status` (`found` | `not_found` | `invalid_request` | `technical_error`)
- `identifier` (string)
- `tipo` (string)
- `token_source` (`cache` | `login` | vacio)
- `data_json` (string JSON con el payload bruto de PYPDatos)
- `response_json` (string JSON con contrato minimo)
- `error` (string | vacio)

Contrato serializado en `response_json`:

- `{"ok":true,"found":true,"status":"found","identifier":"32786693","tipo":"M","data":{...},"error":"","source":"pypdatos_persona"}`
- `{"ok":true,"found":false,"status":"not_found",...}` si PYPDatos responde `No se pudo encontrar cuil/documento`
- `{"ok":false,"status":"invalid_request",...}` si el request es invalido
- `{"ok":false,"status":"technical_error",...}` si la consulta falla por problemas tecnicos

### Variables

Configuracion inline en el flow:

- `PYPDATOS_LOGIN_URL=https://www.pypdatos.com.ar:8444/apiuser/usuario/login`
- `PYPDATOS_PERSONA_URL=https://www.pypdatos.com.ar:469/ascocco/rest/serviciospyp/persona/json`
- `PYPDATOS_TIMEOUT_SECONDS=30`

Secrets:

- `PYPDATOS_USUARIO`
- `PYPDATOS_PASSWORD`
- `ANALISIS_CREDITO_CONSULTA_EMPLEADOR_WEBHOOK_KEY`

Notas:

- el token de PYPDatos dura 2 horas segun el instructivo; el flow lo cachea en KV por `PT1H55M`
- si el token cacheado vence y PYPDatos responde `401`, el flow hace login de nuevo y reintenta una vez
- el proveedor valida por direccion IP, por lo que hay que autorizar la IP saliente de la VPS/Kestra antes de probar en runtime

### Namespace files

- `kestra/automations/analisis-credito/files/consulta_empleador/**`

## consulta_cuad

Consulta CUAD Santa Fe por CUIL. El flujo resuelve el captcha del login con OCR, abre `movimiento.asp` y devuelve los totales de cupo.

### Entrada

Webhook `POST` con JSON:

```json
{ "cuil": "23-33312151-4" }
```

Tambien acepta:

- `cuit` o `cuit_cuil`
- un string simple en el body, tratado como CUIL

Debe venir un identificador de 11 digitos.

### Salida

- `ok` (bool)
- `found` (bool)
- `status` (`ok` | `sin_resultado` | `invalid_request` | `sesion_invalida` | `respuesta_no_reconocida` | `error`)
- `cuil` (string)
- `bruto` (string)
- `neto` (string)
- `cupo` (string)
- `afectado` (string)
- `disponible` (string)
- `deuda` (string)
- `captcha_attempts` (int)
- `data_json` (string JSON con el payload minimizado)
- `response_json` (string JSON con contrato minimo)
- `error` (string | vacio)

Contrato serializado en `response_json`:

- `{"ok":true,"found":true,"status":"ok","cuil":"23333121514","captcha_attempts":2,"data":{...},"error":"","source":"cuad_movimiento"}`
- `{"ok":true,"found":false,"status":"sin_resultado",...}` si CUAD no devuelve movimiento
- `{"ok":false,"status":"invalid_request",...}` si el body no trae un CUIL valido
- `{"ok":false,...}` si el login, OCR o la consulta fallan

### Variables

Configuracion inline en el flow:

- `CUAD_LOGIN_URL=https://www.santafe.gov.ar/cuad/`
- `CUAD_MOVIMIENTO_URL=https://www.santafe.gov.ar/cuad/movimiento.asp`
- `CUAD_EMR_NOMBRE=Santa Fe - ACTIVOS`
- `CUAD_EMR_ID=10`
- `CUAD_TIMEOUT_SECONDS=60`
- `CUAD_MAX_INTENTOS=10`
- `CUAD_CAPTCHA_LEN=6`
- `CUAD_OCR_MODEL=mistral-ocr-latest`
- `CUAD_PRE_SUBMIT_DELAY_MS=1500`
- `CUAD_POST_SUBMIT_WAIT_MS=3000`
- `CUAD_DEBUG=false`

Secrets:

- `CUAD_USUARIO`
- `CUAD_PASSWORD`
- `MISTRAL_API_KEY`
- `ANALISIS_CREDITO_CONSULTA_CUAD_WEBHOOK_KEY`

Notas:

- corre con Playwright en contenedor propio para evitar `pip install` en cada ejecucion
- el OCR se resuelve por HTTP directo contra Mistral, sin depender del SDK
- el flow entra naturalmente en `analisis-credito` porque su contrato es consulta por CUIL con respuesta sincrona

### Namespace files

- `kestra/automations/analisis-credito/files/consulta_cuad/**`

## reporte_evaluacion_management

Genera el Excel evaluatorio acumulado, lo publica en la carpeta privada consumida por Filament y conserva una copia historica diaria.

### Ejecucion automatica

- corre el dia 1 de cada mes a las 07:15, hora de Buenos Aires
- toma desde `2025-10` hasta el ultimo mes cerrado
- el trigger programado solo se despliega en produccion

### Ejecucion manual

Puede ejecutarse desde la UI de Kestra, informando opcionalmente `from_month` y `to_month`, o con un `POST` al webhook:

```json
{
  "from_month": "2026-01",
  "to_month": "2026-07"
}
```

El body es opcional y los meses deben estar cerrados. El webhook usa `ANALISIS_CREDITO_WEBHOOK_KEY`, responde de forma asincrona y el resultado se consulta en la ejecucion de Kestra.

### Salidas

- `/reports/analisis-credito/reporte-evaluacion/ultimo.xlsx`
- `/reports/analisis-credito/reporte-evaluacion/historico/YYYY-MM-DD.xlsx`

Ambos archivos se reemplazan de forma atomica para evitar descargas incompletas.

### Configuracion

- secret `DEVEXPRESS_EVALUATE_API_BASE_URL`
- secret `ANALISIS_CREDITO_WEBHOOK_KEY`
- env opcional `reporte_evaluacion_timeout_seconds`
- env opcional `reporte_evaluacion_per_day_max`

### Namespace files

- `kestra/automations/analisis-credito/files/reporte_evaluacion_report/**`

## mudon_credixsa_report

Genera el padron de socios con credito activo en las lineas `MUDON HABERES` y
`MUDON HABERES SOCIOS NUEVOS`, enriquece cada CUIL con CredixSA y publica un
Excel para Cobranzas.

### Operacion reanudable

- crea un snapshot mensual de socios desde `F.Module.Cuentas.Prestamos.Prestamo`;
- deduplica por CUIL y conserva todas las cuentas activas del socio;
- reutiliza resultados CredixSA de hasta 7 dias;
- procesa por defecto 5 socios por lote y espera 15 segundos entre consultas online;
- persiste cada resultado en `/data/credixsa-cache/mudon-report.sqlite`;
- recupera automaticamente leases de ejecuciones interrumpidas;
- reintenta errores tecnicos hasta 3 veces en lotes posteriores;
- publica el Excel aunque existan errores definitivos, marcandolos por fila.

El estado SQLite es runtime mutable. El esquema, las migraciones y toda la
logica que lo administra viven en Git.

### Triggers

- `primer_dia_del_mes`: dia 1 a las 07:30, solo en produccion;
- `reanudar_corrida`: cada 10 minutos, solo en produccion; sale como `idle` si no hay corrida activa;
- `webhook_manual`: asincrono y protegido por `ANALISIS_CREDITO_WEBHOOK_KEY`.

Cada trigger fija explicitamente el input interno `run_mode` (`monthly`, `resume` o `manual`). El worker no infiere el modo desde metadatos del trigger: `resume` nunca crea una corrida nueva y solo continua una corrida activa.

Body manual opcional:

```json
{
  "force_refresh": false,
  "retry_errors": false
}
```

`force_refresh` solo afecta una corrida nueva. `retry_errors` reabre los errores
definitivos de la ultima corrida. Para consultar estado sin procesar un lote:

```json
{ "mode": "status" }
```

### Salidas

- `/reports/cobranzas/mudon-jubilados/ultimo.xlsx`
- `/reports/cobranzas/mudon-jubilados/historico/YYYY-MM-DD.xlsx`

El workbook contiene las hojas `Resumen` y `Socios`. La publicacion de ambos
archivos es atomica.

### Configuracion

Secrets reutilizados:

- `DEVEXPRESS_EVALUATE_API_BASE_URL` (puerto operativo 5002)
- `DEVEXPRESS_EVALUATE_API_BEARER_TOKEN`
- `CREDIX_CLIENTE`
- `CREDIX_USER`
- `CREDIX_PASS`
- `ANALISIS_CREDITO_WEBHOOK_KEY`

Variables:

- `mudon_core_timeout_seconds` (default `60`)
- `mudon_core_verify_tls` (default `false`)
- `mudon_core_max_rows` (default `5000`; alcanzar el limite aborta la corrida)
- `mudon_loan_lines`
- `mudon_credixsa_batch_size` (default `5`, maximo `10`)
- `mudon_credixsa_delay_seconds` (default `15`)
- `mudon_credixsa_cache_max_age_days` (default `7`)
- `mudon_credixsa_max_attempts` (default `3`)

### Namespace files

- `kestra/automations/analisis-credito/files/mudon_credixsa_report/**`
- reutiliza `kestra/automations/analisis-credito/files/consulta_quiebra_credix/**`
