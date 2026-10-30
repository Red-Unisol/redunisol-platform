# Buckets De Distribucion De Negociaciones

Versión: `2026-10-30`.

Este documento cubre solamente distribución. La clasificación comercial y el proceso
compartido de aprobación se documentan en [`README.md`](README.md).

## Alcance

- La asignacion comercial se realiza unicamente sobre la negociacion.
- El responsable del lead no se usa como mecanismo de distribucion.
- Los buckets se evaluan en el orden documentado.

Los responsables y su orden se administran desde **Configuración > Distribución
Bitrix** en el panel de Red Unisol. Las listas de este documento y las variables de
entorno quedan como valores iniciales y fallback si el panel no está disponible.
Un vendedor pausado permanece visible en el panel pero no recibe asignaciones nuevas.

## Regla general de vendedor unico — 2026-10-30

Cuando el pool publicado por el panel contiene **exactamente un vendedor habilitado**,
Kestra le asigna directamente toda negociacion distribuible, aunque este offline,
fuera de horario o el caso haya sido creado fuera de la ventana semanal. La regla
es general para todos los buckets, no solo Neuquen. Se cuentan los habilitados
luego de aplicar las pausas del panel, no los vendedores online en ese momento.

- Se sincroniza el responsable del prospecto y la negociacion; se conserva la
  decision comercial, su linea y su etapa destino.
- No se consulta presencia para elegir al responsable, no se ejecuta round-robin
  ni compensacion de volumen, y no se ingresa a la cola por falta de conexion.
- La estrategia auditable es `single_seller`; `online_pool` queda vacio porque no
  se verifico presencia. Esto no indica que se haya comprobado que este offline.
- Si ya existen casos en cola y el pool tiene un solo habilitado, el procesador
  los asigna directamente, incluso fuera de horario y aunque sean de otra semana,
  sin recalcular la decision comercial previamente guardada.
- La transferencia del chat se intenta despues de guardar la asignacion. Si Bitrix
  la rechaza, el responsable se conserva y se registra `transfer_error`; el resto
  de los chats sigue procesandose. El resultado distingue transferencia fallida
  de transferencia parcial.
- Los rechazos comerciales/BCRA no se distribuyen. Un pool vacio o pausado no
  habilita esta excepcion. Los pools de varios vendedores conservan la politica
  de disponibilidad, horario, recurrencia, compensacion y cola existente.

## Nuevos buckets — version 2026-10-30

Estado: **implementado en rama, pendiente de deploy**.

### `santa_fe_anses`

- Criterio: Jubilado Nacional de cualquier provincia (prioridad ANSES), o perfil
  interno habilitado de Santa Fe o de Buenos Aires.
- Bucket unico compartido para las lineas `Red Mutual - paii` y `Haberes Premium`.
- Pool inicial confirmado, en este orden:
  - Patricia Contendi (`10451`)
  - Susana Contenti (`29`)
  - Julieta Aguilera (`116561`)
- Ludmila no integra este bucket. Se conservan recurrencia, round-robin,
  compensacion de volumen, pausas, disponibilidad, horario y cola existentes.

### `neuquen`

- Criterio: perfil interno habilitado de Neuquen, excepto Jubilado Nacional que
  corresponde al bucket ANSES.
- Linea: `MUDON`.
- Responsable inicial exclusivo: Ludmila Gallardo (`58913`).
- Se asigna directamente a Ludmila, incluso offline y fuera de horario, por la
  regla general de vendedor unico. No se reasigna al bucket de Santa Fe/ANSES.

Ambos grupos se administran desde el panel de Distribucion Bitrix; los defaults de
Git coinciden con estos pools iniciales. Las pausas y pools explicitamente vacios
conservan la semantica existente. La cola contempla ambos buckets y retira de ella
los casos cuyo pool quede con un unico habilitado.

## Buckets

### `catamarca_general`

- Criterio: negociacion Catamarca con routing valido.
- Incluye resultados aprobados, revision manual y rechazo BCRA.
- Responsables, en orden:
  - Daniel Carrera (`68579`)
  - Patricia Contendi (`10451`)
  - Susana Contenti (`29`)
  - Soledad Rojo Moyano (`90231`)
  - Natalia Rojo Moyano (`71159`)
  - Claudia Algarbe (`113457`)
  - Daniela Arias (`113455`)
  - Julieta Aguilera (`116561`)
  - Agustin Villagra (`110059`)

### `cordoba_jubilados`

- Criterio: Cordoba + `Jubilado Provincial`, `Jubilado Municipal` o `Pensionado`.
  Jubilado Nacional pasa al bucket compartido `santa_fe_anses` desde la version 2026-10-30.
- Responsables, en orden:
  - Patricia Contendi (`10451`)
  - Natalia Rojo Moyano (`71159`)
  - Daniel Carrera (`68579`)
  - Soledad Rojo Moyano (`90231`)
  - Susana Contenti (`29`)
  - Agustin Villagra (`110059`)
  - Julieta Aguilera (`116561`)

### `cordoba_unc`

- Criterio: Cordoba + `Empleado de la UNC` o `DASPU`.
- Responsable: Gloria Fernandez (`53121`).

### `cordoba_general`

- Criterio: Córdoba + `Empleado Público Provincial`, `Policía`, `Docente`,
  `Empleado Público Municipal`, `Personal de Salud` y restantes situaciones
  laborales habilitadas que no correspondan a Jubilados/Pensionados ni UNC/DASPU.
- Responsables, en orden:
  - Patricia Contendi (`10451`)
  - Natalia Rojo Moyano (`71159`)
  - Daniel Carrera (`68579`)
  - Soledad Rojo Moyano (`90231`)
  - Susana Contenti (`29`)
  - Julieta Aguilera (`116561`)
  - Agustin Villagra (`110059`)

