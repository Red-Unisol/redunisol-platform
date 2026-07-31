# Criterios Provisorios De Clasificacion Comercial

Fecha: 2026-07-02

Estado: borrador operativo en lenguaje natural. Este documento traduce las reglas conocidas hasta ahora a criterios de clasificacion sin dejar alternativas abiertas. Cuando una regla no contempla un caso, o cuando falta un dato necesario para decidir, el lead debe quedar para revision manual.

Fuente base:

- `untracked/Criterios de decision comercial y derivacion de leads por provincia y linea.txt`
- `kestra/automations/marketing-crm/docs/COMMERCIAL_DECISION_SPEC_2026-06-29.md`

## Modelo Mixto Bitrix24 / Kestra

Antes de aplicar criterios comerciales, el sistema debe decidir quien puede tomar decisiones comerciales sobre el lead.

El campo de control es `UF_CRM_COMM_OWNER` (`Motor decision comercial`):

- `Bitrix`: las decisiones comerciales quedan a cargo de las automatizaciones nativas/manuales de Bitrix24
- `Kestra`: Kestra puede tomar decisiones comerciales sobre el lead
- `Manual`: el caso queda para revision manual y no debe tener decision comercial automatica

Kestra puede enriquecer leads de cualquier ownership con BCRA, Vimarx, fecha de nacimiento u otros campos informativos.

Kestra solo puede cambiar estado, etapa, responsable, crear negociacion, rechazar o derivar cuando:

- `Motor decision comercial = Kestra`
- o una ejecucion administrativa lo fuerce explicitamente

Las automatizaciones nativas de Bitrix24 deben tener la condicion inversa:

- si `Motor decision comercial = Kestra`, no deben ejecutar sus ramas comerciales nativas
- si `Motor decision comercial` es `Bitrix` o esta vacio durante la transicion, pueden continuar con el circuito nativo/manual que corresponda
- si `Motor decision comercial = Manual`, el caso debe quedar para revision manual

El formulario debe cargar `Motor decision comercial` segun el plan de migracion. Las provincias o flujos ya migrados a Kestra se cargan con `Kestra`. Las provincias o flujos todavia no migrados se cargan con `Bitrix`. Los casos dudosos o no contemplados se cargan con `Manual`.

La migracion se hara por provincia o por flujo comercial. Catamarca es la primera provincia foco de automatizacion y se carga con `Motor decision comercial = Kestra`. Hasta que una provincia o flujo este migrado, el default operativo es `Bitrix` para evitar doble procesamiento comercial.

Precondicion tecnica: el campo existe en Bitrix24 como `UF_CRM_COMM_OWNER`, enumeracion `Motor decision comercial`, con valores `Bitrix`, `Kestra` y `Manual`. `UF_CRM_PROCESSING_POLICY` (`Politica procesamiento`) queda como campo legacy/parcial y no debe usarse como ownership comercial nuevo.

## Regla General De Fallback

Si el sistema no puede decidir con los datos disponibles, el lead no debe rechazarse automaticamente. Debe quedar para revision manual.

Esto aplica a:

- campos faltantes
- valores no reconocidos
- casos no contemplados por provincia, situacion laboral, banco, condicion de socio, BCRA o linea
- reglas comerciales marcadas como pendientes de definicion
- cualquier conflicto entre datos del formulario, Bitrix, Vimarx o BCRA

La respuesta del webhook al formulario sigue siendo binaria: `qualified/rejected`.

## Resultado Ganado

Cuando un prospecto queda ganado:

- el lead debe quedar marcado como ganado
- se debe crear una negociacion
- la negociacion debe crearse en `VENTAS`
- `CATEGORY_ID=1`
- etapa inicial general `C1:NEW` (`PRESENTACION`)
- excepcion Catamarca con motor Kestra: `C1:KESTRA_PENDING` hasta completar la calificacion definitiva
- el deal debe copiar desde el lead la linea comercial calculada
- el deal debe copiar o preservar la informacion necesaria para analisis comercial posterior

La linea comercial debe existir como campo custom tanto en lead como en deal.

## Asignacion De Vendedor

Comportamiento general vigente desde el 2026-07-20:

