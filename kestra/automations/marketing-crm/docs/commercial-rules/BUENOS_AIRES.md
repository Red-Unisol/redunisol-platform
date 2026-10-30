# Buenos Aires — Red Mutual - paii

## Identificacion

- Provincia: Buenos Aires (`221`); CABA es un valor diferente (`4145`).
- Procesos: precalificacion, clasificacion de negociacion y distribucion.
- Aprobacion funcional: Santiago, conversacion del 30/10/2026.
- Estado: implementado en rama; pendiente de merge y deploy.
- Version comercial: `2026-10-30-buenos-aires-v1`.

## Decision

Un caso de Buenos Aires con Policia, Docente, Empleado Publico Provincial o
Jubilado Provincial, sin coincidencia CUAD, llega a GANADO y genera negociacion
interna. La negociacion se aprueba en PRESENTACION con `Red Mutual - paii` y se
distribuye en el bucket existente `santa_fe_anses`.

## Condiciones

| Dato | Condicion |
|---|---|
| Provincia | Buenos Aires (`221`) |
| Situacion laboral | Policia (`1269`), Docente (`3745`), Empleado Publico Provincial (`1239`) o Jubilado Provincial (`2565`) |
| Banco de cobro | Cualquiera; ausente o sin catalogar no bloquea la precalificacion |
| BCRA | Sin limites ni consulta obligatoria; ausente, fallido o negativo no bloquea |
| Edad, afiliacion y prestamos previos | Sin requisitos |
| Actualizacion Vimarx | No se exige para decidir ni se esperan sus reintentos |
| Antecedente Haberes CUAD | Conserva prioridad global de derivacion externa |

Empleado Publico Municipal y Nacional, Salud, Pensionado y Jubilado Municipal no
se incorporan. Jubilado Nacional conserva la regla ANSES de alcance nacional.
Policia Federal (`4165`) no es Policia (`1269`): conserva su circuito separado,
incluida la pausa comercial de CABA. No se abre una nueva ruta PFA en Buenos Aires.

## Resultado y distribucion

Las negociaciones nuevas usan PENDIENTE CALIFICACION KESTRA con responsable
provisional Maru (`57`); la aprobacion posterior usa motivo
`buenos_aires_approved`, PRESENTACION (`C1:NEW`) y `Red Mutual - paii`.

El bucket `santa_fe_anses` conserva su clave y configuracion del panel: Patricia
Contendi (`10451`), Susana Contenti (`29`) y Julieta Aguilera (`116561`) como pool
inicial. Comparte recurrencia, compensacion, disponibilidad, horarios y cola con
ANSES/Santa Fe. Si queda un unico vendedor habilitado, aplica la asignacion directa
general, incluso offline y fuera de horario.

## Prioridad y datos faltantes

La base CUAD permanece congelada. Una coincidencia exacta con CUIT completo deriva
externamente antes de evaluar el perfil. CUIT/CUIL incompleto se considera sin
coincidencia y se decide por provincia y situacion laboral, sin revision manual
por identidad. Se conservan ownership y exclusiones operativas existentes.

## Casos de aceptacion

| Caso | Resultado |
|---|---|
| Docente de Buenos Aires sin banco, con CUIL incompleto y sin BCRA | GANADO; negociacion Red Mutual - paii en el bucket compartido |
| Policia de Buenos Aires con 30 entidades en situacion 5 | Aprobado; BCRA no limita esta familia |
| Jubilado Provincial de Buenos Aires con consulta BCRA fallida o reintento pendiente | Aprobado; no espera BCRA ni Vimarx |
| Perfil habilitado de Buenos Aires con antecedente CUAD | Derivacion externa; sin negociacion interna nueva |
| Municipal, Nacional, Salud o Pensionado de Buenos Aires | No califica por esta ampliacion |
| Policia Federal o perfil habilitado que declara CABA | No ingresa por esta regla de Buenos Aires |

No existen casos de rechazo BCRA ni revision manual comercial dentro de estos
cuatro perfiles por los datos expresamente exceptuados. Los fallos tecnicos de
lectura o persistencia conservan el manejo de errores existente.
