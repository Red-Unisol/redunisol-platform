# Riesgos de la rama `codex/ventas-automatizacion-integral` · revisión del 24/11/2026

Revisión de lectura de los commits 7421cdd6, aed363e6, 1a19312d y b71ea208 sobre `main` (80fb9b29): 124 archivos, +6.768 / −418. No se ejecutaron las pruebas. El diagnóstico de [ventas-automatizacion-2026-11-24.md](ventas-automatizacion-2026-11-24.md) es sólido; los puntos siguientes son sobre cómo entra el cambio a producción.

## 1. El orden de despliegue entre Laravel y Kestra corta algo en cualquier sentido

- **Laravel primero.** `PersistFormSubmission` manda `{"web_crm_delivery_v1": ...}`. El receptor actual de `bitrix24_form_webhook` no reconoce ese sobre y falla sin escribir: los formularios no llegan a Bitrix hasta actualizar Kestra (el worker reintenta hasta 15 veces).
- **Kestra primero.** El calificador y `bitrix24_deal_assignment_queue` consultan `/api/internal/sales-chat/transfer-window`, que todavía no existe. Resultado `customer_window_unverified` y ningún chat se transfiere.

El flujo dev → main no garantiza el orden por sí solo. Hace falta una secuencia explícita (por ejemplo: endpoint Laravel tolerante primero, después Kestra, después el sobre nuevo) o que cada lado acepte la ausencia del otro durante la transición.

## 2. La ventana de 24 h bloquea en silencio cuando no puede verificar

En `deal_service.py`, si el endpoint falla, tarda más de 30 s, Edna no responde o el historial de la sesión no cierra, el motivo `customer_window_unverified` termina en el estado `no_transferable_session`: el mismo que "no hay sesión". La negociación queda con su vendedor, pero el chat no se transfiere y no hay reintento posterior ni aviso.

Este control no depende de `SALES_INBOX_ENABLED`: queda activo con el deploy. Cualquier inestabilidad de la web o de Edna baja el reparto automático sin que se note.

Propuesta: tratar `customer_window_unverified` como estado propio, con reintento acotado mientras la ventana pueda seguir vigente, y contarlo en `sales:distribution` / alerta.

## 3. Cambios activos desde el deploy, aunque la bandeja esté apagada

- Recepción del formulario web completa: `FormSubmissionController`, `Idempotency-Key`, `web_form_http_attempts` y los workers `web-form-worker` y `web-form-reconcile-worker`.
- El mensaje al cliente cuando la precalificación no responde cambia de "Recibimos tu solicitud, pero no pudimos verificarla automáticamente. La revisaremos de forma manual." a "Recibimos tu solicitud. La verificación está pendiente."
- La migración `2026_11_24_153100_activate_organic_seller_wait` activa el corte `organic-seller-wait-v1` en el momento de `migrate`.
- La ventana de 24 h también se aplica en `EdnaOrganicMenu::transfer` (menú orgánico y "Otra consulta").
- `deploy-redunisol-web-dev.yml` y `deploy-redunisol-web-prod.yml` levantan Postgres y corren `migrate` antes de los workers.
- `bitrix24_lead_prefill` y `bitrix24_catamarca_deal_qualification` pasan de `QUEUE` a `CANCEL` con `recoverMissedSchedules: NONE`.

Conviene que cada uno de estos cambios quede listado en la activación, con su forma de volver atrás.

## 4. Un solo PR para seis temas

Formulario web, reparto en Kestra, bandeja, ventana de 24 h, alertas del barrido y watchdog con Ansible. Si algo falla en producción, revertir uno obliga a revertir todos. Partición sugerida, en este orden:

1. Alertas de calendarios en el barrido y watchdog en modo `observe` (bajo riesgo, cubre el bloqueo del 22 al 24/11).
2. Prioridad de ingresos recientes y `CANCEL` en enriquecimiento y calificación.
3. Formulario web con el endpoint de permiso, desplegando primero Kestra.
4. Ventana de 24 h, después de probar el endpoint en dev.
5. Bandeja de Ventas, que sigue apagada.

## 5. Menores

- El criterio general ante datos inesperados de Bitrix o Edna es no actuar. Es seguro, pero puede dejar más casos sin resolver: medir con `sales:inbox status` y `sales:distribution` después de cada activación.
- El watchdog en modo `recover` sería la primera automatización que termina ejecuciones de Kestra en producción. Mantenerlo en `observe` hasta decidirlo.
- Las 6 pruebas de Laravel que fallan también en `main` siguen pendientes, fuera de esta rama.