- al crear una negociacion, Kestra no ejecuta round-robin ni recalcula el vendedor
- la negociacion hereda siempre el responsable actual del lead
- si se retoma el round-robin, debe aplicarse durante la asignacion del lead y antes de crear la negociacion

Excepcion Catamarca vigente desde el 2026-07-31:

- la negociacion nace asignada provisionalmente a Maru Lopez (`57`)
- el round-robin se aplica sobre la negociacion solo despues de una calificacion definitiva aprobable

Para La Rioja, todo prospecto ganado se asigna a Mercedes (`85431`).

Para casos internos asignados al pool `Dani / Pato / Nati / Sole`:

- si el contacto ya tuvo prospectos previos, se asigna al mismo vendedor del prospecto previo mas reciente
- si el contacto no tiene prospectos previos, se asigna por round-robin
- las recurrencias cuentan para mantener equidad
- el round-robin de contactos nuevos debe compensar a quienes reciban mas recurrencias

Pool interno confirmado:

| Alias | Usuario | ID Bitrix |
| --- | --- | ---: |
| Dani | Daniel Carrera | 68579 |
| Pato | Patricia Contendi | 10451 |
| Nati | Natalia Rojo Moyano | 71159 |
| Sole | Soledad Rojo Moyano | 90231 |

Nancy es Nancy Romina Spengler (`74365`).

## Clasificacion Por Provincia

Primero se clasifica por provincia.

Si la provincia es La Rioja, se aplica la rama La Rioja.

Si la provincia es Cordoba, se aplica la rama Cordoba.

Si la provincia es Catamarca, se aplica la rama Catamarca.

Si la provincia es Neuquen, Rio Negro o Santa Fe, el lead queda como derivacion externa. Hasta que se definan vendedor externo, plantilla y destinatarios, la derivacion externa debe quedar para revision manual.

Si la provincia es cualquier otra, el lead queda fuera de alcance actual y se rechaza.

## Rama La Rioja

La Rioja no consulta BCRA automaticamente.

Situaciones laborales aceptadas:

- Empleado Publico Provincial
- Empleado Publico Municipal
- Policia
- Personal de Salud
- Docente

En La Rioja, `Salud` y `Personal de Salud` son equivalentes.

Si la situacion laboral no esta en la lista aceptada, el lead se rechaza por situacion laboral.

Si la situacion laboral esta aceptada:

- el prospecto queda ganado
- se crea negociacion en `VENTAS`
- se asigna a Mercedes (`85431`)
- la linea comercial inicial es `AMELaR`
- el caso queda para validacion manual de Mercedes

Mercedes valida manualmente cargo, edad y condicion final del caso.

Si la validacion manual es aprobable, el caso sigue como aprobable Mercedes con linea `AMELaR`.

Si la validacion manual no es aprobable, el caso se rechaza por analisis.

## Rama Cordoba

Situaciones laborales aceptadas en Cordoba:

- Empleado Publico Provincial
- Empleado Publico Municipal
- Policia
- Personal de Salud
- Docente
- Jubilado Provincial
- Jubilado Nacional
- Pensionado
- Empleado de la UNC
- DASPU

Situaciones laborales rechazadas en Cordoba:

- Empleado Publico Nacional
- Empleado Privado
- Jubilado Municipal
- Autonomo/Independiente
- Monotributista
- Beneficiario de Plan Social
- cualquier otra no aceptada

Si la situacion laboral no esta aceptada, el lead se rechaza por situacion laboral.

`Empleado de la UNC` y `DASPU` siguen aceptados en Cordoba.

### Cordoba Con Banco Bancor Obligatorio

Para estas situaciones laborales, el banco de cobro debe ser Bancor:

- Empleado Publico Provincial
- Empleado Publico Municipal
- Policia
- Personal de Salud
- Docente
- Jubilado Nacional
- Pensionado

Si el banco de cobro no es Bancor, el lead se rechaza por banco de cobro.

Si el banco de cobro es Bancor, el prospecto queda ganado y se crea negociacion en `VENTAS`.

### Cordoba Jubilado Provincial

Para Jubilado Provincial no se exige Bancor como banco de cobro.

Si la situacion laboral es Jubilado Provincial:

