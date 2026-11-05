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
| `dedicated_prod_01` | Nuevo dedicado Debian 13; destino exclusivo de la base. |
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
root por defecto. El provisionamiento habitual no inicializa, formatea ni monta
los SATA: valida su identidad y los montajes existentes y crea directorios de la
base. La preparacion de un SATA para backup se define en una operacion separada,
bloqueada por defecto y pendiente de aprobar y aplicar su cambio concreto.

## Modelo de operacion

La base separa tres operaciones revisables y ejecutables de forma independiente:

1. **Provisionar:** configurar sistema, acceso expresamente declarado, Docker,
   proxy base, directorios, validacion del storage existente, observabilidad y
   mecanismos de respaldo.
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

## Storage local propuesto, pendiente de aplicacion

El nuevo procedimiento se prepara en Git para un solo SATA. Todavia no acredita
un disco preparado, un repositorio creado ni un backup ejecutado. La asignacion
del rol de backup se propone por identidad observada del dispositivo; no es una
confirmacion de que DonWeb etiquete ese serial como su disco de backup.

| Elemento | Propuesta revisable |
| --- | --- |
| Dispositivo | SATA identificado por by-id y serial `ZWD0RX9Q`, actualmente presentado como `/dev/sdb`. |
| Modelo y capacidad | `ST2000VN003-3CW102`, `2000398934016` bytes. |
| Filesystem | XFS sobre el dispositivo completo, etiqueta `ru-backups`. |
| UUID fijado en Git | `df29bb35-b77f-4355-a93c-c53a32580267`. |
| Montaje | `/srv/redunisol-backups`, persistente mediante `srv-redunisol\x2dbackups.mount` de systemd. |
| Fuera del cambio | NVMe raiz y el otro SATA, serial `ZWD0RXD6`. |

La preparacion debe comprobar nuevamente identidad, capacidad, firmas,
particiones y montajes antes de inicializar. Un resultado desconocido o una
firma inesperada detienen la operacion; no justifican un borrado forzado. La
convergencia posterior debe reconocer el UUID ya preparado y conservar los datos.
La revision del plan y la aprobacion concreta preceden a activar sus guardas;
los defaults siguen desactivados.

## Recuperacion y observabilidad

El mecanismo de backup de esta etapa se limita a la configuracion base
efectivamente administrada. El inventario inicial lo mantiene deshabilitado hasta
disponer de un repositorio verificado.
Las copias consistentes de PostgreSQL, SQLite, adjuntos, tracking o colas se
definiran cuando se incorpore cada servicio. Copiar directorios vivos sin revisar
su contrato no se considera una estrategia de backup valida.

La conexion externa de monitoreo se difiere expresamente. Se conservan el exporter
de loopback y las comprobaciones locales, sin afirmar scraping ni entrega de
alertas externos. Ese diferimiento no bloquea preparar futuras etapas y
despliegues; no autoriza por si mismo activar servicios productivos.

El destino externo de copias sigue pendiente mientras no este configurado y
verificado. Una copia en SATA local no cubre la
perdida completa del dedicado. Un timer habilitado tampoco prueba que exista
una copia externa utilizable: hay que comprobar ejecucion, antiguedad, integridad
y restauracion.

Las pruebas sinteticas validan scripts y guardas; no demuestran la recuperacion
de configuracion real ni la existencia de una copia externa.

No se incluye una restauracion generica de servidores o aplicaciones ni un
`cutover` vacio: esas operaciones necesitan un destino y un contrato real. Una
recuperacion integral del host se ensaya por separado en un destino aislado,
con inventario propio y revision conocida de Git.

Los procedimientos preparados de storage y backup local se separan del deploy:
`storage-prepare.yml` identifica y prepara solo el dispositivo aprobado;
`backup-initialize.yml` inicializa su repositorio; `restore-local-config.yml`
extrae el catalogo acotado de configuracion de un snapshot real a un directorio
nuevo `0700` en el mismo host y lo compara. Este ultimo no sobrescribe `/etc`, no
modifica los accesos ni acredita una reconstruccion integral del servidor.
Preparar estos playbooks en Git no los ejecuta. Mantienen guardas desactivadas
hasta la aprobacion y aplicacion de la intervencion concreta.

## Puertas de salida

| Puerta | Evidencia requerida |
| --- | --- |
| Revision del cambio | Diff sin secretos; destinos, defaults y opt-ins revisados. |
| Validacion local | Tests de seguridad, YAML/Ansible lint, inventarios parseados y sintaxis de todos los playbooks de la base. |
| Primera aplicacion | Ejecucion autorizada contra el dedicado identificado y verificacion del runtime. |
| Repetibilidad | Segunda aplicacion de provisionamiento con `changed=0`; `--check` no sustituye una aplicacion real. |
| Observabilidad local | Exporter y comprobaciones locales activos, con resultados recientes y verificables. |
| Backup local | Dispositivo y montaje aprobados, copia real, integridad del repositorio y restauracion aislada de configuracion real comparada. |
| Observabilidad externa, diferida | Metricas desde el monitor autorizado y entrega de alertas verificadas; pendiente de conexion. |
| Recuperacion fuera del host | Copia externa identificada y recuperacion real probada; una copia SATA no cierra esta puerta. |

La evidencia local y los pendientes externos se registran por separado. La base
puede estar aplicada y verificada localmente y seguir con aceptacion de proteccion
externa pendiente. Ese pendiente no bloquea preparar futuros despliegues ni
los autoriza automaticamente: cada servicio conserva sus puertas de activacion
y corte. CI no demuestra una aplicacion, una copia ni una recuperacion reales.

## Etapas posteriores

Cada servicio tendra su inventario de dependencias, datos, secretos, revision
desplegada, entradas/salidas, tareas programadas y ventanas de corte. Eso
permitira elegir olas sin separar productores y lectores de archivos compartidos,
habilitar consumidores duplicados ni volver a una base vieja despues de admitir
nuevas escrituras sin reconciliacion. Esas decisiones no se adelantan desde la
configuracion base del host.
