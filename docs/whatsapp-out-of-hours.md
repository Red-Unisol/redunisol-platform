# WhatsApp fuera de horario de Ventas (23233)

## Alcance y estado de esta entrega

Se reutilizan el receptor autenticado de Edna, el inbox cifrado, la cola dedicada,
la clasificación de Kestra y el adaptador de envíos. Solo cubre WhatsApp de Ventas:
subject configurado en `EDNA_INCOMING_SUBJECT_ID`, cascada configurada y canal
abierto Bitrix 1. La gestión comercial abierta se consulta en la categoría 1.
No amplía el receptor a otros canales ni cambia los recorridos automáticos.

La entrega está **desactivada por defecto**. No modifica la configuración de
Bitrix ni envía mensajes al instalarse. Requiere ambos controles habilitados:
`EDNA_OUT_OF_HOURS_ENABLED=true` en el entorno Git-managed y la configuración
administrada de Ventas en el panel. `EDNA_OUT_OF_HOURS_RECIPIENTS` permite limitar
un piloto; vacío habilita cualquier destinatario elegible una vez activos ambos
controles. La lista se vuelve a comprobar inmediatamente antes del envío.

## Decisión y calendario

Kestra devuelve `out_of_hours_candidate=true` para texto ordinario y los tipos
IMAGE, AUDIO, DOCUMENT y VIDEO. La web solo captura estos tipos adicionales cuando
está habilitado el control operativo. Conserva metadatos mínimos, sin descargar
archivos ni almacenar URLs de adjuntos. Entradas web del Router, FLOW y respuestas
interactivas con código no son candidatas. Un texto común, aunque diga "Quiero
pedir un préstamo", recibe el tratamiento general si no dispara un recorrido
actual: no se presupone una automatización futura.

El worker espera diez segundos tras la clasificación antes de evaluar. También
excluye un Router pendiente/en curso y respuestas referidas a envíos registrados
del Router, su landing o formularios enviados por asesores. La identidad/canal se
comprueba en el registro; una referencia a un envío de otra persona no basta.
Una nueva entrada y el envío del aviso comparten el bloqueo por persona/canal.

Horario inicial: lunes a viernes, 09:00 inclusive a 17:00 exclusive,
`America/Argentina/Cordoba`. Horario, días y cierres excepcionales son editables.
Una franja es el intervalo continuo desde el último cierre hasta la próxima
apertura: el fin de semana y un feriado adyacente forman una sola franja.
Se reserva como máximo un aviso por persona/canal/franja, incluso con mensajes
repetidos, jobs duplicados o cambios de calendario con intervalos superpuestos.

El aviso distingue **en gestión** y **general**. En gestión significa cualquiera de:

- Negociación abierta de Ventas ligada al contacto o lead verificado.
- Lead del formulario creado en los últimos 60 días, sin resultado perdido.
  Se reconocen el snapshot de atribución y los marcadores que ya escribe el intake
  (responsable comercial, CUIL, situación y provincia), excluyendo Finguru del
  reconocimiento legacy. No se interpreta un simple prospecto de WhatsApp como
  formulario.
- Mensaje de un empleado activo en un chat WhatsApp de Ventas en los últimos
  30 días. Se excluyen remitentes externos, bots, mensajes del sistema y otros
  canales; el historial se pagina. No basta con que exista un asesor asignado.

Se verifica el teléfono contra las fichas encontradas. Ante fichas o asesores
ambiguos se omite la personalización; errores de API, permisos o límites de
consulta se reintentan y no se convierten silenciosamente en aviso general.
Las consultas de negociaciones usan filtros planos: se verificó que este portal
ignora grupos OR anidados de `crm.deal.list`. Se comprueba también que cada
resultado pertenece a la persona, categoría y semántica solicitadas.

El mensaje contiene la fecha y hora reales de la próxima apertura y el horario
configurado. No invita a la web ni a formularios. Antes de enviar se revalidan
activación, destinatario, vigencia, franja, automatizaciones y cascada. No se
procesan mensajes previos a la activación, de más de 23 horas, futuros o de una
franja que ya terminó.

## Configuración de Marketing e informes

Panel existente, con una cuenta autorizada:

- `/admin/whatsapp-fuera-de-horario`: textos, horario, días y fechas de cierre.
- `/admin/whats-app-notices`: registro de avisos, tipo, fecha/hora, asesor, estado
  y motivos. El teléfono se muestra enmascarado; el texto puede mostrarse como
  columna opcional. No hay edición ni borrado de envíos desde este informe.

