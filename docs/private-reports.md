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
