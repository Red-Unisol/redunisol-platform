# Plan De Transferencias Automaticas

Fecha: 2026-07-14

Estado: plan inicial simplificado

## Objetivo

Permitir que ciertas lineas de credito se transfieran automaticamente cuando una solicitud esta lista para transferir y pasa todos los chequeos operativos sin advertencias ni bloqueos.

La regla principal del proyecto es conservadora: ante cualquier duda, inconsistencia, error de consulta, warning o estado ambiguo, no se transfiere automaticamente.

## Alcance

El plan se ejecuta como una unica fase de implementacion. No se separa en etapa de observacion, dry-run y live. La misma implementacion debe incluir los controles necesarios para correr de forma limitada y segura desde el inicio.

La automatizacion debe:

- evaluar solicitudes en estado `A Transferir`
- permitir automaticas solo para lineas en allowlist explicita
- transferir solo casos verdes, sin warnings y sin blockers
- respetar cupos automaticos cargados por el operador
- mantener estado de automaticas durante la sesion de la app
- generar comprobantes automaticos en una carpeta separada
- notificar al operador que debe subir el comprobante al programa externo
- tener kill switch global y por linea

## Regla De Elegibilidad Automatica

Una solicitud solo puede transferirse automaticamente si cumple todo lo siguiente:

1. La linea de credito esta en una allowlist explicita de lineas automaticas.
2. El estado del core es exactamente `A Transferir`.
3. La solicitud pasa todos los chequeos actuales de la app.
4. El resultado visual/logico equivalente es verde puro: sin warnings y sin blockers.
5. Existe validacion MetaMap `completed` asociada.
6. Numero de solicitud, documento y monto de MetaMap coinciden contra el core.
7. Existe `Prestamo.[CBU transferencia]`.
8. El CUIL/CUIT de la solicitud, el CUIL/CUIT resuelto por DNI y el titular del CBU en Coinag coinciden.
9. El monto de transferencia se resuelve sin ambiguedad.
10. Coinag no tiene transferencia previa ni en proceso para el `idTrxCliente` esperado.
11. Hay cupo automatico disponible para consumir.
12. El modo automatico esta habilitado explicitamente para el ambiente.

Casos que deben quedar excluidos aunque puedan transferirse manualmente:

- solicitudes con MetaMap faltante
- solicitudes con warnings de cualquier tipo
- renovaciones detectadas por monto bancario menor que `MontoAFinanciar`
- casos donde `Prestamo.[Bco CMF]` y `Prestamo.[Bco Coinag Cba]` sean ambos positivos
- casos donde ninguno de esos campos resuelva monto valido
- errores, timeouts o respuestas no interpretables del core, server o Coinag
- estado Coinag `YA TRANSFERIDA`, `EN PROCESO`, `ERROR` o `Unknown`

## Plan De Implementacion

### 1. Configuracion De Seguridad

Agregar configuracion explicita para:

- habilitar/deshabilitar automaticas globalmente
- habilitar/deshabilitar automaticas por linea
- definir allowlist exacta de lineas automaticas
- permitir que el operador cargue cupo automatico de sesion
- definir limite diario global de monto, si aplica
- definir limite diario de monto por linea, si aplica
- definir carpeta de comprobantes automaticos
- definir canal de notificacion al operador

La ausencia de cualquier configuracion critica debe bloquear la transferencia automatica.

### 2. Cupos Automaticos Cargados Por El Operador

El control principal no sera un limite diario fijo que corre solo. Sera una bolsa de cupos automaticos de sesion que el operador carga desde la app.

Modelo esperado:

- el operador abre la app
- el cupo automatico inicia siempre en `0`
- la app muestra el cupo automatico disponible de la sesion actual
- el operador decide sumar una cantidad, por ejemplo `+2`
- la app suma ese cupo en memoria para esta apertura del programa
- cuando aparece una solicitud elegible de una linea permitida, se autotransfiere
- al enviarse esa transferencia, el cupo baja de `2` a `1`
- la siguiente transferencia automatica vuelve a consumir cupo
- cuando el cupo llega a `0`, no se hacen mas transferencias automaticas aunque haya casos verdes
- si se cierra y vuelve a abrir la app, el cupo vuelve a `0`