- el prospecto queda ganado
- se crea negociacion en `VENTAS`
- se continua con analisis comercial de Caja

### Cordoba Empleado Publico Provincial Y Salud

Para Empleado Publico Provincial y Personal de Salud, despues de ganar el prospecto:

- si es cliente nuevo o no socio, se intenta linea `CBU Nuevos`
- si es socio sin credito vigente, se intenta linea `CBU Recurrente`
- si es socio con credito vigente, se revisa si corresponde renovacion, paralelo o mora

Si corresponde renovacion Cruz del Eje, la linea es `REN Premium` o `REN Especial`, el vendedor es Nancy, y el caso queda para revision manual porque `BCRA REN` sigue pendiente de definicion.

Si es paralelo en Cruz del Eje, no se otorga paralelo. Si no tiene creditos anteriores cancelados, se rechaza por analisis.

Si tiene mora y quiere Cruz del Eje, no se usa REN; pasa por linea comun y queda para regularizacion/refinanciacion y revision manual.

Si sigue encuadrando como CBU recurrente, se valida BCRA para linea CBU.

### Cordoba Policia

Para Policia, despues de ganar el prospecto:

- si no es socio o no tiene credito vigente, se evalua Cruz del Eje comun
- si es socio con renovacion y tiene cuotas anteriores pagadas en tiempo y forma, se evalua REN Premium o REN Especial con Nancy y revision manual por `BCRA REN`
- si es socio con renovacion y no tiene cuotas anteriores pagadas en tiempo y forma, se rechaza por analisis
- si es socio con paralelo, no se otorga paralelo; si no tiene creditos anteriores cancelados, se rechaza por analisis
- si es socio con mora, pasa por linea comun y queda para regularizacion/refinanciacion y revision manual

La linea final normal para Policia es Cruz del Eje. Si pasa Cruz del Eje comun, se asigna a Nancy y la linea es `Cruz del Eje`.

### Cordoba Docente, Municipal, Jubilado Nacional Y Pensionado

Para Docente, Empleado Publico Municipal, Jubilado Nacional y Pensionado:

- la unica linea automatizable por ahora es CBU
- si es cliente nuevo o no socio, se intenta `CBU Nuevos`
- si es socio sin credito vigente, se intenta `CBU Recurrente`
- si es socio con credito vigente y encuadra como recurrente, se intenta CBU
- si es socio con credito vigente y no encuadra como recurrente, se rechaza por analisis

Si pasa CBU, se asigna al pool interno y la linea es `CBU`.

Si no pasa CBU, se rechaza por analisis.

### Cordoba Jubilado Provincial Y Caja

Para Jubilado Provincial:

- si es socio nuevo, se intenta `Caja Nuevo`
- si es socio o recurrente sin credito vigente, se intenta `Caja General`, `Caja Irregulares` o `Caja Morosos`
- si es socio con credito vigente, se revisa paralelo, mora y condicion de pago minima

Lineas Caja:

- `Caja Nuevo`: requiere solo situacion 1
- `Caja General`: permite situaciones 1, 2 o 3
- `Caja Irregulares`: permite situaciones 2 o 3
- `Caja Morosos`: aplica con situaciones 4 o 5

Si hay irregularidad con banco de cobro, especialmente Bancor o Macro, el caso debe ir a revision manual hasta que exista una regla automatica cerrada.

Para paralelos Caja:

- en Caja General, debe tener al menos 50% de la cuota del ultimo mes cobrada y al menos la primera cuota del credito vigente pagada
- en Caja Irregulares, se permiten paralelos desde la cuota 4 pagada del credito vigente

Si pasa alguna linea Caja aplicable, se asigna al pool interno.

Si no pasa ninguna linea Caja aplicable, se rechaza por analisis.

## Reglas BCRA Provisorias

Las reglas BCRA por linea se aplican solo cuando los datos necesarios estan disponibles y la regla esta contemplada.

Si no se puede aplicar la regla con certeza, el lead queda para revision manual.

### CBU Nuevos Y CBU Propia Recurrentes

Para `CBU Nuevos` y `CBU Propia Recurrentes`:

