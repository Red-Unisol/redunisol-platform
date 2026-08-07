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
- los rechazos terminan en `RESULTADO PERDIDO` y guardan el detalle en `Motivo Rechazo`
- Catamarca y Cordoba usan las listas ampliadas de Kestra
- La Rioja conserva la regla observada en Bitrix
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

## Corte Unico

Orden operativo obligatorio:

1. desplegar los flows y namespace files nuevos en dev y ejecutar tests de humo
2. crear y probar el BP minimo de correo Finguru
3. detener o deshabilitar el BP comercial anterior
4. desplegar la revision de Kestra a prod
5. ejecutar `bitrix24_prequalification_cutover` con `dry_run=true`
6. revisar el listado y ejecutar nuevamente con `dry_run=false`
7. habilitar el BP minimo de correo
8. probar un caso aprobado, un rechazo, una derivacion externa, Diego Frias y Finguru

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
