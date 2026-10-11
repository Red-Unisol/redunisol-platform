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
La respuesta real de esta consulta sigue pendiente de validación en integración.

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

## Validación local (2026-10-11)

- Cambios integrados sobre `dev` en `bd1d938`, conservando los PRs 455–459,
  en la rama `feat/datos-rapidos-solicitante`.
- Dependencias instaladas con `npm ci`, sin modificar lockfiles.
- Cliente Prisma 6.19.3 generado con verificación de checksums habilitada.
- `npm run build` aprobado en frontend y backend sobre esa base actualizada.
  Vite avisa sobre chunks grandes y eval en una dependencia.
- 40 pruebas específicas aprobadas (caso de uso, gateway, autorización HTTP y
  estados frontend). Lint aprobado para los archivos afectados antes del rebase.
- Chromium con respuestas simuladas: 8 escenarios del componente aprobados a
  375 px (socio con/sin créditos, no socio, ambigüedad, error de socio, error de
  créditos, vendedor y cambio de solicitud). Sin desbordamiento horizontal;
  botón oculto para vendedor y no socio. Se verificó el callback del botón,
  no el recorrido completo hasta la pestaña de préstamos en una sesión real.
- Suite backend sobre dev: 978 aprobadas, 6 fallidas por falta de DATABASE_URL
  y PostgreSQL local, 2 omitidas. La descarga de PostgreSQL 18.3 desde Docker Hub
  está bloqueada por la política de red.
- Suite frontend: falla preexistente en `field-access-admin-form.test.ts`, por
  esperar escapes Unicode literales donde el código devuelve texto acentuado.
  Esos archivos no se modificaron.
- La consulta de integración del convenio a Vimarx devuelve 403 del proxy, antes
  de llegar al servidor. La API de GitHub también está bloqueada.

El usuario autorizó desplegar únicamente en dev después de pasar las
verificaciones. No se ha desplegado ni modificado producción.
Para continuar se guardaron en el borrador, conservando los dominios actuales:
`api.github.com`, `registry-1.docker.io`, `auth.docker.io`,
`production.cloudfront.docker.com` y `celesol.dyndns.org`.
Tras activar la configuración: preparar PostgreSQL local con las migraciones,
repetir las pruebas fallidas, resolver la regresión preexistente de texto y validar
convenio/navegación antes de publicar por el workflow exclusivo de dev.
