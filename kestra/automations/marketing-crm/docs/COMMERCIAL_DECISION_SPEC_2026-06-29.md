# Especificacion De Decision Comercial Y Derivacion De Leads

Fecha: 2026-06-29

Estado: borrador funcional para alinear con Marketing, Comercial y Operaciones antes de implementar cambios en Kestra/Bitrix24.

Fuente principal:

- `untracked/Criterios de decision comercial y derivacion de leads por provincia y linea.txt`

Fuentes tecnicas revisadas:

- `kestra/automations/marketing-crm/files/bitrix24_form_flow/form_processor/qualification.py`
- `kestra/automations/marketing-crm/docs/LEADS_AUDIT_2026-03-30.md`
- Consulta read-only a Bitrix24 de pipelines, etapas y muestras recientes de negociaciones.

## Alcance Del Documento

Este documento persiste:

- decisiones ya tomadas
- evidencia operativa observada en Bitrix24
- ambiguedades pendientes
- criterios recomendados para convertir el blueprint comercial en automatizacion

No es todavia una especificacion de implementacion cerrada.

## Decisiones Tomadas

1. `PROSPECTO = GANADO` significa ejecutar todo el paquete operativo:
   - cambiar estado del lead/prospecto
   - crear negociacion
   - asignar responsable

2. Se debe crear negociacion para todo prospecto ganado.

3. La implementacion debe seguir el modelo operativo actual de Bitrix24 siempre que sea posible, en vez de inventar un flujo paralelo.

4. La Rioja no debe automatizar clasificacion comercial fina en esta etapa. El informe indica validacion manual por Mercedes.

5. Las reglas incompletas o pendientes de definicion no deben automatizarse como rechazo duro sin confirmacion comercial.

6. Las negociaciones de prospectos ganados deben crearse en:
   - pipeline: `VENTAS`
   - `CATEGORY_ID=1`
   - etapa inicial: `C1:NEW` (`PRESENTACION`)

7. El pool interno `Dani / Pato / Nati / Sole` se asigna con estas reglas:
   - por defecto, round-robin para contactos nuevos
   - si el contacto ya tuvo prospectos previos, asignar al vendedor del prospecto previo mas reciente
   - las recurrencias deben computarse para mantener equidad; el round-robin de contactos nuevos debe compensar para que quienes reciben mas recurrencias no terminen con mas prospectos totales

8. La linea comercial requiere campos custom en Bitrix:
   - campo custom en lead
   - campo custom en deal
   - al crear la negociacion, el deal debe heredar/copiar la linea comercial calculada en el lead

## Evidencia Bitrix24

Pipelines de negociaciones existentes observados:

| ID | Nombre |
| --- | --- |
| 1 | VENTAS |
| 3 | CALIFICADORES |
| 5 | VENTAS 2 |
| 7 | Esquema |
| 9 | AMT |
| 11 | At. Clientes - Mora |
| 13 | Marketing |
| 15 | TOFU |

Pipeline candidato para negociaciones generadas desde prospectos ganados:

- `CATEGORY_ID=1`
- nombre: `VENTAS`

Motivo:

- `VENTAS` tenia 59545 negociaciones al momento de la consulta.
- Las 50 negociaciones recientes consultadas en `VENTAS` estaban vinculadas a `LEAD_ID`.
- `VENTAS 2` tenia solo 3 negociaciones, aunque sus etapas tienen nombres parecidos al blueprint comercial.
- `At. Clientes - Mora` corresponde a cobranzas/mora, no a venta nueva.

Etapa inicial recomendada si se confirma `VENTAS`:

- `STAGE_ID=C1:NEW`
- nombre: `PRESENTACION`

Patron observado en negociaciones recientes de `VENTAS`:

- `CATEGORY_ID=1`
- `TYPE_ID=SALE`
- `SOURCE_ID=CALL`
- `LEAD_ID` vinculado

Nota:

- `SOURCE_ID=CALL` parece funcionar como default historico y no representa bien el canal real.
- El canal real del formulario esta en el custom de lead `origenFormulario` (`UF_CRM_1722365051`).

## Usuarios Bitrix Confirmados

IDs confirmados manualmente el 2026-06-29:

