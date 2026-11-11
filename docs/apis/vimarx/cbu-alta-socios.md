# CBU durante el alta de socios

Pruebas autorizadas del **11/11/2026** en **FapiTest**, base
`http://192.168.88.200:83`, mediante `POST /api/Simulador/CrearSocioMutual`.
Se usaron exclusivamente identidades y CBU ficticios identificados como
`ZZZ PRUEBA API NO OPERAR 20261111 CBU`. Los payloads de la
[evidencia](evidence/2026-11-11/cbu-create.json) son históricos y no deben reenviarse.

## Contrato comprobado

Dentro de `campos`, junto con los datos del socio:

```json
{
  "CuentasBancarias": [{ "CBU": "<CBU válido de 22 dígitos>" }]
}
```

El caso T04 creó el socio **152980** y la cuenta **75366**. Dos lecturas
independientes verificaron que la cuenta pertenece a ese socio, conserva el CBU
exacto y queda como habitual. También se asignaron número de socio **114935**,
`EsSocio=true`, `SocAux` y una entrada de historia de categorías.

| Caso | Resultado HTTP / negocio | Persistencia observada |
| --- | --- | --- |
| T01: `CBU` directamente en `campos` | 200 / `Ok=false`: propiedad inexistente | Ningún socio ni cuenta |
| T02: cuenta con varios campos explícitos | 200 / `Ok=false`: referencia nula | Ningún socio ni cuenta |
| T03: alta de control sin cuenta | 200 / `Ok=true` | Socio 152979 sin cuenta |
| T04: `CuentasBancarias: [{CBU}]` | 200 / `Ok=true` | Socio 152980, cuenta 75366 habitual |
| T05: `CuentasBancarias: [{CBU, Habitual:true}]` | 200 / `Ok=false`: referencia nula | Ningún socio ni cuenta |

No enviar `Habitual` explícitamente en el alta. La causa interna del error de
referencia nula no fue inspeccionada; la diferencia entre T04 y T05 aísla el
campo que dispara ese rechazo en esta versión. Ante un error o timeout,
reconciliar por identidad antes de reintentar; el HTTP 200 no prueba éxito.

## Diferencias bancarias que quedan documentadas

La cuenta de T04 quedó con banco sin asignar, sucursal `0` y número de cuenta
vacío. Una muestra acotada de cuentas históricas de FapiTest sí tenía esos datos.
La cuenta nueva quedó con CUIT del titular igual al del socio, tipo CajaAhorro,
moneda Pesos y `Validada=false`.

La comparación demuestra diferencias de datos, **no una falla operativa**. No se
probaron transferencias, débitos ni movimientos. Se acordó avanzar con el CBU
sin completar banco, sucursal ni número de cuenta, y conservar esta observación
para investigar si algún proceso los necesita. Tampoco se asigna `Validada=true`:
persistir un CBU no demuestra su titularidad bancaria.

## Uso en Beex y alcance

El alta acepta `cbu` opcional para personas físicas y jurídicas. Valida longitud,
dígitos y verificadores, y envía sólo `{CBU}` en la colección de cuentas. Si está
vacío no crea una cuenta. Desde una solicitud se precarga el CBU del titular;
`cbuNoHabitual` conserva su función de destino excepcional de esa solicitud.
El operador puede revisar o corregir el CBU antes de crear el socio.

Este campo sólo se envía a Vimarx al dar de alta. El padrón local de socios y su
edición no sincronizan datos bancarios; la consulta del CBU habitual de socios
existentes es otro cambio. No se cambian categoría ni fecha del alta en esta
corrección. La evidencia funcional corresponde a FapiTest; no se hicieron altas
de prueba en producción.
