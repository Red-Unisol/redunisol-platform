# Estado de cobro y vista compacta del préstamo

La ficha reutiliza `usePrestamoDelSocioQuery` y `GetPrestamoDelSocioUseCase`.
La consulta `POST /api/Empresa/EvaluateList` del tipo
`F.Module.Cuentas.Prestamos.CuotaPrestamo` agrega `FechaCobro` al final de la
proyección existente. Se conservan la verificación de pertenencia al titular,
el filtro `esCuotaDelPlan` y el orden por número de cuota.

## Contrato y reglas

- `fechaCobro` válida: cobrada; nunca recibe alerta de mora.
- `fechaCobro: null` o cadena vacía: sin cobro confirmado.
- Columna ausente o tipo inesperado: se omite `fechaCobro` en JSON. La pantalla
  muestra «Estado de cobro no disponible» y conserva la fila visible.
- Fecha de cobro inválida: dato no disponible, sin alerta. Vencimiento inválido
  con cobro vacío: «Pendiente · vencimiento no disponible».
- Pendiente del mes calendario anterior: amarillo, con prioridad sobre rojo.
- Otras pendientes vencidas antes de hoy: rojo. Hoy y futuro: sin alerta.
- Se usa `America/Argentina/Buenos_Aires` para obtener el día de negocio desde
  el reloj del cliente, independientemente de la zona del navegador. Las fechas
  legacy se tratan como días de calendario, sin desplazar medianoche a UTC.
  No hay un servicio de fecha operativa en este circuito: no se introduce un
  calendario contable ni un reloj de servidor nuevo.

La cuota cobrada de mayor número queda visible junto con todas las pendientes
y desconocidas. La cuota 0 participa igual que las demás. El historial se
expande a filas individuales con los importes originales y se puede contraer.
El estado de expansión vive en la tabla, que se desmonta al cerrar; al cambiar
de préstamo o solicitud también se reinicia mediante su clave React.

La cabecera conserva número, línea, orden de compra, cobrador, destino, asiento
y tasa inicial. La tabla conserva todos los importes, agrega fecha de cobro y
estado, y renombra Fecha a Vencimiento. El control es un botón nativo con
`aria-expanded` y `aria-controls`. El ancho extra queda dentro de un contenedor
con desplazamiento horizontal.

## Evidencia y pruebas (2026-10-11)

Consulta de solo lectura al endpoint legacy configurado en `.env.example`, con
el préstamo de referencia ya utilizado por las pruebas del gateway: HTTP 200,
47 filas crudas (incluyen movimientos), 18 valores de FechaCobro de tipo string
con formato `YYYY-MM-DD` y 29 valores `null`. No se observaron cadenas vacías ni
fechas centinela en esa muestra. El parser también admite ISO con hora, formato
ya contemplado por el formateador existente. Otros formatos quedan desconocidos;
no se presume que una fecha centinela signifique cobro vacío.

Validaciones aprobadas:

- Frontend: `npm run build`, lint de los archivos afectados y 16 pruebas de
  `cuotas-cobro.test.ts` con el runner `tsx` ya instalado en el backend.
- Backend: `npm run typecheck`, lint de los archivos afectados y 23 pruebas de
  `EvaluateListSolicitudesGateway.test.ts` y
  `GetPrestamoDelSocio.use-case.test.ts`.
- Chromium local con datos simulados y día de referencia 10/10/2026: etiquetas,
  orden, datos completos, expansión con Enter, contracción con Space, cierre
  con Escape y reapertura compacta. Casos de todas cobradas, ninguna cobrada,
  solo cuota 0 cobrada y pendiente anterior a la última cobrada.
- Chromium a 375 px: diálogo dentro del viewport, tabla con desplazamiento
  horizontal y control accesible. Se verificó también en escritorio a 1280 px.
- `git diff --check`.

Comandos para repetir las pruebas unitarias desde `web/solicitudes-web`:

```sh
cd celesol-backend
npx tsx --test src/modules/solicitudes/infrastructure/services/EvaluateListSolicitudesGateway.test.ts src/modules/solicitudes-core/application/use-cases/GetPrestamoDelSocio.use-case.test.ts
cd ../celesol-frontend
../celesol-backend/node_modules/.bin/tsx --test src/modules/solicitudes-core/utils/cuotas-cobro.test.ts
```

El build muestra avisos de chunks grandes y uso de eval en una dependencia.
No se ejecutó el recorrido autenticado completo en solicitudes-dev; las pruebas
visuales fueron locales y la comprobación de formato fue contra el legacy real.
No se desplegaron cambios ni se modificaron pagos, imputaciones o saldos.

## Archivos del cambio

- Backend: `Solicitud.entity.ts` (contrato),
  `EvaluateListSolicitudesGateway.ts` (proyección y mapeo), su prueba y
  `GetPrestamoDelSocio.use-case.test.ts` (transmisión y pertenencia).
- Frontend: `solicitudes-core-api.ts` (contrato),
  `prestamo-del-socio-dialog.tsx` (tabla), `utils/cuotas-cobro.ts` (reglas) y
  `utils/cuotas-cobro.test.ts` (casos funcionales).

Trabajo aislado en `feat/estado-cobro-cuotas`, integrado sobre `dev` (`7211ec1`)
para su publicación autorizada en desarrollo. Se conserva el bloque de datos
rápidos del solicitante y la cantidad de cuotas de la cabecera de dev, junto con
los datos superiores requeridos y la cuota 0 según su estado de cobro.
