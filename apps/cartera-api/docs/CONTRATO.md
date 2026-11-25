# API de cartera de préstamos — Mutual Celesol

Documentación para consumir la API de solo lectura con la cartera de préstamos de los proveedores
**SANCOR** (todas las tandas), **M SANATORIO SANTA FE** y **MEDICA ROSARIO**.

Versión 1 · 20/11/2026

---

## 1. Resumen

| | |
| --- | --- |
| URL base | `https://cartera-api.redunisol.com.ar/v1` |
| Protocolo | HTTPS (TLS 1.2 o superior). No hay acceso por HTTP. |
| Formato | JSON (UTF-8) |
| Métodos | Solo `GET`. La API es de solo lectura. |
| Autenticación | Token en el encabezado `Authorization: Bearer <token>` |
| Actualización de los datos | Una vez por día, a las **05:00 (hora de Argentina)**. Se recomienda consultar después de las 06:00. |
| Período | Toda la cartera de esos proveedores desde su inicio (primer préstamo: 07/05/2024). |

La API no consulta el sistema de la mutual en el momento: devuelve la foto tomada en la última
actualización diaria. Consultarla varias veces en el día devuelve los mismos datos.

---

## 2. Autenticación

Cada consulta tiene que llevar el token que les entregamos por separado:

```
Authorization: Bearer <token>
```

- El token es de solo lectura y personal para su integración. **No lo compartan ni lo dejen en
  código público, planillas o correos.** Guárdenlo como un secreto (variable de entorno, gestor de
  secretos).
- Si se pierde o se filtra, avísennos: lo anulamos y les damos uno nuevo.
- Sin token, o con un token incorrecto, la API responde `401`.

**User-Agent.** Envíen un encabezado `User-Agent` que identifique su integración, por ejemplo
`User-Agent: cartera-santafe/1.0`. Algunos clientes HTTP mandan por defecto un User-Agent que el
filtro de seguridad de la red rechaza con un `403` (por ejemplo, `urllib` de Python sin configurar).

---

## 3. Paginado

Las consultas que devuelven listas vienen **por páginas**. Cada respuesta tiene esta forma:

```json
{
  "items": [ ... ],
  "siguiente": "WyIyMDI2LTExLTIwVDE1OjE4OjEyLTAzOjAwIiwgWzQxMjkzOV1d"
}
```

- `items`: los registros de esta página.
- `siguiente`: la marca para pedir la página que sigue. Si viene en `null`, ya no hay más páginas.

Para leer todo:

1. Pidan la primera página, sin `cursor`.
2. Si `siguiente` no es `null`, repitan la **misma consulta** (mismos filtros y mismo `limite`)
   agregando `cursor=<valor de siguiente>`. El valor se usa tal cual, sin interpretarlo ni modificarlo.
3. Repitan hasta que `siguiente` venga en `null`.

Tamaño de página: parámetro `limite`. Por defecto 500, máximo 2000.

Ejemplo:

```
GET /v1/prestamos?limite=2000
GET /v1/prestamos?limite=2000&cursor=WyIyMDI2LTExLTIwVDE1OjE4OjEyLTAzOjAwIiwgWzQxMjkzOV1d
```

El orden de los registros es estable (por fecha de actualización y luego por identificador), de modo
que el recorrido no repite ni saltea registros.

---

## 4. Traer solo lo modificado

Todos los registros traen `actualizado_en`: el momento en que la actualización diaria detectó que
ese registro cambió (fecha y hora con zona horaria, por ejemplo `2026-11-20T05:03:12-03:00`).

Con el parámetro `modificados_desde` reciben solo los registros con `actualizado_en` igual o
posterior a esa fecha y hora:

```
GET /v1/cuotas?modificados_desde=2026-11-20T00:00:00-03:00
```

Acepta una fecha (`2026-11-20`, se toma como 00:00 hora de Argentina) o fecha y hora ISO 8601.

**Flujo diario recomendado:**

1. **Primera vez:** traer todo (sin `modificados_desde`) de `/prestamos`, `/cuotas` y `/cobros`.
2. **Cada día siguiente:** traer con `modificados_desde` igual al momento en que hicieron la consulta
   anterior, y actualizar en su base los registros recibidos (por su identificador, ver cada recurso).

Un registro que deja de existir en el sistema de la mutual (por ejemplo, un cobro revertido) no se
borra de la API: vuelve a aparecer con `"eliminado": true` y un `actualizado_en` nuevo, para que lo
puedan dar de baja de su lado.

---

## 5. Recursos

### 5.1 `GET /v1/prestamos`

Un registro por préstamo.

**Filtros:** `proveedor` (nombre exacto, ver 6.1), `modificados_desde`, `cursor`, `limite`.

**Identificador:** `prestamo_id`.

