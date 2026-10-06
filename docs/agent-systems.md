# Mapa operativo para agentes

Este documento sirve para ubicar rapidamente el sistema correcto, su fuente de verdad y la via de acceso. No contiene secretos. Los valores de acceso estan centralizados localmente en `credentials.txt`.

## Mapa de sistemas

| Sistema | Uso principal | Fuente de verdad | Acceso habitual |
| --- | --- | --- | --- |
| GitHub | Codigo, PRs, checks y deploys | repositorio remoto | `git` y `gh` |
| Kestra | Ejecucion de automatizaciones | YAML y namespace files en Git | API, UI y credenciales locales |
| Bitrix24 | CRM, tareas, chats y actividad comercial | Bitrix24 | MCP o webhook, segun la operacion |
| VPS | Docker, Apache y servicios publicados | Compose/configuracion Git mas estado runtime | SSH |
| Core, CredixSA y servicios financieros | Datos transaccionales | API propietaria correspondiente | endpoint y credencial local |
| Google Sheets | Planillas compartidas | Google Drive/Sheets | service account u OAuth |
| Informes y Excels | Resultados de analisis | proceso y datos fuente que los generaron | `.local/artifacts/` |
| Material retirado | Recuperacion cautelar | no canonico | `.local/quarantine/` |

## Regla para elegir la fuente

Antes de consultar un informe, identificar que proceso lo genero. Cuando el pedido busca trazabilidad, casos actuales o datos completos, consultar la API, base, logs o exportacion fuente. Usar el Excel como fuente solo cuando el pedido sea especificamente sobre ese archivo.

Orden recomendado:

1. codigo y documentacion traqueados para entender el contrato
2. sistema fuente para conocer datos o estado actual
3. artefactos e informes para validar una salida concreta
4. material historico solo cuando sea necesario comparar o recuperar

## Descubrimiento de accesos

Antes de informar que no hay acceso:

1. consultar la seccion correspondiente de `credentials.txt` sin mostrar su contenido
2. revisar las herramientas expuestas en la sesion
3. revisar CLI autenticadas, por ejemplo `gh`
4. comprobar conectividad y permisos con una operacion minima de solo lectura
5. distinguir ausencia de credencial, falta de scope, servicio deshabilitado y problema de red

Que un MCP figure configurado no garantiza que este disponible o autenticado en la sesion actual. De la misma manera, que no haya plugin no impide usar una CLI autenticada.

## Bitrix24: elegir el destino correcto

Estos destinos no son intercambiables:

- **comentario REST de tarea**: pertenece a la actividad/comentarios de la tarea y requiere permisos de tareas
- **chat asociado a una tarea**: conversacion ligada a esa tarea; debe localizarse por su entidad exacta
- **chat del proyecto o grupo**: conversacion general; no reemplaza al chat de una tarea
- **chat directo**: conversacion con una persona

Antes de escribir, confirmar tipo de destino e identificador. Despues, releer el mensaje creado en el mismo destino. No publicar primero en un chat general como aproximacion.

## Git y worktrees

- `main` es la base canonica para trabajo nuevo.
- Revisar siempre rama, upstream, ahead/behind y worktrees existentes.
- Si la rama actual contiene trabajo ajeno o esta desactualizada, crear un worktree limpio desde la base correcta.
- No usar `.tmp/`, `temp/` o `untracked/` como fuente de codigo sin confirmar que se busca material historico.
- Preservar cambios del usuario y separar cada tarea en su propia rama o PR.

## Runtime y despliegues

Separar estas preguntas:

1. ¿El codigo correcto fue mergeado?
2. ¿El workflow ejecuto las etapas relevantes?
3. ¿La revision o imagen nueva quedo activa?
4. ¿El comportamiento publico o la API responden correctamente?

Una falla posterior, como limpieza de imagenes, puede dejar un workflow rojo aunque la aplicacion haya sido desplegada. Verificar el efecto real antes de diagnosticar rollback o repetir el deploy.

## Material local

- `.local/artifacts/`: informes, planillas y resultados que se quieren conservar
- `.local/quarantine/`: material retirado de su ubicacion original por cautela
- `.local-secrets/`: copias y archivos consumidos por runtimes o procesos existentes
- `credentials.txt`: indice canonico y legible de accesos operativos

El contenido local no esta traqueado. No usarlo como documentacion permanente; trasladar a Git solamente reglas, contratos y procedimientos sin secretos.
