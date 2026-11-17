# Pago360 → imputación de cuotas vencidas: plan y primer incremento

Estado del 16/11/2026: **en desarrollo; sin adaptadores productivos, sin flows
nuevos, sin despliegue ni cobros reales**. Esta PR implementa un motor de
controles con puertos y pruebas simuladas; no completa aún la integración.
El archivo aportado por el usuario fija el alcance. No se trasladan al código
credenciales, datos de socios ni payloads personales.

## Objetivo y alcance

Un pago realmente confirmado por Pago360 debe quedar trazable hasta su aplicación
comprobada en Celesol/Vimarx, o hasta un estado explícito de conciliación. El
portal distingue pago recibido de pago imputado. Kestra será el único ejecutor;
un eventual botón de reintento enviará la misma operación al mismo circuito.

Primera etapa: solo cupones de cuotas vencidas. No se implementan cancelaciones
anticipadas, refinanciaciones, pagos parciales, excedentes, descuentos, nuevos
punitorios ni devoluciones/reversiones. Una diferencia de importe o deuda no se
corrige: bloquea el caso para conciliación. Que el saldo sea cero o haya fecha de
cobro no demuestra que el pago provenga de este cupón.

## Decisiones del usuario — 17/11/2026

El usuario confirmó que este circuito opera siempre en pesos argentinos. Se
adopta **ARS como definición de negocio**, sin exigir una confirmación escrita
adicional del proveedor. Esto no se presenta como un dato observado en su API.

Si Pago360 omite moneda, el futuro adaptador de backend podrá normalizarla con
`PAGOS360_MONEDA_CONTRATO=ARS`, configuración ya propuesta por el portal. La
utilidad `resolve_currency` acepta esa configuración explícita; nunca reemplaza
una moneda distinta informada por el proveedor. No cambiar reglas de referencia,
importe realmente cobrado, fecha o estado. No tomar esta configuración del
frontend ni del body no verificado del webhook. Conservar su origen en la
evidencia del backend. En esta PR no se configuraron secretos ni variables reales.

Disparador acordado: **el backend de Préstamos confirma y guarda el pago, y
luego avisa a Kestra** mediante su webhook autenticado. Se conserva el receptor
Pago360 como punto de entrada/verificación; no se crea un segundo receptor de
Pago360 que también ordene imputar. El aviso no depende de una pantalla abierta.
Si se pierde, el pendiente durable permite recuperarlo por el mismo ejecutor.

Cada cuota seleccionada conserva internamente su verdadero CuotaPrestamo.ID,
préstamo e importe al emitir el cupón. «Consolidado» en el portal corresponde a
APPLIED únicamente después de verificar todas las cuotas. El callback lleva la
misma operación y resultados por cuota. Repetir un aviso o callback no crea otro
cobro. El componente visual y los clientes aún necesitan los archivos preparados
en Lovable para revisar su compatibilidad.

## Accesos y evidencia revisada

- Platform: rama de implementación `feat/pago360-imputacion-cuotas`, desde dev
  `b6611c2ab65b625c7ce9b13df127cd560580760d`. Se leyeron AGENTS de raíz,
  web y Kestra, documentación de Cobranzas y contratos existentes.
- Portal identificado por el usuario: `Red-Unisol/prestamos-celesol`, asociado
  al proyecto Lovable `78c08ac9-ec58-4c54-b4ad-13d890203b67`. La conexión actual
  devuelve Repository not found por Git y API. No se pudo clonar ni revisar.
  No confundir una restricción de acceso con prueba de inexistencia.
- El relevamiento informa `pago_operaciones`, `pago_operacion_cuotas`,
  `external_reference`, `proveedor_ref`, función `pagos360-webhook` y webhook
  5156. Son antecedentes a comprobar contra el repositorio, no contratos
  verificados de este incremento. No se comprobó una entrega real del webhook.
- Lovable y las referencias web de Pago360 devolvieron HTTP 403/405 desde esta
  conexión. No se dedujo un payload de proveedor a partir de esas respuestas.
- No se encontró `credentials.txt` en este checkout ni vinculaciones operativas
  en el entorno. No se solicitaron ni copiaron claves por chat.

### Lo que sí permite afirmar el código de Platform

