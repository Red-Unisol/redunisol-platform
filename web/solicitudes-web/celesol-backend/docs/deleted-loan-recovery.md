# Recuperación excepcional de un vínculo a un préstamo eliminado

La generación y el reemplazo ordinarios no consideran que un préstamo ausente
esté anulado. La ausencia en `EvaluateObj` o `QueryEntidad` no autoriza a liberar
el vínculo: debe existir evidencia explícita de `Borrar` en la auditoría de
Vimarx, correspondiente al préstamo y su número de cuenta.

Este procedimiento describe una reparación operativa excepcional autorizada,
no un endpoint ni una migración automática. No modifica Vimarx ni genera
préstamos. El operador debe aprobar la intervención concreta antes de escribir.

## Condiciones previas

- Confirmar ambiente, solicitud, titular, préstamo anterior y auditoría de borrado.
- Releer Vimarx y descartar otro préstamo posterior del titular que requiera
  conciliación; una referencia ausente por sí sola no prueba una eliminación.
- Exigir estado `Confirmada`, sin archivo, liquidación previa, reserva,
  desembolso, pago, firma aprobada ni generación/reemplazo pendiente.
- Para este procedimiento acotado, exigir ausencia de cancelaciones y
  refinanciaciones. Los casos con cobros o deudas relacionados requieren otra
  revisión; no se deben repetir cobros al liberar la generación inicial.
- Verificar que está desplegado el fix que envía `FechaPrimerVto` y comprueba
  el primer vencimiento del préstamo creado.

## Cambio y trazabilidad

Preparar una operación con ID único, administrador activo, referencia anterior,
fecha de actualización esperada y condiciones revisadas. Probar la transacción
con rollback antes de confirmar la misma intervención.

Dentro de una transacción serializable, bloquear la fila, volver a comprobar
todas las condiciones y rechazar cambios concurrentes. El estado deseado es:

- `legacyOid`, `linkFirmaDigital` y `lineaPrestamoCodigoMutual`: vacíos.
- `administrativeCoreControl`: vacío; el control anterior queda conservado en
  la evidencia del historial, no reutilizado para una generación nueva.
- Análisis finalizado y metadatos del ciclo de firma anterior: vacíos.
- Estado, asignación, titular, cuentas bancarias, monto, cuotas, primer
  vencimiento, observaciones y adjuntos: conservados.

Registrar en la misma transacción un evento `ADMIN_DELETED_LOAN_UNLINKED`,
con estado y área de origen/destino iguales, administrador responsable,
autorización operativa, evidencia de borrado, referencia y enlace anteriores,
control anterior y condiciones conservadas. El motivo debe aclarar que la
intervención no generó un préstamo ni efectuó pagos. Una segunda ejecución con
el mismo ID verifica el evento ya guardado y no repite la corrección.

Comparar todos los campos fuera del alcance antes de confirmar. Ante cualquier
diferencia, revertir la transacción. No borrar ni reescribir el historial,
diagnósticos técnicos o evidencia documental anteriores.

## Verificación posterior

Releer el registro y el evento, y comprobar en Beex que se muestra `Generar
préstamo`, con las condiciones conservadas y sin el enlace de firma viejo.
La generación posterior la realiza el analista desde Beex; el control normal
comprueba el vencimiento en Vimarx y vincula el nuevo préstamo. Si devuelve un ID
con condiciones distintas o un resultado incierto, usar la recuperación
existente y no generar otro a ciegas.

Los identificadores y datos reales de cada intervención quedan en el historial
de Beex y, cuando corresponda, en evidencia local privada. No se copian a Git.
