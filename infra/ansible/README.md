# Base administrada con Ansible

Esta carpeta define la base de los hosts de Red Unisol. Su primer destino es
`dedicated_prod_01`: el dedicado Debian 13 que recibira produccion en migraciones
posteriores. La configuracion se revisa en Git antes de aplicarla. Un merge no
ejecuta Ansible ni habilita por si solo el traslado de servicios.

El inventario y la migracion de cada aplicacion se resolveran por servicio
despues. Esta base no despliega aplicaciones, no traslada datos de negocio y no
cambia DNS, webhooks, colas ni schedulers productivos.

## Responsabilidades y limites

| Capa | Responsabilidad de esta base |
| --- | --- |
| Sistema | Configuracion declarativa de Debian, paquetes base, hora y registros. |
| Acceso | Cuentas y claves publicas expresamente configuradas. |
| Docker | Motor y plugin Compose, configuracion del daemon y verificacion. |
| Proxy | Configuracion base sin publicar los dominios de las aplicaciones actuales. |
| Storage | Validacion de discos y montajes existentes, y creacion de directorios; sin montar ni formatear discos. |
| Observabilidad | Agente y comprobaciones del host, con acceso explicito del monitor. |
| Recuperacion | Copias de la configuracion base y comprobaciones de respaldo. |
| Mantenimiento | Revision de actualizaciones y necesidad de reinicio, separada del provisionamiento. |

Por defecto no se cambia el firewall, el puerto SSH ni la politica de login root.
Los dos SATA observados no se particionan ni formatean por inferir que estan
vacios: una futura decision de storage debe identificar discos de forma estable y
revisar su contenido. MONITOREO y TRANSF conservan sus funciones; el correo
historico se verifica por separado y queda fuera de esta etapa.

## Estructura y destinos

```text
ansible.cfg
requirements-control-node.txt
requirements-dev.txt
requirements-dev.lock
inventories/
  production/hosts.yml
  integration/hosts.yml
playbooks/
  provision.yml
  verify.yml
  maintenance.yml
roles/
tests/
```

`foundation_hosts` selecciona los hosts de esta base. El inventario de produccion
identifica `dedicated_prod_01`, direccion `168.197.51.104`, puerto SSH `2241`.
Estos datos identifican el destino; no son credenciales. El inventario de
integracion no autoriza reutilizar la VPS productiva antes de su liberacion.

## Controlador y credenciales

Usar Linux o WSL con Python 3.13 y un cliente OpenSSH. Ansible se ejecuta desde ese
controlador, no desde Python nativo de Windows. Desde la raiz del repositorio:

```bash
python3.13 -m venv .venv-ansible
. .venv-ansible/bin/activate
python -m pip install -r infra/ansible/requirements-dev.lock
python -m pip check
cd infra/ansible
export ANSIBLE_CONFIG="$PWD/ansible.cfg"
```

Los archivos `requirements-control-node.txt` y `requirements-dev.txt` expresan la
seleccion de herramientas. `requirements-dev.lock` fija tambien las versiones de
sus dependencias resueltas en Linux/Python 3.13; es lo que instalan CI y el entorno
de validacion. Cambiarlos requiere otra revision y validacion. Consultar el acceso
operativo vigente en `credentials.txt`, fuera de Git, y configurar el agente SSH
o un archivo privado local. No pegar contrasenas en argumentos, inventarios o
logs. Verificar la huella SSH por un canal confiable; no deshabilitar la
comprobacion de identidad del host para hacer pasar una ejecucion.

En WSL es preferible un checkout en el filesystem Linux. Bajo `/mnt/c`, Ansible
puede considerar el directorio world-writable e ignorar el `ansible.cfg` local.
La variable anterior selecciona expresamente el archivo del checkout revisado;
usarla solo despues de comprobar que ese directorio y configuracion son confiables.

Para actualizar el lock, revisar primero los requirements de intencion y resolver
en un venv Linux/Python 3.13 nuevo, sin otras herramientas ni instalaciones
editables. Desde la raiz del repositorio:

```bash
python3.13 -m venv .venv-ansible-refresh
. .venv-ansible-refresh/bin/activate
python -m pip install -r infra/ansible/requirements-dev.txt
python -m pip check
python -m pip freeze > infra/ansible/requirements-dev.lock
```

Revisar que todas las entradas sean versiones exactas, sin rutas locales, URLs
privadas ni `-e`. Validar el nuevo lock en otro venv limpio con los comandos de
esta guia. Actualizar la intencion y el lock en el mismo cambio cuando corresponda.
CI comprueba ademas que las versiones directas declaradas sean compatibles con
el lock. Fijar versiones no sustituye revisar actualizaciones de seguridad ni
constituye una imagen identica del sistema operativo del controlador.

## Validacion sin acceso al servidor

Desde `infra/ansible`:

