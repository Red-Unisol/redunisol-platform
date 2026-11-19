# Estados permitidos del workflow

Este documento resume una regla operativa del workflow actual de `solicitudes-core`:

- una solicitud solo puede ejecutar transiciones activas desde su estado actual;
- no existen saltos libres entre estados;
- si una transicion no esta catalogada para el estado actual, el backend la rechaza.

En otras palabras, el orden del workflow se controla con una matriz cerrada de salidas permitidas por estado.

## Regla general

Para cambiar de estado, el backend valida:

1. cual es el estado actual de la solicitud;
2. que transiciones activas existen desde ese estado;
3. si el `actionCode` pedido pertenece a ese conjunto.

Si no existe una transicion activa desde el estado actual hacia el destino esperado, la operacion falla como transicion no permitida.

Ejemplo:

- desde `PreAprobada` no se puede ir a `VerificarFirmaYDocumentacion`;
- desde `PreAprobada` no se puede ir a `Liquidada`.

Eso no depende de la UI. Lo impone el catalogo backend.

## Estados y transiciones permitidas

### `CargaVendedor`

Salidas permitidas:
- `enviar` -> `Motor`
- `vencer` -> `Vencida`
- `desestimar` -> `Desestimada`

Notas:
- `enviar` (primera carga hacia Riesgo) requiere al menos un adjunto no eliminado de tipo `Recibo de Sueldo`;
- si no existe, el backend rechaza la transicion (`ChangeSolicitudStateUseCase` + `EnsureSolicitudHasReciboSueldoAdjunto`), sin excepcion para `isSystemAdmin`;
- la opcion `Enviar` sigue apareciendo en el listado de transiciones aunque falte el recibo — el rechazo ocurre recien al intentar ejecutarla.

### `Motor`

Salidas permitidas:
- `motor` -> `RevisionRiesgo`

Notas:
- es un paso tecnico automatico;
- no es una decision manual de usuario.

### `RevisionRiesgo`

Salidas permitidas:
- `evaluacion_externa` -> `EvaluacionExterna`
- `rechazar` -> `Rechazada`
- `revisar` -> `Revisar`
- `preaprobar` -> `PreAprobada`
- `confirmar` -> `Confirmada`

Notas:
- `confirmar` (desde `RevisionRiesgo` o `PreAprobada`) requiere que el titular tenga completos: tipo y nro. de documento, apellido/denominacion, nombre, fecha de nacimiento, sexo, cuit, email y celular (`EnsureSolicitudTitularHasRequiredDataForConfirmar`);
- si falta alguno, el backend no oculta la transicion — la anota con `blockedReason` (listando los campos faltantes) via `AnnotateSolicitudTransitionsBlockedReason`, mostrandola deshabilitada con el motivo al hacer hover, igual que `liquidar`;
- `PreAprobada` es el ultimo estado donde la solicitud puede tener datos del titular incompletos; a partir de `confirmar` se exige la completitud.

### `EvaluacionExterna`

Owner: `RIESGO`. Espera de confirmación de datos por otra persona.

Salidas permitidas:
- `volver_a_revision_riesgo` -> `RevisionRiesgo`

Conserva el ejecutivo y los permisos de Riesgo. Sus entradas y salidas quedan
fechadas en el historial para medir el tiempo externo por separado del análisis.
Para cualquier otra decisión, primero se vuelve a `RevisionRiesgo`.

### `Revisar`

Salidas permitidas:
- `revisar_reenviar` -> `RevisionRiesgo`
- `desestimar` -> `Desestimada`

### `PreAprobada`

Salidas permitidas:
- `desestimar` -> `Desestimada`
- `revisar_monto_cuota` -> `RevisionRiesgo`
- `confirmar` -> `Confirmada`

Notas:
- `confirmar` requiere datos completos del titular — ver nota en `RevisionRiesgo`.
- la regla de acceso a campos (`SolicitudFieldAccessRule`) de este estado habilita edicion de titular/datosLaborales/conyuge/garantias (igual que `Revisar`), para que el vendedor pueda completar lo pendiente antes de confirmar.

### `Confirmada`

