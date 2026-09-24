# Avisos de rechazo por motivo

## Problema y estado

Kestra persiste `STATUS_ID=UC_1P8I07` (RESULTADO PERDIDO) y
`UF_CRM_REJECTION_REASON` en una misma actualización. Los avisos de Bitrix estaban
en las etapas específicas, por lo que ese recorrido no los ejecutaba.

Relevamiento del 2026-09-24, tarea Bitrix **22751**:

- plantilla destino **889**, exportada vacía;
- 16 plantillas de rechazo respaldadas e incorporadas como fuentes JSON;
- fuente adicional **709 / SIN RESPUESTA**, revisada pero excluida: su correo invita
  a retomar una consulta y no comunica un rechazo por falta de calificación;
- campo string `UF_CRM_REJ_NOTICE` creado y releído en Bitrix, ID **1853**;
- automatización **publicada en la plantilla 889 el 2026-09-24 a las 11:55 ART**;
- corte `ID > 396841`, obtenido de Bitrix a las 11:55:08 ART: los prospectos que
  ya existían quedan excluidos, incluso si cambian de etapa posteriormente;
- diseñador reabierto después de guardar y BPT persistido exportado y comparado:
  sin diferencias funcionales frente al generado; hashes en `deployment.json`;
- entrega de comunicaciones pendiente de observar en un rechazo nuevo real;
- la migración de prospectos históricos **no fue ejecutada**.

Los `.bpt` originales están en el directorio local de artefactos del trabajo.
Los JSON de `sources/` contienen los árboles originales, sus IDs y el SHA-256 de
cada BPT. Son las fuentes usadas para generar la configuración desplegada. Los
catálogos necesarios para la importación están en `document-fields.json`.

## Comportamiento publicado

El proceso destino exige simultáneamente:

1. etapa RESULTADO PERDIDO;
2. ID de prospecto mayor que el último existente al habilitar el cambio;
3. `UF_CRM_REJ_NOTICE` vacío;
4. un motivo con plantilla conocida.

Selecciona una sola rama por motivo. Antes de ejecutar sus comunicaciones marca
`IN_PROGRESS`; después, `PROCESSED`. Cualquier estado no vacío excluye nuevas
ejecuciones. `HISTORICAL` queda reservado para migraciones sin comunicaciones.

`PROCESSED` indica que el flujo terminó, **no** que el correo fue entregado o el
mensaje leído. La marca previa evita el reenvío normal al reingresar en la etapa;
no es una transacción atómica con el transporte ni una garantía de entrega
exactamente una vez. Un caso detenido en `IN_PROGRESS` requiere revisar el registro
del proceso y los envíos antes de permitir un reintento.

Se preservan textos, remitentes, selección de destinatario, seguimiento de enlaces
y configuración de los canales, con dos correcciones concretas:

- **AUTONOMO / 387:** se elimina la condición secundaria sobre la opción laboral
  `0b8c70305bf0f7b2a0823319ad31a3ea`, ausente del catálogo vigente. La selección por
  `Motivo Rechazo=AUTONOMO` determina el aviso; correo y chat conservan sus textos.
- **NO CUMPLE REQUISITOS PARA CONVENIO / 407:** por indicación del usuario se
  reemplaza el duplicado de correo por un mensaje de canal abierto. Se conserva
  el correo más reciente y se deriva de él el texto plano del chat. Se reutiliza
  la acción `ImOpenLinesMessageActivity` de la plantilla 383, sin adjuntos.

WhatsApp de OTRA PROVINCIA sigue desactivado. NÚMERO INCORRECTO conserva solo correo.
El resultado contiene **16 correos y 14 mensajes de canal abierto activos**,
distribuidos entre 16 motivos, más la acción WhatsApp desactivada. No hay envío
masivo: cada ejecución selecciona únicamente la rama del motivo del prospecto.

