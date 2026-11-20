# Kestra en el dedicado

Este rol prepara el stack de Kestra (Kestra + PostgreSQL) en el dedicado. Por
defecto solo prepara: crea carpetas y archivos, pero no descarga imagenes ni
levanta, detiene o recrea contenedores (`kestra_running: false`). Mientras
Kestra siga corriendo en la VPS, `deploy-infra.yml`, el compose de
`kestra/platform/infra/` y los flows no cambian.

Reparto de responsabilidades en el dedicado:

| Que | Quien |
| --- | --- |
| Carpetas, compose, `application.yaml`, `.env`, version de Kestra | este rol |
| Flows y archivos de namespaces (API de Kestra, `deploy_kestra.py`) | GitHub (`deploy-prod` / `deploy-dev`) |
| Copia de la base y del storage, DNS, entrada web | el corte, fuera de este rol |

## Operaciones

```bash
KESTRA_REVISION="$(git rev-parse HEAD)"
# 1. Ver que cambiaria, sin cambiar nada (siempre permitido)
ansible-playbook -i inventories/production/hosts.yml playbooks/kestra-deploy.yml \
  --limit dedicated_prod_01 --check --diff
# 2. Aplicar
ansible-playbook -i inventories/production/hosts.yml playbooks/kestra-deploy.yml \
  --limit dedicated_prod_01 \
  --extra-vars "kestra_apply_authorized=true kestra_revision=$KESTRA_REVISION"
# 3. Verificar, solo lectura
ansible-playbook -i inventories/production/hosts.yml playbooks/kestra-verify.yml \
  --limit dedicated_prod_01
```

Fuera de `--check`, el rol se niega a actuar sin `kestra_apply_authorized=true`
y un SHA completo en `kestra_revision`. Ademas comprueba, en la maquina que
corre Ansible, que la copia local sea exactamente ese SHA: sin cambios en
archivos versionados y sin archivos sueltos en `infra/ansible/` ni en
`kestra/platform/infra/`. Asi lo aplicado es lo revisado. Ambos playbooks
corren `preflight` primero.

## Que crea

| Ruta | Modo | Contenido |
| --- | --- | --- |
| `/srv/redunisol/platform/kestra` | 0700 | `docker-compose.yml`, `application.yaml` (y el `.env`, pendiente) |
| `/srv/redunisol/state/kestra` | 0750 | datos |
| `.../state/kestra/postgres` | 0700 | base de datos |
| `.../state/kestra/{storage,tmp,data,data/credixsa-cache,reports}` | ver defaults | storage interno, trabajo de tareas, carpetas de flows, reportes |

Nunca modifica el contenido de esas carpetas.

### Rutas de compatibilidad con la VPS

Kestra lanza los contenedores de tareas en el Docker del host (via
`docker.sock`), asi que los flows montan rutas **del host**. Varios usan rutas
fijas de la VPS. En el dedicado esas rutas son enlaces:

| Ruta que usan los flows | Apunta a |
| --- | --- |
| `/opt/kestra/data` | `/srv/redunisol/state/kestra/data` |
| `/srv/redunisol-reports` | `/srv/redunisol/state/kestra/reports` |

El rol nunca reemplaza una carpeta real por un enlace: si la ruta ya existe
como carpeta, falla. Los enlaces se retiran cuando los flows usen las rutas
nuevas.

## Copias temporales (revisar antes del corte)

- `templates/docker-compose.yml.j2` es una copia de
  `kestra/platform/infra/docker-compose.yml` (commit 3524f0af) con 5 lineas
  distintas: los volumenes de datos y el puerto 8081 en
  `kestra_management_bind` (`127.0.0.1` por defecto). El 8081 expone salud y
  metricas sin login; el dedicado no tiene firewall delante en el panel.
- `files/application.yaml` es una copia exacta de
  `kestra/platform/infra/application.yaml`.

Mientras Kestra conviva en la VPS, `tests/test_kestra.py` falla si las
variables del compose dejan de coincidir (y nombra la que falta), si hay otra
diferencia fuera de esas 5 lineas o si el `application.yaml` cambia en uno
solo. `verify.yml` detecta si los archivos instalados se editaron a mano.

## Pendiente

- `.env`: como se genera (hoy `kestra/platform/infra/kestra-runtime.env.enc`)
  y de donde sale la clave para descifrarlo. Debe incluir
  `KESTRA_CONFIG_SHA256` (sha256 del `application.yaml`) para la etiqueta del
  contenedor. Hasta entonces no se puede validar con `docker compose config`
  ni levantar el stack.

## Orden del corte

1. Antes: definir el `.env`; comparar el compose y el `application.yaml` con
   los de la VPS; decidir si se copia el historial completo de la base.
2. Probar el Kestra del dedicado **sin los flows reales**: hay flows con
   `Schedule` y no deben estar activos en dos Kestra a la vez.
3. Ventana: congelar merges de flows, apagar Kestra en la VPS, copiar la base y
   el storage (traen flows, estado KV, historial y estado de horarios), prender
   el dedicado y hacer un deploy completo de flows desde el repo (todos los
   dominios y los flows de sistema). Revisar que no se disparen atrasos de
   golpe. Despues, DNS y descongelar.
4. En el mismo corte: vhost de Kestra en el Apache del dedicado (hoy privado
   hasta el corte), certificado; acceso del monitoreo al 8081; URL de Kestra en
   `deploy-prod` / `deploy-dev`; reescribir o retirar `deploy-infra.yml` (si no,
   sigue aplicando en la VPS); que los flows se desplieguen despues de la infra.
5. Despues: flows con las rutas nuevas y sin enlaces; retirar el compose y el
   `application.yaml` de `kestra/platform/infra/`.

Mejoras previstas para despues de migrar, fuera de este rol por ahora: limpieza
periodica de contenedores e imagenes de tareas en el host y retencion de logs y
ejecuciones en Kestra.