Riesgo puede elegir **Enviar a liquidada** (`enviar_a_liquidada`) para solicitar el control del vendedor.
En **Más acciones**, el cierre directo conserva las rutas `liquidar` hacia verificación y
`liquidar_con_firma` hacia transferencia, según la aprobación vigente. Ambas opciones de entrega
requieren socio y un préstamo vigente con monto coincidente. Tras una corrección del vendedor
en Liquidada, Riesgo reenvía la solicitud al vendedor para completar el control pendiente.

También siguen disponibles las acciones de devolución a Revisar, desestimación y pase por Vimarx.

### `Liquidada`

El vendedor usa **Finalizar revisión de datos** (`finalizar_revision_datos`). Si guardó cambios,
el servidor registra `devolver_revision_datos` hacia **Revisión de Riesgo**. Si confirma los datos,
pasa a **Verificar firma y documentación**. Una aprobación vigente permite el pase consecutivo
a **Transferir**. **Desestimar** sigue disponible como acción separada.

Los expedientes que ya estaban en Liquidada antes de introducir la revisión conservan sus salidas históricas.

### `VerificarFirmaYDocumentacion`

Legajos Digitales revisa la firma. Con aprobación vigente y análisis terminado se habilita
el pase a **Transferir**. Ver el [circuito de revisión documental](../document-review.md).

### `Transferir`

Salidas permitidas:
- `pagar` -> `Pagada`

Notas:
- representa la puerta de salida hacia Tesoreria / sistema externo;
- `pagar` la puede ejecutar el owner actual (`TESORERIA`) o, como excepcion puntual, cualquier usuario del owner `RIESGO` (ademas de `isSystemAdmin`). Ningun otro actionCode tiene esta excepcion.

### `Pagada`

Salidas permitidas:
- ninguna

Notas:
- estado terminal real: fin de la cadena de una solicitud (2026-07-09);
- owner `HISTORIAL`, igual que `Rechazada`/`Vencida`/`Desestimada`; aparece en la seccion "Historicas" del listado;
- se muestra en verde (`#C0FFC0` fondo / `#000000` texto) en la regla de acceso a campos.

### `Rechazada`

Salidas permitidas:
- ninguna

### `Vencida`

Salidas permitidas:
- ninguna

### `Desestimada`

Salidas permitidas:
- ninguna

## Lectura operativa

La forma correcta de leer el workflow es:

- cada estado define exactamente que acciones estan permitidas;
- esas acciones determinan el siguiente estado posible;
- cualquier transicion fuera de esa matriz esta prohibida.

Por eso el workflow queda ordenado por catalogo, aunque no exista una regla hardcodeada tipo "paso 1, paso 2, paso 3".



OWNER VENDEDORES 
Si el estado de la solicitud es carga vendedor: 
	Carga vendedor -> Revision Riesgo(OWNER RIESGO)
	Carga vendedor -> Vencida  (OWNER HISTORIAL) 
	Carga vendedor -> Desestimada (OWNER HISTORIAL) 
Si el estado de la solicitud es Revisar
	Revisar -> Revision Riesgo (owner Riesgo) 
	Revisar -> Desestimada(OWNER HISTORIAL) 
Si el estado de la solicitud es Pre Aprobada: 
	Pre Aprobada -> Desestimada (OWNER HISTORIAL) 
	Pre Aprobada -> Revision Riesgo (owner Riesgo) 
	Pre Aprobada -> Confirmada (OWNER RIESGO) 
Si el estado de la solicitud es CONFIRMADA 
	sin acciones para vendedor 
En Liquidada aplican las salidas del control del vendedor descritas arriba.

	
________________________________________________________
	

OWNER RIESGO

Si el estado de la solicitud es REVISION RIESGO 
	Revision Riesgo -> Rechazada (OWNER HISTORIAL) 
	Revision Riesgo -> Revisar (OWNER VENDEDORES) 
	Revision Riesgo -> Pre Aprobada (OWNER VENDEDORES)
	Revision Riesgo -> Confirmada (OWNER RIESGO) 

En Confirmada, Riesgo elige el control opcional de Vendedores o el cierre directo según las reglas anteriores.

OWNER LEGAJOS DIGITALES

En Verificar firma y documentación, Legajos revisa la firma y da paso a Tesorería cuando corresponde.

	 

OWNER TESORERIA 

Si el estado de la solicitud es TRANSFERIR 
	Transferir -> Pagada (OWNER HISTORIAL) 

Excepcion: la accion "pagar" tambien la puede ejecutar cualquier usuario del owner RIESGO, ademas de Tesoreria.
