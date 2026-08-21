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
- `rechazar` -> `Rechazada`
- `revisar` -> `Revisar`
- `preaprobar` -> `PreAprobada`
- `confirmar` -> `Confirmada`

Notas:
- `confirmar` (desde `RevisionRiesgo` o `PreAprobada`) requiere que el titular tenga completos: tipo y nro. de documento, apellido/denominacion, nombre, fecha de nacimiento, sexo, cuit, email y celular (`EnsureSolicitudTitularHasRequiredDataForConfirmar`);
- si falta alguno, el backend no oculta la transicion — la anota con `blockedReason` (listando los campos faltantes) via `AnnotateSolicitudTransitionsBlockedReason`, mostrandola deshabilitada con el motivo al hacer hover, igual que `liquidar`;
- `PreAprobada` es el ultimo estado donde la solicitud puede tener datos del titular incompletos; a partir de `confirmar` se exige la completitud.

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

Salidas permitidas:
- `desestimar` -> `Desestimada`
- `liquidar` -> `Liquidada`

Notas:
- la accion `liquidar` (unico actionCode que saca una solicitud de `Confirmada`) requiere que el titular ya exista como socio en base de datos;
- una solicitud puede llegar a `Confirmada` y quedarse ahi sin socio — `confirmar` (desde `RevisionRiesgo` o `PreAprobada`) nunca requiere socio;
- si el socio no existe, el backend sigue devolviendo la transicion `liquidar` en el listado (no la oculta), pero anotada con `blockedReason` (mensaje de `SolicitudTitularSocioRequiredForWorkflowError`) via `AnnotateSolicitudTransitionsBlockedReason` — usado tanto en `ListSolicitudTransitionsUseCase` como en el resultado de `ChangeSolicitudStateUseCase`. Si se intenta ejecutar igual, se rechaza, dejando la solicitud bloqueada en `Confirmada` hasta que el socio se cree;
- el resto de las transiciones no requieren que el socio exista.

### `Liquidada`

Salidas permitidas:
- `desestimar` -> `Desestimada`
- `verificar_firma` -> `VerificarFirmaYDocumentacion`

### `VerificarFirmaYDocumentacion`

Salidas permitidas:
- `devolver_a_liquidada` -> `Liquidada`
- `transferir` -> `Transferir`

Notas:
- tiene exactamente dos salidas activas;
- unifica los antiguos estados `VerificacionDocumentacion` y `VerificarFirma` (2026-07-08). Ambos quedaron desactivados (`is_active=false`) pero no se borraron, para no romper la FK restrictiva desde `solicitud_estado_historial` / `solicitud_field_access_rule_audit`. El historial de solicitudes que pasaron por esos estados sigue mostrando sus nombres originales via snapshot.

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
Si el estado de la solicitud es LIQUIDADA 
	Liquidada -> desestimar (OWNER HISTORIAL) 
	Liquidada -> Verificar Firma y Documentacion (OWNER RIESGO) 

	
________________________________________________________
	

OWNER RIESGO

Si el estado de la solicitud es REVISION RIESGO 
	Revision Riesgo -> Rechazada (OWNER HISTORIAL) 
	Revision Riesgo -> Revisar (OWNER VENDEDORES) 
	Revision Riesgo -> Pre Aprobada (OWNER VENDEDORES)
	Revision Riesgo -> Confirmada (OWNER RIESGO) 

si el estado de la solicitud es CONFIRMADA: 
	Confirmada -> desestimar (OWNER HISTORIAL)
	Confirmada -> liquidada (OWNER VENDEDORES) 

si el estado de la solicitud es VERIFICAR FIRMA Y DOCUMENTACION 
	Verificar Firma y Documentacion -> Liquidada (OWNER VENDEDORES) 
	Verificar Firma y Documentacion -> Para Transferir (OWNER TESORERIA) 

	 

OWNER TESORERIA 

Si el estado de la solicitud es TRANSFERIR 
	Transferir -> Pagada (OWNER HISTORIAL) 

Excepcion: la accion "pagar" tambien la puede ejecutar cualquier usuario del owner RIESGO, ademas de Tesoreria.
