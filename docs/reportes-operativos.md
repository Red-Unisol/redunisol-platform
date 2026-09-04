# Reportes Operativos Recurrentes

## Objetivo

Este documento define el patrón de la monorepo para informes programados. El
Excel es una salida derivada: la fuente de verdad continúa siendo el sistema
operativo que origina cada dato.

## Patrón recomendado

Cada informe recurrente debe separar cinco responsabilidades:

1. **Extracción:** consultar la fuente primaria con fecha y zona horaria
   explícitas, paginación completa, timeout y reintentos acotados.
2. **Normalización:** convertir IDs a texto, fechas a valores tipados y métricas
   a números.
3. **Cálculo:** declarar el universo, reglas de agrupación, deduplicación y
   condiciones de cobertura. Una fuente ausente nunca equivale a cero.
4. **Presentación:** incluir resumen ejecutivo, detalle auditable, metodología y
   visualizaciones sólo cuando faciliten una comparación.
5. **Publicación:** escribir primero a un temporal, reemplazar de forma atómica
   el histórico y `ultimo.xlsx`, y guardar metadata JSON.

## Convenciones de fecha

- Zona horaria de negocio: `America/Argentina/Buenos_Aires`.
- Un día cubre `[00:00:00, 23:59:59.999999]` de la fecha informada.
- Los schedules que requieren un día completo informan el día anterior.
- Todo flow diario acepta `run_date=YYYY-MM-DD` para backfills determinísticos.
- Si una métrica reconstruye estado acumulado, consulta desde una fecha de
  cobertura documentada hasta el cierre del día informado.

## Publicación y retención

```text
/srv/redunisol-reports/<dominio>/<informe>/ultimo.xlsx
/srv/redunisol-reports/<dominio>/<informe>/historico/YYYY-MM-DD.xlsx
/srv/redunisol-reports/<dominio>/<informe>/ultimo.json
/srv/redunisol-reports/<dominio>/<informe>/metadata/YYYY-MM-DD.json
```

La metadata mínima incluye fecha informada, generación, cobertura, conteos
principales y paths publicados. Los históricos no se borran desde el generador.

## Diseño del Excel

- `Resumen`: indicadores, unidades y definiciones breves.
- `Detalle`: una fila por unidad de negocio para auditar el resumen.
- `Eventos técnicos` o `Calidad`: estados, errores y cobertura.
- `Metodología`: definición exacta de cada métrica y fuente usada.

Los informes privados aplican minimización de datos. No se copian secretos,
tokens, payloads crudos, CBU, CUIL o documentos salvo necesidad aprobada.

## Métricas negativas

Una métrica como “no realizado vía app” necesita un evento que defina el
universo, no sólo eventos de operaciones exitosas. Su fórmula conceptual es:

```text
no realizados vía app = OID observados en el universo - OID transferidos vía app
```

Debe documentarse el evento de ingreso al universo, el evento terminal, la
deduplicación y la fecha desde la que ambos están disponibles. Sin esa señal, el
resultado se muestra como `Sin cobertura`, nunca como `0`.

## Implementación en Kestra

- Código: `kestra/automations/<dominio>/files/<informe>/`.
- Flow: `kestra/automations/<dominio>/flows/<informe>.yaml`.
- Pruebas: `kestra/automations/<dominio>/tests/`.
- El flow monta `/srv/redunisol-reports:/reports` para publicar.
- Configuración no sensible: `envs.*`; credenciales: `secret(...)`.
- Las claves también se declaran en `.env.example`, `docker-compose.yml` y el
  runtime cifrado Git-managed.

Validaciones mínimas:

```bash
python -m unittest discover -s kestra/automations/<dominio>/tests -p "test_*.py"
python kestra/tools/validate_kestra.py
python kestra/tools/deploy_kestra.py --environment dev --domain <dominio> --dry-run
```

También se abre un Excel generado y se revisan todas las hojas, encabezados,
gráficos, errores de fórmula y presencia inesperada de datos sensibles.

## Informe de transferencias

La implementación vigente vive en `contabilidad`. Su contrato específico está
en `kestra/automations/contabilidad/docs/README.md`, sección **Informe diario de
transferencias de la app**.