`CobrarPrestamoGateway` utiliza `POST /api/Prestamo/cobrar`, `cobradorId`,
`nrosCuota`, `motivo`, `pagoTotal: true`, `simulacion` y opcionalmente `fecha`.
El legacy calcula el importe. Los comentarios y pruebas documentan el peligro de
confundir `cobradorId` con `idCobrador`, y de cobrar vencidas fuera de orden.
No se cambia ese gateway ni el comportamiento de refinanciación.

`RefinanciacionCobrosService` y `CobrarRefinanciacionSolicitud` conservan intención
previa, resultado parcial y bloqueo ante incertidumbre. Se reutiliza el patrón,
no sus permisos, reservas de generación, cobrador ni motivo. Pago360 es otro
circuito y no depende de crear una nueva solicitud/préstamo.

El snapshot Swagger de `docs/apis/vimarx/evidence/2026-09-15/openapi.json`
inventaría `POST /fapi/PagoDeuda`, con `fecha`, `importe`, `idCuota`,
`idCobrador`, `idCuentaAmv`; su respuesta 200 no tiene esquema de negocio. Eso
no valida su semántica, rechazo sin efectos ni idempotencia.

La consulta `buildCuotasDelPrestamoDefinition` ya incluye `ID` y lo expone como
`CuotaPrestamoLegacy.id`. No reemplazarlo por `nroCuota` o `prestamoId`. La
consulta actual de movimientos no proporciona todavía evidencia suficiente de
la correlación única operación Pago360 ↔ cobro ↔ cuota. No se inventa esa relación.

## Plan de implementación coordinada

### 1. Portal: verificación, persistencia y estado visible

En el repositorio del portal, conservar emisión de cupón y clasificación actual.
Verificar autenticación real del webhook, ambiente, ID del proveedor,
external_reference, moneda, estado paid y **el importe efectivamente cobrado**
obtenido desde la API autenticada. El importe local, el importe solicitado y el
neto después de comisiones no sustituyen un campo ausente del proveedor.

Guardar en una sola transacción confirmación del proveedor, snapshot inmutable
de la operación y cuotas, trabajo pendiente y outbox de aviso. Comprobar todos
los errores de base de datos antes de responder éxito. Los eventos repetidos se
resuelven por unicidad de proveedor + ambiente + referencia, nunca duplicando
trabajos ni reescribiendo la selección original.

Mostrar por separado confirmación del pago e imputación: pendiente, en proceso,
aplicada o a conciliar. Aplicada exige cobros verificados de todas las cuotas.
Conservar el detalle ya aplicado aunque otra cuota falle. Un error de Kestra o
del callback no oculta el pago recibido. No cambiar UI hasta leer el diseño y
levantar el portal con datos ficticios en escritorio y viewport angosto.

### 2. Portal ↔ Kestra: contrato y repositorio persistente

Implementar una interfaz de servicio autenticada y versionada para reclamar la
operación, leer sus datos, registrar los intentos y publicar resultados. El aviso
a Kestra contiene solo el ID de operación; importes y selección se recuperan
siempre del backend. Las respuestas no contienen claves ni acceso del usuario a
otros pagos. La autorización de servicio se comprueba en backend.

El puerto `Repository` de este incremento fija estas garantías, aún sin un
adaptador de base de datos:

- `claim`: transacción con lease, fencing y versión; una operación activa solo
  tiene un ejecutor. Snapshot de referencias, cuotas e importes inmutable.
- `begin`: transacción que revalida el fencing y confirma una intención WRITING
  antes de devolver un ID; exclusión de cuota activa también entre operaciones
  distintas que pretendan pagar la misma deuda. No confiar solo en límite de
  concurrencia de un flow ni en una consulta SELECT seguida de INSERT.
- `received` y `verified`: conservan la respuesta/cobro antes de verificar;
  nunca regresan una cuota a pendiente de escritura por un fallo posterior.
- `finish`: estado, resultados parciales y outbox en la misma transacción.
  APPLIED exige todas las cuotas VERIFIED. Ningún vencimiento de lease libera
  una intención WRITING o UNCERTAIN para repetir el POST.
