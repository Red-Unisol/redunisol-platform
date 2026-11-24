# Calendarios comerciales de Kestra y recuperación de prefill

## Qué sucedió en noviembre de 2026

Todos los horarios corresponden a Argentina. Se verificaron los dos IDs en la API de Kestra, el historial de arranque de la VPS y las salidas de containerd y Docker en el journal. Los recibos de las intervenciones del 24/11 están en la captura local `chat-distribution-daily/2026-11-24`, en `enrichment-recovery` y `chat-response-recovery`.

| Fecha y hora | Evidencia | Consecuencia |
| --- | --- | --- |
| 2/11, noche | Un reinicio del host dejó disparadores vinculados a ejecuciones ausentes. [Investigación del 3/11](kestra-scheduler-recovery-20261103.md). | La solución manual incluyó desbloquear por nombre y evitar reproducir los minutos perdidos. |
| 15/11 23:46 | La ejecución de respuesta de chat `6SkaE2OocJ3Xk3hu7nLGjA` quedó con la tarea `revisar_chats` en ejecución. | El 24/11 el pedido de terminación pasó a `KILLING`. Se documentó un contador residual. La salida tiene efectos de negocio posibles. |
| 21/11 23:23 | Reinició la VPS. | Precede en más de dos horas al siguiente incidente de enriquecimiento. |
| 22/11 01:32:01 | En prefill `5uj9KNIL6Cfd7LE29Tif2c` terminó con éxito la consulta de pendientes. No apareció el selector ni ningún hijo. | La ejecución quedó en `RUNNING` y el disparador quedó retenido. |
| 22/11 01:33:26 y 01:43:29 | Para el ID del mismo contenedor de Kestra, containerd registra desconexión de su shim y Docker informa `/tasks/delete`. Se iniciaron nuevos procesos a las 01:33:28 y 01:43:31. | La primera salida ocurrió 84 segundos después del último avance. El motivo de las salidas sigue abierto. El último código de salida conservado fue 0. |
| 24/11 09:18:35 | Terminó la ejecución de prefill por ID. A las 09:18:37 quedó liberado el trigger, con próxima evaluación a las 09:19. | El bloqueo había durado 55 h 46 min desde la primera lectura terminada. |

El historial muestra tres formas de bloqueo. Para atribuir los reinicios del proceso del día 22 falta evidencia del emisor de la parada o del log de la aplicación en esos minutos. En una futura recurrencia deben preservarse el journal de Docker/containerd, logs de Kestra y recibos de ejecución en cuanto haya alerta.

## Qué hace el dedicado

El timer `redunisol-kestra-crm-watchdog.timer` consulta desde el dedicado cada dos minutos las agendas de prefill, calificación y respuesta de chat. Busca ejecuciones nativas de cada trigger en los últimos 20 minutos. Reporta ausencia de inicio incluso si el reloj de evaluación sigue avanzando. Respeta las agendas pausadas. Distingue fallo de lectura y falta de progreso. El barrido interno complementario mantiene su propia ruta de avisos.

En modo `recover` el servicio tiene una única acción disponible. Solicita terminar **un ID de prefill** con `isOnKillCascade=false`, y sólo cuando se cumplen todas estas condiciones:

1. La ejecución empezó después de activar este modo, permanece `RUNNING` y el disparador habilitado y bloqueado apunta a ese mismo ID. Otro calendario comercial sigue generando ejecuciones.
2. La única tarea registrada es la consulta de pendientes ya terminada. Pasaron al menos 30 minutos desde su éxito y hay dos o más lecturas coincidentes separadas por al menos cuatro minutos. Una interrupción de más de siete minutos invalida la primera observación.
3. La revisión del flow sigue vigente. Tiene concurrencia uno con `CANCEL`, `recoverMissedSchedules: NONE`, el prefiltro revisado y el selector protegido por edad de ejecución. El selector devuelve cero candidatos si tiene 20 minutos o más, aunque el proceso se reanude justo cuando llega la recuperación. Se verifican el destino de lectura, los hashes y las condiciones de lanzamiento de hijos.
4. Vuelve a leer agenda, ejecución y política antes de actuar. SQLite registra la intención en una transacción antes de la llamada. Una ejecución recibe un solo intento incluso ante timeout o reinicio. Un resultado pendiente impide cualquier otro intento. Entre IDs distintos rige además un intervalo mínimo de seis horas.
5. Los siguientes ciclos buscan el estado `KILLED` del ID y una ejecución programada nueva de prefill que haya comenzado después del intento y terminado con `SUCCESS`. Sólo entonces registran `verified`. Esto verifica que el ciclo de enriquecimiento se reanudó. Para medir cuántos prospectos avanzaron, se debe observar su historial en el CRM.

Un bloqueo con ID ausente, una tarea con posibles escrituras, `KILLING`, cron global sin actividad o pérdida de conectividad quedan para diagnóstico operativo. El endpoint de desbloqueo de [Kestra 2.0](https://github.com/kestra-io/kestra/blob/v2.0.0/webserver/src/main/java/io/kestra/webserver/controllers/api/TriggerController.java) no admite una precondición por ejecución. El procedimiento automático jamás llama ese endpoint, modifica contadores SQL, reinicia servicio ni solicita reejecutar lotes. Las decisiones de horario de vendedores, vencimiento de sesión y asignación manual siguen a cargo del reparto.

## Instalación, observación y rollback

Playbook independiente `infra/ansible/playbooks/kestra-crm-watchdog.yml`, con preflight de identidad en el grupo `crm_intake_hosts` de un solo host. Requiere el node exporter de la base y acceso HTTPS a Kestra desde el dedicado. Los archivos de aplicación y política son propiedad de root. El servicio corre con usuario sin shell y recibe la credencial mediante systemd `LoadCredential`.

Desde `infra/ansible`, suministrar las variables `foundation_kestra_watchdog_username` y `foundation_kestra_watchdog_password` mediante un archivo de variables cifrado y externo al repositorio. Usar una identidad de lectura para observación. Si se habilita recuperación debe disponer también del permiso de terminación aplicable en Kestra. No pasar secretos por la línea de comandos.

```sh
ansible-playbook playbooks/kestra-crm-watchdog.yml --syntax-check
ansible-playbook playbooks/kestra-crm-watchdog.yml -e @/ruta/watchdog.vault.yml --ask-vault-pass
journalctl -u redunisol-kestra-crm-watchdog.service --since today --output cat
systemctl list-timers redunisol-kestra-crm-watchdog.timer
```

El despliegue inicial del playbook usa `observe`. Tras verificar el cambio de prefill y los resultados de observación, el mismo playbook admite `-e foundation_kestra_watchdog_mode=recover`. Para volver a sólo lectura, aplicar `observe` con la credencial correspondiente. Para detenerlo, aplicar `stopped`; conserva los recibos. La recuperación siempre tiene un piso temporal nuevo al reactivarse.

El collector expone `redunisol_kestra_crm_watchdog_attention` y `redunisol_kestra_crm_watchdog_timestamp_seconds`. Configurar el alertamiento del scraper para atención > 0, métrica ausente o última muestra de más de siete minutos. El servicio registra los detalles por flow en el journal y marca fallido el ciclo que necesita atención. Los recibos SQLite quedan en `/var/lib/redunisol-kestra-crm-watchdog/watchdog.sqlite`. Contienen ID, fechas y resultado. Un recibo `unknown` o `unverified` requiere revisar el ID antes de cualquier intervención adicional.
