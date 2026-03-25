# Analisis Credito

Dominio para automatizaciones de analisis y calificacion de credito.

## Flows

- `renovacion_cruz_del_eje`

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

- `automations/analisis-credito/files/analisis_credito_renovacion/**`
