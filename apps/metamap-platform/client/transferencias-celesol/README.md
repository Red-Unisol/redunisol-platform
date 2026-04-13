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
- validacion MetaMap faltante tratada como advertencia con confirmacion explicita al transferir
- si existe validacion MetaMap `completed`, siguen aplicando los cruces bloqueantes de:
  - documento MetaMap vs core
  - monto exacto MetaMap vs core
- barrera local anti reenvio por `request_oid` en archivo persistido
- envio a Coinag si el runtime esta configurado
- generacion de comprobante PDF simple

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
- `TRANSFERENCIAS_OPERATOR_NAME`
- `TRANSFERENCIAS_POLL_INTERVAL_SECONDS` default `20`
- `TRANSFERENCIAS_RECEIPTS_DIR`
- `TRANSFERENCIAS_COMPLETED_LOG_PATH`
- `TRANSFERENCIAS_SMOKE_TRANSFERS_DIR` default `smoke-transfers`

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

El archivo local de solicitudes ya transferidas bloquea reenvios desde esa misma instalacion. No coordina automaticamente entre PCs distintas.

Ese registro local tambien guarda, para cada transferencia real:

- `external_transfer_id`
- el JSON completo de respuesta exitosa de Coinag

Con el shape observado en produccion, `external_transfer_id` se toma de `debito.idTrx`.