```json
{
  "prestamo_id": 412939,
  "nro_cuenta": 995474,
  "socio": { "nro_socio": 12345, "dni": "30111222", "cuit": "20301112223" },
  "proveedor": "SANCOR UNO",
  "linea": { "codigo": "3347", "descripcion": "CAJA ESPECIAL A" },
  "fecha_emision": "2024-05-07",
  "capital_otorgado": 368100.0,
  "monto_desembolsado": 300000.0,
  "total_a_devolver": 1104192.0,
  "tna": 1.8737,
  "tem": 0.154,
  "tea": 4.5779,
  "cantidad_cuotas": 18,
  "saldo": 0.0,
  "estado": 101,
  "estado_texto": "PagoAnticipado",
  "estado_prestamo": 5,
  "estado_prestamo_texto": "Tesoreria",
  "participacion_mutual": 0.5,
  "eliminado": false,
  "actualizado_en": "2026-11-20T15:18:12-03:00"
}
```

*(Los datos del socio de este ejemplo son ficticios.)*

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `prestamo_id` | entero | Identificador único del préstamo. |
| `nro_cuenta` | entero | Número de cuenta del préstamo en el sistema de la mutual. |
| `socio.nro_socio` | entero | Número de socio del titular. |
| `socio.dni` | texto | DNI del titular. Puede venir vacío en préstamos anulados. |
| `socio.cuit` | texto | CUIT/CUIL del titular. |
| `proveedor` | texto | Proveedor del préstamo (ver 6.1). |
| `linea.codigo` / `linea.descripcion` | texto | Línea de préstamo. |
| `fecha_emision` | fecha | Fecha de otorgamiento (`AAAA-MM-DD`). |
| `capital_otorgado` | número | Capital del préstamo. |
| `monto_desembolsado` | número | Lo efectivamente entregado al socio (capital menos gastos administrativos). |
| `total_a_devolver` | número | Suma de todas las cuotas del plan. |
| `tna`, `tem`, `tea` | número | Tasas **expresadas como fracción**: `1.8737` = 187,37 %. |
| `cantidad_cuotas` | entero | Cantidad de cuotas del plan. |
| `saldo` | número | Saldo pendiente del préstamo. |
| `estado` / `estado_texto` | entero / texto | Estado del préstamo (ver 6.2). |
| `estado_prestamo` / `estado_prestamo_texto` | entero / texto | Estado administrativo (ver 6.2). |
| `participacion_mutual` | número o `null` | Porcentaje de participación de la mutual, como fracción (ver 6.3). |
| `eliminado` | booleano | `true` si el registro ya no existe en el sistema de la mutual. |
| `actualizado_en` | fecha y hora | Última vez que el registro cambió. |

### 5.2 `GET /v1/cuotas`

Un registro por cuota del plan.

**Filtros:** `prestamo_id`, `modificados_desde`, `cursor`, `limite`.

**Identificador:** `prestamo_id` + `nro_cuota`.

```json
{
  "prestamo_id": 412939,
  "nro_cuota": 1,
  "vencimiento": "2024-05-31",
  "capital": 4656.58,
  "interes": 56687.4,
  "gastos": 0.0,
  "total": 61343.98,
  "pagado_capital": 4656.58,
  "pagado_interes": 56687.4,
  "pagado_total": 61343.98,
  "fecha_pago": "2024-06-24",
  "saldo": 0.0,
  "estado": "pagada",
  "eliminado": false,
  "actualizado_en": "2026-11-20T15:18:12-03:00"
}
```

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `prestamo_id` | entero | Préstamo al que pertenece. |
| `nro_cuota` | entero | Número de cuota (desde 1). |
| `vencimiento` | fecha | Fecha de vencimiento. |
| `capital`, `interes`, `gastos`, `total` | número | Composición de la cuota según el plan. |
| `pagado_capital`, `pagado_interes`, `pagado_total` | número | Lo pagado de esa cuota (en positivo). |
| `fecha_pago` | fecha o `null` | Fecha del último pago imputado a la cuota. |
| `saldo` | número | Saldo pendiente de la cuota. |
| `estado` | texto | `pagada` (saldo 0), `impaga` (no se pagó nada) o `pago_parcial`. |
| `eliminado`, `actualizado_en` | | Igual que en préstamos. |

Los préstamos anulados no tienen cuotas.

### 5.3 `GET /v1/cobros`

Un registro por cobro imputado a una cuota. Un mismo cobro que cubre varias cuotas aparece una vez
por cuota.

**Filtros:** `prestamo_id`, `desde` y `hasta` (fecha del cobro, `AAAA-MM-DD`, ambas inclusive),
`modificados_desde`, `cursor`, `limite`.

**Identificador:** `cobro_id` + `prestamo_id` + `nro_cuota`.

```json
{
  "cobro_id": 16774103,
  "fecha": "2024-05-31",
  "prestamo_id": 412939,
  "nro_cuota": 1,
  "capital": 0.0,
  "interes": 54343.98,
  "otros": 0.0,
  "total": 54343.98,
  "eliminado": false,
  "actualizado_en": "2026-11-20T15:18:12-03:00"
}
```

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `cobro_id` | entero | Identificador del cobro en el sistema de la mutual. |
| `fecha` | fecha | Fecha del cobro. |
| `prestamo_id`, `nro_cuota` | entero | Cuota a la que se imputó. |
| `capital`, `interes`, `otros`, `total` | número | Cómo se imputó el cobro (en positivo). |
| `eliminado`, `actualizado_en` | | Igual que en préstamos. |

