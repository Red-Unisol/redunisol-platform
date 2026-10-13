# Reconocimiento de recibos con Mistral

Cambio sobre dev `28280592018c3530b809a5ffcf58bd6c18acbcb1`. No desplegado. El relevamiento aportado es del 13/10/2026; las dos copias del PDF recibido contienen el mismo informe. Se conserva la integración OCR de CUAD en Kestra, que ya usa `MISTRAL_API_KEY`.

## Funcionamiento

Al seleccionar o arrastrar archivos en alta/detalle, cada archivo inicia una tarea independiente. Se mantiene el lote máximo de 10 y la clasificación final que el usuario elija. Solo un positivo completa el valor exacto `Recibo de Sueldo`. CUPO y las otras categorías se conservan y no se reconocen automáticamente.

El reconocimiento no crea solicitudes, no guarda adjuntos, no reescribe documentos históricos ni modifica Evaluación. Los archivos llegan al backend autenticado en multipart; el backend los envía como data URL base64 privada al proveedor, sin URLs públicas ni persistencia adicional.

Los borradores de modal se identifican por solicitud y apertura. Eliminar/reemplazar/cerrar/cambiar de solicitud/guardar invalida las tareas anteriores. La clasificación manual cancela la tarea; el resultado no puede sobrescribirla. Al editar un adjunto ya clasificado no se vuelve a analizar su archivo original. Una sustitución nueva sí se analiza y conserva cualquier categoría manual previa.

## Configuración y migración

Aplicar `npx prisma migrate deploy`, incluyendo `20261013190000_reconocimiento_recibos`, y regenerar Prisma. Crea una única fila `global`, habilitada inicialmente. La aplicación nunca restablece el valor durante el arranque ni durante una lectura.

Administración → Reconocimiento de recibos, ruta frontend `/admin/solicitudes/reconocimiento-recibos`. Solamente administradores efectivos del sistema pueden modificar el interruptor; operar como otro usuario no suma los permisos del administrador real.

Cada actualización aumenta una versión persistente. Se verifica la configuración antes y después del OCR. El frontend vuelve a leerla antes de completar una clasificación y consulta cada 2 segundos mientras haya tareas. Desactivar y volver a activar tampoco habilita respuestas de la versión anterior. Si la configuración no puede leerse, no se interpreta como habilitada ni se llama al proveedor.

Variables privadas del backend:

- `MISTRAL_API_KEY`: reutilizar la credencial correspondiente, sin rotarla; nunca agregarla al frontend ni a Git.
- `MISTRAL_OCR_MODEL`: por defecto `mistral-ocr-latest` (alias del proveedor).
- `MISTRAL_OCR_TIMEOUT_MS`: por defecto 45000.

Compose transmite estas variables. El despliegue existente consume el archivo de entorno cifrado: su credencial deberá incorporarse mediante el procedimiento de configuración segura existente antes de un despliegue autorizado. No se cambió ese archivo cifrado ni la cuenta de Mistral, incluido su ajuste de entrenamiento. La ausencia de credencial mantiene el interruptor habilitado y produce un error explícito; la selección manual sigue funcionando.

## API y permisos

Todas las rutas son autenticadas bajo `/solicitudes/reconocimiento-recibos`:

- `GET /configuracion` → `{ habilitado, version }`, sin caché HTTP.
- `PATCH /configuracion` → cuerpo estricto `{ habilitado: boolean }`, solo administradores.
- `POST /alta` → multipart `file`, sin ID de solicitud. Exige los requisitos existentes del alta: usuario activo, área, usuario legacy y nombre del vendedor. No crea una solicitud para analizar.
- `POST /:id/analizar` → multipart `file`. Reutiliza la visibilidad de Vendedores y el permiso actual `UPLOAD_ATTACHMENT`, resolviendo el área en backend y las reglas de campos del estado.

La autenticación y autorización se verifican antes de leer el multipart. Se reutilizan extensión, MIME y tamaño permitidos para adjuntos. No se concede permiso para borrar ni editar archivos.

Respuesta: `{ resultado, version, motivo? }`. `resultado` distingue `recibo`, `no_recibo`, `indeterminado`, `error` y `deshabilitado`. Los motivos técnicos son valores fijos: credencial/proveedor/formato/procesamiento. No se devuelven el texto OCR, datos personales, mensajes crudos del proveedor ni el token.

## Contrato del proveedor y aceptación

Documentación oficial consultada el 13/10/2026:

- https://docs.mistral.ai/studio/document-processing/overview
- https://docs.mistral.ai/studio/document-processing/basic_ocr.md
- https://docs.mistral.ai/studio/document-processing/annotations
- https://github.com/mistralai/client-ts/blob/main/src/models/components/ocrrequest.ts

