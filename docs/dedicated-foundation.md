# Etapa 1: base reproducible del dedicado

## Resultado buscado

Esta etapa deja una base de host definida en Git, verificable y recuperable para
recibir produccion mas adelante. La implementacion esta en
[`infra/ansible`](../infra/ansible/README.md). Hacer merge de esa configuracion no
equivale a ejecutarla ni demuestra que el dedicado ya cumpla sus condiciones.

La prioridad es reconstruir y observar el servidor y recuperar su configuracion.
El inventario y la migracion de aplicaciones se abordaran por servicio despues;
no son un prerrequisito para escribir esta base.

## Destinos y limites

| Destino | Papel durante esta etapa |
| --- | --- |
| `dedicatedprod01` | Nuevo dedicado Debian 13; destino exclusivo de la base. |
| VPS actual `5779267` | Conserva sus servicios hasta sus respectivos cortes. |
| MONITOREO `6088737` | Conserva su funcion de observabilidad externa. |
| TRANSF `5967792` | Conserva su funcion operativa. |

La futura asignacion de la VPS actual a integracion depende de liberarla. Mientras
ambos hosts conserven produccion, no hay aislamiento fisico completo de
dev/integracion respecto de produccion. El correo historico se verifica por
separado y no forma parte de esta intervencion.

Esta etapa no traslada aplicaciones, bases, archivos de usuarios, claves OAuth,
colas, schedulers ni webhooks. No cambia DNS o endpoints productivos, no publica
dominios de aplicaciones en el proxy nuevo ni modifica el firewall o el login
root por defecto. Los SATA no se inicializan ni formatean.

## Modelo de operacion

La base separa tres operaciones revisables y ejecutables de forma independiente:

1. **Provisionar:** configurar sistema, acceso expresamente declarado, Docker,
   proxy base, directorios/montajes optados, observabilidad y respaldo.
2. **Verificar:** contrastar runtime con inventario sin aplicar correcciones.
3. **Mantener:** refrescar metadata APT y reportar paquetes actualizables y
   necesidad de reinicio con autorizacion independiente. El playbook actual no
   actualiza paquetes ni reinicia. Esas intervenciones requieren ventana y
   recuperacion propias, separadas del deploy de aplicaciones.

Las credenciales se descubren desde el archivo local `credentials.txt`; no se
copian al inventario ni a documentacion traqueada. Ansible se opera desde
Linux/WSL con herramientas fijadas por version y SSH validado. CI solo valida
codigo sin contactar los hosts operativos.

La politica de actualizaciones del proveedor debe verificarse y coordinarse con
este modelo antes de dar por resuelto el mantenimiento. El incidente de
[recuperacion del scheduler de Kestra](kestra-scheduler-recovery-20261103.md)
documenta un reinicio automatico gestionado por Ansible; no acredita que ese
Ansible perteneciera a este repositorio. Una futura migracion debe definir
apagado ordenado y comprobaciones funcionales posteriores de cada aplicacion.

## Recuperacion y observabilidad

Los backups de esta etapa cubren la configuracion base efectivamente administrada.
Las copias consistentes de PostgreSQL, SQLite, adjuntos, tracking o colas se
definiran cuando se incorpore cada servicio. Copiar directorios vivos sin revisar
su contrato no se considera una estrategia de backup valida.

El destino externo de copias y la autorizacion de acceso del monitor quedan
pendientes cuando no esten configurados. Una copia en SATA local no cubre la
perdida completa del dedicado. Un timer habilitado tampoco prueba que exista
una copia externa utilizable: hay que comprobar ejecucion, antiguedad, integridad
y restauracion.

No se incluye un playbook vacio de `restore` ni uno de `cutover`: esas operaciones
necesitan un destino y un contrato real antes de automatizarse. La recuperacion de
la base se ensaya en un host aislado con inventario propio y la misma revision de
Git, recuperando la configuracion aprobada y verificando los accesos y el resultado.

## Puertas de salida

| Puerta | Evidencia requerida |
| --- | --- |
| Revision del cambio | Diff sin secretos; destinos, defaults y opt-ins revisados. |
| Validacion local | Tests de seguridad, YAML/Ansible lint, inventarios parseados y sintaxis de los tres playbooks. |
| Primera aplicacion | Ejecucion autorizada contra el dedicado identificado y verificacion del runtime. |
| Repetibilidad | Segunda aplicacion de provisionamiento con `changed=0`; `--check` no sustituye una aplicacion real. |
| Observabilidad | Metricas desde el monitor autorizado y fallos visibles en los canales operativos elegidos. |
| Recuperacion | Copia externa identificada y restauracion de la base probada en un destino aislado. |

Hasta reunir evidencia de runtime, repetibilidad, monitor y restauracion externa,
la etapa queda **preparada en Git, pendiente de aceptacion operativa**. CI no
cierra esas puertas ni habilita el traslado de produccion.

## Etapas posteriores

Cada servicio tendra su inventario de dependencias, datos, secretos, revision
desplegada, entradas/salidas, tareas programadas y ventanas de corte. Eso
permitira elegir olas sin separar productores y lectores de archivos compartidos,
habilitar consumidores duplicados ni volver a una base vieja despues de admitir
nuevas escrituras sin reconciliacion. Esas decisiones no se adelantan desde la
configuracion base del host.
