# Buckets De Distribucion De Negociaciones

Estado: criterio acordado, pendiente de implementacion.

Este documento cubre solamente distribución. La clasificación comercial y el proceso
compartido de aprobación se documentan en
[`commercial-rules/README.md`](commercial-rules/README.md).

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

### `cordoba_publico_policia`

- Criterio: Cordoba + `Empleado Publico Provincial` o `Policia`.
- Responsable: Nancy Romina Spengler (`74365`).

### `cordoba_jubilados`

- Criterio: Cordoba + `Jubilado Provincial`, `Jubilado Nacional` o `Pensionado`.
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

- Criterio: restantes situaciones laborales habilitadas de Cordoba.
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

Fuera de lunes a viernes, desde las 09:00 inclusive hasta las 17:00 exclusive, toda
negociacion interna queda con Maru Lopez (`57`) para gestion manual.

- no se ejecuta round-robin;
- no se transfiere el chat;
- no se redistribuye automaticamente al siguiente dia habil.

Zona horaria: `America/Argentina/Cordoba`.

## Seleccion Dentro De Un Pool

Cuando un bucket contiene mas de un vendedor:

1. se reutiliza el vendedor anterior del contacto si pertenece al pool y esta disponible;
2. si no, se aplica round-robin dentro del bucket;
3. si no hay un vendedor disponible, el caso debe usar `manual_fallback`.
