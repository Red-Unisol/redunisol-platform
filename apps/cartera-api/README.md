# Cartera API

API de solo lectura con la cartera de préstamos de los proveedores SANCOR (todas las tandas),
M SANATORIO SANTA FE y MEDICA ROSARIO: préstamos, cuotas y cobros.

No consulta Vimarx en cada pedido. Una vez por día copia la cartera desde la API Fapi
(`EvaluateList`, solo lectura) a una base SQLite propia y responde desde ahí.

## Copia diaria

- Corre dentro de la app, a la hora de `CARTERA_SYNC_HORA` (Argentina). A mano: `python -m cartera_api.sync`.
- Lee los préstamos por proveedor y, por lotes de 100 préstamos, sus cuotas y los movimientos de pago.
- Cuotas: solo `NroCuota > 0` y el tipo exacto `CuotaPrestamo`. Las filas "PG ..." (subtipo
  `CuotaPrestamoCobro`) son cobros, no cuotas.
- Cobros: movimientos con `Pago = true`, agrupados por cobro de Vimarx (`TransaccionAjuste`), préstamo y cuota.
- Cada fila guarda un hash de su contenido: `actualizado_en` solo cambia si la fila cambió. Lo que deja de
  venir de Vimarx queda con `eliminado: true`.
- Todo se aplica en una transacción. Si Vimarx devuelve 0 préstamos, o menos de la mitad de los que había,
  no se aplica nada y el intento queda como `error`.
- Fapi trunca sin avisar al llegar a `max`: si un lote llega al tope, la copia falla en vez de guardar datos incompletos.

## Endpoints

Todos con `Authorization: Bearer <token>`, salvo `/health`.

| Ruta | Filtros |
| --- | --- |
| `GET /v1/prestamos` | `proveedor`, `modificados_desde` |
| `GET /v1/cuotas` | `prestamo_id`, `modificados_desde` |
| `GET /v1/cobros` | `prestamo_id`, `desde`, `hasta` (fecha del cobro), `modificados_desde` |
| `GET /v1/estado` | última copia y cantidad de filas |
| `GET /health` | sin token: si hay una copia correcta y cuándo |

Paginado: `limite` (500 por defecto, máximo 2000) y `cursor`. La respuesta trae `items` y `siguiente`;
con `siguiente = null` no hay más. Orden estable por `actualizado_en`.

## Seguridad

- `CARTERA_API_TOKEN`: obligatorio, mínimo 32 caracteres. La app no arranca sin él.
- `CARTERA_IPS_PERMITIDAS`: lista de IPs o redes separadas por coma. Vacía = apagada.
- `CARTERA_LIMITE_POR_MINUTO`: consultas por minuto por IP (120 por defecto).
- Cada consulta se loguea con su IP. La primera vez que aparece una IP se loguea `ip_nueva` (WARNING),
  para alertarla desde Loki. Las IPs vistas quedan en la tabla `ips_vistas`.
- `X-Forwarded-For` solo se tiene en cuenta si la conexión viene de `CARTERA_PROXIES_CONFIABLES`
  (por defecto loopback y redes privadas, donde está Apache / Docker).
- Sin swagger público (`/docs` y `/openapi.json` apagados).

## Variables

| Variable | Por defecto |
| --- | --- |
| `VIMARX_EVAL_BASE_URL` | obligatoria (ej. `https://celesol.dyndns.org:5002`) |
| `CARTERA_DB_PATH` | `/data/cartera/cartera.sqlite` |
| `CARTERA_SYNC_HORA` | `05:00` |
| `CARTERA_SYNC_ACTIVA` | `1` |
| `CARTERA_PROVEEDORES` | JSON; `["SANCOR%", "M SANATORIO SANTA FE", "MEDICA ROSARIO"]` |
| `CARTERA_PARTICIPACION` | JSON; `{"SANCOR 20 PLAN DESEN": 0.5705, "SANCOR%": 0.5}` |

## Pendiente

- Estado como texto (hoy van los números `estado` y `estado_prestamo`).
- Refinanciación: préstamo de origen y monto cancelado.

## Desarrollo

```bash
pip install -r requirements-dev.txt
pytest
```
