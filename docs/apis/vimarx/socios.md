# CrearSocioMutual: contrato verificado

Verificado el **15/09/2026** contra `https://celesol.dyndns.org:5002`.
Operación: `POST /api/Simulador/CrearSocioMutual`, `Content-Type: application/json`.
Trece intentos de alta autorizados: cinco exitosos y ocho rechazados. Cada intento
tuvo una búsqueda previa y una consulta posterior con `EvaluateList`.

## Alcance del contrato

Swagger define `SocioMutualRequest` con `tipo` (string nullable), `validar`
(boolean) y `campos` (diccionario). No enumera las propiedades internas de socio.
La definición recursiva `JToken` del Swagger tampoco describe de forma útil sus
valores: en vivo se admiten escalares, objetos y listas según la propiedad.

La tabla siguiente cubre los campos que envía la página y los formatos ensayados.
No es una lista exhaustiva de todas las propiedades de `SocioMutual`. No se
determinó el conjunto mínimo obligatorio mediante eliminación de cada campo.
`tipo` se omitió en todos los ensayos, como hace el gateway de la página.

## Campos y formatos

| Campo de `campos` | Forma enviada por la página | Evidencia del core |
| --- | --- | --- |
| `Apellido` | String: apellido en física, razón social en jurídica | Conservado en T03–T06 y T09 |
| `Nombre` | String; vacío en jurídica | Texto conservado en física; `""` leído como `null` en jurídica |
| `FechaDeNacimiento` | String `YYYY-MM-DD`, sólo física | `1990-03-15` conservado; `15/03/1990` rechazado en T07. Otros formatos y zonas horarias no ensayados |
| `NroDoc` | String de dígitos, sólo física | String y número JSON aceptados; `EvaluateList` devuelve número. En jurídica se omitió y el core completó con el CUIT |
| `TipoDoc` | String fijo `"96"` | `"96"` y número `96` persistieron como descripción `DNI`. Jurídica lo omite y obtiene `CUIT` |
| `Sexo` | String; física desde formulario, jurídica `"PersonaJuridica"` | `"Femenino"` y `"PersonaJuridica"` aceptados; valor inexistente rechazado en T10. `EvaluateList` devolvió 1 y 2 respectivamente |
| `CUIT` | String normalizado | String y número JSON aceptados con los valores sintéticos de la campaña. El CUIT deliberadamente inválido de T01 fue rechazado incluso con `validar: false` |
| `Celular` | String opcional; se omite si no tiene valor | Omisión aceptada. `"0000000000"` rechazado en T02. No se probaron contactos reales ni un formato telefónico válido completo |
| `Email` | String opcional | Omisión aceptada. La dirección `...@example.invalid` de T02 fue rechazada. El error menciona `NO POSEE`, pero ese literal no fue ensayado |
| `Domicilio` | Objeto anidado | Aceptado; ver orden de campos más abajo. No se ensayó omitir todo el domicilio |
| `Domicilio.Calle` | String | Conservado |
| `Domicilio.NroPuerta` | String | String `"0"` y número `0` aceptados; lectura como string |
| `Domicilio.Localidad` | ID numérico; el gateway hace `Number(localidad)` | Número `12` y string `"12"` aceptados. Es una referencia a catálogo, no el nombre de la localidad |
| `Domicilio.CodigoPostal` | String | Puede ser sobrescrito por `Localidad`; T05 prueba cómo conservarlo |
| `HistoriaCategorias` | Lista de objetos, fija en la página | Se creó una entrada por socio exitoso |
| `HistoriaCategorias[].Categoria` | Número fijo `2` | La relectura final confirmó una entrada con `Categoria.ID = 2` en los cinco socios |
| `HistoriaCategorias[].Fecha` | String fijo `"2020-01-01"` | La relectura final confirmó una entrada con esa fecha en los cinco socios |

Los CUIT sintéticos que pasaron no se verificaron contra un padrón externo. La
aceptación del core no demuestra identidad real ni titularidad. No inferir una
enumeración completa de `Sexo` a partir de dos valores; el significado observado
de sus códigos de lectura tampoco sustituye un catálogo de tipos de persona.

### Diferencias entre la página y el core

