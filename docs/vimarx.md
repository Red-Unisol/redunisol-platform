# Vimarx (Core)

Vimarx es el sistema central de la mutual: socios, solicitudes, prestamos, cuotas y cobranzas. Esta construido con DevExpress XAF/XPO. En el codigo tambien aparece como **Core**, **Fapi**, **Vimax**, **legacy** o **DevExpress Evaluate API**: es el mismo sistema.

Este documento es la referencia para consultarlo. No contiene secretos: las URLs y tokens reales estan en `credentials.txt` y en los `.env` de cada runtime.

## Puertas de entrada

Las tres estan en `celesol.dyndns.org` y **no son intercambiables**.

| Puerto | Que es | Operacion | Quien la usa |
| --- | --- | --- | --- |
| `5002` | API de consultas ("F API") | **lectura** (`Evaluate`, `EvaluateObj`, `EvaluateList`) | casi todo el repo |
| `35010` | API de transferencias | **escritura** (`POST /api/Transferencias/marcar-pagada`) | solo `apps/metamap-platform/client/transferencias-celesol` |
| `8082` | sitio web de Celesol (`LoginPage`) | uso humano | personal de la mutual |

- La API de consultas atendia en `5050` hasta el 2026-08-31. Quedan referencias viejas a `5050` en el repo (ver "Pendientes").
- Certificado TLS publico (Sectigo), **vence el 2026-12-17**. Si no se renueva, se cortan todas las integraciones.
- El swagger completo de la F API esta en `apps/exportador-bancor/docs/api/swagger.json`. Ademas de `Evaluate*` expone `prestamos`, `lead`, `lotes`, `eiv` y endpoints de login; hoy nada del repo los usa.

## Como se consulta (API `5002`)

Los tres endpoints reciben el mismo JSON:

```json
{
  "tipo": "F.Module.SocioMutual",
  "cmd": "[NroDoc] = 30111222",
  "campos": "NombreCompleto;NroSocio",
  "max": 10
}
```

| Endpoint | Metodo | Devuelve | Uso |
| --- | --- | --- | --- |
| `/api/Empresa/Evaluate` | `GET` **con body** | un valor (numero, texto, booleano) | conteos y sumas: `{"cmd": "[<F.Module.SocioMutual>].Count()"}` |
| `/api/Empresa/EvaluateObj` | `POST` | una fila | cuando se espera exactamente un resultado |
| `/api/Empresa/EvaluateList` | `POST` | lista de filas | todo lo demas |

- `tipo`: nombre exacto de la entidad, con namespace. Distingue mayusculas.
- `cmd`: filtro en lenguaje de criterios de DevExpress.
- `campos`: columnas separadas por `;`. Cada fila vuelve como un array **en el mismo orden** que `campos`, sin nombres.
- `max`: tope de filas de `EvaluateList`. Trunca sin avisar.

### Lenguaje de criterios

| Que | Como |
| --- | --- |
| Texto | `[Referencia] = '8113'` |
| Fecha | `[Fecha] >= #2026-09-01#` |
| Decimal | `[SaldoCuota] > 0.0m` |
| Nulo | `[Prestamo] Is Null`, `Is Not Null` |
| Navegar | `[Prestamo.SocioTitular.Socio.NroDoc]` |
| Filtrar una coleccion | `[DetalleCuotas][NroCuota = 1].Fecha` |
| Todos los objetos | `True` o `[<F.Module.SocioMutual>]` |
| Agregados | `.Count()`, `.Sum(Campo)` |
| Operadores | `=`, `<>`, `<`, `>`, `Between`, `Like`, `AND`, `OR`, `In` |

### Trampas conocidas

