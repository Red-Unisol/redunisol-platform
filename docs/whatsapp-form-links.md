# Enlaces de formulario desde WhatsApp — tarea 23229

## Uso desde Bitrix

En el contacto asociado a la conversación (o en el prospecto activo si no existe
un contacto único), mostrar estos campos en la ficha:

- **Enlace al formulario (WhatsApp)**: copiar este enlace al responder al cliente.
- **Enviar formulario por WhatsApp**: marcar y guardar para solicitar un envío.
- **Estado envío formulario**: resultado de la solicitud. El proceso revisa los
  pedidos cada minuto y desmarca el control al procesarlos.

La sección **Formulario por WhatsApp** se agrega al diseño compartido de la ficha.
Quienes tengan una vista personal pueden seleccionar estos campos en su propia
vista o utilizar el diseño compartido. No se fuerza el reemplazo de vistas personales.

No es necesario que el cliente complete el Router para disponer del enlace.
La acción usa el canal de Ventas configurado y la plantilla aprobada
`boton_home_atribucion`. No se envían mensajes por el solo hecho de recibir una
consulta, registrar un campo o sincronizar la ficha.

El envío requiere una conversación reciente (menos de 23 horas desde la entrada)
y permite un solo envío por entrada. Si el resultado es incierto, revisar el
historial: volver a marcar el control no genera un segundo envío. Esta versión
no agrega un botón dentro del editor nativo de plantillas; usa un control en la
ficha y un worker que llama a la API de Edna.

Los contactos duplicados, la falta de una ficha inequívoca y los prospectos
cerrados se envían a revisión. No se crea ni se elige un prospecto arbitrario.
Si el contacto existe, usar su ficha: no se replica la acción en todas sus
negociaciones o prospectos.

## Atribución

La referencia procede del mensaje entrante autenticado por Edna, nunca de un
campo histórico editable del CRM. Se valida teléfono, canal y vigencia contra
`attribution_journeys`. El enlace válido conserva los 10 caracteres de la
referencia; también admite referencias antiguas de 24 caracteres.

El contexto se guarda en `edna_form_links`, separado de la respuesta al Flow:

- una entrada del sitio o un mensaje con `(ref: ...)` abre un nuevo contexto;
- una referencia inválida o ausente en una nueva entrada elimina la referencia
  anterior;
- una respuesta ordinaria conserva el contexto durante un máximo de 24 horas
  desde su entrada; después de ese plazo un nuevo mensaje empieza sin referencia;
- los eventos antiguos no reemplazan eventos más recientes;
- no se recuperan campañas por teléfono, CUIL o `UF_CRM_JOURNEY_ID` histórico;
- cada contexto nuevo desmarca cualquier solicitud de envío anterior;
- sin referencia válida se usa la home, sin agregar UTMs de adquisición ficticias.

El enlace ya copiado es una instantánea de esa consulta, sujeto a la vigencia
normal de la referencia (30 días). La acción de envío vuelve a validar el contexto
en el momento de enviar. Un enlace copiado no cambia cuando cambia la ficha.

Esta funcionalidad no reemplaza `boton_home`, no modifica sus usos existentes,
no altera el envío automático de la landing del Router y no vuelve a incorporar
la referencia al mensaje posterior al formulario web.

## Operación y despliegue

El código, la definición de la plantilla, los campos y el scheduler están
versionados. El estado de aprobación de Meta/Edna y la disposición visual de los
campos en Bitrix pertenecen a esos sistemas.

La configuración de producción incluida en este cambio activa la captura y
proyección de enlaces, pero mantiene `EDNA_FORM_LINK_SEND_ENABLED=false`.
Por lo tanto, el merge/deploy por sí solo no habilita mensajes a clientes.

1. Ejecutar `php artisan edna:form-links schema` para verificar los campos y
   `php artisan edna:form-links schema --apply` para crear sólo los faltantes.
   `php artisan edna:form-links layout --apply` agrega los campos al diseño
   compartido conservando las secciones existentes. Sin `--apply` sólo verifica.
2. Ejecutar `php artisan edna:form-links template` para verificar definición y
   aprobación; `--apply` registra la plantilla si no existe. No envía mensajes.
   Una respuesta incierta requiere inspeccionar antes de repetir el registro.
3. Desplegar migraciones, web, `edna-worker` y el nuevo servicio `scheduler`.
4. Versionar `EDNA_FORM_LINKS_ENABLED=true` para capturar y publicar enlaces.
5. Para el piloto, configurar `EDNA_FORM_LINK_RECIPIENTS` con el teléfono autorizado
   y habilitar `EDNA_FORM_LINK_SEND_ENABLED=true` en configuración versionada.
   Esta lista es independiente de la del Router. Fuera de una ventana de piloto, mantener
   los envíos deshabilitados hasta la prueba real y decisión de activación.
6. Probar con y sin referencia: solicitar el envío desde la ficha, comprobar el
   botón en WhatsApp, abrirlo desde otro navegador y verificar la atribución de
   un formulario de prueba. Repetir el control no debe duplicar el mensaje.
7. Habilitar el uso general sólo después del piloto. Confirmar aprobación de
   plantilla, flags, servicios activos y campos visibles en la ficha.

Diagnóstico sin contenido personal:

```sh
php artisan edna:form-links status
php artisan edna:form-links sync EVENT_ID
php artisan edna:form-links reconcile SEND_ID
```

`sync` reintenta la proyección de un contexto actual (reinicia el control de
envío). `reconcile` sólo lee el historial de Edna. Ninguno reenvía un mensaje.

`edna_form_link_sends` conserva la reserva única, el UUID, el contenido del botón
y el estado. Se confirma contra el historial por UUID, canal, destinatario,
cascada y texto. `accepted` significa aceptación de la API; sólo `confirmed`
significa que el historial reportó SENT, DELIVERED o READ. Un timeout conserva
`unknown`; jamás se repite el POST de envío automáticamente.

El scheduler limpia contextos inactivos y datos de destinatarios de envíos
cerrados luego de 30 días. Conserva las claves de deduplicación y los envíos
inciertos para su conciliación. `edna:form-links prune` permite revisar los
conteos sin modificar datos; `--apply` aplica esa retención.

## Fuentes de la integración

Verificación del 2026-10-01: los tres campos existen en contactos y prospectos;
la sección está agregada a ambas vistas compartidas; la plantilla Edna 61838,
`boton_home_atribucion`, figura `APPROVED`. Todavía se requiere desplegar este
código y ejecutar el piloto antes de habilitar envíos generales.

- [Edna: registro de plantillas](https://docs-pulse.edna.io/docs/api/templates/add-operator-template/)
- [Edna: envío con URL dinámica](https://docs-pulse.edna.io/docs/api/messages/sending/)
- [Bitrix: mensajes WhatsApp desde CRM](https://helpdesk.bitrix24.com/open/21490882/)

La pantalla CRM inspeccionada no expone la variable del botón de la plantilla
`formu_fueradehorario`, aunque Edna devuelve su URL como
`https://redunisol.com.ar/{{1}}`. Por eso el envío personalizado usa la API.