| Usuario | ID Bitrix | Uso probable |
| --- | ---: | --- |
| Susana Contenti | 29 | Responsable observado en `VENTAS` |
| Maru Lopez | 57 | Creadora/responsable observada en `VENTAS` |
| Mercedes | 85431 | La Rioja, validacion manual |
| Patricia Contendi | 10451 | Pool interno, `Pato` |
| Daniel Carrera | 68579 | Pool interno, `Dani` |
| Natalia Rojo Moyano | 71159 | Pool interno, `Nati` |
| Nancy Romina Spengler | 74365 | Vendedora Nancy |
| Ana Selene Surbano | 84125 | Responsable observada en `VENTAS` |
| Soledad Rojo Moyano | 90231 | Pool interno, `Sole` |

Notas:

- El webhook/API actual solo tiene scope `crm`; los metodos `user.get` y `user.search` devuelven `insufficient_scope`. Por eso estos IDs no se pudieron resolver por API y fueron confirmados manualmente.

## Etapas Relevantes En Pipeline VENTAS

Etapas abiertas:

| Stage ID | Nombre |
| --- | --- |
| `C1:NEW` | PRESENTACION |
| `C1:UC_ZH5DGU` | RESPUESTA |
| `C1:UC_53P7WJ` | DOCUMENTACION |
| `C1:UC_D4N3Y4` | FALTA DOCUMENTACION |
| `C1:EXECUTING` | OFERTA |
| `C1:7` | EN VALIDACION |
| `C1:WON` | ACREDITACION Y FIDELIZACION |

Etapas/cierres utiles para rechazos o derivaciones:

| Stage ID | Nombre |
| --- | --- |
| `C1:4` | NEGOCIACION CON VENDEDOR EXTERNO |
| `C1:5` | SIT. NEG. EN BCRA |
| `C1:6` | NO CUMPLE REQUISITOS |
| `C1:9` | TIENE MORA |
| `C1:APOLOGY` | SIN CUPO HABERES |
| `C1:16` | SIN CUPO CBU |
| `C1:20` | SIN RATIO PARA RENOVAR |
| `C1:21` | SIN MARGEN |

## Estados Y Motivos Existentes En Leads

Estados de lead relevantes:

| Status ID | Nombre |
| --- | --- |
| `UC_64AUC9` | RESULTADO GANADO |
| `CONVERTED` | ANALISIS |
| `JUNK` | OTRA PROVINCIA |
| `UC_1P8I07` | RESULTADO PERDIDO |
| `UC_2B72LN` | SIT NEG BCRA |
| `1` | OTRO BANCO |
| `3` | AUTONOMO |
| `4` | AUH (asignaciones) |
| `UC_LG4IKC` | JUBILADO PROVINCIAL |
| `UC_3L8S0S` | PENSIONADO |
| `UC_TJVEF4` | JUBILADO NACIONAL |
| `UC_PO398Z` | PUBLICO NACIONAL |
| `8` | PRIVADOS |
| `9` | MUNICIPAL |
| `10` | NO CUMPLE REQUISITOS PARA CONVENIO |
| `13` | NEGOCIACION CON VENDEDOR |
| `14` | NO SON SOCIOS NI QUIEREN PRESTAMO |

Motivos de rechazo custom existentes (`UF_CRM_REJECTION_REASON`):

- OTRA PROVINCIA
- SIT NEG BCRA
- SIN RESPUESTA
- OTRO BANCO
- NO TIENE ANTIGUEDAD
- AUTONOMO
- AUH (asignaciones)
- JUBILADO PROVINCIAL
- PENSIONADO
- JUBILADO NACIONAL
- PUBLICO NACIONAL
- NO TIENE RECIBO (en negro)
- CONTRATADO
- NUMERO INCORRECTO
- PRIVADOS
- MUNICIPAL
- NO CUMPLE REQUISITOS PARA CONVENIO
- NO SON SOCIOS NI QUIEREN PRESTAMO

## Brecha Entre Informe Y Codigo Actual

El codigo actual automatiza principalmente:

- provincia
- situacion laboral
- banco de cobro
- consulta BCRA generica, excepto La Rioja

El informe comercial agrega decisiones sobre:

- creacion de negociacion
- asignacion de vendedor
- linea comercial
- socio / cliente nuevo / recurrente
- creditos vigentes
- mora
- cuotas pagadas
- renovacion
- paralelo
- reglas BCRA por linea
- validaciones manuales

Por eso conviene separar la implementacion en dos decisiones:

1. decision de prospecto: ganado, rechazado, derivado, pendiente manual
2. decision comercial: linea sugerida, vendedor, necesidad de analisis manual, etapa de negociacion

