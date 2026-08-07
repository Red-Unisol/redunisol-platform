# Pipeline De Leads WIP

Estado: implementación en revisión.

## Flujo

```text
Formulario
  |-- preclasificación comercial (sin persistencia)
  `-- carga de contacto y lead
            |
            v
     INGRESO (UC_5N2OEO)
            |
            | prefill: ARCA + CredixSA + Vimarx + BCRA
            | hasta 3 intentos, sin revisar ownership
            v
     PRECLASIFICACION (NEW)
            |
            | ONCRMLEADUPDATE
            | Motor = Kestra para todo lead nuevo
            | provincia + situacion laboral + banco + responsable
            v
   RESULTADO GANADO / rechazo
            |
            | ONCRMLEADUPDATE al quedar ganado
            v
        Negociacion
            |
            | Catamarca + Motor Kestra:
            | PENDIENTE CALIFICACION KESTRA + Maru
            v
     Calificacion definitiva
     BCRA + condicion de socio
            |
            |-- aprobado: PRESENTACION + vendedor definitivo
            |-- BCRA duro: SIT. NEG. EN BCRA
            `-- incompleto/ambiguo: REVISION MANUAL KESTRA
```

## Carga

`bitrix24_form_webhook` espera la creación efectiva del contacto y lead antes de
responder. El lead se crea explícitamente en `INGRESO (UC_5N2OEO)`. El endpoint no
consulta proveedores ni cambia el resultado comercial.

## Prefill

`bitrix24_lead_prefill` procesa un lead `INGRESO (UC_5N2OEO)` por ejecución y tiene
concurrencia 1. Completa los datos disponibles de ARCA, CredixSA, Vimarx y BCRA. El campo
`UF_CRM_KSTRA_BF_ATTEMPTS` registra los intentos entre ejecuciones.

El scheduler usa como corte inicial `2026-07-21T00:00:00-03:00`. Además del corte,
el filtro por estado evita tomar los leads históricos que permanecen en
`PRECLASIFICACION (NEW)`.

- sin errores temporales: mueve inmediatamente a `PRECLASIFICACION (NEW)`
- con errores y menos de 3 intentos: conserva `INGRESO (UC_5N2OEO)`
- al tercer intento: conserva lo obtenido y mueve a `PRECLASIFICACION (NEW)`

Los schedulers independientes de BCRA y CredixSA quedan deshabilitados para evitar
procesamiento duplicado.

La entrada a `NEW` es el punto de entrega deliberado a Kestra. Todo lead nuevo recibe
`Motor decision comercial = Kestra`. El BP comercial nativo de Bitrix se retira en un
corte unico; solo permanece un BP minimo para enviar el correo Finguru.

## Clasificación Reactiva

El webhook existente de `ONCRMLEADUPDATE` funciona como dispatcher:

- `PRECLASIFICACION (NEW)` creado desde `2026-08-07T12:28:19-03:00`: ejecuta la
  clasificacion para cualquier owner previo y persiste owner Kestra con el resultado
- responsable Diego Frias (`7`): omite la clasificación automatica
- `RESULTADO GANADO`: crea o reutiliza la negociación
- cualquier otra etapa: no hace nada

La precalificacion reactiva no consulta ni interpreta BCRA. Usa los mismos criterios
locales que el endpoint consumido por el formulario.

Rio Negro, Santa Fe y Neuquen conservan sus reglas migradas desde Bitrix y mueven los
casos aceptados a `NEGOCIACION CON VENDEDOR (13)`. Los rechazos de todas las provincias
se normalizan en `RESULTADO PERDIDO` con `Motivo Rechazo`.

Para Catamarca, el listener crea la negociacion en una etapa aislada y con responsable
provisional. `bitrix24_catamarca_deal_qualification` procesa una negociacion pendiente
por minuto. La decision definitiva reutiliza los datos enriquecidos por el prefill,
aplica el criterio BCRA confirmado y recien al aprobar asigna vendedor y mueve a
`PRESENTACION`.
