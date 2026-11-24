# Activación independiente de formularios y distribución VENTAS

Publicar el código habilita la compatibilidad entre versiones. Cada ambiente tiene su propia configuración. En Laravel se aplican las variables del archivo cifrado del ambiente al recrear los servicios PHP y sus workers. En Kestra se usa una KV de tipo STRING, sin vencimiento, en el namespace exacto de marketing CRM del ambiente.

| Control | Valor inicial | Efecto al activar |
| --- | --- | --- |
| Laravel `WEB_FORM_GUARDED_DELIVERY_ENABLED` | `false` | Con `true`, los nuevos trabajos web usan el sobre `web_crm_delivery_v1`. El destinatario necesita un permiso único antes de escribir en Bitrix. |
| Laravel `SALES_LOCAL_TRANSFER_WINDOW_ENABLED` | `false` | Con `true`, menú, beneficios, v3 y vinculador web verifican el último mensaje entrante antes de transferir. La primera verificación registra `sales-local-transfer-window-v1` en la base compartida. Una vez registrado, los demás workers también exigen esa prueba, incluso si conservan la variable anterior. |
| Laravel `KESTRA_CHAT_TRANSFER_DELIVERY_ENABLED` | `false` | Habilita la recepción y ejecución de pedidos de entrega de ese ambiente. Cada pedido conserva la sesión, la negociación y el destino. |
| Kestra `sales_chat_delivery_mode` | KV ausente o `legacy` | En `durable`, el calificador y la cola delegan la transferencia en Laravel. En `paused`, detienen los nuevos efectos de reparto para sesiones transferibles. Un valor explícito desconocido pausa los efectos. |

Las rutas internas de permiso de formulario y consulta de ventana funcionan al desplegar Laravel, con autenticación y validación de ambiente. La nueva bandeja de ventas tiene su propia activación y, si se habilita, siempre exige prueba de vigencia. Los otros productores Laravel comprueban también la custodia de la sesión antes del POST, independientemente de la configuración del verificador local.

## Secuencia por ambiente

1. Publicar las migraciones y los servicios PHP de Laravel con los controles nuevos apagados. También se puede publicar Kestra primero dejando ausente la KV. Los trabajos web siguen enviando el formato anterior y los flows nuevos en modo `legacy` no requieren el servicio nuevo.
2. Verificar la revisión del webhook de formularios que admite ambos formatos. Verificar el permiso interno con el token y el scope del ambiente. Entonces se puede activar el emisor de formularios por separado.
3. Verificar el endpoint de ventana contra una sesión de prueba del ambiente. Verificar la migración de pedidos, el scheduler y la disponibilidad del consumidor antes de habilitar `KESTRA_CHAT_TRANSFER_DELIVERY_ENABLED=true`. El verificador de las rutas locales puede activarse en este punto de manera independiente.
4. Para cambiar el escritor de chats, poner la KV `sales_chat_delivery_mode=paused` en el namespace exacto y esperar que terminen las ejecuciones de calificación o reparto que comenzaron con la revisión o el modo anterior. Comprobar que no quedan efectos directos en curso. Cambiar a `durable` y observar los primeros pedidos hasta el evento nativo de transferencia o la conservación de atención humana.
5. En dev usar únicamente sesiones de prueba. Verificar Edna indisponible y recuperado, un Nico que toma la sesión durante la espera, una expiración de 24 h y una entrega repetida de la misma solicitud. Consultar `php artisan sales:chat-transfers status` y `php artisan sales:distribution --day=AAAA-MM-DD`. Conciliar el número de POST y la transferencia nativa de cada sesión.

## Lectura del resultado de Kestra

Los dos flows publican `chat_delivery_totals_json`, con chats distintos por estado dentro de la ejecución. `delivery_queued` indica que Laravel guardó el pedido, `delivery_waiting` que sigue verificando condiciones y `delivery_uncertain` que falta resolver el resultado. Si el POST de custodia pierde su acuse, `handoff_unconfirmed` mantiene el caso en el selector de Kestra. Los recibos previos quedan identificados. Sólo `transferred` cuenta escrituras nativas confirmadas en esa ejecución de Kestra. La confirmación posterior de las entregas durables se consulta en Laravel.

