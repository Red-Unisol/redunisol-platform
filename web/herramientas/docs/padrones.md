# Padrones complementarios de CredixSA

Desde Herramientas, abrir **Administrar padrones** (`/padrones`) e ingresar con
la contraseña compartida de Análisis. La consulta de estos datos también requiere
esa sesión, aunque el informe de CredixSA se consulta independientemente.

## Carga por los analistas

1. Elegir una fuente existente o crear una nueva, indicando si es un padrón o un archivo de bajas.
2. Seleccionar el período de los datos y subir un XLSX o CSV.
3. Revisar la hoja, la fila de encabezados, la columna DNI/CUIL y los campos visibles.
4. Validar: se muestran registros válidos, documentos agregados y ausentes respecto de la versión vigente, coincidencias múltiples, filas excluidas y una muestra.
5. Confirmar la revisión y publicar. Hasta ese momento sigue disponible la versión anterior.

Las siguientes cargas reutilizan la configuración publicada. Los cambios de
estructura requieren revisión. El historial permite retomar borradores y restaurar
una versión publicada. Dos publicaciones concurrentes no se pisan: la segunda
debe recargar y volver a validar contra la versión vigente.

Se crean cinco fuentes vacías con los formatos iniciales: Administración,
Educación, Bajas de agentes, Senado y Organismos y dependencias. Los archivos
reales deben cargarse por la interfaz; no se incluyen datos personales en Git.
La cantidad de fuentes no queda fijada en cinco.

## Interpretación y límites

- Hasta 20 MB, 100.000 registros y 60 columnas por archivo; XLSX hasta 20 hojas y 200 MB descomprimidos.
- CSV separado por coma, punto y coma o tabulador; UTF-8 o Windows-1252. XLS antiguo debe guardarse como XLSX.
- Se aceptan DNI de 7/8 dígitos y CUIL de 11, con puntos, espacios o guiones; se cruza por DNI. Esta validación de formato no verifica identidad ni dígito verificador del CUIL.
- Se conservan todas las filas coincidentes, incluso varios cargos del mismo documento. Las filas sin documento válido se excluyen y requieren confirmación antes de publicar.
- La consulta muestra todas las fuentes publicadas, período, fecha de carga y campos seleccionados. Las bajas se distinguen explícitamente. No aparecer no demuestra ausencia de empleo y no se toma una decisión crediticia automática.
- La comparación cuenta documentos agregados/ausentes; no compara cambios de sueldo u otros valores de documentos que permanecen.

## Operación

Requiere `ANALISIS_PASSWORD_HASH`, sesiones de Laravel, PHP `pdo_sqlite`, `zip`,
`fileinfo`, `mbstring` y las extensiones XML exigidas por OpenSpout. La imagen
Docker y ambos Compose incluyen las extensiones y un volumen nombrado `padrones`.
`PADRONES_DIRECTORY` permite cambiar el directorio fuera de Docker; por defecto
es `storage/app/private/padrones`. No usar `storage:link` para exponerlo.

La base `padrones.sqlite`, su WAL y los originales UUID están en ese directorio.
El volumen debe conservarse entre despliegues: **no ejecutar `docker compose down -v`**.
Para respaldar el conjunto, detener escrituras y el contenedor, copiar el volumen
completo y reiniciar; comprobar la restauración en un entorno separado. Copiar
solo el archivo SQLite durante actividad puede omitir transacciones del WAL.
Los originales y versiones se conservan; vigilar espacio y definir retención y
copias antes de la carga operativa. El despliegue no configura backups externos.

Las rutas de datos exigen sesión, CSRF para escrituras y consultas por POST, y
respuestas privadas sin caché. Rotar la contraseña invalida sesiones anteriores.
La auditoría registra publicación/restauración como “Equipo de Análisis (acceso
compartido)”: no atribuye acciones a una persona porque no hay cuentas individuales.
Las versiones publicadas son inmutables y la activación es una transacción SQLite.

Pruebas: `php artisan test --filter=PadronesTest`; frontend: `npm run build`.

## Consulta desde Beex

`POST /api/internal/padrones/lookup` recibe `{"document":"12345678"}` y exige
un bearer `PADRONES_SERVICE_TOKEN` de al menos 32 caracteres, distinto del acceso
compartido de Análisis. La credencial sólo habilita esta consulta; las rutas de
carga, publicación y administración siguen requiriendo su sesión habitual.
Sin token configurado responde 503. Las respuestas son privadas y no se cachean.

La lectura abre SQLite en modo de sólo lectura, no crea bases y toma un snapshot
consistente. Devuelve `document`, `queried_at` y todas las fuentes, con nombre,
tipo, período, `loaded_at`, estado y filas coincidentes (`row`, `data`). Cada fuente
distingue `ready`, `unpublished` y `needs_review`. Los archivos de bajas conservan
su tipo explícito. Una publicación con datos personales usados como encabezado
de documento, estructura inválida o más de 500 coincidencias requiere revisión
y no devuelve filas; no se interpreta como ausencia de empleo.

Configurar el mismo token exclusivamente en los backends de Herramientas y Beex
antes de habilitar la integración. El endpoint no modifica ni reimporta versiones.
La carga de Administración observada el 11/11/2026 debe revisarse desde la interfaz
de padrones: tiene una fila de datos seleccionada como encabezado. Esta API la
señala como `needs_review` hasta que se publique una versión corregida.
