# Identidad de socios en Vimarx

Préstamos y refinanciación, datos rápidos, CBU habitual y evaluación usan
`SocioLegacyIdentityResolver`. La resolución consulta Vimarx en vivo; no depende
del padrón PostgreSQL, cuyo sincronizador puede excluir registros incompletos.

## Criterios

1. Normalizar documento, tipo y CUIT guardados en la solicitud. Aceptar sólo
   identificadores numéricos, sin interpolar expresiones del cliente.
2. Consultar candidatos por documento y tipo, o CUIT. Pedir sólo
   `ID;NroDoc;CUIT;TipoDoc.Descripcion`, hasta 21 filas.
3. Priorizar el CUIT exacto compatible con el documento. Un documento distinto
   explícitamente informado en ese registro es un conflicto. El CUIT exacto
   también permite recuperar un socio con documento faltante.
4. Si no hay CUIT exacto, admitir el respaldo por documento y tipo únicamente
   cuando los candidatos no tengan un CUIT contradictorio. Si la solicitud no
   tiene documento, contemplar jurídicas que guardan el CUIT en `NroDoc`.
5. Elegir únicamente una coincidencia. Dos identidades igualmente compatibles
   quedan ambiguas; no desempatar por orden de respuesta, número de socio,
   antigüedad, préstamos o CBU. Alcanzar el límite, recibir filas mal formadas,
   conflictos o errores deja el dato sin verificar, nunca confirma ausencia.

Ejemplo ficticio: dos registros comparten DNI; uno tiene el CUIT de la solicitud
y otro no tiene CUIT. Se elige el primero aunque ambos tengan préstamos. Si los
dos comparten DNI y CUIT, la identificación requiere revisión; no se mezclan sus
cuentas ni se elige uno arbitrariamente.

## Uso del ID resuelto

El CBU se lee por `SocioMutual.ID`, desde `CuentaBancariaHabitual.CBU`. La
evaluación consulta situación, rechazos y fecha de alta por ese mismo ID; saldo
y compromiso mensual filtran `SocioTitular.Socio.ID`. Préstamos y refinanciación
conservan sus validaciones de pertenencia por `Integrantes[Socio.ID]`.

Si la identidad es ambigua o falla, la evaluación devuelve historial desconocido
(`null`), no saldo cero ni titular nuevo. Los datos rápidos conservan sus estados
de incertidumbre y el CBU no expone datos bancarios de candidatos ambiguos.

La caché del detalle incluye CUIT. Editar documento, tipo o CUIT suspende la
comparación bancaria hasta guardar o cancelar, para no comparar contra el socio
que se había consultado antes.

## Integridad de préstamos

El listado pide hasta 2001 préstamos en lugar de los primeros 100. Los totales
de evaluación también piden hasta 2001 filas en lugar de 200. Si se alcanza ese
límite, el listado falla y el total queda desconocido: no se presentan datos
truncados como completos. Un importe ausente tampoco se suma como cero.

La verificación de sólo lectura del 12/11/2026 encontró un socio con 245
préstamos cuyos préstamos recientes no estaban en las primeras 100 filas. La
consulta ampliada incluyó ambos. No se modificaron socios ni préstamos para
probarlo. Los tests versionados usan exclusivamente identidades ficticias.