### `policia_federal_caba`

- Regla `PFC-ROUTE-010`: Policía Federal + CABA, lead creado desde el 14/09/2026.
- Responsable inicial: Stefania Salguero (`8057`), editable desde el panel.
- Incluye la revisión comercial y respeta la regla general de vendedor unico
  cuando queda un habilitado; para pools de varios conserva horario y cola.
- Excluye leads históricos y fechas ausentes o inválidas.
- Estado: implementado, pendiente de deploy.

Detalle aprobado: [`POLICIA_FEDERAL_CABA.md`](POLICIA_FEDERAL_CABA.md).

### `manual_fallback`

- Criterio: negociacion interna que no coincide con una regla de distribucion.
- Responsable: Maru Lopez (`57`).
- No ejecuta round-robin ni transferencia automatica de chat.

## Derivacion Externa

No generan negociacion interna ni participan de estos buckets:

- La Rioja, segun su elegibilidad provincial.
- Rio Negro, segun su elegibilidad provincial.
- Cualquier provincia y situacion laboral cuando el CUIT coincide con la base
  historica Haberes CUAD, con prioridad sobre ANSES.

Santa Fe y Neuquen dejan de derivar por provincia. Sus perfiles habilitados pasan
a GANADO si no tienen antecedente CUAD. Las reglas exactas estan en
[`LEAD_QUALIFICATION.md`](LEAD_QUALIFICATION.md), version 2026-10-30, implementada en
rama y pendiente de deploy. Los pools y la clasificacion comercial posterior de la version 2026-10-30 se
detallan en este documento y en `DEAL_CLASSIFICATION.md`.

La derivacion externa solo aplica cuando el caso cumple las reglas de elegibilidad de
su provincia. Un caso no elegible conserva su rechazo correspondiente.

## Fuera De Horario

Fuera de la ventana continua que comienza el lunes a las 00:00 inclusive y termina
el viernes a las 17:00 exclusive, Kestra conserva y aplica la decision comercial,
las negociaciones distribuibles de pools de varios vendedores o pools vacios
quedan con Maru Lopez (`57`) para gestion manual. Los pools con exactamente un
habilitado se asignan directamente a ese vendedor en cualquier horario.

- no se ejecuta round-robin;
- no se transfiere el chat;
- no se redistribuye automaticamente al siguiente dia habil.

Zona horaria: `America/Argentina/Cordoba`.

## Cola Temporal Por Falta De Vendedor

Si una negociacion creada y procesada dentro de la ventana semanal pertenece a un
pool de varios habilitados sin vendedores online, queda con Maru en
`COLA DE DISTRIBUCION KESTRA`. Los pools vacios conservan la pausa explicita;
los pools con un unico habilitado reciben asignacion directa.

- cada minuto se reintenta como maximo el caso mas antiguo de cada bucket;
- el orden es FIFO dentro de cada bucket, no existe una cola global;
- un bucket sin vendedores no bloquea los otros buckets;
- la clasificacion, linea y etapa destino originales quedan persistidas y no se
  recalculan durante el reintento;
- al distribuir, se sincronizan negociacion y prospecto y se transfiere el chat;
- el viernes a las 17:00, todo remanente sale definitivamente de la cola y queda en
  `REVISION MANUAL KESTRA` con Maru;
- el remanente no vuelve a entrar automaticamente el lunes.

Las negociaciones creadas fuera de la ventana semanal nunca ingresan a esta cola;
si tienen un unico vendedor habilitado se asignan directamente.
Un pool explícitamente vacío significa **grupo pausado**, incluso si un vendedor
anterior sigue conectado. Sus casos distribuibles salen de Pendiente de calificación
y entran a la cola temporal con motivo `routing_pool_paused`; conservan la decisión
comercial, línea y etapa destino. No se usa un vendedor de fallback ni otro bucket,
y no se transfiere el chat durante la pausa. La cola registra espera normal, permite
avanzar a otros grupos y retoma el caso cuando haya vendedores habilitados y online.
Se conserva el cierre semanal y el tratamiento fuera de horario ya definidos.

Los rechazos se aplican directamente, sin buscar vendedor, asignar, transferir chat
ni ingresar a la cola. Los casos de revision comercial o de enrutamiento mantienen
sus circuitos propios.

La decision de distribucion nunca reemplaza la decision comercial en la traza. Una
negociacion puede, por ejemplo, quedar `manual_review / missing_bcra_snapshot` en lo
comercial y `queued / assignment_queued` en distribucion.

## Seleccion Dentro De Un Pool

Cuando un bucket contiene mas de un vendedor:

1. se reutiliza el vendedor anterior del contacto si pertenece al pool y esta disponible;
2. toda asignación, incluida la recurrencia, actualiza el balance del día para los
   vendedores que estaban habilitados y online en ese momento;
3. si no hay recurrencia, tres de cada cuatro casos mantienen el round-robin y el
   cuarto se asigna al vendedor online con mayor déficit de la jornada;
4. el déficit es `volumen esperado - volumen recibido`, se calcula por bucket y se
   reinicia cada día sin arrastrar diferencias históricas;
5. un vendedor offline o pausado no acumula volumen esperado y la compensación no
   puede producir más de dos asignaciones consecutivas al mismo vendedor;
6. si no hay un vendedor disponible, el caso debe usar `manual_fallback`.

La recurrencia tiene prioridad absoluta: la compensación la contabiliza, pero nunca
cambia su responsable. Si el servicio de balance no está disponible, la operación
continúa con la recurrencia y el round-robin normales.