## Ambiguedades Pendientes

1. Definir si hay que crear campos nuevos en Bitrix para:
   - vendedor sugerido
   - requiere analisis manual
   - resultado BCRA por linea
   - tipo de caso

2. Para Neuquen, Rio Negro y Santa Fe: definir vendedor externo, si se crea negociacion en `VENTAS`, si queda en `C1:4` y si se envia mail.

3. Para provincias fuera de alcance: rechazar, dejar sin procesar, derivar o crear negociacion manual.

4. Definir plantilla de mail Bitrix para derivacion externa, destinatarios y remitente.

5. Definir si el envio de mails lo hace Kestra via API o una automatizacion interna de Bitrix disparada por estado/campo.

6. La Rioja: confirmar si `Salud` equivale a `Personal de Salud` del formulario y debe aceptarse.

7. Cordoba: confirmar si `Empleado de la UNC` y `DASPU` siguen aceptados aunque no figuren en el informe.

8. La Rioja: confirmar que nunca consulta BCRA automaticamente, ni siquiera despues de crear negociacion.

9. La Rioja: confirmar que todo prospecto ganado se asigna siempre a Mercedes y queda para validacion manual.

10. Definir como identificar si la persona es socio, cliente nuevo o recurrente: Vimarx, campo Bitrix, formulario o validacion manual.

11. Definir como identificar credito vigente, cantidad de creditos activos, mora, cuotas pagadas, renovacion y paralelo.

12. Definir que datos de Vimarx son fuente valida para decision automatica y cuales solo deben mostrarse para analisis manual.

13. Definir reglas para `BCRA REN`; el informe lo marca como pendiente de definicion.

14. Definir como matchear banco de cobro contra entidades del BCRA: nombre exacto, alias normalizados, codigo/CUIT de entidad o tabla manual.

15. Para CBU nuevos / propia recurrentes: confirmar si "hasta 5 situaciones" significa hasta 5 entidades en situacion 1 o hasta 5 registros totales.

16. Para CBU Comer recurrentes: confirmar que significa "cupo afectado al 0,1" y si existe fuente para calcularlo.

17. Para Cruz del Eje Especial: confirmar si permite cualquier cantidad de situaciones 2/3 y solo limita situaciones 4/5.

18. Para rechazo duro Cordoba: confirmar si "situacion 2 o mayor en Banco de Cordoba" se evalua contra entidad BCRA Banco de Cordoba, independientemente del banco de cobro declarado.

19. Para Caja Morosos: definir como detectar si la irregularidad es con banco de cobro, especialmente Bancor o Macro.

20. Para Catamarca: confirmar si "situacion mayor a 1 en Banco Nacion" es rechazo duro siempre.

21. Para AMEJUCA Premium: confirmar si manda "sin situaciones con ninguna entidad" o "equivalente operativo: situacion 1".

22. Definir que pasa cuando faltan datos para una regla: rechazar, dejar pendiente manual o crear negociacion sin linea asignada.

23. Definir si `rechazo por analisis` debe cerrar automaticamente como perdido o quedar en etapa manual de revision.

24. Definir si la respuesta del webhook al formulario debe seguir siendo binaria `qualified/rejected` o devolver tambien linea, vendedor y estado manual.

25. Definir que reglas deben aplicarse inmediatamente en carga via formulario y cuales solo en reclasificacion posterior, cuando ya existe enrichment Vimarx/BCRA.

26. Definir si se migra o limpia el comportamiento actual donde `SOURCE_ID` queda como `CALL` aunque el origen real venga del formulario.

## Recomendacion De Implementacion

Fase 1:

- mantener el comportamiento actual de preclasificacion binaria
- corregir solo reglas confirmadas de provincia/situacion laboral/banco
- crear negociacion para todo prospecto ganado
- usar pipeline/etapa confirmada por Bitrix
- no automatizar reglas comerciales que dependan de datos incompletos

Fase 2:

- agregar campos de salida comercial si se confirman
- persistir linea sugerida, vendedor sugerido y estado manual
- implementar asignacion de responsables

Fase 3:

- implementar motor BCRA por linea sobre el JSON raw
- cubrir con tests por provincia, situacion laboral, banco, linea y entidad BCRA

Fase 4:

- automatizar casos de socio/recurrente/renovacion/paralelo/mora solo cuando la fuente de datos este validada.
