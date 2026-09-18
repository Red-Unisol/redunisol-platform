# Pruebas de aceptación del router Edna

Procedimiento de operador para los cuatro casos restantes de la tarea 23055.
No forma parte del runtime, de una ruta HTTP ni de un scheduler. CABA/PFA ya se
validó con entrada automática, respuesta correlacionada, landing entregada y
campos WA releídos en Bitrix el 2026-09-18.

`EdnaPilotCase::run($case, $eventId, $apply = false)` se ejecuta con Laravel
inicializado y configuración efectiva del runtime. El modo por defecto es lectura.
Para el piloto se puede transmitir el código versionado por stdin a un proceso
PHP del contenedor, sin copiar archivos ni cambiar configuración o servicios.
**La ejecución con apply por SSH requiere aprobación explícita del usuario**.

Casos permitidos, una sola reserva por caso en esta tanda de aceptación:

- `cordoba-jubilado`: Córdoba / Jubilado o pensionado.
- `cordoba-docente`: Córdoba / Docente.
- `catamarca-policia`: Catamarca / Policía.
- `otra-provincia`: Otra provincia.

Para cada caso, el destinatario único del piloto debe enviar exactamente:

`Hola, vengo del sitio web de Red Unisol. prueba-router-<caso>`

El operador identifica su evento real en `edna_incoming_events` y ejecuta primero
el dry-run. Sólo admite eventos entregados y clasificados `router_entry`, detenidos
por `cooldown`, del canal Ventas y del único teléfono permitido; exige antigüedad
menor de 15 minutos. Debe haberse completado y confirmado landing/CRM de los ciclos
anteriores. La lista vacía de destinatarios, otro canal, texto o número se rechazan.

Con `apply=true` reserva un nuevo registro `edna_flow_sends`, vinculado a ese evento
real, encola el job habitual `SendEdnaFlow` y marca la entrada `pilot_scheduled`.
El requestId determinista por caso y la entrada única impiden duplicarlo. No borra
ni reinicia registros, no cambia la ventana general de 24 h, no fabrica respuestas
y no envía directamente por API. Los workers normales verifican historial, respuesta,
landing y CRM. Los siguientes mensajes generales siguen sujetos al cooldown normal.

Después de cada formulario real comprobar:

1. Flow completado y respuesta `verified_response` ligada al envío.
2. `edna_router_results`: provincia/segmento esperados, landing correcta,
   `state=confirmed`, `crm_state=synced`.
3. Edna: un único mensaje de landing, DELIVERED o READ.
4. Bitrix: los siete campos WA esperados, mismo contacto y origen/UTMs previos intactos.
5. Mensaje de entrada visible en el canal abierto de Bitrix y colas sin pendientes.

No iniciar el siguiente caso hasta cerrar el anterior. Una respuesta errónea o una
incertidumbre exige diagnóstico; no se resetea el estado para reintentar un envío.
Los resultados y IDs operativos se conservan en `.local/artifacts/edna-probe/`;
no versionar teléfonos, credenciales ni conversaciones.

Validación local desde `web/redunisol-web`:

```powershell
php vendor/bin/pint ../../tools/edna-pilot --test
php -d extension=pdo_sqlite -d extension=sqlite3 vendor/bin/pest ../../tools/edna-pilot/PilotCaseTest.php --compact
```

19 pruebas cubren dry-run, idempotencia, preservación de registros/configuración,
rollback de cola, restricciones de destinatario/canal/texto, antigüedad y bloqueo
por un caso anterior incompleto. La aceptación real requiere participación del
usuario en WhatsApp; no se sustituye por callbacks sintéticos.