- `publish`: entrega idempotente desde el resultado persistido. Un callback
  fallido reintenta la publicación, no el cobro. Actualizar el resultado no debe
  volver a emitir un trabajo de cobro en bucle.

Las rutas HTTP, migraciones y permisos RLS se definirán contra el esquema real
del portal al recuperar su acceso. No hay endpoints, migraciones SQL ni cambios
RLS desplegables inventados en esta PR. Reutilizar su infraestructura de
persistencia; no crear un segundo ledger local o una base SQLite en tareas efímeras.

### 3. Kestra: ejecutor y recuperación

Adaptar `Provider`, `Repository` y `Legacy` al esquema inspeccionado. El motor
normaliza importes a centavos sin redondear y rechaza campos ambiguos. Ejecuta:

1. Reclamar la operación y detectar terminales, intenciones inciertas o journal
   incompatible. Un duplicado ocupado no ejecuta otra escritura.
2. Verificar pago con el proveedor. Cancelado/rechazado/vencido/devuelto no
   autoriza cobrar ni revertir. No hay regla automática de devolución.
3. Si existe respuesta RECEIVED, verificarla solo con lecturas; no volver a
   cobrar esa cuota. Conservar cada intento VERIFIED.
4. Reconsultar todas las cuotas pendientes antes de la primera escritura y cada
   cuota inmediatamente antes de su intento. Exigir identidad, deuda e importe
   coincidentes. Procesar las más antiguas primero por préstamo.
5. Confirmar intención, ejecutar un solo POST por intento sin retry HTTP,
   conservar respuesta, reconsultar cobro y saldo y confirmar la cuota.
6. Persistir estado final y publicar. Si una escritura falla sin respuesta
   concluyente, conservar la intención y bloquear en conciliación.

El día en Argentina de `paid_at` solo se usa en el núcleo para comprobar que la
cuota estaba vencida al pagarse; **no determina el parámetro fecha del legacy**.
Su semántica contable/de cálculo aún debe verificarse antes de implementar el
adaptador. No se usan nombres de campos reales de Pago360 sin confirmarlos.

Después de comprobar los contratos, añadir en Cobranzas un flow de webhook
con autenticación nativa y límite de concurrencia como protección adicional; un
flow periódico de recuperación cada 5 minutos será el valor inicial. Ambos se
entregarán deshabilitados hasta autorización de activación. Recuperación recoge
pendientes y publicaciones fallidas, excluye conciliaciones y procesa intenciones
sin respuesta como inciertas: no las vuelve a cobrar por antigüedad. Un intento
manual utiliza el mismo ejecutor y las mismas reservas.

### 4. Verificación de legacy antes de habilitar el adaptador

| Bloqueante | Evidencia requerida |
| --- | --- |
| Endpoint de cobro | Contrato probado que aplique el importe exacto de las cuotas vencidas y distinga éxito, rechazo sin efectos y respuesta incierta |
| IDs | CuotaPrestamo.ID, préstamo y socio corresponden a la operación; no usar número de cuota como ID |
| Cobrador/cuenta | Identificadores dedicados y vigentes de Pago360; no usar los de refinanciación ni aceptar un default silencioso |
| Fecha | Significado y formato de fecha de cobro frente a fecha de cálculo; no elegir una fecha para hacer coincidir el importe |
| Concurrencia con otros canales | Evidencia de una precondición/operación del legacy que impida cobrar una deuda modificada entre lectura y POST; el lock del portal no bloquea una caja externa |
| Correlación y conciliación | Poder comprobar cobro, cuota, importe, cobrador/cuenta y saldo; un saldo cero aislado no identifica el cupón |
| Autenticación/ambiente | API y notificación reales de Pago360, webhook 5156, encabezados y entrega verificados sin registrar secretos |

La configuración dev de Solicitudes no demuestra que Vimarx sea un sandbox.
No ejecutar cobros reales ni repetir payloads históricos. Si falta cualquiera
de estas pruebas, el adaptador real permanece sin implementar/habilitar.

## Implementado en este primer incremento

- `files/pago360_cuotas/domain.py`: contratos normalizados inmutables,
  centavos exactos, identidad y reglas de elegibilidad sin fallback de importe.
