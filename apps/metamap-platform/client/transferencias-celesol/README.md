# Transferencias Celesol

Cliente desktop en Rust para la cola `transferencias_celesol`.

## Estado de este corte

- UI nativa con `egui/eframe`
- polling simple del server para mantener actualizada la cola
- hidratacion inicial desde MetaMap
- refresh manual solo desde el core financiero
- validaciones bloqueantes de:
  - solicitud en `A Transferir`
  - `Prestamo.[CBU transferencia]`
  - documento MetaMap vs core
  - monto exacto MetaMap vs core
  - titularidad Coinag via CUIL/CUIT
- lock previo en server con `transfer_initiated`
- envio a Coinag si el runtime esta configurado
- generacion de comprobante PDF simple

## Variables de entorno minimas

Obligatorias:

- `TRANSFERENCIAS_SERVER_BASE_URL`
- `TRANSFERENCIAS_SERVER_CLIENT_ID`
- `TRANSFERENCIAS_SERVER_CLIENT_SECRET`
- `TRANSFERENCIAS_METAMAP_API_TOKEN`

Opcionales frecuentes:

- `TRANSFERENCIAS_CORE_BASE_URL`
- `TRANSFERENCIAS_OPERATOR_NAME`
- `TRANSFERENCIAS_POLL_INTERVAL_SECONDS`
- `TRANSFERENCIAS_RECEIPTS_DIR`

Coinag para habilitar `Transferir`:

- `TRANSFERENCIAS_COINAG_API_BASE`
- `TRANSFERENCIAS_COINAG_TOKEN_URL`
- `TRANSFERENCIAS_COINAG_USERNAME`
- `TRANSFERENCIAS_COINAG_PASSWORD`
- `TRANSFERENCIAS_COINAG_CUIT_DEBITO`
- `TRANSFERENCIAS_COINAG_CBU_DEBITO`
- `TRANSFERENCIAS_COINAG_TITULAR_DEBITO`

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

## Probe SSH

Para validar el camino `cliente Rust -> SSH -> VPS -> banco`, hay un binario de prueba:

```powershell
cargo run --bin coinag_ssh_probe
```

Toma `TRANSFERENCIAS_COINAG_PROBE_URL` y, si no esta, usa `TRANSFERENCIAS_COINAG_TOKEN_URL`.

## Nota operativa

Este binario no versiona secretos. La configuracion real debe quedar fuera de Git y cargarse via variables de entorno del runtime local.
