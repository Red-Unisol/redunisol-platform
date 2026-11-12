# Lectura del CBU habitual desde Beex

El detalle de una solicitud muestra el CBU habitual del socio en Vimarx junto
al CBU cargado en la solicitud. La consulta es en vivo y de sólo lectura: no
sobrescribe ninguno de esos valores ni mantiene una copia en el padrón local.

## Fuente y contrato

`POST /api/Empresa/EvaluateList`, con `tipo: F.Module.SocioMutual`,
`campos: ID;CuentaBancariaHabitual.CBU` y `max: 2`. El criterio usa el documento
guardado en la solicitud y, cuando existe, `TipoDoc.Descripcion`. Se normalizan
puntos, espacios y guiones del documento; el tipo se pasa en mayúsculas y con
comillas escapadas. No se toma la primera cuenta de la colección: se lee la
relación que Vimarx marca como habitual.

Prueba de sólo lectura del **11/11/2026** en **FapiTest**,
`http://192.168.88.200:83`: [peticiones y resultados](evidence/2026-11-11/cbu-read.json).
Se verificaron exclusivamente identidades ficticias de la campaña de altas:
el socio 152980 con CBU habitual, el socio 152979 sin cuenta y una identidad sin
coincidencias. No se hicieron nuevas altas ni se modificaron cuentas para esta
prueba. El contrato fue comprobado en test; no se desplegó este cambio.

## API de Beex

`GET /solicitudes/:id/datos-rapidos/cbu` exige sesión y el mismo acceso a la
solicitud que su detalle. No permite consultar un documento arbitrario desde
parámetros. Responde sólo `{status, cbu}`, con `Cache-Control: no-store`.

| `status` | Significado | `cbu` |
| --- | --- | --- |
| `available` | Un único socio con CBU habitual informado | Valor del proveedor |
| `missing` | Un único socio sin CBU habitual | `null` |
| `not_member` | Ningún socio coincide con documento y tipo | `null` |
| `ambiguous` | Más de un socio coincide | `null` |
| `unavailable` | Documento inválido, error, timeout o respuesta mal formada | `null` |

La búsqueda pide dos filas para detectar ambigüedad; nunca elige un socio por
orden de respuesta. `available` significa dato encontrado, no titularidad
bancaria verificada ni formato correcto.

## Comparación en pantalla

- Presenta el CBU habitual en Vimarx y el CBU de la solicitud con coincidencia,
  diferencia o dato pendiente. Ignora espacios y guiones al comparar y verifica
  longitud, dígitos y ambos verificadores antes de mostrar una coincidencia.
- Si hay `cbuNoHabitual`, lo presenta y compara por separado, identificado como
  destino de transferencia de esa solicitud.
- Al editar el CBU compara el borrador. Si cambia documento o tipo, suspende la
  consulta y pide guardar la identidad antes de consultar al titular actualizado.
- Permite actualizar la lectura. Mientras consulta, o si falla una actualización,
  retira el resultado anterior para evitar una coincidencia desactualizada.

La consulta usa `LEGACY_API_BASE_URL` del backend. No agrega un destino fijo ni
modifica su configuración. Los datos bancarios adicionales sin completar en el
alta siguen documentados en [CBU durante el alta](cbu-alta-socios.md).

## Verificación reproducible

Los tests del backend cubren el contrato acotado, respuestas inválidas, estados
de negocio y autorización por solicitud. En el frontend, las pruebas de
comparación cubren normalización, verificadores y cambios de identidad.

El laboratorio usa datos ficticios y bloquea el tráfico a APIs externas. Desde
`web/solicitudes-web/celesol-frontend`, ejecutar `npm run ui:dev` y luego
`node ui-lab/cbu-comparison.browser-test.mjs` (opcional
`UI_LAB_BROWSER_CHANNEL=chrome`). Prueba estados, actualización fallida y
recuperación, edición sin guardar, escritorio y móvil. Las capturas quedan en
`.local/ui-cbu-review/`. Los escenarios se pueden abrir en
`/production?cbu=match`, `different`, `missing`, `not_member`, `ambiguous`,
`unavailable`, `invalid`, `empty`, `nonhabitual` o `refresh-error`; agregar
`&edit=1` para la prueba de edición.
