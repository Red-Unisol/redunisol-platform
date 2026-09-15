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

El flow `form_management_report_daily` genera el informe de formulario a Bitrix semanalmente, los sábados a las 12:00 (zona `America/Argentina/Buenos_Aires`, cron `0 12 * * 6`). Conserva los identificadores históricos del flow y del trigger. Mantiene el acumulado completo disponible de `bitrix24_form_webhook`, sin recortarlo a siete dias. Recupera los resultados por ID de ejecucion mediante la API de outputs de Kestra 2.0 y usa exclusivamente la precalificacion incluida en el propio formulario. No consulta ni reconstruye persistencias o precalificaciones legacy. Reemplaza `ultimo.xlsx` de forma atomica.

### Alcance y limites del informe de formularios

- El periodo es el acumulado **disponible en Kestra**, con fecha de corte al iniciar la consulta, no una ventana semanal. Se explicita la fecha superior para desactivar el filtro reciente implicito de la API; no se aplica fecha inferior.
- La programacion sigue siendo sabados a las 12:00 Buenos Aires. Las fechas de las filas se convierten a esa misma zona.
- La consulta usa `filters[namespace][EQUALS]` y `filters[flowId][EQUALS]`. Cada pagina se valida contra ambos, su total y los IDs ya leidos. Una respuesta ajena, duplicada, truncada o cambiante aborta la publicacion.
- Los resultados se leen en `/api/v1/{tenant}/outputs/executions/{executionId}`, con hasta cuatro consultas simultaneas y sin descargar logs. No se emparejan formularios por provincia, banco o cercania temporal.
- Sin precalificacion incluida: **Sin precalificacion disponible**. Sin outputs en una ejecucion exitosa: **Sin trazabilidad disponible**. No se inventa un rechazo o un vinculo con otro formulario. Los errores de lectura de API abortan; no se confunden con outputs vacios validos.
- Los resultados describen el envio del formulario, no el estado comercial actual del lead. La hoja **Sin lead confirmado** contiene casos sin un ID confirmado, que no necesariamente significan que nunca se haya creado el lead.
- Los historicos publicados de fechas anteriores se conservan. No se reconstruyen datos que Kestra ya haya purgado ni se incorporan archivos Excel anteriores como fuente de nuevas cifras.
- Maximo 50.000 formularios por corrida, plazo interno de 14 minutos y timeout de tarea de 15 minutos. Se cancela al excederlos, sin truncar el acumulado ni reemplazar el ultimo archivo valido.
- Una sola corrida activa; solicitudes simultaneas se cancelan. Contenedor limitado a 0,5 CPU y 1 GB de memoria, sin swap adicional.
- Los logs informan cantidades descargadas, avance de outputs y duracion final, sin documentos ni datos personales.

Validacion operativa: contrastar cantidad de formularios y leads unicos con la API,
verificar las cinco hojas y sus totales y comprobar publicacion atomica. Una corrida
fallida deja intacto `ultimo.xlsx`; revisar el error antes de repetir.

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

## Evaluación y comisiones

El flow adicional `reporte_evaluacion_comisiones_management` publica en
`analisis-credito/reporte-evaluacion-comisiones/`, con su propio `ultimo.xlsx`
e histórico por ejecución. Corre el día 1 a las 08:15 Buenos Aires y admite
los mismos meses cerrados que el evaluatorio anterior. Ambos reportes tienen
su propia tarjeta en Gestión > Reportes y mantienen sus salidas independientes.

Incluye objetivos sobre los tres meses anteriores, feriados nacionales
obligatorios y comisiones sobre la colocación consultada por API. Los 30
legajos se seleccionan al azar exclusivamente del último mes analizado; el
operador marca Correcto, Incorrecto o A revisar en Muestreo legajos. Al resolver los 30 se calcula la comisión
y, si las demás métricas están completas, el total definitivo. La carpeta privada `datos/` conserva
SQLite y JSON de cada ejecución y no se muestra entre los archivos descargables.

Ver [reglas y mantenimiento del calendario](../kestra/automations/analisis-credito/docs/README.md#reporte_evaluacion_comisiones_management).

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
