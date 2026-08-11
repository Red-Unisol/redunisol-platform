# Glosario Comercial

Versión: `2026-08-10`

## Entidades

| Término | Definición |
|---|---|
| Lead | Registro inicial que atraviesa ingreso, enriquecimiento y precalificación. |
| Negociación | Oportunidad comercial creada únicamente después de que el lead obtiene un resultado interno ganado. |
| No socio | Persona para la que Vimarx no encontró una afiliación. Vimarx informa en ese caso cero créditos activos; el contador no es un criterio comercial independiente. |
| Socio recurrente | Persona identificada como socia que puede acceder a una línea para clientes existentes. |
| Crédito vigente | Crédito activo detectado en Vimarx. No equivale por sí solo a renovación, paralelo ni mora. |
| Préstamo activo Cruz del Eje | Crédito vigente cuya línea de origen pertenece a la familia Cruz del Eje. Es el único tipo de préstamo activo que interviene en una renovación, paralelo o mora de Cruz del Eje. |
| Préstamo activo CBU propio | Crédito vigente de una línea CBU propia. No convierte ni bloquea la evaluación Cruz del Eje de Policía o Empleado Público Provincial. |
| Snapshot BCRA | Copia persistida de la consulta BCRA usada para que una decisión sea reproducible. |
| Entidad | Institución informada dentro del último período del snapshot BCRA. |
| Situación | Calificación BCRA de una entidad para el período evaluado. |
| Banco de cobro | Banco declarado o normalizado donde la persona cobra sus haberes. |
| Línea | Producto o línea comercial registrada en la negociación. |
| CBU Recurrente | Evaluación CBU para una persona socia que encuadra como recurrente. No existen subtipos Propia ni Comer en la especificación vigente. |
| Bucket | Regla de distribución que determina el conjunto de vendedores posibles. No determina aprobación ni línea. |

## Etapas de negociación

| Nombre funcional | Significado |
|---|---|
| PENDIENTE CALIFICACIÓN KESTRA | La negociación espera una decisión automática. |
| PRESENTACIÓN | La evaluación automática encontró una línea comercial aprobable. |
| REVISIÓN MANUAL KESTRA | No existe información o regla suficiente para una decisión automática segura. |
| REVISIÓN DE ENRUTAMIENTO KESTRA | La decisión comercial puede existir, pero no puede ejecutarse la distribución. |
| SIT. NEG. EN BCRA | Una regla BCRA explícita determinó un rechazo duro. |

## Resultados de clasificación

| Resultado | Etapa | Campo Línea |
|---|---|---|
| Aprobado | PRESENTACIÓN | Obligatorio. |
| Rechazo BCRA | SIT. NEG. EN BCRA | Vacío, salvo decisión comercial explícita en contrario. |
| Revisión manual | REVISIÓN MANUAL KESTRA | Vacío o sugerido; debe indicarse cuál de las dos alternativas corresponde. |

## Valores especiales

| Valor | Uso correcto |
|---|---|
| Cualquiera | La condición no influye en esa regla. |
| Desconocido | El dato falta, no pudo consultarse o no es confiable. |
| No aplica | El concepto no corresponde al caso. |

`Desconocido` y `No aplica` no son equivalentes. Por ejemplo, una persona sin crédito
vigente tiene renovación `No aplica`; una persona con crédito vigente cuyos pagos no
pudieron consultarse tiene cumplimiento `Desconocido`.

## Campos técnicos conocidos

Esta sección sirve como referencia para Tecnología y no debe utilizarse como lenguaje
principal en las reuniones funcionales.

| Concepto | Campo Bitrix24 |
|---|---|
| Línea de la negociación | `ufCrm_659EBB0445E8E` |
| Fecha de nacimiento del lead | `BIRTHDATE` |
| Bucket de distribución | `ufCrmRouteBucket` |
| Motor de decisión comercial del lead | `UF_CRM_COMM_OWNER` |
