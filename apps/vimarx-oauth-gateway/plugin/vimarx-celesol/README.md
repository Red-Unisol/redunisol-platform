# Celesol · Vimarx

Consultas de lectura de Mutual Celesol con los permisos de cada usuario.

## ChatGPT y escritorio

Para usar las herramientas en el chat normal de ChatGPT, el paquete debe referenciar
una conexión MCP ya registrada mediante `.app.json`. El operador obtiene el App ID
real desde **Agregar servidor MCP personalizado** y exporta la variante con
`--registered-app-id`. No contiene `mcp.json`, `.mcp.json` ni declaraciones inline:
OpenAI marca como **solo en computadoras** cualquier importación que las incluya,
aunque la URL sea HTTPS y el servidor esté publicado en una VPS.

La exportación por omisión incluye el MCP remoto directamente y sirve para el
cliente local de escritorio/Codex. No habilita sus herramientas en ChatGPT web.
Ambas variantes mantienen el nombre interno `vimarx-celesol` para las actualizaciones.
El nombre visible es **Celesol · Vimarx**.

## Conectar

Instalar la variante correcta, conectar la cuenta de Vimarx desde ChatGPT y abrir
una conversación nueva. Las contraseñas se ingresan únicamente en el formulario
HTTPS de Red Unisol. Marcar **Mantener conectado** autoriza conservarlas cifradas
en la VPS para renovar el acceso automáticamente. El ZIP nunca incluye credenciales.

MCP: https://mcp.redunisol.com.ar/mcp. OAuth usa DCR, PKCE S256 y `mcp:read`.
Cada persona necesita acceso propio a Vimarx; el paquete no concede permisos.

## Cuenta elegida y demostración

Si hay varias cuentas conectadas, seleccionar la cuenta deseada antes de consultar.
La cuenta DEMO sólo devuelve datos ficticios. El plugin debe mantener la cuenta y
el ambiente elegidos, también al consultar metadatos o resolver una falla: no debe
buscar conexiones alternativas ni sustituir DEMO por producción. Después de una
reconexión o un cambio explícito, vuelve a confirmar el contexto de esa cuenta.
El servidor de otra mutual queda fuera del alcance de este plugin.

El puente garantiza que un token demo nunca se envía a Vimarx. Las instrucciones
del plugin guían la selección que hace ChatGPT; no pueden revocar ni bloquear
otras conexiones independientes que el usuario haya autorizado en su cuenta.
Para una revisión que requiera aislamiento estricto del host, usar un perfil de
ChatGPT que sólo tenga conectada la cuenta demo, sin credenciales de producción.

## Compartir

La variante con App debe apuntar a una conexión accesible para sus destinatarios.
Una App personal privada no se vuelve compartida por enviar el ZIP. Para un equipo,
usar una conexión y permisos del workspace; cada miembro autentica su cuenta.
Este paquete privado no constituye una publicación en el directorio público.

## Datos y desconexión

El acceso es de lectura. Sólo las consultas reales renuevan el plazo de actividad.
Tras 30 días sin consultas se borra la conexión del servicio activo; backups cifrados
pueden conservarse siete días. Sin Mantener conectado, el acceso es temporal.
Administrar y borrar conexiones: https://mcp.redunisol.com.ar/connections.

## Marca

Se reutiliza sin modificar el símbolo cuadrado y centrado que sirve la web de
Red Unisol en https://redunisol.com.ar/logo.jpeg (29/10/2026), con la marca real
de dos puntos y trazo blanco/verde. Reemplaza el favicon incorrecto de 2.0.1.