SIN RESPUESTA, NO SON SOCIOS NI QUIEREN PRESTAMO, POLICÍA FEDERAL CABA - PERÍODO
INICIAL y motivos vacíos/desconocidos no generan avisos en este proceso. No se
inventaron mensajes para motivos sin plantilla de rechazo verificada.

## Generar y validar

Desde la raíz del repositorio:

```powershell
php kestra/tools/build_bitrix_rejection_notifications.php kestra/automations/marketing-crm/bitrix/rejection-notifications <salida.bpt> <ultimo-id-existente>
python -m unittest discover -s kestra/automations/marketing-crm/tests -p 'test_*.py'
php -l kestra/tools/build_bitrix_rejection_notifications.php
python kestra/tools/validate_kestra.py
```

El generador crea el BPT y un JSON legible junto a él. Verifica la lectura del BPT,
el catálogo de motivos, las actividades admitidas y la ausencia de dependencias
externas de variables/parámetros. Las pruebas locales validan la selección de cada
motivo, propiedades originales de los mensajes, corte de históricos, marca previa,
reingreso, desconocidos y las dos correcciones descritas. No emulan la entrega de
mensajes del servidor Bitrix.

Para inspección inicial usar `999999999` como límite, sin habilitar envíos actuales.
No presentar ese archivo como una solución activa. Para habilitar, consultar el
último `crm.lead.list` ordenado por ID descendente, regenerar con ese ID y registrar
fecha, hora y hash exactos del artefacto.

En el diseñador de la plantilla 889 importar primero la variante de inspección.
Comprobar las condiciones del filtro y el mapeo de motivos tras la importación.
Después importar la variante con el corte real, o editar únicamente ese límite
en la condición y generar el artefacto equivalente. Guardar, reabrir el diseñador
y volver a exportar para comparar el resultado persistido. La configuración REST usa IDs numéricos de enum;
los BPT usan sus `XML_ID`. No intercambiarlos.

En la activación del 2026-09-24 se verificaron la etapa, el campo de control y el
motivo OTRO BANCO en los selectores del diseñador. El árbol importado de inspección
coincidió exactamente con el generado. Tras editar el corte, guardar y reabrir,
la comparación completa detectó únicamente normalizaciones del editor:
`joiner` y `MessageTextEncoded` numéricos convertidos a texto, adjuntos nulos
convertidos a texto vacío, metadatos `Node` nulos agregados y un comentario vacío.
Las condiciones, los 16 motivos, los textos, los canales y las marcas se conservaron.

Verificar un rechazo nuevo real posterior al corte mediante historial del proceso
y actividades del CRM; la presencia de la plantilla no prueba entrega. No mover
prospectos reales ni generar comunicaciones de prueba para forzar esa verificación.

El rollback consiste en importar el BPT vacío original de la plantilla 889. No
borra mensajes ya enviados. Las plantillas de las etapas originales permanecen
intactas y no escriben la nueva marca: un traslado manual entre esos recorridos
requiere revisar comunicaciones previas para no duplicarlas.

## Migración histórica posterior

`manifest.json` ofrece el mapa etapa original → motivo. Antes de ejecutar una
migración, generar un inventario de candidatos con ID, etapa, motivo actual y marca,
excluyendo ganados, convertidos, derivaciones a vendedor y cualquier ambigüedad.
No sobrescribir un motivo ya informado que contradiga la etapa: enviarlo a revisión.

Para cada candidato aprobado, persistir **en una misma actualización**:

```text
UF_CRM_REJ_NOTICE = HISTORICAL
UF_CRM_REJECTION_REASON = ID numérico vigente del motivo confirmado
STATUS_ID = UC_1P8I07
```

La marca impide avisos aunque el candidato sea posterior al corte inicial. No
migrar primero la etapa y marcar después. Guardar valores anteriores para revertir
datos y verificar por lectura cada lote. Para históricos que ya estén en RESULTADO
PERDIDO sin motivo no se puede inferir la causa solo desde la etapa: se necesita
historial o evidencia de la clasificación original.
