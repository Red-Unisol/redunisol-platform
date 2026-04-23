# Analisis Credito

Dominio para automatizaciones de analisis y calificacion de credito.

## Flows

- `renovacion_cruz_del_eje`
- `tope_descuento_caja`
- `afip_contacto_por_dni`
- `incoming_metamap_bridge`
- `consulta_quiebra_credix`
- `consulta_quiebra_credix_http`
- `consulta_padron_a13`
- `consulta_empleador`

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

Consulta CredixSA y devuelve la forma legacy de `consultar_tabla`: `none`, `multiple` o `single`.

### Entrada

Webhook `POST` con JSON:

```json
{ "cuit": "20-12345678-3", "nombre": "Juan Perez" }
```

Tambien acepta:

- solo `cuit`
- solo `nombre`
- un string simple en el body, tratado como CUIL

Debe venir al menos uno de los dos criterios.

### Salida

Outputs principales:

- `ok` (bool)
- `status` (`none` | `multiple` | `single` | `error`)
- `rows_json` (string JSON)
- `data_json` (string JSON)
- `response_json` (string JSON con el contrato legacy)
- `error` (string | vacio)

Contrato legacy serializado en `response_json`:

- `{"status":"none","rows":[]}`
- `{"status":"multiple","rows":[...]}`
- `{"status":"single","data":[...]}`

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

### Namespace files

- `kestra/automations/analisis-credito/files/consulta_quiebra_credix/**`

## consulta_quiebra_credix_http

Consulta CredixSA por HTTP directo y devuelve la forma legacy de `consultar_tabla`: `none`, `multiple` o `single`.

### Entrada

Webhook `POST` con JSON:

```json
{ "cuit": "20-12345678-3", "nombre": "Juan Perez" }
```

Tambien acepta:

- solo `cuit`
- solo `nombre`
- un string simple en el body, tratado como CUIL

Debe venir al menos uno de los dos criterios.

### Salida

Outputs principales:

- `ok` (bool)
- `status` (`none` | `multiple` | `single` | `error`)
- `rows_json` (string JSON)
- `data_json` (string JSON)
- `response_json` (string JSON con el contrato legacy)
- `error` (string | vacio)

Contrato legacy serializado en `response_json`:

- `{"status":"none","rows":[]}`
- `{"status":"multiple","rows":[...]}`
- `{"status":"single","data":[...]}`

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

### Namespace files

- `kestra/automations/analisis-credito/files/consulta_quiebra_credix_http/**`

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
- `identifier` (string)
- `tipo` (string)
- `token_source` (`cache` | `login` | vacio)
- `data_json` (string JSON con el payload bruto de PYPDatos)
- `response_json` (string JSON con contrato minimo)
- `error` (string | vacio)

Contrato serializado en `response_json`:

- `{"ok":true,"found":true,"identifier":"32786693","tipo":"M","data":{...},"error":"","source":"pypdatos_persona"}`
- `{"ok":true,"found":false,...}` si PYPDatos responde `No se pudo encontrar cuil/documento`
- `{"ok":false,...}` si el request es invalido o la consulta falla

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
