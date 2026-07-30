# Pipeline De Leads WIP

Estado: implementación en revisión.

## Flujo

```text
Formulario
  |-- preclasificación comercial (sin persistencia)
  `-- carga de contacto y lead
            |
            v
           NEW
            |
            | prefill: ARCA + CredixSA + Vimarx + BCRA
            | hasta 3 intentos, sin revisar ownership
            v
     PRECLASIFICACION
            |
            | ONCRMLEADUPDATE
            | solo clasifica si Motor = Kestra
            v
   RESULTADO GANADO / rechazo
            |
            | ONCRMLEADUPDATE al quedar ganado
            v
        Negociación
```

## Carga

`bitrix24_form_webhook` espera la creación efectiva del contacto y lead antes de
responder. El lead se crea en `NEW`. El endpoint no consulta proveedores ni cambia
el resultado comercial.

## Prefill

`bitrix24_lead_prefill` procesa un lead `NEW` por ejecución y tiene concurrencia 1.
Completa los datos disponibles de ARCA, CredixSA, Vimarx y BCRA. El campo
`UF_CRM_KSTRA_BF_ATTEMPTS` registra los intentos entre ejecuciones.

El scheduler usa como corte inicial `2026-07-21T00:00:00-03:00`. Esto evita tomar
los 1499 leads históricos que actualmente siguen en `NEW`; el corte puede modificarse
al ejecutar manualmente un backfill controlado.

- sin errores temporales: mueve inmediatamente a `PRECLASIFICACION`
- con errores y menos de 3 intentos: conserva `NEW`
- al tercer intento: conserva lo obtenido y mueve a `PRECLASIFICACION`

Los schedulers independientes de BCRA y CredixSA quedan deshabilitados para evitar
procesamiento duplicado.

## Clasificación Reactiva

El webhook existente de `ONCRMLEADUPDATE` funciona como dispatcher:

- `PRECLASIFICACION` y owner Kestra: ejecuta la clasificación
- `PRECLASIFICACION` con otro owner: no hace nada
- `RESULTADO GANADO`: crea o reutiliza la negociación
- cualquier otra etapa: no hace nada

La clasificación reutiliza el snapshot BCRA persistido por el prefill. Si el snapshot
no está disponible, puede hacer un último intento online y continúa con la información
existente si el proveedor sigue temporalmente indisponible.
