# CrearSocioMutual: implementación inspeccionada en el servidor

Inspección estática del **15/09/2026**. Se accedió por SMB a la carpeta compartida
`wwwroot` del servidor autorizado y se copiaron DLL a esta PC para leer metadatos
e IL y decompilar tipos seleccionados. No se ejecutaron esos binarios, no se
modificó el servidor y no hubo nuevas llamadas de escritura a la API.

## Identificación del despliegue

Se encontraron Fapi, FapiTest y FapiMcp. La carpeta **Fapi** contiene FApiNet y
Vimarx.F.Module **26.1.720.1**. En su log FAPI260915.log se encontraron los diez
mensajes de alta correspondientes exactamente a nuestros socios sintéticos:
152760–152764 y 152768–152772. No se copió ni publicó el log operativo completo.

Esa correlación vincula Fapi con nuestras pruebas. No se obtuvo la configuración
global de sitios/bindings de IIS: la asignación administrativa del puerto no se
deduce exclusivamente del nombre de la carpeta. FapiTest tiene FApiNet
24.1.1226.3 y FapiMcp 26.1.827.3; no se intercambian sus contratos por semejanza.

El [snapshot](evidence/2026-09-15/server-api.json) registra versiones, tamaños y
SHA-256 de quince DLL, los IDs propios encontrados en el log, los doce miembros
dinámicos de la versión de Fapi y los cuerpos IL de los tres métodos analizados.

## Causa confirmada del rechazo de SocAux

`DS.Api2.Controllers.SimuladorController.CrearSocioMutual` llama a
`WebApplication1.XafApiBaseController.CrearObjeto`. Este último busca cada campo
con la siguiente operación, reconstruida de la DLL:

```csharp
type.GetProperty(campo.Key,
    BindingFlags.IgnoreCase | BindingFlags.Instance | BindingFlags.Public);
```

Si no obtiene una propiedad CLR, devuelve inmediatamente el error de propiedad
inexistente. El helper recursivo CrearObjetoDesdeJObject repite esa búsqueda.

La DLL del servidor también registra SocAux y Caja40 mediante CreateMember, igual
que la copia del cliente. Esos registros dinámicos no constituyen propiedades CLR
que GetProperty pueda encontrar. **Ahora la diferencia entre lectura y alta tiene
evidencia directa del servidor**, además de las pruebas HTTP y el modelo del cliente.

- Cambiar mayúsculas/minúsculas no es la solución: IgnoreCase ya está habilitado.
- Los espacios y puntos no se interpretan como alias o rutas: se busca la clave
  completa como nombre de propiedad.
- Anidar SocAux no evita el problema: primero debe reconocerse esa propiedad.
- Cambiar sólo la búsqueda del socio tampoco alcanzaría para Caja40: el helper
  recursivo también necesita contemplar los miembros dinámicos del auxiliar.

## Reglas de conversión y anidamiento que implementa el alta

| Clase de propiedad | Comportamiento observado en código |
| --- | --- |
| Nombre de campo | Búsqueda CLR pública, de instancia, sin distinguir mayúsculas; incluye propiedades heredadas |
| Sin setter | Rechazo, salvo si deriva de XPBaseCollection |
| XPBaseCollection | Exige JArray, obtiene el tipo de elemento, crea hijos y llama a Add sobre la colección existente |
| Referencia XPO con JObject | Crea un objeto nuevo del tipo relacionado, procesa sus campos recursivamente y asigna ese objeto |
| Referencia XPO con valor escalar | Convierte el valor al tipo de clave del catálogo y busca con GetObjectByKey; rechaza si no existe |
| Referencia XPO vacía | Asigna null en la rama escalar vacía; pueden intervenir validaciones posteriores |
| Enum | Usa Enum.Parse con ignoreCase true; no aparece una comprobación Enum.IsDefined en este helper |
| Otros escalares | Convierte su representación textual con Convert.ChangeType e InvariantCulture |
| Escalar vacío/null | Usa null para tipos referencia o el valor predeterminado para tipos valor; no equivale necesariamente a omitir el campo |

Dos consecuencias que antes no se habían probado:

1. `"Localidad": 12` busca un registro existente; `"Localidad": {"ID": 12}` entra
   en la rama de **creación de otro objeto**. No usar el segundo formato como
   sustituto de una referencia por ID. No se ejecutó una prueba que altere catálogos.
2. Las colecciones recorren `OfType<JObject>()`: elementos de otro tipo pueden
   quedar fuera del recorrido. Un HTTP exitoso no demuestra que se procesaron todos
   los elementos enviados. Se trata de evidencia estática; no se crearon más socios.

El orden de enumeración del JSON llega a setters con efectos de negocio. La copia
de CodigoPostal al asignar Localidad, ya observada en vivo y en el cliente, encaja
con este recorrido secuencial.

## tipo y validar: comportamientos concretos

**tipo se sobrescribe:** CrearSocioMutual asigna `request.tipo = "SocioMutual"`
antes de llamar al helper. Eso explica por qué suministrar un tipo explícito en
T17 no cambió el resultado. No extrapolar a otros endpoints.

**validar no proporciona un dry-run fiable en esta versión.** El controlador
contiene una rama descrita como validación sin persistencia, pero exige simultáneamente
que el objeto devuelto sea null y request.validar sea true, después de descartar
errores. CrearObjeto devuelve un objeto no nulo al tener éxito y no consulta
request.validar. Además llama a ValidateTarget con contexto Save;Insert y a
ValidateInsert con SaveAlso=true. El controlador luego llama a CommitChanges.

Por eso el éxito normal llega a persistencia también con validar=true. **Esto
coincide con T09**, que creó el socio 152764. El mensaje de logging o el nombre del
flag no son prueba de que la operación sea sólo de validación.

No se reconstruyeron todas las transacciones/efectos internos de ValidateInsert
ni se afirma atomicidad frente a cualquier error. No usar validar=true para
ensayos supuestamente inocuos en el sistema real.

## Cambio necesario para contemplar SocAux

La corrección pertenece al mecanismo de escritura de la API, tanto en el nivel
principal como en el recursivo: resolver miembros estáticos y dinámicos con los
metadatos XAF/XPO y usar el mecanismo de lectura/asignación correspondiente.
Debe mantener reglas de validación, referencias por ID, colecciones y límites de
campos permitidos; no basta con reemplazar una línea sin revisar esas ramas.

El cliente ya contiene GetMemberValue/SetMemberValue para SocAux/Caja40, según el
[modelo inspeccionado](modelo-cliente.md). Para un alcance menor se puede definir
un contrato explícito que soporte sólo los auxiliares requeridos. No se implementó
ninguna variante ni se parchearon DLL: esta tarea deja la causa y el alcance del
cambio documentados para trabajar sobre el fuente del servicio.

## Acceso operativo y límites

La credencial se conserva en un archivo local cifrado con DPAPI, referenciado
desde credentials.txt. SMB permitió IPC y lectura de wwwroot; WinRM devolvió HTTP
401 y C$ acceso denegado. No se cambió WinRM, UAC, firewall ni permisos para obtener
las DLL. El acceso verificado es a archivos compartidos, no administración remota.

Las decompilaciones completas permanecen en el área local de artefactos; sólo se
versionan metadatos y los tres métodos relevantes, sin binarios ni configuraciones
operativas. El código reconstruido puede diferir textualmente del fuente original;
las afirmaciones centrales se contrastaron con IL y las pruebas HTTP previas.
