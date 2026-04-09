# Transferencias Celesol

Cliente desktop en Rust para operar solicitudes del core financiero en estado `A Transferir`.

## Estado de este corte

- UI nativa con `egui/eframe`
- polling simple del core financiero para reconstruir la lista de trabajo
- lookup de validaciones MetaMap via `metamap-platform/server`
- consumo de datos MetaMap ya enriquecidos por `metamap-platform/server`
- validaciones bloqueantes de:
  - solicitud en `A Transferir`
  - validacion MetaMap `completed` disponible en el server
  - `Prestamo.[CBU transferencia]`
  - documento MetaMap vs core
  - monto exacto MetaMap vs core
  - titularidad Coinag via CUIL/CUIT
- barrera local anti reenvio por `request_oid` en archivo persistido
- envio a Coinag si el runtime esta configurado
- generacion de comprobante PDF simple

## Variables de entorno minimas

La app ahora puede cargar configuracion desde un archivo plaintext estilo `.env`.

Busqueda por defecto:

1. `transferencias.env` al lado del `.exe`
2. `transferencias.env` en el directorio actual

Tambien se puede forzar otra ruta con la variable de entorno del sistema:

- `TRANSFERENCIAS_CONFIG_PATH`

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

Coinag para habilitar `Transferir`:

- `TRANSFERENCIAS_COINAG_TRANSFER_API_BASE` base `v2` para `Transferencia`
- `TRANSFERENCIAS_COINAG_LOOKUP_API_BASE` base `v1` para consultas `Consulta/CBU/...`
- `TRANSFERENCIAS_COINAG_TOKEN_URL`
- `TRANSFERENCIAS_COINAG_USERNAME`
- `TRANSFERENCIAS_COINAG_PASSWORD`
- `TRANSFERENCIAS_COINAG_CUIT_DEBITO`
- `TRANSFERENCIAS_COINAG_CBU_DEBITO`
- `TRANSFERENCIAS_COINAG_TITULAR_DEBITO`

Compatibilidad:

- `TRANSFERENCIAS_COINAG_API_BASE` sigue funcionando como alias legacy para ambos caminos
- si no definis `TRANSFERENCIAS_COINAG_LOOKUP_API_BASE`, la app reutiliza la base de transferencia

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

Para runtime local o productivo, copia `transferencias.env.example` a `transferencias.env` y completalo al lado del ejecutable.

## Logs de debug

En builds `debug`, la app escribe logs descriptivos por defecto en:

- `target/debug/logs/transferencias-debug.log`

Si queres cambiar la ubicacion, defini:

- `TRANSFERENCIAS_DEBUG_LOG_PATH`

## Probe SSH

Para validar el camino `cliente Rust -> SSH -> VPS -> banco`, hay un binario de prueba:

```powershell
cargo run --bin coinag_ssh_probe
```

Toma `TRANSFERENCIAS_COINAG_PROBE_URL` y, si no esta, usa `TRANSFERENCIAS_COINAG_TOKEN_URL`.

## Nota operativa

Este binario no versiona secretos. La configuracion real debe quedar fuera de Git y cargarse via `transferencias.env` o variables de entorno del runtime local.

El archivo local de solicitudes ya transferidas bloquea reenvios desde esa misma instalacion. No coordina automaticamente entre PCs distintas.
