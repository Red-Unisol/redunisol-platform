# APIs de Celesol / Vimarx

Referencia transversal para los consumidores de `celesol.dyndns.org`: Solicitudes,
Transferencias, formularios web y automatizaciones de Kestra. Centraliza los
contratos del proveedor; los flujos de negocio y despliegues de cada consumidor
siguen documentados junto a su aplicación.

## Cómo usar esta referencia

- [Crear socios: campos, formatos y comportamiento real](socios.md).
- [Implementación del alta inspeccionada en el servidor](implementacion-alta.md).
- [Modelo reconstruido desde el cliente: herencia, relaciones y miembros dinámicos](modelo-cliente.md).
- [Hipótesis de escritura: propiedades, formatos, validaciones y cinco altas adicionales](hipotesis-escritura.md).
- [EvaluateList / EvaluateObj: consultas y verificación](evaluate.md).
- [Préstamos, solicitudes e identificadores](prestamos.md).
- [Evidencia de altas del 15/09/2026](evidence/2026-09-15/socios.json).
- [Relectura final de los cinco socios](evidence/2026-09-15/final-verification.json).
- [Pruebas de escritura de SocAux / Caja40](evidence/2026-09-15/socaux.json).
- [Diagnósticos de consultas](evidence/2026-09-15/evaluate-diagnostics.json).
- [Snapshot del Swagger publicado](evidence/2026-09-15/openapi.json).

El catálogo es un punto de entrada común. No implica que todos los endpoints
hayan sido probados ni constituye una especificación exhaustiva del proveedor.

## Niveles de evidencia

1. **Verificado en vivo:** petición y respuesta fechadas; para escrituras, lectura
   posterior de lo persistido. La campaña de socios incluye también rechazos.
2. **Publicado en Swagger:** operación o esquema anunciado por el servidor; no
   demuestra el comportamiento de todos los campos.
3. **Observado en código:** contrato utilizado por un consumidor Git; puede
   necesitar comprobación en runtime.
4. **Pendiente:** hipótesis o contrato que todavía no fue verificado.

Al extender estos documentos, registrar ambiente, fecha, revisión del consumidor,
JSON enviado, resultado HTTP, resultado de negocio y lectura posterior. Mantener
estos niveles separados; no convertir un comentario histórico en garantía actual.

## Ambientes y puertos

| Servicio | Base o puerto | Evidencia y alcance |
| --- | --- | --- |
| API usada por Solicitudes dev | `https://celesol.dyndns.org:5002` | Variable efectiva `LEGACY_API_BASE_URL`, verificada el 15/09/2026 |
| Swagger de esa API | `/swagger/v1/swagger.json`, UI `/swagger/index.html` | Ambos respondieron HTTP 200 el 15/09/2026 |
| Consulta del core desde Transferencias | Puerto `5002` | Contrato de empaquetado en el README de Transferencias |
| Registro del comprobante desde Transferencias | Puerto `35010`, `/api/Transferencias/marcar-pagada` | Contrato del cliente; no invocado en esta campaña |
| API histórica | Puerto `5050` | Referencias anteriores; no es el objetivo de esta campaña. Verificar el runtime antes de utilizarlo |

**Solicitudes dev se conecta al sistema legado real.** El nombre `dev` identifica
la aplicación web, no un sandbox de Vimarx. Los socios creados por esta campaña
son registros persistentes y están inventariados en [socios.md](socios.md).

Los secretos y accesos operativos se consultan en `credentials.txt`, fuera de Git.
Las llamadas de esta campaña a `CrearSocioMutual` y `EvaluateList` no enviaron
headers de autenticación. Eso describe lo observado en esos endpoints y desde
este acceso; no garantiza que todas las APIs o redes carezcan de autenticación.
TLS se verificó normalmente; no se desactivó la validación de certificados.

## Catálogo inicial

| Método y ruta | Uso | Evidencia disponible |
| --- | --- | --- |
| `POST /api/Simulador/CrearSocioMutual` | Alta de socios | [Contrato y pruebas](socios.md) |
| `POST /api/Empresa/EvaluateList` | Lectura de objetos por tipo, criterio y campos | [Pruebas y ejemplos](evaluate.md); ausente del Swagger capturado |
| `POST /api/Empresa/EvaluateObj` | Consulta de un objeto | Consumido por las aplicaciones; no probado en esta campaña |
| `POST /api/Simulador/CrearPrestamo` | Alta del préstamo | Swagger + [consumidor y límites conocidos](prestamos.md); sin altas en esta campaña |
| `POST /api/Simulador/CrearSolicitud` | Alta de solicitud del proveedor | Sólo inventariado en Swagger; contrato operativo pendiente |
| `GET /api/Simulador/LineasPrestamos` | Líneas | Sólo inventariado en Swagger |
| `GET /api/Simulador/ObtenerLineaSimuladorReact` | Datos de una línea para simulador | Sólo inventariado en Swagger |
| `GET /api/Simulador/ObtenerLineasPrestamos` | Líneas | Sólo inventariado en Swagger |
| `GET /api/Simulador/Simular/{id}` | Simulación | Sólo inventariado en Swagger; consultar sus parámetros antes de usarlo |
| `POST /api/auth/login_user` | Autenticación | Sólo inventariado en Swagger |
| `POST /auth/token` | Tokens | Sólo inventariado en Swagger |
| `POST /fapi/PagoDeuda` | Operación de deuda | Sólo inventariado en Swagger; no invocado |
| `POST /api/Transferencias/marcar-pagada` | Comprobante y marcado de solicitud antigua | Puerto `35010`, cliente Transferencias; no invocado |

Los nombres parecidos no prueban equivalencia entre rutas. No intercambiar puertos,
tipos de objeto o identificadores para intentar resolver una integración.

## Fuentes de código

El backend dev observado durante las pruebas ejecutaba la imagen
`dev-01ea23d11b00b8e5b61a14ec4945c3503f4a34ba`. Su contrato de creación puede
consultarse en el [gateway de esa revisión](https://github.com/Red-Unisol/redunisol-platform/blob/01ea23d11b00b8e5b61a14ec4945c3503f4a34ba/web/solicitudes-web/celesol-backend/src/modules/socios/infrastructure/services/CrearSocioMutualGateway.ts).

Otros consumidores y guías:

- [Backend de Solicitudes](../../../web/solicitudes-web/celesol-backend/README.md).
- [Transferencias Celesol](../../../apps/metamap-platform/client/transferencias-celesol/README.md).
- [Actualización comercial desde Vimarx](../../../kestra/automations/marketing-crm/docs/technical/vimarx-deal-refresh.md).

## Mantenimiento y pruebas futuras

Las pruebas de escritura requieren autorización explícita y una lista acotada de
casos. Usar nombres inequívocos, comprobar previamente CUIT/documento/marcador,
guardar la petición antes de enviarla y releer incluso ante `Ok: false`.
Un timeout no autoriza a repetir el alta: primero buscar el registro por sus
identificadores. No hay garantía de idempotencia documentada para este endpoint.

No publicar PII de socios reales, secretos ni logs completos de otros servicios.
Las evidencias de este directorio contienen exclusivamente los socios sintéticos
creados para la campaña y metadatos de catálogo. Las pruebas no son parte del CI
y sus payloads históricos no deben reenviarse como si fueran un script de seed.
