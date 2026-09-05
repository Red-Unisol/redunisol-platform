# Reportes privados

## Arquitectura

- Kestra genera los archivos y escribe en `/srv/redunisol-reports`.
- El contenedor Laravel monta esa carpeta en `/var/www/reports` como solo lectura.
- Filament muestra los archivos en **Gestión > Reportes**.
- La descarga pasa por Laravel y exige una sesión autenticada; Apache no publica la carpeta.

Formatos visibles: `.xlsx`, `.xls`, `.csv` y `.pdf`.

## Estructura recomendada

```text
/srv/redunisol-reports/
  marketing/
    formulario-bitrix/
      ultimo.xlsx
      historico/
        2026-08-05.xlsx
```

Cada flow debe escribir primero un archivo temporal y renombrarlo al finalizar, para que management nunca descargue un archivo incompleto.

El flow `form_management_report_daily` genera el informe de formulario a Bitrix todos los días a las 07:15 (hora de Buenos Aires). Consulta tanto el flow principal como las subejecuciones históricas de persistencia y reemplaza `ultimo.xlsx` de forma atómica.

## Preparación de la VPS

El volumen `/srv/redunisol-reports` reside en la **VPS PRINCIPAL / DATTAWEB**,
segun el nombre del bloque en `credentials.txt`. Para inspeccionar o descargar
reportes por SSH, usar ese bloque y su comando exacto. La **VPS DE ALTA
SEGURIDAD / DATTAWEB** no aloja este volumen.

Ejecutar una sola vez:

```bash
sudo install -d -m 0775 /srv/redunisol-reports
```

Después se despliegan por sus circuitos habituales la infraestructura de Kestra y la aplicación web. El cambio no requiere S3, SMB ni un servicio adicional.

El runtime de Kestra requiere estas variables:

- `ENV_REPORTS_KESTRA_URL`
- `ENV_REPORTS_KESTRA_TENANT`
- `SECRET_REPORTS_KESTRA_USERNAME`
- `SECRET_REPORTS_KESTRA_PASSWORD`

## Volumen en un task runner de Kestra

Los flows que generen reportes con Docker deben montar explícitamente el directorio del host:

```yaml
taskRunner:
  type: io.kestra.plugin.scripts.runner.docker.Docker
  volumes:
    - "/srv/redunisol-reports:/reports"
```

El archivo final se escribe bajo `/reports/<dominio>/<reporte>/`. El bind mount del servicio Kestra permite además inspeccionar la carpeta como `/reports` desde el contenedor principal.

## Reporte evaluatorio

El flow `reporte_evaluacion_management` genera el acumulado desde octubre de 2025 hasta el ultimo mes cerrado. Corre el dia 1 de cada mes a las 07:15 (hora de Buenos Aires) y publica:

```text
/srv/redunisol-reports/
  analisis-credito/
    reporte-evaluacion/
      ultimo.xlsx
      historico/
        YYYY-MM-DD.xlsx
```

Tambien puede iniciarse desde Kestra con inputs opcionales `from_month` y `to_month`, o mediante su webhook asincrono. El webhook acepta un objeto JSON opcional como `{"from_month":"2026-01","to_month":"2026-07"}`; sin body usa el periodo acumulado por defecto. Solo admite meses cerrados.

## Topes mensuales de Caja

El flow `tope_descuento_caja_mensual` corre el dia 1 de cada mes a las 05:00
(hora de Buenos Aires). Toma los CUILs elegibles desde Core/Vimarx y Bitrix,
consulta Caja una sola vez por CUIL deduplicado y publica:

```text
/srv/redunisol-reports/
  analisis-credito/
    tope-descuento-caja/
      ultimo.xlsx
      historico/
        YYYY-MM.xlsx
      .state/
        YYYY-MM.jsonl
```

El checkpoint permite reanudar una corrida cortada sin repetir respuestas
definitivas. Filament ignora `.jsonl`, por lo que el estado intermedio no aparece
en **Gestion > Reportes**. Una corrida con `limit`, errores tecnicos pendientes o
corte por rate limit no publica ni reemplaza los Excel visibles.
