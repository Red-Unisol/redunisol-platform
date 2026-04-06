# Analisis Credito

Dominio para automatizaciones de analisis y calificacion de credito.

## Flows

- `renovacion_cruz_del_eje`
- `tope_descuento_caja`
- `incoming_metamap_bridge`
- `consulta_quiebra_credix`

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

- `response` (string)

Body HTTP devuelto por el webhook:

- `{"status":"none","rows":[]}`
- `{"status":"multiple","rows":[...]}`
- `{"status":"single","data":[...]}`
- `{"status":"error","error":"..."}`

Nota:

- el webhook usa `responseContentType: text/plain` para que Kestra devuelva exactamente ese body sin envolverlo en outputs extra

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
