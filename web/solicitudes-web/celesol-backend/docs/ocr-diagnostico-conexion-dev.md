# Diagnóstico de OCR y conexión dedicada de Solicitudes dev

Se reprodujo un error genérico tanto en alta como en una solicitud existente. El PDF aportado se reconoce con Mistral real usando la clave privada local. Los logs del despliegue muestran que dev toma la credencial cifrada de Kestra; el primer despliegue registró HTTP 429. Esto prueba una diferencia de origen de configuración y un antecedente de límite del proveedor, pero no demuestra cuál fue la respuesta del intento reciente del usuario.

## Cambio preparado

- El workflow de dev admite el secreto de GitHub Actions `SOLICITUDES_MISTRAL_API_KEY`, restringido al paso que prepara el entorno privado. No se transmite a los builds del frontend.
- Se conserva una clave propia de Solicitudes presente en el archivo runtime. Si no existe, se usa el secreto dedicado. Si tampoco existe, se conserva el fallback cifrado de Kestra. No se reemplazan ni rotan credenciales de Kestra ni se modifica la cuenta del proveedor.
- El helper escribe exclusivamente `MISTRAL_API_KEY` en el archivo privado de runtime, con modo 0600. No imprime el valor. Credenciales inválidas no se interpretan como shell y mantienen la clasificación manual.
- El contrato mantiene `resultado: error` y `motivo: proveedor`, y agrega `codigoError` opcional de un conjunto cerrado: límite del proveedor, autenticación del proveedor, timeout, modelo no disponible, respuesta inválida, conexión y servicio no disponible.
- La pausa de 30 segundos conserva el mismo código del último error; la cancelación manual no activa esa pausa.
- El frontend diferencia además sesión vencida, falta de permisos, archivo rechazado y conexión con Solicitudes. No muestra mensajes crudos del proveedor ni contenido OCR. Los códigos desconocidos conservan el mensaje genérico.
- No cambian la activación global, permisos, categorías, carga, guardado, selección manual ni descarte de respuestas tardías.

## Configuración que falta para dev

GitHub respondió 403 al intentar consultar el secreto dedicado desde la integración de este entorno. Debe configurarlo una persona con permiso sobre los secretos del repositorio:

1. Abrir `https://github.com/Red-Unisol/redunisol-platform/settings/secrets/actions`.
2. Crear o comprobar el secreto de Actions `SOLICITUDES_MISTRAL_API_KEY` usando la clave que ya funciona en el archivo local privado `celesol-backend/.env`. No pegar el valor en el chat, documentación ni Git.
3. Revisar e integrar el PR según la aprobación de código requerida por GitHub. El despliegue de dev incorpora el secreto como `MISTRAL_API_KEY` del backend.
4. Volver a seleccionar el PDF para ejecutar un análisis nuevo. Guardar o reclasificar un adjunto existente no ejecuta OCR.

Preparar el secreto no modifica por sí solo el servidor. No se desplegó este ajuste ni se verificó aún con una sesión autenticada en dev. El diagnóstico explícito del proveedor sigue disponible; el despliegue no depende de una inferencia ni del estado del OCR.

## Comprobaciones

- 31 pruebas backend del reconocimiento, contrato, permisos y fallback.
- 47 pruebas frontend de tareas, estados, descarte de respuestas, prioridad manual, controles y categorías existentes.
- 16 pruebas Python de preparación del runtime, conexión dedicada, prioridad y preservación de claves.
- Compilaciones frontend/backend, lint de archivos modificados y validación YAML.
- Prueba real contra Mistral del PDF aportado: `recibo`. Las pruebas de los errores HTTP/timeout son simuladas y verifican el código seguro y el mantenimiento de la carga manual.

La solución preparada permite usar la conexión local ya comprobada y diagnosticar el rechazo real en dev. No se afirma que el incidente del servidor esté resuelto antes de configurar, desplegar y probar allí.