La suma de `total` de los cobros de una cuota es igual a su `pagado_total`. Los gastos
administrativos que se descuentan al desembolsar no figuran como cobros.

### 5.4 `GET /v1/estado`

Fecha y hora de la última actualización correcta y cantidad de registros. Útil para verificar,
antes de leer, que la actualización del día ya corrió.

```json
{
  "ultima_sincronizacion_ok": "2026-11-20T05:05:20-03:00",
  "filas": { "prestamos": 3973, "cuotas": 98656, "cobros": 87031 },
  "ultimo_intento": { "inicio": "2026-11-20T05:00:00-03:00", "estado": "ok" }
}
```

Si `ultimo_intento.estado` es `error`, la actualización de ese día falló y la API sigue sirviendo
los datos de la última actualización correcta.

---

## 6. Valores

### 6.1 Proveedores

`M SANATORIO SANTA FE`, `MEDICA ROSARIO` y las tandas de SANCOR: `SANCOR UNO`, `SANCOR DOS`,
`SANCOR 3`, `SANCOR 4`, `SANCOR 5`, `SANCOR 6`, `SANCOR SEIS BIS`, `SANCOR SIETE`, `SANCOR OCHO`,
`SANCOR NUEVE`, `SANCOR 10` a `SANCOR 19` y `SANCOR 20 PLAN DESEN`.

El filtro `proveedor` compara el nombre exacto.

### 6.2 Estados del préstamo

| `estado` | `estado_texto` |
| --- | --- |
| 0 | Activa |
| 3 | Anulada |
| 100 | Pago |
| 101 | PagoAnticipado |
| 102 | PagoVencido |
| 121 | Fallecimiento |
| 122 | Refinanciado |
| 123 | Perdida |

`Activa` es el préstamo vigente. `Anulada` es un préstamo anulado (sin cuotas ni saldo).
`Refinanciado` es un préstamo cancelado por una refinanciación. Los demás son los nombres con que el
sistema de la mutual registra cada forma de cancelación o baja.

`estado_prestamo` / `estado_prestamo_texto`: `0 Anulado`, `1 AprobadoInactivo`, `5 Tesoreria`.

Los textos son los del sistema de la mutual; si aparece un estado nuevo, viene con su número y su texto.

### 6.3 Participación de la mutual

`participacion_mutual` no sale del sistema de la mutual: es un valor configurado.

- Todas las tandas de SANCOR: `0.5` (50 %), salvo `SANCOR 20 PLAN DESEN`: `0.5705` (57,05 %).
- M SANATORIO SANTA FE y MEDICA ROSARIO: `null` (sin dato).

Si alguno de estos valores tiene que cambiar, avísennos.

---

## 7. Límites y errores

- Hasta **120 consultas por minuto**. Leer toda la cartera con `limite=2000` lleva menos de 100
  consultas (hoy, unas 2 de préstamos, 50 de cuotas y 44 de cobros), así que en el uso normal no se
  llega al límite.
- Las respuestas no deben guardarse en cachés intermedias (`Cache-Control: no-store`).

| Código | Significado | Qué hacer |
| --- | --- | --- |
| `200` | OK | |
| `400` | Parámetro inválido (fecha mal escrita, cursor alterado) | Revisar la consulta. |
| `401` | Falta el token o es incorrecto | Revisar el encabezado `Authorization`. |
| `403` | Rechazada por el filtro de seguridad | Enviar un `User-Agent` propio (ver 2). Si sigue, avísennos. |
| `429` | Se superó el límite por minuto | Esperar un minuto y reintentar. |
| `5xx` | Error del servicio | Reintentar más tarde; si persiste, avísennos. |

---

## 8. Ejemplo completo (Python)

```python
import os
import requests

BASE = "https://cartera-api.redunisol.com.ar/v1"
HEADERS = {
    "Authorization": f"Bearer {os.environ['CARTERA_API_TOKEN']}",
    "User-Agent": "cartera-santafe/1.0",
}


def leer_todo(recurso, **filtros):
    """Recorre todas las páginas de un recurso y devuelve la lista completa."""
    registros, cursor = [], None
    while True:
        params = {"limite": 2000, **filtros}
        if cursor:
            params["cursor"] = cursor
        r = requests.get(f"{BASE}/{recurso}", headers=HEADERS, params=params, timeout=60)
        r.raise_for_status()
        datos = r.json()
        registros += datos["items"]
        cursor = datos["siguiente"]
        if not cursor:
            return registros


# Primera vez: todo
prestamos = leer_todo("prestamos")
cuotas = leer_todo("cuotas")
cobros = leer_todo("cobros")

# Días siguientes: solo lo modificado desde la consulta anterior
cambios = leer_todo("cuotas", modificados_desde="2026-11-20T06:00:00-03:00")
```

---

## 9. Pendiente

Para los préstamos refinanciados (`estado` 122) todavía no se informan el préstamo de origen ni el
monto cancelado. Se agregarán en una versión siguiente como campos nuevos, sin cambiar los actuales.

## 10. Contacto

Ante dudas, errores o cambios: área de Sistemas de Mutual Celesol.
