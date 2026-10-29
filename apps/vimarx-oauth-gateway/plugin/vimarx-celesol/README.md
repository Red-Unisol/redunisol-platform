# Celesol · Vimarx

Paquete privado para distribuir la conexión al MCP de Mutual Celesol.

## Instalar en ChatGPT

1. Abrir Complementos y seleccionar **Agregar → Cargar archivo del complemento**.
2. Elegir el ZIP e instalar Celesol · Vimarx.
3. Conectar la cuenta con el usuario habitual de Vimarx.
4. Marcar Mantener conectado para autorizar que Red Unisol conserve las
   credenciales cifradas y renueve el acceso automáticamente.
5. Abrir una conversación nueva, seleccionar el plugin y hacer una consulta.

El servidor está en `https://mcp.redunisol.com.ar/mcp`. OAuth usa registro
 dinámico DCR y el scope `mcp:read`; no hay que copiar tokens ni configurar una VPS.
Cada persona necesita acceso propio a Vimarx. El ZIP no otorga permisos sobre datos.
No contiene contraseñas, tokens, IDs privados de la cuenta del autor ni código del
servidor. La conexión usa discovery OAuth del servidor, sin opciones de
autenticación embebidas que versiones anteriores de escritorio rechazan.
Se admiten callbacks web de ChatGPT y callbacks loopback del cliente de escritorio;
no se declara compatibilidad probada con otros productos.

## Compartir

Para un equipo de ChatGPT, un administrador puede compartir un plugin del workspace
con sus miembros; cada miembro conecta su propia cuenta. También se puede distribuir
este ZIP privadamente, sujeto a los permisos de importación de cada workspace.
Un ZIP por sí solo no publica el plugin en el directorio público de OpenAI.

## Datos y desconexión

El acceso es de lectura. Con Mantener conectado, la VPS renueva los tokens y sólo
las consultas reales cuentan como actividad. Tras 30 días sin consultas se borra
la conexión del servicio activo; backups cifrados pueden conservarse siete días.
Sin esa opción se vuelve a iniciar sesión al vencer el acceso temporal.
Para borrar las conexiones recordadas: `https://mcp.redunisol.com.ar/connections`.
Cambios de contraseña o revocaciones pueden requerir volver a conectar.

El paquete describe una conexión ya desplegada; importar el archivo no autentica
la cuenta ni sustituye la comprobación real de OAuth y consultas.

## Actualización 2.0.1 y marca

El nombre interno `vimarx-celesol` se conserva para actualizar la instalación
existente. El nombre visible pasa a **Celesol · Vimarx**. Después de importar el
ZIP actualizado, completar la conexión OAuth desde el plugin y abrir una
conversación nueva. El servidor debe aparecer entre los MCP disponibles.

Ícono oficial de Red Unisol, reutilizado sin modificaciones desde
https://www.redunisol.com.ar/apple-touch-icon.png (29/10/2026).
