# Datos rápidos del solicitante

Bloque del detalle de solicitud, debajo del encabezado y antes de las acciones.
No modifica alta de socios, transiciones ni generación de préstamos.

## Contrato

Tres consultas independientes bajo `/solicitudes/:id/datos-rapidos/`:

- `socio`: `{ condicion: "member" | "none" | "unknown" }`.
- `creditos`: `{ vigentes: true | false | null }`.
- `convenio`: `{ descripcion: string | null }`.

Todas pasan por el guard existente de visibilidad de solicitudes, autentican al
usuario y reutilizan GetSolicitudById. La respuesta es no-store. El resumen no
entrega identidades ni importes de préstamos. VENDEDORES puede ver los indicadores,
pero conserva la restricción existente del detalle de préstamos.

## Fuentes y estados

`lookupSocioByDocumento` y `/api/socios/lookup` consultan el padrón PostgreSQL
sincronizado. Un resultado vacío allí no acredita ausencia actual en Vimarx.
El bloque consulta F.Module.SocioMutual por NroDoc y TipoDoc.Descripcion, con
máximo dos coincidencias. Una coincidencia confirma socio; cero confirma ausencia;
múltiples, documento inválido, respuestas malformadas y errores quedan desconocidos.
No se usa la ausencia de número de socio de la solicitud para decidir.

La consulta de créditos vuelve a resolver la identidad en el servidor. Reutiliza
el criterio por Integrantes[Socio.ID] del listado existente y consulta existencia
con Vigente=True. Si no hay coincidencias, descarta Vigente nulo antes de responder
false. Así el máximo de 100 del listado no genera negativos por truncamiento.
No se filtra por convenio, saldo ni fecha de cobro.

La fuente confirmada es `LineaPrestamo.Superior.Descripcion` sobre
`F.Module.Cuentas.Prestamos.Prestamo` (por ejemplo, `NroCuenta == 993989`).
Para solicitudes sin préstamo generado se consulta esa misma línea superior
partiendo de `F.Module.Cuentas.Prestamos.LineaPrestamo`, con campos
`Superior.Descripcion` y criterio `[LineaSolicitud.Oid] = <lineaPrestamoLegacyOid>`.
Esta relación ya se utiliza en `EvaluateListLineaPrestamoLegacyIdResolver`;
el Oid de la línea de presolicitud no se confunde con el ID de la línea del préstamo.
No se utiliza un número de cuenta fijo ni se sustituye el convenio por la descripción
de la línea específica. Cero o múltiples líneas candidatas y superior vacío dan
convenio no disponible. Se conserva el endpoint legacy configurado del entorno.
La consulta fue validada en integración: la cuenta de referencia 993989 y su
línea de presolicitud 2617 devuelven el mismo superior, MUDON HABERES.

## Interfaz

Condición de socio: Consultando condición de socio / Es socio / No es socio /
No se pudo verificar. Créditos: Consultando créditos / Tiene / No tiene /
No se pudo verificar. El indicador y enlace de créditos existen únicamente cuando
se confirma socio. El enlace respeta los permisos existentes, selecciona la pestaña
Préstamos, expande la sección y lleva allí el foco. Respeta la confirmación existente
al salir de una evaluación con cambios sin guardar.

Las claves React Query separan persona y convenio e incluyen solicitud, documento,
tipo y línea guardados. Al cambiar esos datos no se retienen resultados de otra
identidad. Los indicadores generales quedan separados de futuras reglas por convenio.

## Validación (2026-10-11)

- Integrado sobre `dev` en `bd1d938`, conservando los PRs 455–459.
- Dependencias instaladas con `npm ci`, sin modificar lockfiles; Prisma 6.19.3
  generado manteniendo verificación de checksums.
- Compilaciones frontend y backend aprobadas. Vite conserva advertencias de
  chunks grandes y eval en una dependencia.
- PostgreSQL 18.3 local con todas las migraciones aplicadas: 984 pruebas backend
  aprobadas; 2 opcionales omitidas por ausencia de TEST_DATABASE_URL.
- 76 pruebas frontend aprobadas. Se corrigió la expectativa preexistente de un
  mensaje que contenía escapes Unicode literales en lugar de texto acentuado;
  no se cambió el comportamiento de la aplicación para hacerlo pasar.
- Lint de los archivos afectados aprobado.
- Chromium a 375 px: 8 escenarios del bloque aprobados con respuestas simuladas
  (socio con/sin créditos, no socio, ambigüedad, errores, vendedor y cambio de
  solicitud), sin desbordamiento horizontal.
- Página completa a 390 px con sesión y datos simulados: Ver detalle abre la
  pestaña Préstamos, expande Solicitante y lleva allí el foco, sin errores JS.
- Vimarx real: la consulta de referencia de convenio y la relación
  `[LineaSolicitud.Oid] = 2617` devolvieron `MUDON HABERES`.

El usuario autorizó el despliegue exclusivamente en dev tras estas verificaciones.
Los escenarios de identidad, permisos y créditos se validaron con pruebas
controladas; no se realizaron escrituras de datos operativos para probarlos.
