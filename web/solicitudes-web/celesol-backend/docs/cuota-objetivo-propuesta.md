# Recalcular una propuesta por monto, cuotas o cuota deseada

En el detalle, durante «Editar», cambiar el monto o la cantidad de cuotas recalcula automáticamente la cuota mediante el hook de simulación existente, con una pausa de 400 ms para no consultar por cada tecla. «Cuota resultante» ahora permite ingresar una cuota deseada cuando el estado habilita editar monto a financiar. Esa dirección conserva la línea y la cantidad de cuotas y actualiza el monto con la respuesta del servidor.

El valor ingresado es una cuota objetivo de simulación, no un importe manual que se graba en la solicitud. El guardado envía el monto/cuotas efectivos, y vuelve a calcular la cuota por el circuito actual. PATCH continúa rechazando cuotaResultante manual. Si el cálculo inverso está pendiente, falla o la entrada es inválida, no se permite guardar una propuesta basada en ese objetivo. El cálculo en curso/error se muestra junto al campo y no se presenta una cuota anterior como vigente.

## Backend

La ruta de simulación existente admite cuotaObjetivo, positiva y finita. El documento/identidad de solicitud no se utiliza para mezclar cálculos: el request del detalle contiene solicitudId y la ruta mantiene los controles existentes. Se consulta el catálogo vigente del vendedor de esa solicitud, se ajustan las cuotas al máximo y se calcula dentro del monto máximo y el mínimo configurado. Cuando el catálogo no define un mínimo positivo, el piso numérico de búsqueda es un centavo, conforme a importes positivos con dos decimales; no corrige ni cambia las reglas generales de mínimos.

El servicio busca el monto consultando al simulador real. Evalúa los extremos del rango y aproxima dentro de ese intervalo, con hasta 10 intentos adicionales, verificando el resultado a un centavo de la cuota objetivo. No supone que una cuota sea proporcional al monto ni reemplaza tasas/gastos por fórmulas propias. Se rechazan condiciones inconsistentes y rangos sin solución. Una cuota por encima del rango permitido usa el monto máximo y devuelve su cuota real; una cuota inferior al mínimo no ajusta el mínimo automáticamente.

cuotaObjetivo no se envía al legacy. Cada consulta usa el cuerpo de simulación habitual. No cambian creación, guardado de cuotas calculadas, generación, cancelaciones, permisos ni el cuerpo de CrearPrestamo. El simulador modal y los formularios de carga conservan su presentación actual; la entrada de cuota deseada se incorpora al detalle de la propuesta.

## Verificación

- 81 pruebas aprobadas: búsqueda inversa, gastos fijos, regla no proporcional, límites, error de legacy, salto sin solución, entrada inválida, vendedor correcto, validación de respuesta, creación/edición/generación y schemas.
- Chromium con la pantalla real de detalle, AppLayout y APIs simuladas: monto 12000 / 12 cuotas → cuota 1100; objetivo 2100 → monto 24000, conservando 12 cuotas; respuesta tardía 3100 ignorada frente a objetivo 4100; al pasar a 6 cuotas, cálculo normal; fallo de legacy bloquea guardar; objetivo 3200 → monto 18600 y PATCH envía monto/cuotas, sin cuota manual. Sin ciclos de recálculo tras sincronizar el monto.
- Prueba de solo simulación en Vimarx, línea 2519 AMEJUCA ESPECIAL: catálogo vigente mínimo 1000, máximo 3000000 y hasta 6 cuotas. Una simulación de monto 20000 / 6 cuotas devolvió 6599,84; el servicio inverso recuperó 20000 y 6599,84 (tres consultas del inverso más la consulta inicial de referencia). Sin crear préstamos ni modificar solicitudes.
- Compilaciones frontend/backend, ESLint de archivos afectados y diff correctos.

Pendiente: revisión con una sesión real sobre una solicitud en dev. El número de consultas y la latencia del cálculo inverso dependen de las condiciones de la línea y del tiempo de respuesta del legacy. Sin despliegue.