Si la sesión vigente identifica únicamente al contacto, `delivery_binding_unverified` queda visible en la ejecución y la sesión queda libre. El calificador exige que la sesión vigente identifique al prospecto o la negociación correspondientes. Esa prueba permite la entrega aunque el índice histórico de Bitrix todavía sólo liste el chat bajo el contacto. Si una conversación figura en dos negociaciones, decide la identidad de la sesión actual. El vinculador puede aportar después la evidencia específica de esa solicitud.

## Verificación en dev

El 24/11/2026 se ejecutó el worker de la rama en la VPS con la imagen PHP de Laravel de dev y PostgreSQL 18 temporal. Se simularon Edna y Bitrix con sesiones de prueba. El historial de Edna pasó de HTTP 503 a 200 para el mismo mensaje entrante. Se contaron tanto los pedidos enviados a Bitrix como los eventos de transferencia registrados en el historial simulado.

| Evento durante la espera | Pedidos de transferencia a Bitrix | Resultado |
| --- | ---: | --- |
| La conversación siguió sin atención | 1 | Un evento de transferencia al vendedor, incluso tras repetir el pedido y volver a ejecutar el worker. |
| Nico tomó el chat antes del reintento | 0 | Quedó con Nico. |
| Nico tomó el chat durante la última comprobación | 0 | Quedó con Nico. |
| Bitrix aplicó la transferencia y se perdió el acuse | 1 | El worker consultó el historial. Mientras el evento seguía sin aparecer, el resultado permaneció pendiente de confirmación. |

Las seis suites de Laravel ejecutadas en dev pasaron 112 pruebas con 501 aserciones. En otra prueba, el cliente Python de Kestra llamó por HTTP al endpoint de Laravel en dos contenedores aislados de la VPS. La negociación anterior recibió un rechazo por vínculo incorrecto. Cuatro repeticiones concurrentes para la solicitud correcta devolvieron el mismo ID de pedido. Un pedido posterior con otro vendedor conservó el destino original.

Bitrix recibe la transferencia por ID de chat y vendedor. Su API carece de una operación que condicione atómicamente el envío a que nadie haya tomado la sesión. La última lectura de atención reduce esa ventana de carrera. Una vez registrada la intención de envío, los reintentos sólo consultan evidencia del efecto.

## Pausa y reversión

- **Formulario.** Volver el emisor a `false` afecta los trabajos nuevos. Los encolados mantienen su formato original. Conservar el receptor dual, el endpoint de permiso y los workers de conciliación hasta resolver todos los recibos v1. Una respuesta perdida en modo anterior sólo autoriza lectura de conciliación.
- **Distribución.** Pasar la KV a `paused` y esperar el cierre de las ejecuciones que ya tomaron su modo. Mantener activo el consumidor mientras concilia su custodia. Si se requiere suspender sus efectos de inmediato, apagar además el control del consumidor y conservar las filas para su reanudación. No borrar la KV ni volver a `legacy` mientras existan pedidos o efectos pendientes, no concluyentes o susceptibles de ser seleccionados otra vez. El escritor anterior desconoce las custodias de Laravel. Para una reversión de código, drenar también los workers con la versión capaz de reconocer los recibos correspondientes.
- **Ventana local.** La marca de activación es persistente porque volver a omitir la verificación permitiría transferir sesiones vencidas. Ante una caída de Edna se puede pausar el productor afectado. Conservar la marca y verificar la sesión y la atención humana al reanudar.

El resto de los cambios de la rama conserva su ciclo previo. Las migraciones crean los recibos y el corte de espera de vendedor orgánico. El ingreso HTTP idempotente, la respuesta pública y los workers web se publican con Laravel. Las políticas de concurrencia de los cron se publican con Kestra. Este corte controla el protocolo entre servicios y el escritor de transferencias. El barrido de ventas, la bandeja y la recuperación del watchdog se operan según sus controles correspondientes.