- `files/pago360_cuotas/processor.py`: máquina de ejecución con puertos;
  prevalidación, intención previa, resultados parciales, comprobación posterior,
  recuperación de respuestas conocidas y publicación separada de la escritura.
- `tests/test_pago360_cuotas.py`: escenarios con datos ficticios y dobles de
  puertos. El repositorio simulado usa un lock; **no demuestra atomicidad,
  durabilidad ni concurrencia de PostgreSQL/Supabase**.

`Processor` está bloqueado por defecto (`CONTRACTS_NOT_VERIFIED`) y no realiza
ningún I/O así. `contracts_verified=True` solo se usa en las pruebas con dobles;
no se expone como una variable que pueda habilitar un adaptador no verificado.
No hay un flow ejecutable, webhook nuevo ni llamada de escritura real en este
incremento. El paquete no se importa desde los flows actuales.

## Pruebas y aceptación

Ejecutar desde la raíz de Platform:

```bash
.venv/bin/python -m unittest discover -s kestra/automations/cobranzas/tests -p 'test_*.py' -v
.venv/bin/python kestra/tools/validate_kestra.py
.venv/bin/python kestra/tools/deploy_kestra.py --environment dev --domain cobranzas --dry-run
git diff --check
```

Resultado local de este incremento: **66 pruebas de Cobranzas correctas**, de
las cuales 34 son nuevas del motor Pago360; **13 pruebas existentes** de
`CobrarPrestamoGateway` y `CobrarRefinanciacionSolicitud` correctas. Estructura
Kestra, dry-run y `git diff --check` correctos. Todas estas comprobaciones usan
contratos/dobles locales; no hubo autenticación o escritura real en Pago360,
Supabase o Vimarx. No se ejecutó una prueba de durabilidad PostgreSQL.

El núcleo debe cubrir: operación inexistente; bloqueo inicial; importe, moneda,
ambiente o referencia diferentes; eventos repetidos; dos ejecutores; cuota
pagada por otro canal; validación de todas las cuotas antes de escribir;
fallos parciales; timeout posterior a posible escritura; respuesta inválida;
fallos al registrar intención, respuesta o resultado; callback del portal
fallido; recuperación por lectura de un cobro conocido y estados no pagados.

Cuando se recupere el portal, añadir pruebas reales de transacciones/constraints
con dos conexiones de base, RLS, autenticación, errores de escrituras del
webhook, reintento de outbox y contrato HTTP. La concurrencia simulada no las
sustituye. Después, usar sandbox o fixtures autorizados del proveedor y legacy
para verificar los adaptadores, y un evento auténtico de prueba con el webhook.
No se declaran esas verificaciones como realizadas.

## PRs, configuración y orden de integración

1. PR Platform inicial: este plan, núcleo y pruebas; mantener en borrador.
2. Recuperar acceso a `Red-Unisol/prestamos-celesol`; preparar PR coordinada del
   portal con migraciones, persistencia, webhook e interfaz autenticada.
3. Completar en Platform clientes, adaptador legacy comprobado y flows
   deshabilitados; validar ambos contratos en pruebas de integración.
4. Con autorización expresa, aplicar primero las migraciones/rutas del portal
   compatibles con su circuito manual y después los flows todavía deshabilitados.
5. Configurar vinculaciones seguras separadas por ambiente, verificar un pago de
   prueba y recién entonces autorizar la activación. Sin escritura real mientras
   sigan abiertos los bloqueantes de la tabla.

No se agregan secretos al repositorio ni a logs. Reutilizar la credencial real
de Pago360 del portal si corresponde, una identidad backend de integración
para Kestra ↔ portal y la clave del trigger de Kestra. No inventar sus valores,
rotar credenciales o usar una service_role de Supabase en el frontend. Los
nombres definitivos y las variables de cobrador/cuenta/fecha se documentarán al
inspeccionar esos adaptadores; este incremento no requiere configuración runtime.

La desactivación de futuros flows detendrá escrituras nuevas sin borrar
intenciones, resultados ni outbox. No hacer rollback destructivo del journal ni
borrar estados inciertos para volver a cobrar. Conciliación futura deberá ser
administrativa, auditada y basada en evidencia: no se incluye una acción que
libere reservas sin demostrar que no hubo aplicación.
