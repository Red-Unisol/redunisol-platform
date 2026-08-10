# Centralizacion De Precalificacion En Kestra

Estado: implementado en Git; pendiente de deploy y corte operativo.

## Alcance

Kestra pasa a ser el unico motor de decision comercial de la etapa de precalificacion.
Bitrix conserva los datos del CRM, emite `ONCRMLEADUPDATE`, persiste el resultado y,
temporalmente, envia el correo de seguimiento Finguru.

No se implementa una migracion gradual por provincia. El cambio operativo es un unico
corte coordinado.

## Politica Implementada

- todos los leads creados por Kestra reciben `Motor decision comercial = Kestra`
- `bitrix24_lead_won_deal_webhook` toma la decision para cualquier owner comercial si
  el lead fue creado desde `2026-08-07T12:28:19-03:00`; al persistir el resultado deja
  `Motor decision comercial = Kestra`
- los leads creados antes del corte quedan fuera aunque reciban actualizaciones futuras
- los rechazos terminan en `RESULTADO PERDIDO` y guardan el detalle en `Motivo Rechazo`
- Catamarca y Cordoba usan las listas ampliadas de Kestra
- La Rioja deriva a vendedor externo cuando cumple sus reglas de elegibilidad; no
  pasa a `RESULTADO GANADO` ni genera negociacion interna
- Rio Negro, Santa Fe y Neuquen conservan la derivacion observada en Bitrix a
  `NEGOCIACION CON VENDEDOR (13)` cuando cumplen sus reglas
- Diego Frias (`ASSIGNED_BY_ID=7`) queda excluido de la precalificacion automatica
- los datos incompletos o no soportados fallan de forma explicita y no aprueban por default
- Finguru (`origenFormulario=3729`) es reconocido por Kestra, pero el correo sigue en Bitrix

## Reglas De Derivacion Externa

### Rio Negro

- empleado publico provincial o policia: deriva sin condicion de banco
- jubilado provincial o pensionado: deriva solo con Banco Nacion o Banco Patagonia
- cualquier otra situacion: `RESULTADO PERDIDO` con motivo
- jubilado/pensionado con otro banco: `RESULTADO PERDIDO` + `OTRO BANCO`

### Santa Fe

Deriva a vendedor externo para empleado publico provincial, policia, jubilado provincial
o pensionado. Las restantes situaciones se rechazan con motivo.

### Neuquen

Deriva a vendedor externo para empleado publico provincial, empleado publico municipal,
policia o jubilado provincial. Las restantes situaciones se rechazan con motivo.

## BP Minimo Que Permanece En Bitrix

El BP exportado como `bp-1 (3).bpt` no puede permanecer sin cambios: su primera rama
finaliza todo el proceso cuando el owner es Kestra, por lo que tambien impediria el correo.

Debe reemplazarse por un BP dedicado exclusivamente al correo, con esta estructura:

```text
SI origenFormulario = Finguru
  Enviar email al primer correo del cliente
FIN
```

No debe agregarse una compuerta por `Motor decision comercial`: al verificar los 25
leads Finguru mas recientes el 2026-08-07, todos tenian owner `Bitrix` (`4117`).
El identificador confirmado de `Finguru` en `origenFormulario` es `3729`.

Configuracion que se conserva del BP actual:

- asunto: `Red Unisol: seguimos tu consulta 🚀`
- remitente: `Red Unisol <contacto@redunisol.com.ar>`
- contenido HTML: reutilizar la plantilla actual
- selector de destinatario: primer email del cliente
- link tracking: habilitado
- baja: conservar `#UNSUBSCRIBE_LINK#`

Ese BP no debe cambiar titulo, etapa, responsable, motivo de rechazo ni crear negociaciones.

El artefacto importable se puede regenerar desde el export original con:

```text
php kestra/tools/build_bitrix_finguru_email_bp.php <origen.bpt> <salida.bpt>
```

## Corte Operativo

El BP comercial anterior fue reemplazado por el BP minimo de correo y Kestra fue
desplegado a produccion. La frontera que separa casos nuevos de historicos es:

`2026-08-07T12:28:19-03:00`

El webhook de actualizacion aplica esa frontera antes de tomar ownership o decidir. No
se debe ejecutar `bitrix24_prequalification_cutover` sin `date_from`: el dry-run global
del 2026-08-07 encontro `1515` candidatos historicos que no forman parte del corte.

Validacion operativa pendiente:

1. probar un caso aprobado posterior al corte
2. probar un rechazo posterior al corte
3. probar una derivacion externa posterior al corte
4. confirmar que Diego Frias sigue omitido
5. confirmar que Finguru recibe el correo y luego es clasificado por Kestra

El flow de cutover solo cambia ownership para leads que en ese momento estan en
`INGRESO` o `PRECLASIFICACION`. No modifica leads ya ganados, perdidos, convertidos o
derivados.

## Rollback

Si el corte falla:

1. detener el webhook/scheduler de clasificacion Kestra
2. deshabilitar el BP minimo de correo para evitar duplicados
3. reactivar temporalmente el BP comercial exportado
4. devolver a `Bitrix` el owner de los leads que sigan en `INGRESO` o
   `PRECLASIFICACION`

No se debe ejecutar Kestra y el BP comercial completo simultaneamente sobre los mismos
leads.