- no se acepta ninguna situacion mayor a 1
- se aceptan como maximo 5 situaciones
- el maximo posible aceptado es 5 situaciones y todas deben ser situacion 1
- debe tener como maximo situacion 1 con banco de cobro

Si cumple, el resultado es aprobable internos, vendedor pool interno y linea `CBU`.

### CBU Comer Recurrentes

Para `CBU Comer Recurrentes`:

- se permiten situaciones negativas
- no hay tope de cantidad ni valor
- la regla "cupo afectado al 0,1" queda pendiente de fuente/calculo; si ese dato es necesario, el caso va a revision manual

Si cumple con los datos disponibles, el resultado es aprobable internos, vendedor pool interno y linea `CBU`.

### Cruz Del Eje Comun

Para Cruz del Eje comun:

- Premium: solo situaciones 1
- Especial: situaciones 2 en adelante, hasta 2 situaciones 4 o 5, y situacion 1 con banco de cobro
- rechazo duro: mas de 2 situaciones 4 o 5

La regla "situacion 2 o mayor en Banco de Cordoba" queda pendiente de confirmacion. Si aparece esa condicion y afecta la decision, el caso va a revision manual.

Si pasa Cruz del Eje, se asigna a Nancy y la linea es `Cruz del Eje`.

Si no pasa Cruz del Eje, se rechaza por analisis.

## Rama Catamarca

Situaciones laborales aceptadas en Catamarca:

- Empleado Publico Provincial
- Policia
- Personal de Salud
- Docente

Situaciones laborales rechazadas en Catamarca:

- Empleado Publico Municipal
- Empleado Publico Nacional
- Empleado Privado
- Jubilado Nacional
- Jubilado Provincial
- Jubilado Municipal
- Autonomo/Independiente
- Monotributista
- Pensionado
- Beneficiario de Plan Social
- cualquier otra no aceptada

Si la situacion laboral no esta aceptada, el lead se rechaza por situacion laboral.

Si la situacion laboral esta aceptada:

- el prospecto queda ganado
- se crea negociacion en `VENTAS`
- se continua con analisis comercial Catamarca

### Catamarca Condicion Comercial

Si no es socio o no tiene credito vigente, pasa a validar BCRA.

Si es socio con segundo credito, debe tener abonada la cuota 4. Si no cumple, se rechaza por analisis. Si cumple, valida BCRA.

Si es socio con renovacion y dos creditos vigentes, debe tener abonado al menos el 50% del credito que va a cancelar y al menos la segunda cuota cancelada del ultimo credito solicitado. Si no cumple, se rechaza por analisis. Si cumple, valida BCRA.

Si es socio con mora:

- si la mora es porque no ingreso la ultima cuota, se rechaza por analisis
- si la mora es por otro motivo y no tiene cupo, se rechaza por analisis
- si la mora es por otro motivo y tiene cupo, queda para cancelacion/refinanciacion y revision manual

### Catamarca BCRA Y AMEJUCA

Rechazo duro:

- mas de 4 situaciones 4 o 5

La regla "situacion mayor a 1 en Banco Nacion" queda pendiente de confirmacion. Si aparece esa condicion y afecta la decision, el caso va a revision manual.

AMEJUCA Premium:

- se acepta cuando no hay situaciones negativas
- si hay duda entre "sin situaciones con ninguna entidad" y "situacion 1", el caso va a revision manual

AMEJUCA Especial:

- situaciones 2 en adelante
- hasta 4 situaciones 4 o 5
- situacion 1 con banco de cobro

Si pasa Premium, el resultado es aprobable internos, vendedor pool interno y linea `AMEJUCA Premium`.

Si no pasa Premium pero pasa Especial, el resultado es aprobable internos, vendedor pool interno y linea `AMEJUCA Especial`.

Si no pasa ninguna linea AMEJUCA, se rechaza por analisis.

## Rechazo Por Analisis

Cuando una regla indique rechazo por analisis, el criterio de negocio es no aprobar el caso. La forma exacta de cierre en Bitrix sigue pendiente de definicion operativa.

Hasta que se defina si debe cerrarse automaticamente como perdido o quedar en etapa manual, esos casos deben quedar para revision manual de cierre.

## Casos No Contemplados

Cualquier caso no contemplado por este documento queda para revision manual.
