# EvaluateList y EvaluateObj

Base verificada el 15/09/2026: `https://celesol.dyndns.org:5002`.
Ambas rutas se consumen desde varias aplicaciones del repositorio. **EvaluateList**
se probó en esta campaña; **EvaluateObj** se describe a partir del código existente.
Ninguna aparece en el Swagger capturado de esa base.

## EvaluateList

`POST /api/Empresa/EvaluateList`, `Content-Type: application/json`.

```json
{
  "tipo": "F.Module.SocioMutual",
  "cmd": "[ID] = 152762",
  "campos": "ID;Apellido;NroDoc;CUIT;TipoDoc.Descripcion;Domicilio.CodigoPostal;Domicilio.Localidad.ID",
  "max": 1
}
```

| Propiedad | Uso |
| --- | --- |
| `tipo` | Nombre completo del tipo del proveedor; distingue socio, solicitud antigua, préstamo, etc. |
| `cmd` | Expresión de filtro del proveedor; no es SQL ni un endpoint para ejecutar comandos del sistema |
| `campos` | Lista de propiedades/expresiones separadas por `;`; define el orden posicional de cada fila |
| `max` | Máximo solicitado de filas. Se usaron límites pequeños en esta campaña; no se midieron límites del servidor |

Respuesta verificada para ese socio sintético:

```json
[[152762,"ZZZ PRUEBA API NO OPERAR 20260915 T05",99091505,27990915054,"DNI","0000",12]]
```

La respuesta es una lista de filas posicionales. No interpretar los valores por
nombre ni cambiar el orden de `campos` sin cambiar el mapeo. Documento y CUIT se
reciben como números en estas lecturas; las identidades deben conservarse como
strings en los contratos propios. No deducir preservación de ceros iniciales.

Filtros y expresiones utilizados con éxito:

- Identidad numérica: `[ID] = 152762`.
- Texto: `[Apellido] = 'ZZZ PRUEBA API NO OPERAR 20260915 T05'`.
- Búsqueda previa: `[CUIT] = '27990915054' OR [NroDoc] = 99091505`.
- Relaciones: `Domicilio.Localidad.ID`, `Domicilio.Localidad.Nombre`.
- Colecciones: `HistoriaCategorias.Count()`.
- Filtro de colección: `HistoriaCategorias[Categoria.ID = 2].Count()`.
- Fecha en criterio de colección: `HistoriaCategorias[Fecha = #2020-01-01#].Count()`.

Los últimos dos campos devolvieron 1 para el socio 152761, verificando la categoría
y fecha enviadas en T04. Los demás tipos de fecha, operadores y agregaciones no
se ensayaron exhaustivamente. Validar entradas antes de interpolarlas y escapar
comillas de textos; nunca aceptar un criterio arbitrario desde un usuario público.

## Ausencia, errores y verificación

- Búsquedas sin coincidencias devolvieron HTTP 200 con `[]`.
- Pedir `TipoDoc.ID` sobre un socio existente devolvió HTTP 400 con un error de
  propiedad: el tipo relacionado es `ClasesBase.TiposDocumentos` y no tiene `ID`.
- `TipoDoc.Codigo` produjo también HTTP 400. `TipoDoc.Descripcion` sí funcionó.
- Una consulta con filtro sin coincidencias había devuelto `[]` incluso incluyendo
  `TipoDoc.ID`: un resultado vacío no demuestra que todas las propiedades sean válidas.
- Esos errores de consulta tienen cuerpo de texto, distinto del envelope
  `Ok/ID/Error` de creación. Comprobar estado HTTP antes de asumir JSON.

Después de un alta, buscar por el ID retornado y comparar cada campo relevante.
Si el alta falló o tuvo timeout, buscar también por CUIT/documento/marcador antes
de decidir si se puede reintentar. No registrar datos de terceros al investigar
colisiones: la búsqueda previa sólo necesita los IDs coincidentes.

La campaña verificó cinco socios por identidad. No dependió de una consulta global,
del orden de resultados ni de una sincronización local. El consumidor de socios
usa filtros `ID > cursor`; su estrategia de paginación no demuestra que el servidor
garantice orden sin un contrato adicional. Ese comportamiento queda pendiente.

## EvaluateObj

`POST /api/Empresa/EvaluateObj` recibe `tipo`, `cmd` y `campos` en los consumidores
inspeccionados. Se utiliza para recuperar un objeto por identidad y sus relaciones.
Ver el [cliente del core de Transferencias](../../../apps/metamap-platform/client/transferencias-celesol/src/core_client.rs)
y el [gateway de solicitudes/préstamos](https://github.com/Red-Unisol/redunisol-platform/blob/01ea23d11b00b8e5b61a14ec4945c3503f4a34ba/web/solicitudes-web/celesol-backend/src/modules/solicitudes/infrastructure/services/EvaluateListSolicitudesGateway.ts).

No se verificaron en esta campaña su respuesta para cero/múltiples coincidencias,
sus errores ni su equivalencia con `EvaluateList(max=1)`. No tratarlos como
intercambiables sin medir esas condiciones.
