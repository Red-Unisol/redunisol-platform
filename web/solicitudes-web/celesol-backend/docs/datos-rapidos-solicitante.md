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

- Parche incorporado sobre `6fc17eb` en `feat/datos-rapidos-solicitante`.
  La comparación con `dev` actualizado queda pendiente: GitHub responde 403
  por la política de red de este entorno.
- `npm ci --no-audit --no-fund` completado en frontend y backend, conservando
  ambos lockfiles. `HUSKY=0` evita instalar hooks durante la preparación.
- `npm run build` del frontend aprobado después de corregir el cierre JSX
  faltante en el parche. Vite avisa sobre chunks grandes y eval en una dependencia.
- 37 pruebas backend de datos rápidos, autorización HTTP y regresión del gateway
  aprobadas; 3 pruebas frontend de estados aprobadas.
- Chromium con respuestas simuladas: 8 escenarios del componente aprobados a
  375 px (socio con/sin créditos, no socio, ambigüedad, error de socio, error de
  créditos, vendedor y cambio de solicitud). Sin desbordamiento horizontal;
  botón oculto para vendedor y no socio. Se verificó el callback del botón,
  no el recorrido completo hasta la pestaña de préstamos en una sesión real.
- Suite frontend completa: 75 aprobadas y 1 fallida preexistente en
  `field-access-admin-form.test.ts`, por esperar escapes Unicode literales
  donde el código devuelve texto acentuado. Esos archivos no se modificaron.
- La generación de Prisma, incluso con `--no-engine`, está bloqueada al obtener
  checksums desde `binaries.prisma.sh` (403). No se deshabilitó su verificación.
  El build backend falla por tipos de Prisma no generados. En la suite global
  inicial del backend hubo 927 aprobadas, 33 fallidas y 2 omitidas; las fallas
  corresponden al cliente Prisma ausente. Las 6 pruebas HTTP agregadas después
  pasaron dentro de las 37 pruebas específicas indicadas arriba.

Para completar la validación, habilitar los dominios `github.com` y
`binaries.prisma.sh` guardados en el borrador del entorno, actualizar/comparar
con `dev`, ejecutar `npm run prisma:generate`, `npm run build` y `npm test`
en el backend. Revalidar el frontend si la integración con dev cambia sus archivos.
Quedan pendientes la respuesta real del convenio en Vimarx y el recorrido de
navegación en la página completa autenticada. No desplegar sin instrucción expresa.
