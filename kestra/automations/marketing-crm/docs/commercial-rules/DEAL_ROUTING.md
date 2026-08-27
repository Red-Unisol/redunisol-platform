# Buckets De Distribucion De Negociaciones

Versión: `2026-08-26`.

Este documento cubre solamente distribución. La clasificación comercial y el proceso
compartido de aprobación se documentan en [`README.md`](README.md).

## Alcance

- La asignacion comercial se realiza unicamente sobre la negociacion.
- El responsable del lead no se usa como mecanismo de distribucion.
- Los buckets se evaluan en el orden documentado.

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

### `cordoba_jubilados`

- Criterio: Cordoba + `Jubilado Provincial`, `Jubilado Nacional`, `Jubilado Municipal`
  o `Pensionado`.
- Responsables, en orden:
  - Patricia Contendi (`10451`)
  - Natalia Rojo Moyano (`71159`)
  - Daniel Carrera (`68579`)
  - Soledad Rojo Moyano (`90231`)
  - Susana Contenti (`29`)
  - Agustin Villagra (`110059`)

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

### `manual_fallback`

- Criterio: negociacion interna que no coincide con una regla de distribucion.
- Responsable: Maru Lopez (`57`).
- No ejecuta round-robin ni transferencia automatica de chat.

## Derivacion Externa

No generan negociacion interna ni participan de estos buckets:

- La Rioja
- Rio Negro
- Neuquen
- Santa Fe

La derivacion externa solo aplica cuando el caso cumple las reglas de elegibilidad de
su provincia. Un caso no elegible conserva su rechazo correspondiente.

## Fuera De Horario

Fuera de la ventana continua que comienza el lunes a las 00:00 inclusive y termina
el viernes a las 17:00 exclusive, Kestra conserva y aplica la decision comercial,
pero toda negociacion que requiera distribucion queda con Maru Lopez (`57`) para
gestion manual.

- no se ejecuta round-robin;
- no se transfiere el chat;
- no se redistribuye automaticamente al siguiente dia habil.

Zona horaria: `America/Argentina/Cordoba`.

## Cola Temporal Por Falta De Vendedor

Si una negociacion creada y procesada dentro de la ventana semanal no encuentra
vendedores online, queda con Maru en `COLA DE DISTRIBUCION KESTRA`.

- cada minuto se reintenta como maximo el caso mas antiguo de cada bucket;
- el orden es FIFO dentro de cada bucket, no existe una cola global;
- un bucket sin vendedores no bloquea los otros buckets;
- la clasificacion, linea y etapa destino originales quedan persistidas y no se
  recalculan durante el reintento;
- al distribuir, se sincronizan negociacion y prospecto y se transfiere el chat;
- el viernes a las 17:00, todo remanente sale definitivamente de la cola y queda en
  `REVISION MANUAL KESTRA` con Maru;
- el remanente no vuelve a entrar automaticamente el lunes.

Las negociaciones creadas fuera de la ventana semanal nunca ingresan a esta cola.
Los rechazos se aplican directamente, sin buscar vendedor, asignar, transferir chat
ni ingresar a la cola. Los casos de revision comercial o de enrutamiento mantienen
sus circuitos propios.

La decision de distribucion nunca reemplaza la decision comercial en la traza. Una
negociacion puede, por ejemplo, quedar `manual_review / missing_bcra_snapshot` en lo
comercial y `queued / assignment_queued` en distribucion.

## Seleccion Dentro De Un Pool

Cuando un bucket contiene mas de un vendedor:

1. se reutiliza el vendedor anterior del contacto si pertenece al pool y esta disponible;
2. si no, se aplica round-robin dentro del bucket;
3. si no hay un vendedor disponible, el caso debe usar `manual_fallback`.
