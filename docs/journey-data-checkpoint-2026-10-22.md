# Checkpoint: recorrido completo en volumen dedicado

Estado histórico al 22/10/2026: **WIP, pausado por pedido de Santiago**.

Retomado el 23/10/2026. La revisión posterior corrigió renovación de sesión, lotes de salida,
correlación de página/formulario, exclusión de rutas privadas y durabilidad del checkpoint.
Los pendientes enumerados abajo documentan la pausa original; para el contrato final ver
[datos del recorrido](journey-data.md). La activación productiva se verifica tras el deploy Git-managed.

## Retomar

- Rama: `codex/journey-volume`, basada en `origin/main` (`8307f12f`).
- Worktree: `C:\Users\Santiago\.codex\worktrees\journey-volume\redunisol-kestra`.
- Pedido: datos del circuito completo web anónima → WhatsApp → formulario → Kestra →
  evolución comercial Bitrix, organizados para Marketing/management/IA, sin dashboard.
  Todos los datos nuevos de tracking en el volumen, con batching y costo I/O moderado.
- [Diseño, contrato y operación](journey-data.md).

## Estado real de la VPS

Se preparó exclusivamente el volumen nuevo verificado por serial y tamaño, autorizado
para esta tarea. Está montado en `/srv/redunisol-tracking`, ext4, 24 GiB, UUID
`047f85cf-0e3a-48fe-880f-d42f0ba0be64`; fstab por UUID, noatime/nodev/nosuid/noexec/nofail.
Directorios de ambientes y permisos www-data listos. El script Git-managed es
`web/redunisol-web/deploy/prepare-tracking-volume.sh`; se verificó su idempotencia.

**No se desplegó código nuevo, no se activó la recolección nueva ni se cambió el env
efectivo de los servicios.** La web conserva el tracking anterior. No hay tareas de carga
ni procesos de benchmark pendientes corriendo por esta intervención.

## Implementado en la rama

- Diario JSONL por día UTC y ambiente: appends por lote, export incremental autenticado,
  JSON Schema, IDs explícitos, límite de espacio y recuperación de cola parcial.
- Captura de navegación/origen/enlaces y pasos/resultados del formulario.
- Lotes navegador cada 10 s / hasta 20 eventos; backoff, keepalive, cola acotada.
- Buffer del servidor por request, observación por job WhatsApp y acuses Kestra.
- Atribución en SQLite WAL del volumen, con importación puntual de referencias antiguas
  y comando de copia por lotes; la fuente vieja no se borra.
- Recolector CRM por ventanas e ID, cinco streams y catálogos diarios. Sólo lecturas API;
  diario durable por página antes del cursor, con IDs reproducibles para deduplicar.
- Compose/envs cifrados y workflows preparados para montar el volumen e inicializar schema
  antes del deploy. Producción activa recolección CRM; desarrollo queda aislado sin CRM.
- Tokens nuevos guardados en `credentials.txt` local; no hay secretos en este documento.

## Validaciones realizadas

- PHP: 246 pruebas, 1.030 assertions del circuito, sin fallos; el runner informa
  deprecaciones de dependencias. Incluye caída del volumen, importación, exportación,
  recuperación del diario y middleware WhatsApp.
- Frontend: ocho pruebas Node pasaron (batching/reintentos/navegación y Analytics).
- Build Vite pasó. Se agregó después sólo el evento de respuesta de upload y ajustes
  de imports/formato: repetir build al cerrar el trabajo.
- ESLint de archivos cambiados se corrigió; repetir la pasada final.
- Kestra: estructura válida; 123 tests + 100 subtests pasaron, uno omitido.
- VPS, sin deploy/restart: Compose dev/prod válido, nginx válido y fsync de directorio
  soportado por el PHP real. Consultas API CRM de sólo lectura confirmaron la forma de
  listas e historial. Los temporales privados de validación se eliminaron.
- `npm run types` encuentra un error **ya presente en HEAD**:
  `resources/js/layouts/main-layout.tsx:3`, `children` con any implícito. No se modificó.

## Pendiente antes de un PR listo / activación

1. Revisión final de completitud y semántica del dataset, especialmente enlaces cifrados
   de asistencia (`link_text`), normalización de IDs y cobertura/cursores en manifest.
2. Revisar sesión en páginas abiertas más de 30 minutos y salida con lote en vuelo;
   documentar/corregir los límites sin agregar colas SQL ni servicios innecesarios.
3. Quitar el cambio incidental de imports MySQL en `config/database.php` que dejó Pint.
4. Pasada final de lint/build y pruebas pertinentes a cualquier corrección.
5. Abrir PR (todavía no se creó), explicando intervención de volumen y coordinación
   operativa; no esperar ni monitorear checks remotos después de abrirlo.
6. Tras merge/deploy por el circuito Git-managed, verificar bind/conexión SQLite, export
   autenticado, cursores y un recorrido controlado sin mensajes comerciales a terceros.
   Evaluar copia de snapshots heredados sólo después de cambiar todos los escritores.

No hay alerta externa ni copia remota del dataset configuradas. El diario no se purga
automáticamente; el espacio y las limitaciones de durabilidad están documentados.

Los resultados previos de I/O y scripts de diagnóstico permanecen ignorados en
`.local/artifacts/tracking-impact-20261022/` del checkout original. El disco principal
ya tenía latencia e I/O wait variables: no afirmar que otro disco garantiza aislamiento.