En otras palabras: el operador habilita una cantidad acotada de automaticas para ese periodo operativo, y la app va gastando esa autorizacion una por una. Esto permite probar el sistema sin dejarlo libre para transferir todo lo que aparezca.

Reglas:

- el cupo vive en memoria de la app
- cada apertura de la app empieza con cupo `0`
- cada aumento de cupo queda visible en la UI de la sesion actual
- cada consumo de cupo queda asociado en la UI a una transferencia concreta de la sesion actual
- si no se puede descontar/reservar cupo de forma segura dentro del proceso, no se transfiere
- debe existir una forma visible de dejar el cupo en `0`
- para evitar carreras, la app debe procesar automaticas de a una por vez o bloquear la seccion critica de consumo de cupo

Pendiente de definicion:

- si se permitira mas de una instancia de la app abierta al mismo tiempo

### 3. Carpeta Separada De Comprobantes Automaticos

Los comprobantes generados por transferencias automaticas no deben mezclarse con los comprobantes manuales.

Debe existir una carpeta propia, configurable, por ejemplo:

- `TRANSFERENCIAS_AUTO_RECEIPTS_DIR`

Reglas:

- la carpeta debe existir o poder crearse antes de transferir
- si la carpeta no esta disponible, no se transfiere automaticamente
- el path del comprobante debe quedar visible en la app para la transferencia automatica
- el reporte/notificacion al operador debe apuntar a esa carpeta
- los nombres de archivo deben permitir identificar solicitud, fecha e importe

Propuesta de nombre:

```text
YYYYMMDD-HHMMSS_solicitud-<request_oid>_importe-<importe>_automatico.pdf
```

### 4. Estado De Sesion Y Evidencia Operativa

No se requiere un registro durable propio para cupos, contador de pendientes o historial interno de automaticas.

La app mantiene en memoria, durante la sesion actual:

- cupo automatico disponible
- solicitudes autotransferidas en esta apertura
- contador/dot de automaticas pendientes de revisar
- rutas de comprobantes automaticos generados en esta apertura

Al cerrar la app:

- el cupo restante se descarta
- al abrir nuevamente, el cupo empieza en `0`
- no se reconstruye el contador anterior desde una base propia

La evidencia persistente principal son los comprobantes PDF generados en la carpeta separada de automaticas y el estado consultable en Coinag por `idTrxCliente`.

### 5. Flujo De Ejecucion

Orden propuesto por corrida:

1. Leer configuracion.
2. Verificar kill switch global.
3. Inicializar cupo automatico de sesion en `0` al abrir la app.
4. Verificar disponibilidad de carpeta de comprobantes automaticos.
5. Consultar solicitudes `A Transferir`.
6. Para cada solicitud:
   - verificar que la linea este en allowlist automatica
   - hidratar con datos de core, server MetaMap y Coinag
   - construir reporte de validacion
   - descartar si hay warnings o blockers
   - descartar si no hay cupo automatico disponible
   - verificar que no este ya procesandose en esta sesion
   - verificar idempotencia en Coinag por `idTrxCliente`
   - reservar/descontar un cupo automatico
   - enviar transferencia a Coinag
   - generar comprobante en carpeta automatica
   - agregar la solicitud a la lista de automaticas pendientes de revisar en la app
   - crear notificacion para carga de comprobante

La corrida debe procesar una solicitud por vez o usar lock por solicitud. No debe haber dos ejecuciones transfiriendo la misma solicitud en paralelo.

### 6. Notificacion Al Operador

Despues de una transferencia automatica enviada a Coinag, debe quedar un item pendiente para el operador humano, porque el operador debe subir el comprobante al programa operativo externo.

La notificacion principal debe estar dentro de la app desktop.

Comportamiento esperado en la app:

