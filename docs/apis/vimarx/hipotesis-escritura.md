# Escritura de socios: hipótesis y pruebas discriminantes

Verificado el **15/09/2026** en `https://celesol.dyndns.org:5002`, mediante
`POST /api/Simulador/CrearSocioMutual`. Esta campaña adicional tuvo autorización
para crear como máximo cinco socios: **10 intentos, 5 altas y 5 rechazos**.
Los casos T14–T23 continúan la numeración de las campañas anteriores.

La [inspección posterior del cliente](modelo-cliente.md) confirmó que SocAux y
Caja40 se registran dinámicamente para Celesol, identificó los enums y encontró
las reglas que explican varios resultados. La [inspección de la API del servidor](implementacion-alta.md) confirmó después
la causa del rechazo y el comportamiento de tipo/validar. Las hipótesis de este
informe describen la evidencia original de las altas.

## Método y alcance

Cada caso cambia una sola propiedad respecto del payload físico aceptado en T04,
además de usar una identidad sintética nueva. Se omiten contactos, salvo el campo
Email en T22 y T23. Se usa `validar: false`; sólo T17 incorpora también
`tipo: "F.Module.SocioMutual"` para contrastar el rechazo previo de SocAux.

Se buscó por marcador, CUIT y documento antes y después de cada intento. Se guardó
el payload antes de enviarlo, sin reintentos de alta. La verificación final volvió
a consultar las diez identidades: encontró los cinco éxitos con todos sus valores
iniciales y ninguna fila para los cinco rechazos. No se modificaron socios
existentes, catálogos, préstamos ni pagos. No se invocó sincronización de Solicitudes.

Los ejemplos siguientes son **fragmentos de `campos`**, no solicitudes completas.
Los payloads históricos completos están en la evidencia y **no deben reenviarse**.

## Hipótesis, resultado y límite de la conclusión

| Hipótesis | Prueba | Resultado y alcance |
| --- | --- | --- |
| El alta permite propiedades almacenadas que la página no envía; no se limita al formulario actual | T18: `"EstadoCivil": 1` | Alta 152768; lectura devuelve 1 frente a 0 en el caso base. Confirma ese campo/valor, no todos los campos del modelo |
| Un enum puede aceptar un número JSON además de su nombre | T19: `"Sexo": 1` | Alta 152769; lectura 1, igual que `"Femenino"` en T04. No demuestra que admita cualquier número ni enum |
| Una propiedad booleana puede activar validaciones de otros campos | T20: `"SujetoObligado": true` | Rechazo: «Tipo Sujeto Obligado» no puede estar vacía. No hubo error de propiedad inexistente ni de conversión, pero no se logró persistir true |
| La lista anidada admite más de un elemento | T21: dos objetos en `HistoriaCategorias`, categoría 2, fechas 2020-01-01 y 2021-01-01 | Alta 152770; count total 2, uno por cada fecha, ambos con categoría 2. No se probó reemplazo/actualización de listas existentes |
| El literal de ausencia de correo mencionado por el servidor es válido | T22: `"Email": "NO POSEE"` | Alta 152771; lectura `"no posee"`. Hay normalización a minúsculas para este valor |
| Un contacto opcional admite null explícito, además de omitirse | T23: `"Email": null` | Alta 152772; lectura null. Se confirmó para Email, no para todos los campos |
| Las propiedades calculadas no aceptan asignación | T14: `"Edad": 1`; T15: `"NombreCompleto": "ZZZ NOMBRE COMPLETO PRUEBA NO OPERAR"` | Ambos rechazos identifican explícitamente la propiedad como «de solo lectura». No se ignoran silenciosamente |
| Las claves con puntos de EvaluateList no son rutas de escritura del alta | T16: `"Domicilio.Calle": "CALLE CON PUNTO PRUEBA NO OPERAR"` | Rechazo: propiedad inexistente en SocioMutual. El JSON anidado `"Domicilio": {"Calle": ...}` sí funcionó en la campaña inicial |
| SocAux falla sólo porque falta el tipo explícito en el envelope | T17: tipo explícito y `"SocAux": {"Caja40": 50}` | Hipótesis no sostenida: mismo rechazo «La propiedad 'SocAux' no existe en el tipo 'SocioMutual'». No prueba que tipo se ignore en todas las operaciones |

Todos los intentos respondieron HTTP 200. Los rechazos tuvieron `Ok: false` e
`ID: null`; los éxitos `Ok: true` e ID. El flag `validar: false` no evitó la regla
condicional de T20.

## Qué explica mejor los resultados

**Inferencia, sin acceso al código del proveedor:** el alta parece buscar
propiedades por su nombre inmediato, comprobar si pueden asignarse, convertir
valores y procesar objetos/listas según la propiedad. Luego intervienen reglas de
negocio y normalizaciones. Es compatible con un mecanismo genérico de asignación
por propiedades, pero no confirma que use reflexión, una lista permitida ni un
algoritmo interno específico.

Hay evidencia diferenciada para cuatro fallas:

1. **Propiedad no reconocida:** SocAux o una clave con puntos. Cambiar 50 por
   `"50"` no ataca el error observado: el rechazo identifica la propiedad padre.
2. **Propiedad reconocida de solo lectura:** Edad y NombreCompleto. Deben derivarse
   de FechaDeNacimiento, Apellido y Nombre, no enviarse como campos a asignar.
3. **Formato/conversión inválido:** fecha DD/MM/YYYY y enum desconocido, comprobados
   en T07/T10 de la campaña inicial. Usar formatos que tengan evidencia positiva.
4. **Regla de negocio:** SujetoObligado true necesita información adicional. No
   equivale a decir que el campo no existe o que booleanos no se soportan.

