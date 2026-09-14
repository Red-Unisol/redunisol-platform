# Policía Federal + CABA — apertura comercial

Versión: `2026-09-14`. Estado: **implementado, pendiente de deploy**.

## Identificación y aprobación

- Solicitud: tarea Bitrix24 `22889`, Marketing / Comercial (Maru Lopez).
- Proceso: precalificación y distribución. Apertura requerida: 14/09/2026.
- Autorización de implementación: Santiago Acosta, 14/09/2026.
- Canal: WhatsApp habitual de la web, confirmado por Santiago en la misma fecha.
- Regla afectada: final del período inicial de Policía Federal + CABA.

## Decisión y condiciones

Las presentaciones nuevas de Policía Federal con residencia en CABA desde el
14/09/2026 califican para medición, muestran el botón habitual de WhatsApp y pueden
continuar como negociación interna de Bitrix. No se reprocesa la cohorte inicial.
La fecha se interpreta en `America/Argentina/Buenos_Aires`; para clasificar un lead
existente se utiliza su `DATE_CREATE`.

| Regla | Provincia | Situación laboral | Fecha local | Banco, afiliación y créditos | Resultado |
|---|---|---|---|---|---|
| `PFC-PRE-010` | CABA | Policía Federal | 31/08 al 13/09 inclusive | Cualquiera | Medición positiva, sin WhatsApp; perdido con motivo 4175 |
| `PFC-PRE-020` | CABA | Policía Federal | Desde 14/09 | Cualquier banco válido del catálogo; afiliación y créditos no restringen precalificación | Calificado, WhatsApp y negociación interna |
| `PFC-PRE-030` | Otra provincia o situación laboral | Cualquiera | Cualquiera | Según reglas vigentes | Conserva sus reglas; no extiende el convenio |

## Clasificación y distribución

La precalificación habilita la gestión, no aprueba un crédito. Como la solicitud no
define una línea ni criterios crediticios del convenio, aplica la política general
de revisión manual: `policia_federal_caba_requires_commercial_review`, etapa
**REVISIÓN MANUAL KESTRA**, sin línea automática ni cierre automático. Se conservan
las consultas, reintentos y motivos de datos pendientes de BCRA/Vimarx del circuito.
No se aplican las tablas de aprobación o rechazo de Córdoba ni Catamarca.

Regla `PFC-ROUTE-010`: bucket `policia_federal_caba`, responsable inicial Stefania
Salguero (`8057`, cuenta activa verificada por API). El pool puede editarse o pausarse
desde **Configuración > Distribución Bitrix** sin cambiar el flujo ni otros pools.
Fallback de código: únicamente `8057`; un pool vacío explícito se respeta.

Se conserva la ventana semanal, la cola por falta de vendedores online y la
transferencia del chat del canal habitual. Fuera de horario queda con Maru según la
regla general. Una fecha de creación ausente o inválida no habilita este bucket.

## Formulario

CABA pasa a las provincias principales y La Rioja pasa a otras provincias. Este
cambio de ubicación no altera las reglas comerciales de La Rioja.

## Casos de aceptación

- `13/09 23:59:59 -03`: medición positiva, rechazo inicial, sin WhatsApp ni vendedor.
- `14/09 00:00:00 -03` (03:00 UTC): calificado y WhatsApp habilitado.
- Policía Federal + Buenos Aires, o Policía común + CABA: no ingresan al convenio.
- Lead nuevo calificado: negociación pendiente de Kestra y luego revisión con Stefania.
- Stefania online dentro de horario: responsable sincronizado en lead/negociación y chat transferido.
- Stefania offline: cola del segmento; al volver online, revisión asignada a Stefania.
- Fecha anterior al 14/09, ausente o inválida: sin nueva distribución automática del segmento.
- Aprobación crediticia o rechazo BCRA específico: no definidos; evaluación manual.

## Implementación

- Catálogos: provincia `4145`, situación laboral `4165`, motivo inicial `4175`.
- Pruebas: `test_business_logic.py` (frontera temporal, clasificación, conversión,
  asignación, chat y cola) y `BitrixRoutingConfigTest.php` (configuración del pool).
- Deploy y auditoría productiva: pendientes de integración del PR.
