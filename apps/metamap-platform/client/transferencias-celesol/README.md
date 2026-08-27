# Transferencias Celesol

Cliente desktop en Rust para operar solicitudes del core financiero en estado `A Transferir`.

## Estado de este corte

- UI nativa con `egui/eframe`
- polling simple del core financiero para reconstruir la lista de trabajo
- lookup de validaciones MetaMap via `metamap-platform/server`
- consumo de datos MetaMap ya enriquecidos por `metamap-platform/server`
- validaciones bloqueantes de:
  - solicitud en `A Transferir`
  - `Prestamo.[CBU transferencia]`
  - titularidad Coinag via CUIL/CUIT
- configuracion unificada de lineas por ID estable, editable desde la aplicacion
- transferencia automatica habilitada/pausada para lineas marcadas como automaticas
- validacion MetaMap faltante tratada como advertencia con confirmacion explicita al transferir
- si existe validacion MetaMap `completed`, siguen aplicando los cruces bloqueantes de:
  - documento MetaMap vs core
  - monto exacto MetaMap vs core
- barrera local anti reenvio por `request_oid` en archivo persistido
- envio a Coinag si el runtime esta configurado
- generacion de comprobante PDF simple
- carga del comprobante confirmado en el core y marcado de la solicitud como `Pagada`

## Variables de entorno minimas

La app puede cargar configuracion desde archivo:

- en `debug`, por defecto desde `transferencias.env`
- en builds no-debug, por defecto desde `transferencias.env.enc`

Busqueda por defecto:

1. archivo al lado del `.exe`
2. archivo en el directorio actual

Tambien se puede forzar otra ruta con la variable de entorno del sistema:

- `TRANSFERENCIAS_CONFIG_PATH`
- `TRANSFERENCIAS_CONFIG_PASSPHRASE` si queres pasar la passphrase por entorno

Si existen variables de entorno del proceso y tambien archivo, las variables del proceso pisan al archivo.

Ejemplo versionado:

- `transferencias.env.example`

Obligatorias:

- `TRANSFERENCIAS_SERVER_BASE_URL`
- `TRANSFERENCIAS_SERVER_CLIENT_ID`
- `TRANSFERENCIAS_SERVER_CLIENT_SECRET`

Opcionales frecuentes:

- `TRANSFERENCIAS_CORE_BASE_URL`
- `TRANSFERENCIAS_MARK_PAID_ENDPOINT` default `https://celesol.dyndns.org:35010/api/Transferencias/marcar-pagada`
- `TRANSFERENCIAS_MARK_PAID_AUTH_TOKEN` token Bearer requerido para registrar el comprobante
- `TRANSFERENCIAS_MARK_PAID_ALLOW_INVALID_CERTS` default `true`
- `TRANSFERENCIAS_OPERATOR_NAME`
- `TRANSFERENCIAS_POLL_INTERVAL_SECONDS` default `20`
- `TRANSFERENCIAS_RECEIPTS_DIR`
- `TRANSFERENCIAS_AUTO_RECEIPTS_DIR` default `receipts-automaticas`
- `TRANSFERENCIAS_SMOKE_TRANSFERS_DIR` default `smoke-transfers`
- `TRANSFERENCIAS_LINEAS_CONFIG_PATH` default `lineas.toml` junto a la configuracion

Configuracion de lineas:

- `lineas.toml` reemplaza los archivos historicos `lineas_habilitadas` y `lineas_automaticas`
- la identidad se resuelve exclusivamente por `LineaPrestamo.ID`; codigo y descripcion son informativos
- si el archivo no existe, se consultan las lineas con solicitudes en los ultimos tres meses y todas se crean `inhabilitada`
- `Configurar lineas` permite elegir `Inhabilitada`, `Habilitada` o `Automatica`
- `Refrescar desde el core` conserva el modo de IDs que siguen activos, actualiza sus metadatos, incorpora IDs nuevos inhabilitados y retira los que ya no tienen actividad en la ventana de tres meses
- el orden del archivo no modifica el comportamiento
- el guardado crea `lineas.toml.bak` y reemplaza el archivo principal de forma atomica

