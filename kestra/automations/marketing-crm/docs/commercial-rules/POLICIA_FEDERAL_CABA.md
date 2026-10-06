# Policía Federal + CABA — pausa comercial

Versión: `2026-10-02`. Estado: **implementado, pendiente de deploy**.

## Identificación y aprobación

- Solicitud: tarea Bitrix24 `22889`, Marketing / Comercial (Maru Lopez).
- Proceso: precalificación y distribución. Apertura requerida: 14/09/2026.
- Autorización de implementación: Santiago Acosta, 14/09/2026.
- Canal: WhatsApp habitual de la web, confirmado por Santiago en la misma fecha.
- Regla afectada: final del período inicial de Policía Federal + CABA.
- Pausa solicitada por Maru Lopez el 01/10/2026 en el chat directo con Santiago.
- Aprobación funcional e implementación de la pausa: Santiago Acosta, 02/10/2026.
  Confirmó que los prospectos siguen entrando a Bitrix, como rechazo «otra provincia».
- Motivo: alta administrativa pendiente del convenio. Las campañas y la conversión
  de lead calificado continúan; se retira la redirección posterior a WhatsApp.

## Decisión y condiciones

Desde el 02/10/2026 y hasta nuevo aviso, las presentaciones de Policía Federal con
residencia en CABA califican para medición, pero no habilitan WhatsApp. Se conserva
el ingreso asíncrono en Bitrix y, después del prefill, se clasifican como
**RESULTADO PERDIDO**, motivo **OTRA PROVINCIA** (`3933`), sin crear negociación.
No se reprocesan leads ni negociaciones existentes. Los leads del período comercial
14/09–01/10 conservan su tratamiento anterior.
La fecha se interpreta en `America/Argentina/Buenos_Aires`; para clasificar un lead
existente se utiliza su `DATE_CREATE`.

| Regla | Provincia | Situación laboral | Fecha local | Banco, afiliación y créditos | Resultado |
|---|---|---|---|---|---|
| `PFC-PRE-010` | CABA | Policía Federal | 31/08 al 13/09 inclusive | Cualquiera | Medición positiva, sin WhatsApp; perdido con motivo 4175 |
| `PFC-PRE-020` | CABA | Policía Federal | 14/09 al 01/10 inclusive | Cualquier banco válido del catálogo; afiliación y créditos no restringen precalificación | Calificado, WhatsApp y negociación interna |
| `PFC-PRE-040` | CABA | Policía Federal | Desde 02/10, sin fecha de fin | Cualquier banco válido del catálogo; afiliación y créditos no restringen precalificación | Medición positiva, sin WhatsApp; perdido con motivo OTRA PROVINCIA (3933) |
| `PFC-PRE-030` | Otra provincia o situación laboral | Cualquiera | Cualquiera | Según reglas vigentes | Conserva sus reglas; no extiende el convenio |

## Clasificación y distribución

Durante la pausa, los leads nuevos no acceden al bucket `policia_federal_caba` ni
generan negociación interna. El pool y las negociaciones anteriores se conservan.
La pausa tiene prioridad sobre la apertura comercial y el rechazo general por provincia;
las entradas inválidas conservan la validación habitual, sin inventar datos.

Para la cohorte del 14/09 al 01/10, la precalificación habilita la gestión, no aprueba
un crédito. Como la solicitud no define una línea ni criterios crediticios del convenio, aplica la política general
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
- Lead del período comercial calificado: negociación pendiente de Kestra y luego revisión con Stefania.
- Stefania online dentro de horario: responsable sincronizado en lead/negociación y chat transferido.
- Stefania offline: cola del segmento; al volver online, revisión asignada a Stefania.
- Fecha anterior al 14/09, ausente o inválida: sin nueva distribución automática del segmento.
- Aprobación crediticia o rechazo BCRA específico: no definidos; evaluación manual.
- `01/10 23:59:59 -03`: conserva medición, WhatsApp y circuito comercial.
- `02/10 00:00:00 -03` (03:00 UTC) y fechas futuras: medición positiva, sin WhatsApp,
  ingreso en Bitrix y posterior rechazo `UC_1P8I07` con motivo `3933`, sin negociación.
- La pausa no agrega reglas BCRA ni revisión manual: el resultado de precalificación
  de esta cohorte es el rechazo comercial por provincia.

## Implementación

- Catálogos: provincia `4145`, situación laboral `4165`, motivo inicial `4175`,
  motivo de pausa `3933` (OTRA PROVINCIA), estado perdido `UC_1P8I07`.
- Pruebas: `test_business_logic.py` (frontera temporal, clasificación, conversión,
  asignación, chat y cola) y `BitrixRoutingConfigTest.php` (configuración del pool).
- Deploy y auditoría productiva: pendientes de integración del PR.
- Catálogo productivo verificado por API el 02/10/2026: `UF_CRM_REJECTION_REASON`
  contiene `3933 = OTRA PROVINCIA`; `UC_1P8I07 = RESULTADO PERDIDO` (semántica perdida).