- **`Evaluate` es `GET` con body JSON.** Sin body responde `415` o `400`; con `POST` responde `405`.
- **Los enums vuelven como numeros** (`Estado`, `EstadoBase`, `EstadoPrestamo`). Para el texto pedir la descripcion: `Estado.Descripcion`.
- **`campos` se separa con `;`.** Con comas falla con `single criterion expected`.
- **No duplicar comillas** al serializar: `[Campo]='valor'`. `''valor''` da `syntax error`.
- **`EvaluateObj` sin resultados** responde `500` con `No existe objeto con esas condiciones`. No es una caida.
- **Proyecciones pesadas** (colecciones u objetos enteros) pueden dar `OutOfMemoryException` en el servidor. Pedir campos escalares y usar `max`.
- **Navegaciones vacias** vuelven como `null` (por ejemplo, `Prestamo.Garantia.*` en prestamos sin garantia).
- **Montos negativos**: `PunitoriosPendientes` puede ser negativo cuando hubo creditos aplicados.
- **No existe `LineaPrestamo.Tasa`**: usar `TasaMinima` / `TasaMaxima`.
- **Consultas lentas**: los clientes usan timeouts de 60 a 180 segundos. Acotar siempre por fecha o identificador.

### Errores

| Respuesta | Causa |
| --- | --- |
| `400` `El camino de la propiedad '<X>' no es correcto` | campo o navegacion inexistente |
| `400` `Value cannot be null (Parameter 'classType')` | `tipo` mal escrito |
| `400` syntax error | `cmd` mal formado (comillas o corchetes) |
| `405` | metodo HTTP equivocado |
| `500` `No existe objeto...` | `EvaluateObj` sin coincidencias |
| `500` `OutOfMemoryException` | proyeccion demasiado pesada |

### Ejemplo

```bash
curl -s -X POST "$VIMARX_EVAL_BASE_URL/api/Empresa/EvaluateList" \
  -H 'Content-Type: application/json' \
  -d '{"tipo":"PreSolicitud.Module.Solicitud","cmd":"[Fecha] >= #2026-09-30#","campos":"Oid;NroSolicitud;Fecha;Estado.Descripcion;NroDocumento","max":50}'
```

## Entidades principales

Ordenadas por uso en el repo. El detalle de campos esta en `apps/exportador-bancor/docs/api/BOModel_API_Reference.md`.

| `tipo` | Que es | Identificadores | Campos utiles |
| --- | --- | --- | --- |
| `PreSolicitud.Module.Solicitud` | solicitud de credito | `Oid`, `NroSolicitud` | `Fecha`, `Estado.Descripcion`, `EstadoBase`, `LineaPrestamo`, `MontoAFinanciar`, `MontoADesembolsar`, `Cuotas`, `CuotaResultante`, `NroDocumento`, `NroSocio`, `Prestamo` |
| `F.Module.SocioMutual` | socio | `ID`, `NroSocio`, `NroDoc`, `CUIT` | `NombreCompleto`, `Celular`, `Email`, `CuentaBancariaHabitual.CBU`, `Prestamos`, `Solicitudes`, `Saldo` |
| `F.Module.Cuentas.Prestamos.Prestamo` | prestamo | `ID`, `NroCuenta`, `Referencia` | `SocioTitular.Socio`, `LineaPrestamo`, `FechaEmision`, `MontoPrestamo`, `SaldoPrestamo`, `Cuotas`, `Estado`, `Solicitud` |
| `PreSolicitud.Module.NovedadSolicitud` | historial de cambios de una solicitud | | fechas y estados por solicitud |
| `F.Module.Cuentas.Prestamos.CuotaPrestamo` | cuota | `ID`, `Prestamo.ID`, `NroCuota` | `Fecha`, `FechaCobro`, `Capital`, `Interes`, `SaldoCuota`, `PunitoriosPendientes` |
| `F.Module.Cuentas.CuentaPorSocio` | relacion socio-cuenta | `ID` | `Socio`, `Prestamo`, `TipoRelacion` (titular, garante, etc.) |
| `F.Module.Cuentas.Bancos.CuentaBancariaSocio` | cuenta bancaria del socio | `ID` | `CBU`, `NroCuenta`, `Habitual` |
| `F.Module.Cuentas.Prestamos.GarantiaCuenta` | garantia | `ID` | `TipoGarantia`, `CoDeudor`, `ValorAproximado` |
| `PreSolicitud.Module.EjecutivoSolicitud` / `VendedorSolicitud` | actores del circuito | | `Nombre`, `Usuario.UserName` |

