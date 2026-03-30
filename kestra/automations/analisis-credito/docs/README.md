# Analisis Credito

Dominio para automatizaciones de analisis y calificacion de credito.

## Flows

- `renovacion_cruz_del_eje`
- `tope_descuento_caja`

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
