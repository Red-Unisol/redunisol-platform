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
            | solo precalifica si Motor = Kestra
            | provincia + situacion laboral + banco
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

La entrada a `NEW` es el punto de entrega deliberado a las automatizaciones
reactivas. Las ramas nativas de Bitrix en ese estado deben excluir los leads cuyo
campo `Motor decision comercial` sea `Kestra`.

## Clasificación Reactiva

El webhook existente de `ONCRMLEADUPDATE` funciona como dispatcher:

- `PRECLASIFICACION (NEW)` y owner Kestra: ejecuta la clasificación
- `PRECLASIFICACION (NEW)` con otro owner: no hace nada
- `RESULTADO GANADO`: crea o reutiliza la negociación
- cualquier otra etapa: no hace nada

La precalificacion reactiva no consulta ni interpreta BCRA. Usa los mismos criterios
locales que el endpoint consumido por el formulario.

Para Catamarca, el listener crea la negociacion en una etapa aislada y con responsable
provisional. `bitrix24_catamarca_deal_qualification` procesa una negociacion pendiente
por minuto. La decision definitiva reutiliza los datos enriquecidos por el prefill,
aplica el criterio BCRA confirmado y recien al aprobar asigna vendedor y mueve a
`PRESENTACION`.
