# Buckets De Distribucion De Negociaciones

Versión: `2026-11-19`.

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

### `santa_fe` y `mutual_paii` — separacion 2026-11-04

- `santa_fe`: perfiles internos habilitados de Santa Fe, linea `Haberes Premium`.
- `mutual_paii`: Jubilado Nacional de cualquier provincia (prioridad ANSES) y
  perfiles habilitados de Buenos Aires, linea `Red Mutual - paii`.
- Los grupos se administran por separado en el panel. Si existia configuracion
  guardada de `santa_fe_anses`, cada grupo hereda su orden y pausas, incluso un
  pool vacio, hasta que se guarde su propia configuracion.
- Sin configuracion previa, ambos comienzan con Patricia Contendi (`10451`),
  Susana Contenti (`29`) y Julieta Aguilera (`116561`).
- Renato Rodriguez Barros (`127337`, cuenta confirmada por Santiago) queda
  disponible en la lista de vendedores; no se incorpora automaticamente a pools.
- Recurrencia, round-robin, balance y FIFO usan las nuevas claves de forma
  independiente. No se redistribuyen negociaciones ya asignadas ni se copia el
  balance historico del grupo compartido.
- El procesador de cola separa los pendientes con clave antigua por su linea
  comercial; sin linea resuelve la familia del lead. Conserva decision, etapa
  destino y fecha de ingreso. Un caso que no pueda identificarse registra error
  y no bloquea los otros grupos.
- Compatibilidad de despliegue: el endpoint mantiene `santa_fe_anses` para el
  runtime anterior; Kestra nuevo prioriza las claves nuevas, incluso vacias,
  y puede leer el pool antiguo si el panel aun no se desplego. La separacion
  efectiva requiere desplegar tanto web como namespace files de marketing-crm.
- Estado: implementado en rama, pendiente de merge y deploy.

### `neuquen`

- Criterio: perfil interno habilitado de Neuquen, excepto Jubilado Nacional que
  corresponde al bucket ANSES.
- Linea: `MUDON`.
- Responsable inicial exclusivo: Ludmila Gallardo (`58913`).
- Se asigna directamente a Ludmila, incluso offline y fuera de horario, por la
  regla general de vendedor unico. No se reasigna a Santa Fe ni Mutual PAII.

Los grupos se administran desde el panel de Distribucion Bitrix; los defaults de
Git coinciden con estos pools iniciales. Las pausas y pools explicitamente vacios
conservan la semantica existente. La cola contempla los buckets y retira de ella
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
  Jubilado Nacional pasa al bucket `mutual_paii`, separado de Santa Fe desde 2026-11-04.
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

Para ingresos nuevos desde el 19/11/2026 a las 11:00 ART se usa el calendario
diario de Ventas, incluidos fines de semana y feriados configurados. Cuando
la evaluación ya resolvió el grupo y corresponde distribuir entre varios vendedores,
se conserva la decisión en la cola hasta la próxima apertura. El cierre del
viernes también conserva el turno en la cola. Al retomar, se comprueban los
responsables y la atención del chat antes de asignar. Un grupo con un único
habilitado sigue teniendo destino directo. Los rechazos y los grupos pausados
conservan sus motivos específicos.

El formulario web registra el ingreso antes de encolarlo y crea el prospecto
con responsable provisional. En el v3 se reconoce al receptor inicial cuando
la entrada, la sesión nativa y el prospecto coinciden y la sesión sigue sin
atención humana. Una reasignación, una respuesta o una transferencia humana
conserva la atención existente. La evidencia ambigua queda para revisión.

### Chat ya en manos de un vendedor del grupo (desde 2026-11-25)

La entrada web y de WhatsApp pasa el chat al vendedor del caso o la negociación
abierta del cliente. Si al calificar la negociación el único dueño humano del chat
comercial activo es un vendedor del grupo que le corresponde, la negociación (y el
prospecto) se asignan a ese vendedor:

- primero se aplica la calificación comercial; un rechazo no se distribuye;
- no hay round-robin, compensación de volumen ni cola, y el chat no se transfiere;
- se envía la notificación habitual de distribución, con "Chat transferido: No";
- antes de cada escritura se vuelve a comprobar que el chat siga con ese vendedor.

