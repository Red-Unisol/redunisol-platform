# Contabilidad

Dominio para automatizaciones especificas de contabilidad.

## Transfer Vimarx

Flow principal:

- `contabilidad_transfer_vimarx_diario`
- namespace runtime por ambiente: `redunisol.<env>.contabilidad`
- schedule prod: todos los dias a las 08:30 `America/Argentina/Buenos_Aires`

Proceso:

1. descarga desde SFTP los archivos `mov_emp_431*.txt` de la raiz remota
2. excluye `mov_emp_mes_*`
3. conserva todos los movimientos bancarios, incluso los que no informan CUIT
4. ejecuta el cruce contra la API Vimarx solo para movimientos con CUIT valido
5. deja vacias las columnas Vimarx cuando no existe una coincidencia confiable
6. genera dos Excel por fecha de corrida:
   - `cruce_mov_emp_vimarx_YYYYMMDD.xlsx`
   - `cruce_mov_emp_vimarx_altos_YYYYMMDD.xlsx`
7. guarda `metadata.json` junto al output, incluyendo conteos de movimientos sin
   CUIT y sin importe interpretable

El Excel completo usa Coinag como fuente principal: contiene una fila por cada
movimiento leido. Los movimientos que no pueden consultarse en Vimarx se marcan
como `sin_cuit_para_consultar`; los candidatos Vimarx no confiables no completan
las columnas de socio, solicitud o prestamo.

Storage esperado en VPS:

```text
/opt/kestra/data/contabilidad-transfer/YYYY-MM-DD/
```

El task Docker monta esa ruta como:

```text
/data/contabilidad-transfer
```

Secrets requeridos en Kestra:

- `CONTABILIDAD_SFTP_HOST`
- `CONTABILIDAD_SFTP_USERNAME`
- `CONTABILIDAD_SFTP_PASSWORD`
- `DEVEXPRESS_EVALUATE_API_BASE_URL`

Frontend oculto:

```text
/contabilidad/77q330j56z
```

El slug puede cambiarse en `web/herramientas` con `CONTABILIDAD_TRANSFER_PRIVATE_SLUG`.

## Informe diario de transferencias de la app

Flow principal:

- `transfer_trace_report_daily`
- namespace runtime por ambiente: `redunisol.<env>.contabilidad`
- schedule prod: todos los días a las 10:00 `America/Argentina/Buenos_Aires`
- fecha informada por defecto: el día calendario anterior

La fuente única es `MetaMap Platform Server /api/v1/transfer-trace-events`.
Desde Transferencias Celesol 2.0.1, la app emite una observación por sesión y OID
cuando una solicitud aparece en `A Transferir`. El informe reconstruye desde esas
observaciones el universo de solicitudes y considera **No realizada vía app** a
toda solicitud observada que no tenga una transferencia confirmada por la app.

El informe muestra:

- solicitudes nuevas observadas y backlog no realizado vía app
- transferencias y cancelaciones manuales y automáticas
- tiempos promedio desde la primera detección en `A Transferir` hasta que la
  solicitud queda marcada como `Pagada`, por modalidad y para cancelaciones
- intentos bloqueados, pendientes o con registro final pendiente
- volumen de eventos técnicos por tipo

Storage publicado:

```text
/srv/redunisol-reports/contabilidad/transferencias-app/ultimo.xlsx
/srv/redunisol-reports/contabilidad/transferencias-app/historico/YYYY-MM-DD.xlsx
/srv/redunisol-reports/contabilidad/transferencias-app/ultimo.json
/srv/redunisol-reports/contabilidad/transferencias-app/metadata/YYYY-MM-DD.json
```

Para reejecutar una fecha desde Kestra, completar `run_date=YYYY-MM-DD`. El
reporte consulta desde `transfer_trace_coverage_from` hasta el cierre de esa fecha
para reconstruir el backlog. Antes de que exista al menos un evento
`transfer_candidate_observed`, el indicador se muestra como `Sin cobertura`, no
como cero.

Los tiempos operativos requieren los dos extremos para cada OID:
`transfer_candidate_observed` y `mark_paid_request_succeeded`. El tiempo técnico
del intento dentro de la app se conserva en el detalle, pero no alimenta los
promedios del resumen.

Configuración requerida en el runtime Kestra:

- `ENV_TRANSFERENCIAS_SERVER_BASE_URL`
- `ENV_TRANSFER_TRACE_COVERAGE_FROM`
- `SECRET_TRANSFERENCIAS_SERVER_CLIENT_ID`
- `SECRET_TRANSFERENCIAS_SERVER_CLIENT_SECRET`

El Excel no exporta CBU, CUIL, documento, payloads ni respuestas HTTP crudas.