- lanzar una notificacion cuando se realiza una transferencia automatica
- mostrar un indicador visual persistente, por ejemplo un dot
- mostrar contador de solicitudes autotransferidas pendientes de revisar, por ejemplo `(1)`, `(2)`, `(3)`
- permitir abrir la lista de transferencias automaticas pendientes de la sesion actual
- mostrar la ruta del comprobante automatico
- permitir marcar visualmente que el operador ya cargo el comprobante en el programa externo, si esa accion queda dentro del alcance

Notificacion minima esperada:

- solicitud transferida
- importe
- linea de credito
- fecha/hora
- ruta del comprobante en la carpeta automatica
- estado `needs_receipt_upload`

Complementos posibles:

- reporte diario de transferencias automaticas pendientes de carga
- email
- Bitrix
- tarea interna

La notificacion vive en la app. Si se cierra la app, el operador conserva como evidencia la carpeta separada de comprobantes automaticos.

### 7. Idempotencia

La automatizacion debe verificar idempotencia en dos capas antes de transferir:

1. Coinag: `TransferenciaByIdTrxCliente` devuelve `SIN_REGISTROS`
2. lock de sesion: no hay otra tarea de la app procesando la misma solicitud

Si cualquiera de las dos capas no puede verificarse, no se transfiere.

El `idTrxCliente` debe seguir la regla actual cuando `TRANSFERENCIAS_COINAG_ID_EMPRESA` esta configurado:

- `ID_EMPRESA`
- mas `numero_de_solicitud + "0"`
- left-padded a 15 digitos para el sufijo

No se debe generar un identificador alternativo para modo automatico si eso impide conciliar con la consulta previa a Coinag.

## Contexto Actual

El programa existente `apps/metamap-platform/client/transferencias-celesol` ya contiene la logica operativa principal:

- lista solicitudes del core financiero en estado `A Transferir`
- valida linea de credito habilitada
- consulta validacion MetaMap `completed` en el server
- valida datos del core contra MetaMap cuando existe validacion
- valida CBU de transferencia
- resuelve CUIL/CUIT por DNI contra el core
- valida titularidad del CBU destino contra Coinag
- resuelve monto de transferencia desde `Prestamo.[Bco CMF]` o `Prestamo.[Bco Coinag Cba]`
- consulta Coinag por `idTrxCliente` para evitar reenvios
- ejecuta la transferencia y genera comprobante

Para transferencia automatica, no alcanza con reutilizar el boton `Transferir`. Hay que agregar control de cupos de sesion cargados por el operador, notificacion al operador y carpeta separada de comprobantes automaticos.

## Decisiones Iniciales

- La automatizacion es mas estricta que la operacion manual.
- Cualquier warning bloquea automatica.
- MetaMap faltante bloquea automatica.
- Renovacion bloquea automatica.
- El operador carga cupos automaticos desde la app.
- Cada transferencia automatica consume un cupo.
- Si el cupo llega a `0`, no se transfiere automaticamente.
- Cada apertura de la app inicia con cupo `0`.
- No se requiere registro durable propio para cupos o contador de pendientes.
- Comprobantes automaticos van a carpeta separada.
- La app desktop debe notificar automaticas y mostrar contador/dot de pendientes.
- La carga del comprobante al programa externo sigue siendo tarea humana.
- La primera allowlist va a incluir alguna linea de AMEJUCA, a definir exactamente.
- Usar prod requiere decision explicita.

## Preguntas Abiertas

1. Que linea exacta de AMEJUCA entra en la primera allowlist.
2. Si se permitira mas de una instancia de la app abierta al mismo tiempo.
3. Cual sera la ruta real de `TRANSFERENCIAS_AUTO_RECEIPTS_DIR`.
4. Si el comprobante generado por la app Rust actual alcanza para la carga externa o hay que adaptar formato/nombre.
5. Si el flujo automatico debe actualizar algun estado en el core o solo enviar a Coinag y dejar pendiente la carga manual del comprobante.
6. Como se confirma posteriormente una transferencia `EN PROCESO`: callback bancario, consulta periodica por `idTrxCliente` o carga manual.
