# Precalificacion de leads — ANSES, Santa Fe, Neuquen y Haberes CUAD

Version: `2026-10-30-anses-santa-fe-neuquen-cuad-history`.

Estado: **implementado en rama, pendiente de deploy**. Definicion funcional confirmada
por Santiago en la conversacion del 30/10/2026. Git conserva las reglas y la base congelada; Vimarx fue la fuente del relevamiento
realizado el 30/10/2026. Los CUIT personales no se guardan en Git.

## Alcance y prioridad

El resultado de esta capa es `GANADO`, `PERDIDO` o `NEGOCIACION CON VENDEDOR (13)`.
No define nuevas lineas comerciales, etapas de negociacion ni pools de vendedores.
La clasificacion y distribucion posteriores para las nuevas familias se definiran
por separado en esta misma conversacion.

Se conservan el corte temporal y las exclusiones operativas existentes: responsables
excluidos, ownership y marcadores de prueba no se reemplazan por estas reglas.

| Prioridad | Regla | Condicion | Resultado |
|---:|---|---|---|
| 10 | `LEAD-CUAD-010` | El CUIT/CUIL completo coincide exactamente con la base historica Haberes CUAD | Derivacion externa, en cualquier provincia y para cualquier situacion laboral; prevalece incluso sobre ANSES |
| 20 | `LEAD-ANSES-010` | Jubilado Nacional, sin antecedente CUAD | GANADO; provincia y banco no restringen la elegibilidad, aunque esos campos esten ausentes |
| 30 | `LEAD-SFE-010` | Santa Fe + Docente, Empleado Publico Provincial, Policia, Personal de Salud o Jubilado Provincial; sin antecedente CUAD | GANADO; cualquier banco |
| 40 | `LEAD-NEU-010` | Neuquen + Docente, Empleado Publico Provincial, Policia, Personal de Salud, Jubilado Provincial o Empleado Publico Municipal; sin antecedente CUAD | GANADO; cualquier banco |
| 50 | Reglas existentes | Resto de provincias y perfiles sin antecedente CUAD | Se conservan sus requisitos y resultados anteriores |

La derivacion externa general por provincia se elimina para Santa Fe y Neuquen.
La Rioja y Rio Negro conservan sus reglas provinciales, sujetas a la prioridad global
CUAD/ANSES. Pensionado no se incorpora a los requisitos internos de Santa Fe ni a
ANSES: en Santa Fe se rechaza si no coincide con la base CUAD. Con antecedente CUAD
rige la regla global de derivacion externa, sin usar la situacion laboral.

## Identidad incompleta y fuente no disponible

Por decision explicita de negocio, un CUIT/CUIL ausente o con cantidad de digitos
distinta de once se considera **sin coincidencia CUAD** y se clasifica con las reglas
de provincia y situacion laboral. No se deriva a revision manual por esa identidad.
Se conservan los restantes requisitos de datos y bancos de las reglas existentes.
No se comparan DNI, nombres ni coincidencias parciales contra la base historica.

Con once digitos se compara contra la base congelada incluida en el paquete. Si el
archivo no esta disponible o esta corrupto, no se interpreta como una lista vacia: se conserva el
estado del lead, con `waiting_for_update / haberes_cuad_registry_unavailable`. Esto
es una falla tecnica del archivo distribuido, distinta del CUIL incompleto admitido por negocio.

El endpoint anonimo de precalificacion comercial sigue evaluando los campos del
perfil, sin consultar identidad ni la base. La excepcion CUAD se aplica al clasificar
el lead persistido en CRM, cuando ya se dispone del CUIL.

## Base historica Vimarx

- Entidad: `Prestamo` (`F.Module.Cuentas.Prestamos.Prestamo`).
- Familia: `LineaPrestamo.Superior.ID = 2703`, **Haberes CUAD SANTA FE**; tambien se
  contempla un eventual prestamo asociado directamente a la linea superior 2703.
- Identificador: `SocioTitular.Socio.CUIT`, normalizado a once digitos y sin duplicados.
- Se incluyen creditos historicos, cancelados y refinanciados; no se filtra saldo,
  estado, fecha de emision ni provincia.
- Los registros sin CUIT utilizable se cuentan y omiten. No generan una identidad
  supuesta ni una coincidencia por documento parcial.
- La base se congela con los CUIT recuperados en el relevamiento. No existen
  consultas operativas, actualizaciones periodicas ni incorporaciones automaticas.

El relevamiento por MCP de Mutual Celesol produccion del **30/10/2026** encontro:

| Evidencia | Cantidad |
|---|---:|
| Lineas dependientes de la superior 2703 | 63 |
| Prestamos historicos recuperados, mediante paginacion por ID | 5.127 |
| CUIT distintos de once digitos | 1.945 |
| Prestamos sin CUIT utilizable, todos anulados en ese relevamiento | 398 |
| CUIT con digito verificador incorrecto en la base obtenida | 0 |

La base inicial y la lista de CUIT se conservaron en un artefacto local ignorado por
Git. Estas cantidades son evidencia del relevamiento, no una constante operativa.

## Base congelada y despliegue

Por decision explicita de Santiago, **la base queda congelada** al relevamiento del
30/10/2026. No hay scheduler, flow de refresh, KV mutable ni consultas a Vimarx para
resolver esta pertenencia. Los creditos o CUIT que se incorporen posteriormente en
Vimarx no modifican esta lista.

El paquete incluye `form_processor/haberes_cuad_registry_2026-10-30.json`, con los
1.945 hashes SHA-256 de los CUIT normalizados y los conteos de origen. El clasificador
normaliza el CUIL del lead, calcula el mismo hash y compara por igualdad. Git guarda
los hashes de coincidencia; los CUIT legibles permanecen en el artefacto local.

La base viaja con los namespace files del paquete Python y la utilizan los dos
puntos de entrada existentes de clasificacion. No requiere inicializar un KV ni
crear nueva configuracion operativa. Modificar la lista requiere un cambio explicito
y revisable en Git; este cambio no agrega ningun mecanismo de actualizacion.

No se ha desplegado este cambio ni reclasificado leads historicos cerrados durante
la implementacion. Las reglas posteriores de negociacion quedan pendientes de
definicion, sin introducir nuevas clasificaciones ni distribuciones en este cambio.

## Casos de aceptacion

| Caso | Resultado del lead |
|---|---|
| CUIT con credito CUAD cancelado; declara Buenos Aires y empleado privado | Derivacion externa |
| CUIT con historial CUAD; declara Jubilado Nacional | Derivacion externa |
| CUIT fuera de CUAD; Jubilado Nacional; cualquier provincia/banco | GANADO |
| CUIT fuera de CUAD; Jubilado Nacional; sin provincia o banco informado | GANADO |
| CUIL de ocho digitos; Docente Santa Fe | GANADO, asumiendo sin historial CUAD |
| Sin coincidencia CUAD; Pensionado Santa Fe | PERDIDO por situacion laboral |
| Sin coincidencia CUAD; Municipal Santa Fe | PERDIDO por situacion laboral |
| Sin coincidencia CUAD; Municipal Neuquen | GANADO |
| Sin coincidencia CUAD; Salud Neuquen | GANADO |
| CUIT completo; archivo de base congelada ausente | Conservar estado; error tecnico recuperable, sin decision comercial |