```bash
yamllint --strict . ../../.github/workflows/validate-ansible.yml
ansible-lint --offline
ansible-inventory -i inventories/production/hosts.yml --graph
ansible-inventory -i inventories/integration/hosts.yml --graph
for playbook in provision verify maintenance; do
  ansible-playbook -i inventories/production/hosts.yml "playbooks/${playbook}.yml" --syntax-check
done
```

Desde la raiz del repositorio:

```bash
python -m unittest discover -s infra/ansible/tests -v
```

El workflow `Validate Ansible foundation` ejecuta estas validaciones en Linux con
Python 3.13 y acciones fijadas por commit. Tiene permisos de lectura del repositorio, no abre SSH, no usa
secretos de produccion y no ejecuta tareas de provisionamiento. Sintaxis y lint
aprobados no demuestran que un host haya sido configurado ni que una restauracion
funcione.

## Provisionar, verificar y mantener

- `provision.yml` converge la configuracion declarada de la base del host.
- `verify.yml` inspecciona el resultado real; no aplica correcciones encubiertas.
- `maintenance.yml` refresca metadata APT y reporta paquetes actualizables y
  necesidad de reinicio, con autorizacion independiente. No actualiza paquetes
  ni reinicia el host; tampoco forma parte de un deploy de aplicacion.

Una futura aplicacion autorizada empieza por revisar inventario y variables,
comprobar el destino y evaluar los cambios:

```bash
ansible-playbook -i inventories/production/hosts.yml playbooks/provision.yml \
  --limit dedicated_prod_01 --list-hosts
ansible-playbook -i inventories/production/hosts.yml playbooks/provision.yml \
  --limit dedicated_prod_01 --check --diff
```

`--check` puede reunir facts y contactar el host. No es una validacion offline ni
una simulacion completa de cambios que dependen de paquetes o servicios que aun
no existen. Revisar el resultado y evitar que un diff muestre secretos.

Una vez autorizada esa intervencion, usar el SHA completo de la revision revisada
y un checkout limpio de esa misma revision. El guard del playbook exige tanto la
autorizacion expresa como esa referencia:

```bash
FOUNDATION_REVISION="$(git rev-parse HEAD)"
ansible-playbook -i inventories/production/hosts.yml playbooks/provision.yml \
  --limit dedicated_prod_01 \
  --extra-vars "foundation_apply_authorized=true foundation_revision=$FOUNDATION_REVISION"
ansible-playbook -i inventories/production/hosts.yml playbooks/verify.yml \
  --limit dedicated_prod_01 \
  --extra-vars "foundation_revision=$FOUNDATION_REVISION"
```

No agregar esos comandos a un workflow de deploy de aplicaciones ni ejecutar
mantenimiento como paso implicito del provisionamiento. Las variables sensibles
deben mantenerse fuera de Git y las tareas que las consuman ocultar su contenido.
`maintenance.yml` exige por separado `foundation_maintenance_authorized=true` y
`foundation_revision` para ejecutarse fuera de check mode. Un futuro upgrade o
reinicio requiere su propia intervencion y criterios de recuperacion.

## Aceptacion y evidencia

El inventario inicial mantiene el exporter en `127.0.0.1:9100`, marca
`foundation_external_monitoring_configured: false` y deja
`foundation_backups_enabled: false`. Eso permite preparar la observacion local
sin exponer metricas a Internet ni simular una copia externa. El acceso desde
MONITOREO y la politica de red se completan con destinos autorizados y verificados.

Para activar backups hace falta un repositorio real ya inicializado, local o externo,
custodia de su clave, archivo privado de autenticacion y rutas fuente revisadas.
El backend local exige un montaje independiente con UUID verificado y distinto del filesystem raiz; el externo exige un destino confirmado.
Preparar ese montaje corresponde a una intervencion de storage separada; esta
base valida un montaje existente y no lo crea.
Los defaults del rol `backups` exigen confirmar esos datos y la consistencia de
las fuentes. No usar una declaracion `true` para sustituir su verificacion, ni
agregar bases vivas o volumenes de aplicaciones a esa lista sin su procedimiento.

Registrar revision Git, inventario y limite usados, hora, operador, resultados y
limitaciones pendientes, sin credenciales ni dumps de variables. La aceptacion
requiere primera aplicacion autorizada, verificacion del runtime y segunda
aplicacion de provisionamiento con `changed=0`. Todo cambio recurrente debe
investigarse y corregirse antes de declarar idempotencia.

Tambien requiere metricas consultables desde el monitor autorizado, una copia
externa identificada y un ensayo de restauracion de la configuracion real de la
base en un destino aislado.
Un timer habilitado o una copia en otro disco del mismo dedicado no acreditan
recuperacion ante perdida del host. Si faltan destino externo, acceso del monitor
o ensayo real, la aceptacion sigue pendiente; no se inventan endpoints ni
credenciales para cerrarla.

Esta base no contiene restauraciones genericas de bases de aplicaciones. Cada
servicio tendra despues su procedimiento de consistencia y recuperacion.
Ver [las puertas de salida de la etapa](../../docs/dedicated-foundation.md).