Si no hay ninguna linea marcada como automatica, el control habilitado/pausado queda deshabilitado.
Cada apertura de la app comienza con las transferencias automaticas pausadas. Al habilitarlas, procesa una solicitud elegible por vez; al pausarlas, deja terminar la transferencia en curso y no comienza la siguiente.
Las automaticas solo corren si la solicitud esta verde, sin warnings ni bloqueos, con MetaMap `completed`.
Los comprobantes de automaticas se generan en `TRANSFERENCIAS_AUTO_RECEIPTS_DIR`, separado de los comprobantes manuales.

Registro del comprobante en el core:

- se ejecuta solo cuando Coinag confirma la transferencia y el PDF se genero correctamente
- envia el OID unico dentro de la propiedad `numeroSolicitud`
- considera exitosa solamente una respuesta HTTP `200`
- ante otro estado HTTP, timeout o error de red, informa que la transferencia bancaria fue realizada pero el registro en el core requiere revision; nunca sugiere repetir la transferencia
- los comprobantes rechazados y los smoke de debug no se envian al endpoint de marcado

Coinag para habilitar `Transferir`:

- `TRANSFERENCIAS_COINAG_TRANSFER_API_BASE` base `v2` para `Transferencia`
- `TRANSFERENCIAS_COINAG_LOOKUP_API_BASE` base `v1` para consultas `Consulta/CBU/...`
- `TRANSFERENCIAS_COINAG_BALANCE_API_BASE` base para consultar `SaldoActual`
- `TRANSFERENCIAS_COINAG_TOKEN_URL`
- `TRANSFERENCIAS_COINAG_USERNAME`
- `TRANSFERENCIAS_COINAG_PASSWORD`
- `TRANSFERENCIAS_COINAG_CUIT_DEBITO`
- `TRANSFERENCIAS_COINAG_CBU_DEBITO`
- `TRANSFERENCIAS_COINAG_TITULAR_DEBITO`

Compatibilidad:

- `TRANSFERENCIAS_COINAG_API_BASE` sigue funcionando como alias legacy para ambos caminos
- si no definis `TRANSFERENCIAS_COINAG_LOOKUP_API_BASE`, la app reutiliza la base de transferencia
- si no definis `TRANSFERENCIAS_COINAG_BALANCE_API_BASE`, la app reutiliza la base de lookup

SSH opcional para llegar a Coinag via la VPS:

- `TRANSFERENCIAS_COINAG_SSH_ENABLED=true`
- `TRANSFERENCIAS_COINAG_SSH_HOST`
- `TRANSFERENCIAS_COINAG_SSH_PORT`
- `TRANSFERENCIAS_COINAG_SSH_USER`
- `TRANSFERENCIAS_COINAG_SSH_PRIVATE_KEY_PATH`
- `TRANSFERENCIAS_COINAG_SSH_HOST_PUBLIC_KEY_PATH`
- `TRANSFERENCIAS_COINAG_SSH_ORIGINATOR_ADDRESS` opcional

## Ejecutar

```powershell
cargo run
```

Para debug local, copia `transferencias.env.example` a `transferencias.env` y completalo al lado del ejecutable.

Para builds no-debug:

1. completa `transferencias.env`
2. genera `transferencias.env.enc`
3. distribui solo `transferencias.env.enc`
4. al abrir la app:
   - o ingresa la passphrase en la ventanita inicial
   - o defini `TRANSFERENCIAS_CONFIG_PASSPHRASE` si queres evitar el prompt

Herramienta incluida para cifrar:

```powershell
cargo run --bin encrypt_transferencias_env -- --input transferencias.env --output transferencias.env.enc
```

## Build local de paquete

Para armar un zip local con el `.exe`, el entorno encriptado y las keys SSH, usa:

```powershell
.\build-package.ps1
```

El script busca estos archivos locales dentro de `package-input/`:

- `package-input/transferencias.env.enc`
- `package-input/ssh/coinag_tunnel_key`
- `package-input/ssh/vps_host_key.pub`

El zip se genera en `dist/`.

Recomendacion importante para que el paquete funcione sin tocar rutas por instalacion:

