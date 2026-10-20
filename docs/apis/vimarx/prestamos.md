# Préstamos, solicitudes y marcado de pagos

Inventario de contratos **observados en código y Swagger**. No se crearon
préstamos, solicitudes antiguas ni pagos en la campaña de socios del 15/09/2026.

## Identidades distintas

| Entidad | Tipo/almacenamiento | Identidad usada por sus consumidores |
| --- | --- | --- |
| Socio del core | `F.Module.SocioMutual` | `ID`; el alta devuelve `ID` |
| Solicitud antigua | `PreSolicitud.Module.Solicitud` | `Oid` |
| Préstamo | `F.Module.Cuentas.Prestamos.Prestamo` | `ID` |
| Solicitud de la web nueva | PostgreSQL de Solicitudes | UUID propio; `legacyOid` guarda el ID retornado por `CrearPrestamo` |

Un ID numérico sólo tiene significado acompañado del tipo al que pertenece.
`legacyOid` es un nombre del consumidor; no garantiza que sea un `Oid` de solicitud
antigua. No resolver identidades probando tipos distintos hasta que alguno responda:
podría encontrarse un objeto diferente con el mismo número.

## CrearPrestamo

`POST /api/Simulador/CrearPrestamo` figura en Swagger. El
[gateway de Solicitudes dev](https://github.com/Red-Unisol/redunisol-platform/blob/01ea23d11b00b8e5b61a14ec4945c3503f4a34ba/web/solicitudes-web/celesol-backend/src/modules/solicitudes-core/infrastructure/services/CrearPrestamoGateway.ts)
envía `validar: false` y, dentro de `campos`, este orden:

1. `FechaEmision`.
2. `Integrantes`: lista con `Socio` y `TipoRelacion: "Titular"`.
3. `LineaPrestamo`.
4. `Cuotas`.
5. `MontoDeseado`, como número JSON.
6. `Vendedor`.

Ese código documenta una comprobación previa: asignar `LineaPrestamo` después de
`Cuotas` restablecía las cuotas al mínimo de la línea; enviar `MontoDeseado` como
string dejaba el importe en cero. Son antecedentes de otro consumidor, no resultados
repetidos en esta campaña. El caso de código postal en [socios.md](socios.md) aporta
una comprobación nueva de dependencia del orden en el endpoint de socios.

El caso de uso traduce el OID de `PreSolicitud.Module.LineaPrestamoPresolicitud`
al ID de `F.Module.Cuentas.Prestamos.LineaPrestamo` antes de crear el préstamo.
No asumir que esos identificadores coinciden.

## CrearSolicitud

`POST /api/Simulador/CrearSolicitud` aparece en Swagger con un diccionario `campos`.
No se verificó qué crea, sus campos internos, estados iniciales ni relación con
`CrearPrestamo`. Su documentación completa queda pendiente; no usarlo como puente
de integración basándose sólo en el nombre.

## Marcar pagada

El [cliente de Transferencias](../../../apps/metamap-platform/client/transferencias-celesol/src/mark_paid_client.rs)
envía al servicio del puerto `35010`:

- `numeroSolicitud`: OID de la **solicitud antigua**, pese al nombre del campo.
- `comprobantePdfBase64`: PDF confirmado.
- Autenticación Bearer, obtenida de la configuración operativa.

El cliente requiere HTTP 200 y luego verifica el estado del core. No se encontró
en estos contratos una garantía de idempotencia del endpoint ni soporte comprobado
para marcar directamente un préstamo creado sin solicitud antigua. Esa diferencia
debe resolverse antes de conectar los pagos del nuevo módulo. Consultar el
[README vigente de Transferencias](../../../apps/metamap-platform/client/transferencias-celesol/README.md)
para su recuperación y límites operativos.