Variables de texto: `{saludo}`, `{asesor}`, `{proxima_apertura}`, `{horario}`.
Sin nombre/asesor seguro se usan "¡Hola!" y "Un asesor". Los enlaces, dominios y
variables desconocidas se rechazan al guardar y antes de enviar. Los cambios
se aplican a nuevas reservas sin reiniciar workers ni desplegar. Cada reserva
conserva su texto cifrado para verificar el mensaje efectivamente enviado.

Los accesos son los del panel actual; esta entrega no crea usuarios ni cambia
permisos. Los estados y cantidades pueden consultarse sin datos personales:

```bash
php artisan edna:out-of-hours report
php artisan edna:out-of-hours recover
php artisan edna:out-of-hours recover --apply
php artisan edna:out-of-hours prune --apply
```

`report` incluye completitud del Router por horario hábil, fuera de horario y fin
de semana, antes/después de la activación, para los últimos 30 días. Usa el
calendario actualmente configurado; mantener ese calendario estable para comparar
las franjas. El denominador son los Flows reservados y completados según el ledger,
no una estimación de todas las consultas que recibió Bitrix.

El scheduler recupera evaluaciones/envíos cada cinco minutos y limpia PII de
avisos cerrados de más de 30 días. Conserva registros y claves de deduplicación;
los envíos inciertos conservan datos cifrados para conciliar. Los jobs solo llevan
IDs, sin teléfonos, nombres ni textos.

## Entrega y conciliación

Una reserva persistente y la inserción del job se confirman juntas. Antes del
único POST a `cascade/schedule`, el claim `pending → sending` se confirma en otra
transacción. Si hay timeout o cae el worker, nunca se repite ese POST: se consulta
`messages/history`. La confirmación exige requestId/comment, teléfono, canal,
cascada, texto y un único mensaje saliente compatibles. Los estados fallidos o
inciertos quedan visibles para revisión y recuperación.

El worker exige `WORKTIME_DAYOFF_RULE=none` en el canal abierto 1 antes de enviar.
Mientras el aviso de Bitrix siga activo, la entrega falla cerrada y no compite con
él. Esta comprobación no sustituye la coordinación operativa del cambio.

## Despliegue y activación coordinada

1. Integrar y desplegar por los workflows habituales tanto marketing-crm como web.
   Aplicar la migración aditiva y verificar worker/scheduler. Un parser anterior
   de Kestra no habilita candidatos: se conserva compatibilidad y no salen avisos.
2. Preparar textos, horario y feriados en el panel con avisos desactivados.
   Verificar que el acceso CRM configurado permite duplicados/contactos/leads,
   negociaciones, usuarios, chats e `imopenlines.config.get`.
3. Habilitar el control operativo en el entorno cifrado mediante Git; confirmar
   la propagación a PHP y worker. Para piloto, cargar únicamente el destinatario
   autorizado. Este paso por sí solo no envía avisos.
4. Coordinar el reemplazo: cambiar solo la respuesta fuera de horario de Bitrix
   a ninguna y activar la configuración de Ventas. Conservar el horario y sus
   reglas de enrutamiento humano. Son operaciones externas explícitas; no se
   realizan durante el deploy. Verificar ambas configuraciones en el momento.
5. Ejecutar UAT real y leer el registro de envío y su confirmación en Edna. Ampliar
   destinatarios por Git tras verificar el piloto y el circuito sin duplicados.

Reversión: desactivar la configuración administrada, verificar que no haya un
POST en curso y restaurar coordinadamente la respuesta anterior de Bitrix. El
control operativo puede apagarse mediante Git. Conservar tablas e inbox para
trazabilidad; no reintentar un POST incierto.

## UAT de Ventas

- Entrada web al Router fuera de horario: Flow y ningún aviso adicional.
- Respuesta al Flow o a su landing: ningún aviso adicional.
- Persona con negociación abierta y asesor a las 22: aviso de gestión personalizado.
- Tres mensajes esa noche: un aviso. Nueva franja: puede recibir otro.
- Lead perdido sin otra evidencia de gestión: aviso general, sin nuevo Router.
- Mensaje de asesor de hace 29 días sin negociación abierta: aviso de gestión.
- Mensaje hábil: sin aviso. Sábado y feriado: próxima apertura correcta.
- Marketing cambia el texto: siguiente nueva reserva usa el texto editado.
- Bitrix sin respuesta propia: no hay duplicados; si sigue activa, no se envía el nuevo aviso.
- Timeout o caída de worker: historial confirma o deja incierto, sin segundo POST.
- Registro consultable, teléfono enmascarado y texto sin enlaces.

El despliegue, habilitación y UAT real quedan pendientes del merge y del cambio
coordinado. Las pruebas locales usan APIs simuladas y no envían WhatsApp reales.
