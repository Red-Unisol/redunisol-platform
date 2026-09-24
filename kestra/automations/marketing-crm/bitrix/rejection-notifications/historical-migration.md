# Migración histórica de rechazos

La migración consolida las 16 etapas antiguas en RESULTADO PERDIDO y conserva su
causa en Motivo Rechazo. No vuelve a evaluar elegibilidad crediticia ni envía avisos.
El usuario aprobó un piloto de 50 y la continuación por lotes; después indicó que
el lote grande debía ejecutarse por la noche.

## Alcance aprobado el 2026-09-24

Inventario de solo lectura, con corte `ID <= 396841`:

| Grupo | Cantidad | Tratamiento |
|---|---:|---|
| Etapas de rechazo con motivo vacío | 75.052 | Copiar el motivo de la etapa original |
| Etapas de rechazo con motivo coincidente | 202 | Conservar el motivo |
| Motivo contradictorio con la etapa | 56 | Excluir y revisar |
| Ya en RESULTADO PERDIDO con motivo | 10.045 | Sin traslado |
| Ya en RESULTADO PERDIDO sin motivo | 12 | Requieren investigación separada |
| SIN RESPUESTA / NO SON SOCIOS NI QUIEREN PRESTAMO | 5.874 | Fuera del alcance inicial |

Los **75.254 candidatos** provienen exclusivamente de etapas catalogadas como
fallidas. Los estados activos, ganados, convertidos y NEGOCIACION CON VENDEDOR
no integran la selección. El archivo aprobado tiene SHA-256
`3be805e892af5682ad8fcbc9ec496fb097b7d21802e6280b091fde7bf21c757a`.
Los IDs y valores anteriores permanecen en artefactos locales privados, fuera de Git.

## Piloto ejecutado

El 24/9 entre las 12:57 y 12:58 ART se actualizaron **50 prospectos**, que cubren
las 16 etapas. Cada actualización guardó juntos:

```text
STATUS_ID = UC_1P8I07
UF_CRM_REJECTION_REASON = motivo verificado de la etapa original
UF_CRM_REJ_NOTICE = HISTORICAL
```

La relectura confirmó los tres campos en los 50 registros. Se compararon las
actividades de los 50 prospectos y el último mensaje del único chat asociado:
**sin nuevas actividades, chats ni mensajes**, verificado a las 12:59 ART.
`REGISTER_SONET_EVENT=N` evita publicaciones del feed; la supresión de los avisos
depende del corte de IDs y de `HISTORICAL` en la plantilla 889, no de ese parámetro.

Antes del piloto se volvió a exportar la plantilla 889. Su SHA-256 coincidió con
el de la publicación: `3e459118a94509e7d2f012cb042a1d7efd07b5b79c221917c690427e4d5b44bf`.
El receptor estaba activo. Los pendientes pasaron de 72 antes del piloto a 69
en la comprobación posterior; no hubo incremento de `read_errors`.

La primera respuesta de actualización exponía un mapa vacío de errores como una
lista JSON. El cliente se corrigió y releyó los primeros 25 registros, ya cambiados,
sin repetir sus escrituras. El diario conserva esa recuperación; los otros 25
se verificaron en su primera ejecución. Hay **75.204 pendientes** de la fase nocturna.

## Ejecutor y controles

- `kestra/tools/migrate_bitrix_rejection_history.py`: preflight, piloto,
  verificación de comunicaciones y ejecución del resto.
- `kestra/tools/schedule_bitrix_rejection_history.ps1`: registra la tarea local
  después de verificar el piloto y el hash del inventario.
- Antes de cada lote se releen etapa, motivo, marca, fecha de creación y fecha de
  modificación. Un cambio, registro ausente o estado no fallido se omite.
- Solo se escriben los tres campos indicados. El diario se confirma en disco
  antes del envío; después se relee cada registro. Un resultado incierto se
  reconcilia por lectura; no se repite ciegamente la escritura.
- Las lecturas de la cola usan el acceso SSH canónico y ejecutan únicamente
  `python3 operate.py stats`. No modifican la VPS ni su cola.
- No restaurar automáticamente las etapas originales: sus avisos siguen activos.

## Programación nocturna

Tarea de Windows: `RedUnisol-HistoricalRejections-20260924`, registrada y releída
en estado Ready, con primer inicio **2026-09-24 22:00 ART**.

- Ventana: **22:00–06:00 Argentina**, diariamente hasta terminar.
- Lotes de 25, separados al menos 30 segundos.
- Antes de escribir, comprueba que pendientes + en comprobación + en espera +
  el próximo lote no excedan 125 en el receptor. Si no hay capacidad, espera.
- Un receptor pausado o con recibos no confirmados impide nuevas escrituras.
- Ante cualquier error, la tarea se deshabilita para revisión. Al terminar el
  inventario también se deshabilita. No tiene reintentos automáticos de errores.
- A las 06:00 deja de iniciar lotes. La siguiente noche reanuda desde el diario.
  Puede necesitar varias noches; no se compromete una fecha de finalización.
- El hash del script queda fijado en la configuración del lanzador. Una edición
  posterior del ejecutor requiere volver a validar y actualizar la programación.

La tarea corre en la PC del operador, con su sesión iniciada y privilegios
limitados, en una ventana oculta. Necesita **PC encendida, conectada a corriente,
con Internet y sesión abierta**. Se habilitó WakeToRun, sin garantizar encendido
de una PC apagada. No se instaló ningún servicio ni tarea en la VPS.

El lanzador fue probado durante el día y el ejecutor devolvió
`outside_night_window`, sin escrituras. Configuración, diario, referencias de
comunicaciones y logs quedan en
`.local/artifacts/bitrix-historical-rejection-20260924/execution/` del workspace
original. No borrar ese directorio ni el worktree usado por la tarea mientras
queden registros pendientes.

## Revisión operativa

Consultar `progress.json` para cantidades y `journal.jsonl` para antes/después;
`night-*.log` y `receiver-latest.json` describen la ejecución y su regulación.
Los estados `skip_*` requieren revisión y no significan que el prospecto se movió.
Ante un cierre abrupto, inspeccionar el proceso y el diario antes de retirar un
`running.lock` remanente. No volver a correr el inventario desde cero.

Las pruebas cubren cambios concurrentes, exclusión de estados, unicidad/corte del
inventario, guardas de históricos, escritura conjunta, recuperación sin reenvío,
fallos de verificación, comunicaciones nuevas, horario argentino y control de cola.