### Por qué SocAux merece tratamiento separado

EvaluateList devolvió `SocAux.ID = 228255` para el socio sintético 152761. Los cinco
socios nuevos también tienen SocAux.ID no nulo y Caja40 null. Por tanto, la ausencia
total de un objeto SocAux no explica el rechazo de escritura.

Esto es compatible con una extensión accesible al modelo de consulta pero ausente
del mecanismo de asignación del alta. Sigue siendo una hipótesis: no se determinó
si es una propiedad dinámica, una relación, una personalización o una exclusión
del endpoint. La lectura existente no autoriza a inferir un contrato de escritura.

El parámetro tipo explícito no lo resolvió. No se probaron otros tipos, rutas de
actualización o acceso directo a la entidad auxiliar. Se necesita el código o un
contrato del proveedor para decidir entre ampliar CrearSocioMutual o usar otro
endpoint soportado.

## Cómo construir los campos que sí tienen evidencia

- **Escalares:** claves inmediatas como `EstadoCivil`, `Sexo`, `Apellido`, `Nombre`.
  EstadoCivil 1 funcionó, pero no se confirmó el nombre comercial de ese código.
- **Objeto anidado:** `"Domicilio": {"Localidad": 12, "Calle": "...", "NroPuerta": "0", "CodigoPostal": "0000"}`.
  El ID de Localidad como escalar ya estaba verificado. No usar `{"ID": 12}` como
  reemplazo sin comprobarlo; esa representación de referencia no se ensayó.
- **Colección:** `"HistoriaCategorias": [{"Categoria": 2, "Fecha": "2020-01-01"}, {"Categoria": 2, "Fecha": "2021-01-01"}]`.
  Confirma creación de dos entradas, no asociación por ID de una entrada previa.
- **Opcionales:** Email omitido y Email null persistieron como null; el literal
  NO POSEE persistió en minúsculas. No extrapolar a campos obligatorios.

El orden Localidad antes de CodigoPostal es deliberado: en la campaña inicial se
comprobó que Localidad sobrescribe el código postal si se asigna después. Una
respuesta exitosa no garantiza igualdad literal con el JSON enviado: comparar
valores tras el alta, incluyendo fechas, enum, código postal y colecciones.

## Qué no podemos afirmar todavía

- No hay una lista exhaustiva de propiedades escribibles. Swagger anuncia un
  diccionario campos, pero no su contrato interno.
- No se probó escritura de CBU, cuentas bancarias, empleador, ingresos, contactos
  reales ni IDs internos. Una referencia no debe probarse mutando catálogos o
  vinculando registros ajenos.
- No se completó el caso SujetoObligado con su tipo dependiente. El nombre visible
  «Tipo Sujeto Obligado» no demuestra el nombre JSON ni su catálogo.
- No se probaron límites, todos los enums, obligatoriedad mínima, deduplicación,
  reintentos, concurrencia, actualización de socios existentes ni rollback total.
  La ausencia de socios tras los rechazos no descarta objetos auxiliares huérfanos.
- La guía histórica menciona DomicilioLaboral; las proyecciones
  DomicilioLaboral.Calle y DomicilioLaboral.Localidad.ID devolvieron HTTP 400 en la
  API actual, sobre un socio existente. No se usaron como base de un alta.
- La consulta auxiliar a DevExpress.Xpo.XPObjectType falló con un error de cast a
  XPBaseObject. No produjo un catálogo de propiedades ni resolvió la causa de SocAux.

Para exponer un campo adicional en Solicitudes también habrá que incorporarlo a su
schema, modelo y gateway: que el core lo admita no significa que el formulario o
backend actual lo envíen. Para completar catálogos y campos condicionados, priorizar
metadatos/código del proveedor antes de seguir creando registros de prueba.

## Ampliación T24: nombre con espacio

Con autorización separada para hasta una alta adicional, se probó dentro de
`campos` exactamente `"Soc Aux": {"Caja40": 50}`, manteniendo el payload físico
base. El endpoint devolvió HTTP 200 con `Ok: false`, `ID: null` y
`La propiedad 'Soc Aux' no existe en el tipo 'SocioMutual'.`

Las búsquedas previa y posterior por identidad sintética devolvieron `[]`.
No se observó un socio adicional. La variante con espacio tampoco resuelve el
rechazo. [Petición y verificación de T24](evidence/2026-09-15/soc-aux-espacio.json).

## Inventario y evidencia

| Caso exitoso | ID de socio | Cambio confirmado |
| --- | --- | --- |
| T18 | 152768 | EstadoCivil numérico |
| T19 | 152769 | Sexo numérico |
| T21 | 152770 | Dos entradas de HistoriaCategorias |
| T22 | 152771 | Email NO POSEE |
| T23 | 152772 | Email null |

Los cinco tienen apellido `ZZZ PRUEBA API NO OPERAR 20260915 Txx`. Se conservan en
el core como evidencia, sin contactos reales. Cualquier limpieza debe autorizarse
por separado. Sumados a los cinco de la campaña inicial, el inventario propio es
152760–152764 y 152768–152772; los IDs intermedios no se atribuyen a estas pruebas.

- [Peticiones, respuestas y consultas finales](evidence/2026-09-15/hipotesis-escritura.json).
- [Contrato inicial y pruebas T01–T13](socios.md).
- [Referencia histórica del modelo](../../../apps/exportador-bancor/docs/api/BOModel_API_Reference.md).

La evidencia contiene sólo identidades sintéticas propias y errores de metadatos.
No es un script de seed ni una suite que deba ejecutarse en CI.