El [schema HTTP de Solicitudes](https://github.com/Red-Unisol/redunisol-platform/blob/01ea23d11b00b8e5b61a14ec4945c3503f4a34ba/web/solicitudes-web/celesol-backend/src/modules/socios/presentation/CreateSocioRequest.schema.ts)
exige strings no vacíos para varios campos, email con forma válida si está
presente y fecha con patrón `YYYY-MM-DD`. Eso es validación del consumidor,
no prueba de obligatoriedad o reglas completas del proveedor.

El gateway fija `TipoDoc: "96"` para personas físicas aunque el formulario tenga
otro tipo de documento. También fija `HistoriaCategorias` a categoría 2 / fecha
2020-01-01 y envía `validar: false`. Esas decisiones deben revisarse funcionalmente
si se amplían tipos de socio; no son defaults inferidos del proveedor.

## El orden de las claves cambia el resultado

T04 envió el mismo orden que usa actualmente el gateway:

```json
{
  "Calle": "CALLE FICTICIA PRUEBA API NO OPERAR",
  "CodigoPostal": "0000",
  "Localidad": 12,
  "NroPuerta": "0"
}
```

La lectura posterior devolvió `Domicilio.CodigoPostal = "215200"`, asociado a la
localidad 12 (`GDRO.BAIGORRIA`). El alta respondió `Ok: true` sin advertir el cambio.

T05 envió la localidad primero y el código postal al final:

```json
{
  "Localidad": 12,
  "Calle": "CALLE FICTICIA PRUEBA API NO OPERAR",
  "NroPuerta": "0",
  "CodigoPostal": "0000"
}
```

La lectura devolvió `"0000"`. La comparación confirma dependencia del orden de
asignación para este par de campos. No ordenar alfabéticamente el JSON ni asumir
que la asociación y los valores explícitos son independientes.

**Hallazgo pendiente de corrección en la página:** el gateway desplegado envía el
primer orden, por lo que puede guardar en PostgreSQL un código postal distinto del
persistido en Vimarx. Esta campaña documenta el problema; no modifica la aplicación.

## Ejemplo de persona física

Es el payload histórico exitoso de T05. **No reenviarlo:** ya existe el socio
152762. Para pruebas nuevas deben asignarse identidades sintéticas nuevas y
comprobar su ausencia antes de escribir.

```json
{
  "campos": {
    "Apellido": "ZZZ PRUEBA API NO OPERAR 20260915 T05",
    "FechaDeNacimiento": "1990-03-15",
    "Nombre": "SOCIO FICTICIO",
    "NroDoc": "99091505",
    "Sexo": "Femenino",
    "TipoDoc": "96",
    "CUIT": "27990915054",
    "Domicilio": {
      "Localidad": 12,
      "Calle": "CALLE FICTICIA PRUEBA API NO OPERAR",
      "NroPuerta": "0",
      "CodigoPostal": "0000"
    },
    "HistoriaCategorias": [{"Categoria": 2, "Fecha": "2020-01-01"}]
  },
  "validar": false
}
```

Para persona jurídica, T03 envió razón social en `Apellido`, `Nombre: ""`,
`Sexo: "PersonaJuridica"` y CUIT. Omitió `NroDoc`, `TipoDoc` y fecha de nacimiento.
El core completó NroDoc con el CUIT, tipo documental `CUIT` y nombre `null`.
El payload y la lectura completos están en [socios.json](evidence/2026-09-15/socios.json).

## Respuestas y errores

Éxito observado: HTTP 200 con `{"Ok":true,"ID":152762,"Error":null}`.
Rechazo observado: también HTTP 200, con `Ok: false`, `ID: null` y explicación
en `Error`. Un cliente debe comprobar **HTTP + JSON + `Ok` + ID utilizable** y
después verificar lo persistido. No basta con `response.ok` ni con recibir 200.

`validar: false` **no desactiva todas las validaciones**: T01, T02, T07, T08 y
T10 fueron rechazados con ese valor. T09, con `validar: true`, aceptó un payload
equivalente al caso base. No se deduce que los dos modos sean equivalentes ni se
determinó qué validaciones adicionales controla exactamente el flag.

| Caso | Diferencia ensayada | Resultado |
| --- | --- | --- |
| T01 | CUIT con prefijo deliberadamente inválido; contacto ficticio | Rechazo: CUIT inválido. No se observaron registros |
| T02 | CUIT corregido; celular de ceros y correo `.invalid` | Rechazo: celular/email inválidos. No se observaron registros |
| T03 | Jurídica, omitiendo contacto y datos de persona física | Creado **152760** |
| T04 | Física, fecha ISO, documento string y contacto omitido | Creado **152761**; postal sobrescrito |
| T05 | Física, localidad antes del postal explícito | Creado **152762**; postal conservado |
| T06 | Documento, tipo documental, CUIT y puerta numéricos; localidad string | Creado **152763**; valores convertidos según la tabla |
| T07 | Fecha `15/03/1990` | Rechazo `not recognized as a valid DateTime`; sin registro observado |
| T08 | Propiedad `CampoInexistentePruebaAPI` | Rechazo: propiedad inexistente; sin registro observado |
| T09 | Caso físico equivalente a T04, `validar: true` | Creado **152764** |
| T10 | `Sexo: "VALOR_INVALIDO_PRUEBA"` | Rechazo de enum; sin registro observado |

T06 combina varios cambios de representación: su éxito y lectura prueban que esa
combinación fue aceptada. No demuestra todas las conversiones posibles ni que cada
variante funcione de manera independiente bajo otras condiciones.

## Campos adicionales: SocAux.Caja40

Se ensayaron tres formas de escritura sobre identidades sintéticas nuevas,
con el payload físico previamente aceptado y sin contactos. Todas usaron
`validar: false` y omitieron `tipo`, igual que la página:

| Caso | Fragmento agregado dentro de `campos` | Respuesta de negocio |
| --- | --- | --- |
| T11 | `"SocAux": {"Caja40": 50}` | La propiedad 'SocAux' no existe en el tipo 'SocioMutual'. |
| T12 | `"SocAux.Caja40": 50` | La propiedad 'SocAux.Caja40' no existe en el tipo 'SocioMutual'. |
| T13 | `"Caja40": 50` | La propiedad 'Caja40' no existe en el tipo 'SocioMutual'. |

Las tres llamadas devolvieron HTTP 200 con `Ok: false` e `ID: null`. Las búsquedas
previas y posteriores por marcador, CUIT y documento devolvieron `[]`: no se
observaron socios nuevos. Peticiones completas y respuestas en
[socaux.json](evidence/2026-09-15/socaux.json).

La lectura de `ID;SocAux.Caja40` con `tipo: "F.Module.SocioMutual"` y
`cmd: "[ID] = 152761"` respondió HTTP 200, `[[152761,null]]`. El consumidor
Bancor también utiliza `Prestamo.SocioTitular.Socio.SocAux.Caja40` desde cuotas.
La accesibilidad mediante EvaluateList no demuestra escritura mediante el alta.

**Conclusión comprobada:** anidar JSON no alcanza para escribir SocAux con el
contrato de CrearSocioMutual usado por la página. El endpoint sí acepta otros
objetos anidados como Domicilio, pero rechaza SocAux antes de poder comprobar el
valor de Caja40. Esto no es un rechazo del número 50 ni demuestra que sea
imposible escribirlo mediante otro contrato.

**Hipótesis pendiente:** lectura y alta podrían resolver propiedades con mecanismos
diferentes, y SocAux podría ser una extensión del modelo que el alta no contempla.
No se inspeccionó la implementación del proveedor ni se confirmó esa causa.
No se ensayaron otros valores de `tipo`, endpoints de modificación o escritura
directa sobre SocAux. Para habilitarlo, confirmar con el proveedor la ruta de
escritura soportada o ampliar el endpoint y verificar su persistencia.

## Persistencia, inventario y límites

Quedaron **cinco socios sintéticos: 152760–152764**. Todos tienen el marcador
`ZZZ PRUEBA API NO OPERAR 20260915 Txx` en el apellido/razón social. No se asignaron
contactos reales. No se crearon préstamos ni se ejecutaron pagos, borrados o
modificaciones de socios existentes. No se invocó sincronización a PostgreSQL.

Las respuestas de error no se reenviaron. Tras cada intento se buscó por
apellido/marcador, CUIT y documento. En los ocho rechazos no se observaron filas;
esto no prueba rollback atómico para todos los errores posibles del proveedor.
El caso T03 tuvo un error en la primera consulta de verificación por `TipoDoc.ID`;
se corrigió sólo la consulta y se leyó el ID retornado, sin repetir el alta.

No se probó deduplicación del proveedor, creación concurrente, reintentos tras
timeout, longitudes máximas, todos los enums, campos nulos frente a omitidos,
localidades inexistentes ni la obligatoriedad mínima de todos los campos.
La página comprueba duplicados contra su repositorio local; eso no garantiza
ausencia de duplicados en Vimarx ni una transacción conjunta entre ambos sistemas.

Las altas se conservan como evidencia identificable. Cualquier baja o limpieza
posterior debe ser una intervención explícita y documentar su resultado.

La [verificación final](evidence/2026-09-15/final-verification.json) encontró los
cinco IDs y conservó todos los valores de la lectura inicial; también verificó
categoría y fecha para cada registro.