Siguen yendo a `C1:KESTRA_ROUTE_REVIEW` sin cambios: un responsable humano en el
prospecto o la negociación, un dueño del chat que no es vendedor del grupo (por
ejemplo `5737`, otras consultas), dos dueños humanos distintos y la sesión atendida,
respondida o transferida a mano mientras el chat sigue con el receptor. Cada una de
esas entradas a `C1:KESTRA_ROUTE_REVIEW` envía una notificación a Maru (`57`) con el
motivo, para que la asignación manual no quede sin aviso.

### Ingresos anteriores al corte

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

Si una negociacion elegible dentro de su ventana de reparto pertenece a un
pool de varios habilitados sin vendedores online, queda con Maru en
`COLA DE DISTRIBUCION KESTRA`. Los pools vacios conservan la pausa explicita;
los pools con un unico habilitado reciben asignacion directa.

- cada minuto se reintenta como maximo el caso mas antiguo de cada bucket;
- el orden es FIFO dentro de cada bucket, no existe una cola global;
- un bucket sin vendedores no bloquea los otros buckets;
- la clasificacion, linea y etapa destino originales quedan persistidas y no se
  recalculan durante el reintento;
- al distribuir, se sincronizan negociacion y prospecto y se transfiere el chat;
- antes de reintentar o cerrar un caso se releen su etapa y los responsables de
  negociacion, prospecto y chats comerciales activos. Si ya salio de la cola, no
  se modifica. Si existe un responsable distinto de Maru, se conserva esa
  asignacion, se sincronizan negociacion y prospecto y se libera la etapa destino
  original sin transferir chats. No depende de que ese responsable este online;
- si hay responsables distintos entre esos registros, el caso sale a revision
  manual conservando todos los responsables y sin transferir chats. Los chats
  cerrados o de lineas no comerciales no determinan el responsable comercial;
- para ingresos anteriores al corte, el viernes a las 17:00 el remanente sale definitivamente de la cola y queda en
  `REVISION MANUAL KESTRA` con Maru;
- para los ingresos nuevos que esperan apertura, se usa la siguiente fecha hábil del calendario.

Con la política anterior al corte, las negociaciones creadas fuera de la ventana semanal nunca ingresan a esta cola;
si tienen un unico vendedor habilitado se asignan directamente.
Un pool explícitamente vacío significa **grupo pausado**, incluso si un vendedor
anterior sigue conectado. Sus casos distribuibles salen de Pendiente de calificación
y entran a la cola temporal con motivo `routing_pool_paused`; conservan la decisión
comercial, línea y etapa destino. No se usa un vendedor de fallback ni otro bucket,
y no se transfiere el chat durante la pausa. La cola registra espera normal, permite
avanzar a otros grupos y retoma el caso cuando haya vendedores habilitados y online.
El tratamiento al cierre depende de la política aplicable al ingreso.

Los rechazos se aplican directamente, sin buscar vendedor, asignar, transferir chat
ni ingresar a la cola. Los casos de revision comercial o de enrutamiento mantienen
sus circuitos propios.

La decision de distribucion nunca reemplaza la decision comercial en la traza. Una
negociacion puede, por ejemplo, quedar `manual_review / missing_bcra_snapshot` en lo
comercial y `queued / assignment_queued` en distribucion.

## Recuperación cuando Bitrix no puede leer la atención

Si una lectura de atención falla durante el reparto y ambos responsables siguen siendo
provisionales, Kestra guarda el reintento en la negociación. El primer intento vuelve
al minuto. Los siguientes esperan 2, 4, 8 y 16 minutos, y luego hasta 30 minutos entre
consultas. El límite de recuperación es de 24 horas desde el primer fallo. El selector
deja pasar otros ingresos durante la espera. Las negociaciones estacionadas en revisión
antes del cambio quedan fuera de este circuito.

Para retomar se debe verificar una sola sesión activa de VENTAS que ya existía al fallar
la lectura, la identidad de la solicitud y una entrada del cliente de menos de 24 horas.
Se verifican la atención humana y los responsables del chat, prospecto y negociación antes
de asignar. Una aceptación, respuesta o transferencia humana, una sesión reemplazada o
una relación contradictoria conserva la atención para revisión. Siguen aplicándose las
reglas comerciales, de disponibilidad y de próxima apertura.

Si corresponde vendedor, la asignación guarda también una orden de entrega para el chat y
la sesión exactos. El calificador procesa esa orden incluso cuando ya no quedan negocios
pendientes de calificar. Un corte después de asignar permite retomar sólo la entrega.
Una vez iniciado el envío, un acuse incierto deja la intención disponible para conciliación
y evita un segundo pase. El resultado por chat se consulta en `attention_deliveries_json`.

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