Navegaciones frecuentes:

- documento del titular de un prestamo: `Prestamo.SocioTitular.Socio.NroDoc`
- linea de un prestamo: `LineaPrestamo.Codigo;LineaPrestamo.Descripcion`
- CBU habitual del socio: `CuentaBancariaHabitual.CBU`
- prestamo generado por una solicitud: `Prestamo.ID;Prestamo.NroCuenta`

## Quien consulta Vimarx en el repo

Cada consumidor tiene su propio cliente y su propia variable de configuracion.

| Consumidor | Variable de base URL | Notas |
| --- | --- | --- |
| Flows de Kestra (analisis de credito, reportes, contabilidad) | secret `DEVEXPRESS_EVALUATE_API_BASE_URL` | token opcional en secret `DEVEXPRESS_EVALUATE_API_BEARER_TOKEN`. Ver `docs/kestra-configuration.md` |
| Formularios y CRM (`kestra/automations/marketing-crm`) | `VIMARX_EVAL_BASE_URL` | `VIMARX_TIMEOUT_SECONDS`, `VIMARX_VERIFY_TLS`, `VIMARX_BEARER_TOKEN` |
| Contabilidad (`cruce_mov_emp_vimarx`) | `VIMARX_BASE_URL` | |
| Solicitudes Web (`web/solicitudes-web/celesol-backend`) | `LEGACY_API_BASE_URL` | `LEGACY_API_TIMEOUT_MS`. Login, socios, simulacion y `/solicitudes-legacy/*` |
| Herramientas (`web/herramientas`, `/analisis`) | `config('analisis.core_url')` | |
| Transferencias Celesol (`apps/metamap-platform/client/transferencias-celesol`) | `TRANSFERENCIAS_CORE_BASE_URL` | unico que escribe: `TRANSFERENCIAS_MARK_PAID_ENDPOINT` (puerto `35010`) |
| Validacion Metamap (`apps/metamap-platform/client/validacion-metamap`) | `VALIDACION_METAMAP_CORE_BASE_URL` | |
| Exportador Bancor (`apps/exportador-bancor`) | constante en `core.py` | URL fija en el codigo |
| Sitio mutualcelesol.com (`web/mutual-celesol/.../consultas.html`) | constante en el HTML | consulta **desde el navegador** |

## Relacion con Solicitudes Web

Solicitudes Web (`web/solicitudes-web`) reemplaza el modulo de solicitudes de Vimarx. Mientras convivan:

- Solicitudes Web **lee** de Vimarx: usuarios, socios, lineas, simulacion y solicitudes del circuito viejo.
- El sistema nuevo **replica** el comportamiento del viejo, aunque parezca mal configurado. Si difieren, se corrige el nuevo.
- Verificado el 2026-09-18: las cancelaciones de prestamos cargadas en Solicitudes Web **no llegan a Vimarx**.

## Pendientes

- **Autenticacion de la API de consultas, a verificar.** Existe un token, pero Solicitudes Web, Transferencias y `consultas.html` consultan sin enviarlo, y `consultas.html` lo hace desde el navegador, en una pagina publica. Todo indica que el puerto `5002` responde sin autenticacion desde internet, con acceso a datos de socios. Confirmarlo con quien administra Vimarx.
- **Referencias al puerto viejo `5050`** (relevado el 2026-10-01). Los runtimes configurables por entorno ya usan `5002`; estas quedan:
  - fijas en el codigo, **probablemente rotas**: `web/mutual-celesol/public/celesol-web/consultas.html` (pagina publica) y `apps/exportador-bancor/src/exportador_bancor/core.py`
  - valores por defecto, solo se usan si falta la variable: `validacion-metamap/src/config.rs` y `contabilidad_transfer/cruce_mov_emp_vimarx.py`
  - ejemplos y documentacion: `validacion-metamap.env.example`, `celesol-backend/.env.example`, `celesol-backend/docs/DEPLOY.md`, `apps/exportador-bancor/README.md` y `apps/exportador-bancor/docs/api/`
- **Certificado TLS**: vence el 2026-12-17.
