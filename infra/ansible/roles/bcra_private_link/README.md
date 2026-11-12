# Enlace privado BCRA

Este rol conserva `http://bcra-file-api-poc:8080` para Kestra sin recrear el runtime
compartido ni cambiar sus secretos. El servicio con datos vive en el dedicado;
la VPS contiene solamente un cliente OpenSSH y un relay TCP sin datos ni token.
No inicia importaciones ni hace consultas a personas.

El playbook `playbooks/bcra-private-link.yml` tiene dos destinos expresos:
`bcra_file_api_hosts` en el dedicado y `bcra_migration_origins` en la VPS.
Ambos helpers comprueban hostname y machine-id de los dos hosts revisados antes
de cualquier operacion. El controlador no reune facts en la VPS: usa el action
plugin `script`, y el programa remoto es compatible con Python 3.6.

## Operaciones

`bcra_private_link_action` vale `plan` por defecto. `--check` tambien se limita
al plan: no ejecuta el helper, no crea claves y no contacta Docker. Las escrituras
requieren `bcra_private_link_apply_authorized=true` y
`bcra_private_link_revision=<SHA completo revisado>`.

1. `prepare_key`, limitado a `bcra_origin_01`, crea la cuenta local `bcra-link`
   y una clave Ed25519 si no existen. La privada permanece exclusivamente en
   `/var/lib/bcra-private-link/id_ed25519`, modo `0600`; el resultado devuelve
   solamente la publica. Una repeticion conserva la misma clave.
2. `apply`, limitado a `dedicated_prod_01`, autoriza esa publica mediante
   `bcra_private_link_client_public_key`. Requiere tambien
   `bcra_private_link_client_source_ip`, la IPv4 publica de la VPS. Configura
   unicamente la cuenta dedicada y un bloque `Match User bcra-link`.
3. `apply`, limitado a `bcra_origin_01`, instala la unidad systemd y el relay.
   Requiere `bcra_private_link_server_host`, `bcra_private_link_server_port` y
   `bcra_private_link_server_host_key` (publica Ed25519 previamente verificada,
   sin hostname). No usa `ssh-keyscan` ni acepta una identidad nueva por defecto.
4. `verify` inspecciona ambas partes sin corregirlas. En la VPS comprueba el
   proceso de transporte, aislamiento del contenedor, `/health` y que Kestra
   resuelva el alias exclusivamente a la IP del relay. No llama `/refresh`,
   `/lookup` ni rutas de deuda.

El coordinador maneja inventario, credenciales privadas, copia consistente del
volumen y encendido del servicio remoto. No agregar contrasenas a argv; usar
el mapping privado `bcra_migration_passwords` y un archivo local protegido.
Las claves publicas y la identidad del host no sustituyen la autorizacion de apply.

## Restricciones efectivas

El usuario del dedicado no admite sesiones (`MaxSessions 0`), TTY, X11, agente,
TUN ni forwarding de sockets Unix. Permite solamente forwarding TCP **local**
hacia `127.0.0.1:18082`. La clave tiene `from=`, `restrict`, `port-forwarding`
y `permitopen` del mismo destino. `ForceCommand /usr/sbin/nologin` no sustituye
esas restricciones. OpenSSH documenta que
[MaxSessions 0 mantiene el forwarding y deshabilita sesiones](https://man.openbsd.org/sshd_config#MaxSessions)
y que [AllowTcpForwarding y AllowStreamLocalForwarding son controles separados](https://man.openbsd.org/sshd_config#AllowTcpForwarding).
El apply valida `sshd -t` y la politica efectiva del usuario, y exige que la
politica efectiva de root sea identica antes y despues. Si cambia o falla la
validacion, restaura el drop-in previo sin recargar SSH. No edita claves de root,
puerto SSH, firewall ni configuracion global de login.

En la VPS, OpenSSH se ejecuta como `bcra-link` con host key pinneada,
`ExitOnForwardFailure` y keepalives. Escucha unicamente en el gateway ya existente
de `kestra_net`, `172.18.0.1:18083`; la subred esperada es `172.18.0.0/16`.
Una red distinta detiene el apply en lugar de crearla o adivinar otro bind.
La unidad es `redunisol-bcra-private-link.service`; una repeticion sin deriva no
la reinicia. Si Docker o la red faltan durante un arranque, systemd reintenta el
transporte cada cinco segundos, sin ejecutar tareas BCRA.

El relay reutiliza la imagen BCRA local fijada por digest, con `--pull=never` y
entrypoint `python /proxy.py`; no ejecuta la aplicacion original de la imagen.
Tiene como unico montaje el script de solo lectura, sin volumen BCRA, token,
logs de peticiones ni descargas. Limita memoria a 64 MiB, CPU a 0,10 y PIDs a 40.
Su socket se publica en `127.0.0.1:18082` y en el alias Docker existente,
puerto 8080. Solo acepta 32 conexiones simultaneas, chunks de 64 KiB, conexion
de cinco segundos, idle de 35 y vida maxima de 120 segundos. No interpreta ni
reintenta HTTP: una respuesta perdida no genera un segundo POST desde el relay.

## Corte y limites

El importer de la VPS debe seguir detenido antes del apply. El rol verifica eso;
no lo detiene, arranca, borra ni desconecta. Tampoco modifica Kestra, schedulers,
tokens o flags. Si el nombre del relay pertenece a otro actor, falla sin
adoptarlo. Una deriva del relay propio puede recrear solamente ese contenedor.

Durante el corte puede haber un intervalo corto sin respuesta. La verificacion
rechaza un alias que todavia incluya otra IP: el coordinador debe resolver la
identidad del endpoint antiguo antes de declarar exitoso el cambio. El token
existente sigue siendo validado por la API remota; `/health` no demuestra por si
solo autorizacion de `/status`, vigencia de los datasets o recuperacion de la copia.
Esas comprobaciones pertenecen al corte del servicio y no deben disparar una
segunda importacion para probar conectividad.

Este camino agrega un componente de transporte y su dependencia de SSH/systemd.
Evita una recreacion inmediata de Kestra y un endpoint HTTP publico. Una red
privada administrada o un endpoint TLS autenticado simplificaria posteriormente
el transporte; requiere una decision separada y cambiar el URL del consumidor.

## Pruebas locales

Desde la raiz del repositorio:

```bash
python -m unittest discover -s infra/ansible/tests -p test_bcra_private_link.py -v
```

Las pruebas usan loopback y fixtures sinteticos, sin SSH, Docker real, datos BCRA
ni acceso a produccion. Validan stream binario y half-close, limite de conexiones,
timeout de inactividad, ausencia de reintentos, guardas de escritura, restricciones
de SSH, deriva de privilegios y apply idempotente. El parser de Python comprueba
ademas la gramatica 3.6. Lint y pruebas no sustituyen el apply/verify autorizado.