Se comprueba `GET https://api.mistral.ai/v1/models` con la credencial configurada antes de la primera inferencia de la instancia. Debe figurar el modelo configurado o un alias. Un fallo impide OCR y no modifica la configuración global.

`POST https://api.mistral.ai/v1/ocr`, modelo configurado, `document` de tipo `image_url` o `document_url`, `document_annotation_format` con JSON Schema estricto y `document_annotation_prompt`. El proveedor combina texto OCR y elementos visuales para anotación documental; la documentación indica los primeros ocho bounding boxes de imágenes extraídas. No se pide extracción de campos de negocio.

Se habilitan para reconocimiento PDF, PNG, JPEG y WebP con firma compatible, dentro de los límites locales y los del proveedor: 50 MB y 1000 páginas. PDF ilegible/cifrado se informa como error; otros formatos conservan carga y clasificación manual. Se usa pdf-lib únicamente para verificar PDF y cantidad de páginas, sin modificarlo.

Anotación validada: clasificación enum y cinco booleanos `periodo`, `agente`, `haberes`, `descuentos`, `neto`. Se acepta positivo solamente con clasificación `recibo`, texto OCR legible y todos los indicadores presentes. Si el modelo propone positivo sin esa combinación, se devuelve indeterminado. Un documento legible de otra clase puede resultar negativo. JSON inválido, errores HTTP y tiempos de espera son errores, nunca negativos. No hay porcentaje de confianza ni precisión medida. El prompt trata todo el documento como contenido no confiable e ignora instrucciones en él; no existen herramientas o acciones que pueda ejecutar el proveedor.

## Validaciones realizadas

- 31 pruebas backend: contrato con proveedor simulado, resultados y errores, límites PDF, autorización HTTP antes del análisis, administración, estado desactivado y regresiones de permisos/catálogo/validación de adjuntos.
- 10 pruebas frontend de tareas: positivos, desactivación, elecciones manuales, guardado, cierre, eliminación, sustitución y cambios de contexto.
- Base PostgreSQL local aislada: aplicación de todas las migraciones, valor inicial habilitado, desactivación conservada al recrear Prisma/conexión y al repetir `migrate deploy`.
- Navegador Chromium con API simulada: selección/arrastre, individual/lote, estados positivo/negativo/indeterminado/error, guardado durante análisis, CUPO manual conservado, límite de 10, controles a 640 px y configuración guardada tras recargar. También se verificó la ruta con ID de solicitud existente y el cambio de solicitud durante un análisis, sin mezclar archivos ni respuestas.
- Compilaciones frontend/backend, lint de archivos funcionales modificados y typecheck de scripts.

Estas comprobaciones NO son una validación real de reconocimiento con Mistral. No se generaron préstamos, no se guardaron adjuntos ni solicitudes en dev y no se desplegó.

## Prueba real pendiente y comienzo de pruebas

En este entorno no existe `MISTRAL_API_KEY` configurada y las cinco imágenes visibles en el mensaje no están disponibles como archivos descargables; las rutas `C:/Users/...` pertenecen a la computadora del usuario. Los dos PDF técnicos sí se descargaron. Falta confirmar el modelo y la anotación con la credencial real y contrastar el criterio con las cinco muestras: no se declara terminada la integración funcional hasta hacerlo.

Para ejecutar la prueba real sin guardar solicitudes ni adjuntos, configurar la credencial como secreto privado y aportar los cinco archivos originales. Desde `celesol-backend`:

```bash
npx tsx scripts/probar-reconocimiento-recibos.ts /ruta/recibo1.png /ruta/recibo2.png /ruta/recibo3.png /ruta/recibo4.jpg /ruta/recibo5.jpg
```

El script verifica que haya cinco archivos y credencial antes de llamar al proveedor. Procesa las cinco muestras reales, imprime únicamente archivo/modelo solicitado/resultado y termina con código no cero si alguna no resulta positiva. No contiene respuestas simuladas ni envía archivos por su nombre como criterio.

Para pruebas de interfaz local, tras migración y configuración del backend, iniciar las aplicaciones con sus comandos habituales (`npm run dev`), abrir una solicitud accesible o el alta y agregar los archivos. Verificar el mensaje por archivo, corregir el tipo si corresponde y guardar con el circuito habitual. Desactivar desde Administración y repetir: no debe haber OCR. Probar también un documento que no sea un recibo y uno ilegible, sin confundir indeterminación con fallos del proveedor. Dev público no incorpora este cambio hasta una instrucción expresa de despliegue.