- en `transferencias.env.enc`, defini `TRANSFERENCIAS_COINAG_SSH_PRIVATE_KEY_PATH=ssh/coinag_tunnel_key`
- en `transferencias.env.enc`, defini `TRANSFERENCIAS_COINAG_SSH_HOST_PUBLIC_KEY_PATH=ssh/vps_host_key.pub`

Asi las rutas quedan relativas al archivo `transferencias.env.enc` que viaja dentro del mismo zip.

## Logs

La app escribe logs descriptivos por defecto en:

- en builds `debug`: `target/debug/logs/transferencias-debug.log`
- en builds no-debug: `logs/transferencias.log` al lado del `.exe`

Si queres cambiar la ubicacion, defini:

- `TRANSFERENCIAS_DEBUG_LOG_PATH`

Cada transferencia deja eventos JSON correlacionables en ese mismo archivo con el target
`transfer_audit`. La traza incluye:

- solicitud, operador, tipo manual/automatico y snapshots usados para validar
- payload completo enviado a Coinag
- respuesta inicial completa
- `idTrxCliente` e `idCoelsa`
- clasificacion inicial y resultado de cada intento de confirmacion
- resultado final y ruta o error de generacion del PDF
- inicio, resultado HTTP y body de respuesta del marcado como pagada
- tamaño y SHA-256 del PDF enviado al core

Los requests y responses operativos de Coinag tambien se registran completos con el target
`coinag_http`. Se omiten solamente el body OAuth, tokens, passwords y claves SSH.

## Smoke en debug

En builds `debug`, el boton `Transferir` no pega al endpoint real de transferencia de Coinag.

En su lugar:

- escribe el body JSON que se habria enviado a Coinag en `smoke-transfers/`
- genera comprobante igual
- no registra la solicitud como transferida real en el log local

Si queres cambiar esa carpeta, defini:

- `TRANSFERENCIAS_SMOKE_TRANSFERS_DIR`

## Saldo actual

Si `TRANSFERENCIAS_COINAG_BALANCE_API_BASE` esta configurada, la app consulta `SaldoActual` del banco:

- al iniciar
- cada 60 segundos
- despues de cada transferencia o smoke

La UI muestra siempre el valor de `SaldoActual`. No usa fallback a `SaldoDisponible`.

## idTrxCliente

Si `TRANSFERENCIAS_COINAG_ID_EMPRESA` esta configurado, `idTrxCliente` se arma como:

- `ID_EMPRESA`
- mas `numero_de_solicitud + "0"`
- left-padded a 15 digitos

Ejemplo:

- empresa `123`
- solicitud `234567`
- resultado `123000000002345670`

Si `ID_EMPRESA` no esta configurado, la app usa un fallback textual con `request_oid`, `verification_id` y timestamp UTC.

## Probe SSH

Para validar el camino `cliente Rust -> SSH -> VPS -> banco`, hay un binario de prueba:

```powershell
cargo run --bin coinag_ssh_probe
```

Toma `TRANSFERENCIAS_COINAG_PROBE_URL` y, si no esta, usa `TRANSFERENCIAS_COINAG_TOKEN_URL`.

## Nota operativa

Este binario no versiona secretos. La configuracion real debe quedar fuera de Git y cargarse via `transferencias.env` o variables de entorno del runtime local.

En builds no-debug, si la configuracion viene desde archivo, ese archivo debe estar cifrado como `transferencias.env.enc`.

Antes de habilitar `Transferir`, la app consulta Coinag por `idTrxCliente` derivado del numero de solicitud:

- si Coinag responde `SIN_REGISTROS`, permite transferir
- si Coinag responde estado `1`, bloquea como `YA TRANSFERIDA`
- si Coinag responde estado `2`, bloquea como `NO COMPLETADA`
- si Coinag responde estado `3`, bloquea como `EN PROCESO` y el polling periodico vuelve a consultar
- para cualquier otra respuesta, bloquea como `ERROR`

La confirmacion por estado Coelsa reconoce:

- `00` o `ACREDITADO / 0600`: transferencia confirmada
- `0601`, `0602`, `0612`, `2100` o `2000`: transferencia pendiente; continua el polling
- estados explicitos de error/rechazo/no completada: transferencia rechazada
- estados desconocidos: se mantienen pendientes para evitar falsos rechazos
