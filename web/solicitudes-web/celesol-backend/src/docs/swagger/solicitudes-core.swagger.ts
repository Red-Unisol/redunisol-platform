/**
 * @openapi
 * tags:
 *   - name: Solicitudes Core
 *     description: Solicitudes persistidas en PostgreSQL con lectura autenticada y operación por owner actual.
 */

/**
 * @openapi
 * /solicitudes:
 *   post:
 *     summary: Create a first-party solicitud
 *     description: |
 *       Crea una solicitud propia nueva en PostgreSQL.
 *       La linea de prestamo se valida contra legacy para el usuario autenticado.
 *       `titular` y `datosLaborales` son obligatorios. `conyuge` y `garantias` son opcionales.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - lineaPrestamoLegacyOid
 *               - titular
 *               - datosLaborales
 *             properties:
 *               lineaPrestamoLegacyOid:
 *                 type: string
 *               montoAFinanciar:
 *                 type: number
 *               cuotaResultante:
 *                 type: string
 *               cuotas:
 *                 type: integer
 *               motivo:
 *                 type: string
 *               firmaDigitalmente:
 *                 type: boolean
 *               ejecutivoSolicitud:
 *                 type: string
 *               vendedorSolicitud:
 *                 type: string
 *               observaciones:
 *                 type: string
 *               fechaPrimerVencimiento:
 *                 type: string
 *                 format: date
 *               nroOperacion:
 *                 type: string
 *               cupoTitular:
 *                 type: number
 *               titular:
 *                 type: object
 *                 required:
 *                   - apellidoDenominacion
 *                   - nombre
 *                   - tipoDocumento
 *                   - nroDocumento
 *                 properties:
 *                   apellidoDenominacion:
 *                     type: string
 *                   nombre:
 *                     type: string
 *                   tipoDocumento:
 *                     type: string
 *                   nroDocumento:
 *                     type: string
 *                   cuit:
 *                     type: string
 *                   nroSocio:
 *                     type: string
 *                   email:
 *                     type: string
 *                     format: email
 *                   celular:
 *                     type: string
 *                   domicilioCalle:
 *                     type: string
 *                   nroPuerta:
 *                     type: string
 *                   localidad:
 *                     type: string
 *                   cbu:
 *                     type: string
 *                   fechaNacimiento:
 *                     type: string
 *                     format: date
 *               datosLaborales:
 *                 type: object
 *                 properties:
 *                   empleador:
 *                     type: string
 *                   actividadLaboral:
 *                     type: string
 *                   relacionLaboral:
 *                     type: string
 *                   antiguedadLaboralMeses:
 *                     type: integer
 *                   fechaIngresoLaboral:
 *                     type: string
 *                     format: date
 *                   domicilioLaboralCalle:
 *                     type: string
 *                   domicilioLaboralNroPuerta:
 *                     type: string
 *                   domicilioLaboralPisoDepto:
 *                     type: string
 *                   domicilioLaboralLocalidad:
 *                     type: string
 *                   montoRecibo:
 *                     type: number
 *                   descuentosSueldo:
 *                     type: number
 *                   tarjetas:
 *                     type: string
 *                   vehiculo:
 *                     type: string
 *                   vivienda:
 *                     type: string
 *               conyuge:
 *                 type: object
 *                 properties:
 *                   apellido:
 *                     type: string
 *                   tipoDocumento:
 *                     type: string
 *                   nroDocumento:
 *                     type: string
 *                   fechaNacimiento:
 *                     type: string
 *                     format: date
 *                   sexo:
 *                     type: string
 *                   actividad:
 *                     type: string
 *                   ingresosMensuales:
 *                     type: number
 *                   nacionalidad:
 *                     type: string
 *                   nombre:
 *                     type: string
 *               garantias:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     tipoRelacion:
 *                       type: string
 *                     tipoGarantia:
 *                       type: string
 *                     observaciones:
 *                       type: string
 *                     tipoDocumento:
 *                       type: string
 *                     nroDocumento:
 *                       type: string
 *                     persona:
 *                       type: string
 *                     cuit:
 *                       type: string
 *                     nroSocio:
 *                       type: string
 *                     denominacion:
 *                       type: string
 *                     nombre:
 *                       type: string
 *                     nombreCompleto:
 *                       type: string
 *                     sexo:
 *                       type: string
 *                     fechaNacimiento:
 *                       type: string
 *                       format: date
 *                     edad:
 *                       type: integer
 *                     email:
 *                       type: string
 *                       format: email
 *                     nacionalidad:
 *                       type: string
 *                     estadoCivil:
 *                       type: string
 *                     telefono:
 *                       type: string
 *                     celular:
 *                       type: string
 *                     domicilio:
 *                       type: string
 *                     ocupacion:
 *                       type: string
 *                     ingresoMensual:
 *                       type: number
 *                     fechaIngresoLaboral:
 *                       type: string
 *                       format: date
 *                     antiguedadLaboralMeses:
 *                       type: integer
 *                     sumaIngresos:
 *                       type: boolean
 *                     casadoConTitular:
 *                       type: boolean
 *           examples:
 *             minimo:
 *               summary: Create minimo
 *               value:
 *                 lineaPrestamoLegacyOid: "123456"
 *                 titular:
 *                   apellidoDenominacion: "Perez"
 *                   nombre: "Juan"
 *                   tipoDocumento: "DNI"
 *                   nroDocumento: "33344455"
 *                 datosLaborales: {}
 *             completo:
 *               summary: Create con datos ampliados
 *               value:
 *                 lineaPrestamoLegacyOid: "123456"
 *                 montoAFinanciar: 1500000
 *                 cuotaResultante: "125000"
 *                 cuotas: 12
 *                 motivo: "Compra de materiales"
 *                 firmaDigitalmente: true
 *                 ejecutivoSolicitud: "Maria Gomez"
 *                 vendedorSolicitud: "Juan Perez"
 *                 observaciones: "Solicitud creada desde Swagger"
 *                 titular:
 *                   apellidoDenominacion: "Perez"
 *                   nombre: "Juan"
 *                   tipoDocumento: "DNI"
 *                   nroDocumento: "33344455"
 *                   cuit: "20-33344455-9"
 *                   nroSocio: "SOC-1001"
 *                   email: "juan.perez@test.com"
 *                   celular: "3415551234"
 *                   domicilioCalle: "San Martin"
 *                   nroPuerta: "1234"
 *                   localidad: "Rosario"
 *                   cbu: "2850590940090418135201"
 *                 datosLaborales:
 *                   empleador: "ACME SA"
 *                   actividadLaboral: "Administrativo"
 *                   relacionLaboral: "Dependencia"
 *                   antiguedadLaboralMeses: 36
 *                   fechaIngresoLaboral: "2023-01-10"
 *                   montoRecibo: 850000
 *                   descuentosSueldo: 50000
 *                 conyuge:
 *                   apellido: "Lopez"
 *                   tipoDocumento: "DNI"
 *                   nroDocumento: "30111222"
 *                   fechaNacimiento: "1990-05-20"
 *                   sexo: "F"
 *                   actividad: "Docente"
 *                   ingresosMensuales: 450000
 *                   nacionalidad: "Argentina"
 *                 garantias:
 *                   - tipoRelacion: "Familiar"
 *                     tipoGarantia: "Recibo de sueldo"
 *                     tipoDocumento: "DNI"
 *                     nroDocumento: "27888999"
 *                     nombre: "Pedro"
 *                     nombreCompleto: "Pedro Garcia"
 *                     ingresoMensual: 950000
 *     responses:
 *       201:
 *         description: Solicitud created.
 *       400:
 *         description: Invalid payload.
 *       401:
 *         description: Invalid session.
 *       503:
 *         description: Legacy line validation unavailable.
 *   get:
 *     summary: List solicitudes using the current inbox scopes
 *     description: |
 *       Conserva las bandejas/scopes actuales. No devuelve un listado global por defecto.
 *       `scope=tracking` puede funcionar como vista de seguimiento, pero no otorga permisos operativos.
 *       Los filtros son opcionales.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [work, tracking, recientes]
 *           default: work
 *       - in: query
 *         name: estado
 *         schema:
 *           type: string
 *       - in: query
 *         name: createdFrom
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: createdTo
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: nroDocumento
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Solicitudes list.
 */

/**
 * @openapi
 * /solicitudes/stats:
 *   get:
 *     summary: Get dashboard KPIs and backlog stats
 *     description: Filtros opcionales por periodo, linea, estado, area, vendedor o usuario asignado.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: query
 *         name: fechaDesde
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-01-01"
 *       - in: query
 *         name: fechaHasta
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-06-30"
 *       - in: query
 *         name: linea
 *         schema:
 *           type: string
 *       - in: query
 *         name: estado
 *         schema:
 *           type: string
 *       - in: query
 *         name: area
 *         schema:
 *           type: string
 *       - in: query
 *         name: vendedorId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: asignadoId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Dashboard stats.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 kpis:
 *                   type: object
 *                   properties:
 *                     creadasPeriodo:
 *                       type: integer
 *                     backlogActivo:
 *                       type: integer
 *                     sinAsignar:
 *                       type: integer
 *                     detenidas7dias:
 *                       type: integer
 *                     rechazadas:
 *                       type: integer
 *                     desestimadas:
 *                       type: integer
 *                     vencidas:
 *                       type: integer
 *                 backlogPorEstado:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       estado:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 backlogPorArea:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       area:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 rendimientoPorLinea:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       linea:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 calidadDatos:
 *                   type: object
 *                   properties:
 *                     sinEjecutivo:
 *                       type: integer
 *                 solicitudesAntiguas:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       titular:
 *                         type: string
 *                       linea:
 *                         type: string
 *                       estado:
 *                         type: string
 *                       diasActiva:
 *                         type: integer
 *                 solicitudesSinAsignar:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       titular:
 *                         type: string
 *                       linea:
 *                         type: string
 *                       estado:
 *                         type: string
 *                       diasActiva:
 *                         type: integer
 *                 funnelPeriodo:
 *                   type: object
 *                   properties:
 *                     confirmadas:
 *                       type: integer
 *                     liquidadas:
 *                       type: integer
 *                     verificacionFirma:
 *                       type: integer
 *                     transferidas:
 *                       type: integer
 *                 filterOptions:
 *                   type: object
 *                   properties:
 *                     vendedores:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           fullName:
 *                             type: string
 *                     estados:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           code:
 *                             type: string
 *                           name:
 *                             type: string
 *                     areas:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           code:
 *                             type: string
 *                           name:
 *                             type: string
 *                     lineas:
 *                       type: array
 *                       items:
 *                         type: string
 *       401:
 *         description: Invalid session.
 */

/**
 * @openapi
 * /solicitudes/stats/vendedor:
 *   get:
 *     summary: Get the authenticated vendedor's own dashboard stats
 *     description: Autoscoped -- vendedorId siempre sale de la sesion, nunca del cliente. Filtros opcionales por periodo y linea.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: query
 *         name: fechaDesde
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-01-01"
 *       - in: query
 *         name: fechaHasta
 *         schema:
 *           type: string
 *           format: date
 *           example: "2026-06-30"
 *       - in: query
 *         name: linea
 *         schema:
 *           type: string
 *       - in: query
 *         name: estado
 *         schema:
 *           type: string
 *       - in: query
 *         name: area
 *         schema:
 *           type: string
 *       - in: query
 *         name: asignadoId
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vendedor dashboard stats.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 kpis:
 *                   type: object
 *                   properties:
 *                     montoLiquidado:
 *                       type: number
 *                     aprobadoSinLiquidar:
 *                       type: number
 *                     solicitudesIniciadas:
 *                       type: integer
 *                     tiempoPromedioDiasLiquidacion:
 *                       type: number
 *                       nullable: true
 *                 evolucionMensual:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       periodo:
 *                         type: string
 *                       monto:
 *                         type: number
 *                 solicitudesPorEstado:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       estado:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 funnel:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       estado:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 montosPorLinea:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       linea:
 *                         type: string
 *                       monto:
 *                         type: number
 *                       count:
 *                         type: integer
 *                 pendientes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       titular:
 *                         type: string
 *                       linea:
 *                         type: string
 *                       estado:
 *                         type: string
 *                       monto:
 *                         type: number
 *                       diasActiva:
 *                         type: integer
 *                 filterOptions:
 *                   type: object
 *                   properties:
 *                     lineas:
 *                       type: array
 *                       items:
 *                         type: string
 *       401:
 *         description: Invalid session.
 */

/**
 * @openapi
 * /solicitudes/stats/analista:
 *   get:
 *     summary: Get the authenticated analista's dashboard stats
 *     description: Solo analistas de RIESGO y administradores. workflowOwnerId siempre sale de la sesion.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: query
 *         name: fechaDesde
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: fechaHasta
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: linea
 *         schema:
 *           type: string
 *       - in: query
 *         name: estado
 *         schema:
 *           type: string
 *       - in: query
 *         name: vista
 *         schema:
 *           type: string
 *           enum: [mis_casos, sin_asignar, ambos]
 *           default: mis_casos
 *       - in: query
 *         name: conRetrabajo
 *         schema:
 *           type: string
 *           enum: [con, sin]
 *       - in: query
 *         name: umbralDias
 *         schema:
 *           type: integer
 *           default: 7
 *           maximum: 365
 *     responses:
 *       200:
 *         description: Analista dashboard stats.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 kpis:
 *                   type: object
 *                   properties:
 *                     asignadosAMi:
 *                       type: integer
 *                     sinAsignarEnMiArea:
 *                       type: integer
 *                     detenidosMasDeNDias:
 *                       type: integer
 *                     casosConRevision:
 *                       type: integer
 *                     tasaDeRechazoPeriodo:
 *                       type: number
 *                       nullable: true
 *                 backlogPorEstado:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       estado:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 retrabajoYRevisiones:
 *                   type: object
 *                   properties:
 *                     conRetrabajo:
 *                       type: integer
 *                     tresOMasRevisiones:
 *                       type: integer
 *                     promedioRevisionesPorCaso:
 *                       type: number
 *                 casosParaTomar:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       titular:
 *                         type: string
 *                       linea:
 *                         type: string
 *                       vendedor:
 *                         type: string
 *                       diasEnCola:
 *                         type: integer
 *                 casosConMultiplesRevisiones:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       titular:
 *                         type: string
 *                       estado:
 *                         type: string
 *                       cantidadRevisiones:
 *                         type: integer
 *                 transicionesLentas:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       titular:
 *                         type: string
 *                       estadoActual:
 *                         type: string
 *                       estadoDestinoEsperado:
 *                         type: string
 *                       diasAcumulados:
 *                         type: integer
 *                 filterOptions:
 *                   type: object
 *                   properties:
 *                     estados:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           code:
 *                             type: string
 *                           name:
 *                             type: string
 *                     lineas:
 *                       type: array
 *                       items:
 *                         type: string
 *                     vendedores:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           fullName:
 *                             type: string
 *       401:
 *         description: Invalid session.
 */

/**
 * @openapi
 * /solicitudes/stats/analista/v2:
 *   get:
 *     summary: Get the authenticated analista's dashboard stats (v2 -- work-queue focused)
 *     description: Solo analistas de RIESGO y administradores. workflowOwnerId siempre sale de la sesion. Reemplaza los KPIs agregados de v1 por listas de trabajo directamente accionables (mis casos activos, casos para tomar, historial).
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: query
 *         name: fechaDesde
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: fechaHasta
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: linea
 *         schema:
 *           type: string
 *       - in: query
 *         name: estado
 *         schema:
 *           type: string
 *       - in: query
 *         name: vista
 *         schema:
 *           type: string
 *           enum: [mis_casos, sin_asignar, ambos]
 *           default: mis_casos
 *       - in: query
 *         name: conRetrabajo
 *         schema:
 *           type: string
 *           enum: [con, sin]
 *       - in: query
 *         name: umbralDias
 *         schema:
 *           type: integer
 *           default: 7
 *           maximum: 365
 *     responses:
 *       200:
 *         description: Analista dashboard stats (v2).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 kpis:
 *                   type: object
 *                   properties:
 *                     asignadosAMi:
 *                       type: integer
 *                     sinAsignarEnMiArea:
 *                       type: integer
 *                     detenidosMasDeNDias:
 *                       type: integer
 *                     casosConRevision:
 *                       type: integer
 *                 misCasosActivos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       titular:
 *                         type: string
 *                       linea:
 *                         type: string
 *                       estado:
 *                         type: string
 *                       turno:
 *                         type: string
 *                         enum: [mia, otro]
 *                       diasAcumulados:
 *                         type: integer
 *                       cantidadRevisiones:
 *                         type: integer
 *                       volvioCorregido:
 *                         type: boolean
 *                 casosParaTomar:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       titular:
 *                         type: string
 *                       linea:
 *                         type: string
 *                       vendedor:
 *                         type: string
 *                       diasEnCola:
 *                         type: integer
 *                 historialTrabajo:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       solicitudId:
 *                         type: string
 *                         format: uuid
 *                       fecha:
 *                         type: string
 *                         format: date-time
 *                       titular:
 *                         type: string
 *                       accion:
 *                         type: string
 *                       resultado:
 *                         type: string
 *                 filterOptions:
 *                   type: object
 *                   properties:
 *                     estados:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           code:
 *                             type: string
 *                           name:
 *                             type: string
 *                     lineas:
 *                       type: array
 *                       items:
 *                         type: string
 *                     vendedores:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             format: uuid
 *                           fullName:
 *                             type: string
 *       401:
 *         description: Invalid session.
 */

/**
 * @openapi
 * /solicitudes/simulacion:
 *   post:
 *     summary: Simulate a loan (cuotas, intereses, gastos)
 *     description: No persiste nada -- corre la simulacion contra el motor de calculo del legado para el usuario autenticado.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - lineaId
 *               - montoAFinanciar
 *               - cuotas
 *             properties:
 *               lineaId:
 *                 type: integer
 *               montoAFinanciar:
 *                 type: number
 *               cuotas:
 *                 type: integer
 *               capitalPuro:
 *                 type: boolean
 *                 default: false
 *               fechaPrimerVencimiento:
 *                 type: string
 *                 format: date
 *               tasa:
 *                 type: number
 *     responses:
 *       200:
 *         description: Simulacion result.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 capital:
 *                   type: number
 *                 capitalPuro:
 *                   type: boolean
 *                 cuotaResultante:
 *                   type: number
 *                 cuotas:
 *                   type: integer
 *                 cuotasDetalle:
 *                   type: array
 *                   nullable: true
 *                   items:
 *                     type: object
 *                 fechaPrimerVencimiento:
 *                   type: string
 *                   nullable: true
 *                 fechaUltimaCuota:
 *                   type: string
 *                 gastos:
 *                   type: number
 *                 intereses:
 *                   type: number
 *                 iva:
 *                   type: number
 *                 lineaDescripcion:
 *                   type: string
 *                   nullable: true
 *                 lineaId:
 *                   type: integer
 *                 montoAFinanciar:
 *                   type: number
 *                 montoSujetoASellado:
 *                   type: number
 *                 sellado:
 *                   type: number
 *       400:
 *         description: Invalid request body.
 *       401:
 *         description: Invalid session.
 *       503:
 *         description: No se pudo conectar con el sistema legado.
 */

/**
 * @openapi
 * /solicitudes/tipos-adjunto:
 *   get:
 *     summary: Get the catalog of adjunto types
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     responses:
 *       200:
 *         description: Adjunto type catalog.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   label:
 *                     type: string
 *                   value:
 *                     type: string
 *       401:
 *         description: Invalid session.
 */

/**
 * @openapi
 * /solicitudes/{id}:
 *   get:
 *     summary: Get solicitud by id
 *     description: Devuelve el detalle completo para usuarios autenticados activos.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Solicitud detail.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Solicitud not found.
 *   patch:
 *     summary: Patch solicitud core and titular data
 *     description: |
 *       Actualiza parcialmente el nucleo editable de la solicitud.
 *       Solo se permite si el usuario autenticado pertenece al owner actual de la solicitud.
 *       Si un campo opcional se envia como `null`, se limpia.
 *       Si `conyuge` se envia como `null`, se elimina el bloque completo.
 *       Si `garantias` viene informado, reemplaza la coleccion completa.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               solicitud:
 *                 type: object
 *                 properties:
 *                   lineaPrestamoLegacyOid:
 *                     type: string
 *                   montoAFinanciar:
 *                     type: number
 *                     nullable: true
 *                   cuotaResultante:
 *                     type: string
 *                     nullable: true
 *                   cuotas:
 *                     type: integer
 *                     nullable: true
 *                   motivo:
 *                     type: string
 *                     nullable: true
 *                   firmaDigitalmente:
 *                     type: boolean
 *                   ejecutivoSolicitud:
 *                     type: string
 *                     nullable: true
 *                   vendedorSolicitud:
 *                     type: string
 *                     nullable: true
 *                   observaciones:
 *                     type: string
 *                     nullable: true
 *                   fechaPrimerVencimiento:
 *                     type: string
 *                     format: date
 *                     nullable: true
 *                   nroOperacion:
 *                     type: string
 *                     nullable: true
 *                   cupoTitular:
 *                     type: number
 *                     nullable: true
 *               titular:
 *                 type: object
 *                 properties:
 *                   apellidoDenominacion:
 *                     type: string
 *                   nombre:
 *                     type: string
 *                   tipoDocumento:
 *                     type: string
 *                   nroDocumento:
 *                     type: string
 *                   cuit:
 *                     type: string
 *                     nullable: true
 *                   nroSocio:
 *                     type: string
 *                     nullable: true
 *                   email:
 *                     type: string
 *                     format: email
 *                     nullable: true
 *                   celular:
 *                     type: string
 *                     nullable: true
 *                   domicilioCalle:
 *                     type: string
 *                     nullable: true
 *                   nroPuerta:
 *                     type: string
 *                     nullable: true
 *                   localidad:
 *                     type: string
 *                     nullable: true
 *                   cbu:
 *                     type: string
 *                     nullable: true
 *                   fechaNacimiento:
 *                     type: string
 *                     format: date
 *                     nullable: true
 *               datosLaborales:
 *                 type: object
 *                 properties:
 *                   empleador:
 *                     type: string
 *                     nullable: true
 *                   actividadLaboral:
 *                     type: string
 *                     nullable: true
 *                   relacionLaboral:
 *                     type: string
 *                     nullable: true
 *                   antiguedadLaboralMeses:
 *                     type: integer
 *                     nullable: true
 *                   fechaIngresoLaboral:
 *                     type: string
 *                     format: date
 *                     nullable: true
 *                   domicilioLaboralCalle:
 *                     type: string
 *                     nullable: true
 *                   domicilioLaboralNroPuerta:
 *                     type: string
 *                     nullable: true
 *                   domicilioLaboralPisoDepto:
 *                     type: string
 *                     nullable: true
 *                   domicilioLaboralLocalidad:
 *                     type: string
 *                     nullable: true
 *                   montoRecibo:
 *                     type: number
 *                     nullable: true
 *                   descuentosSueldo:
 *                     type: number
 *                     nullable: true
 *                   tarjetas:
 *                     type: string
 *                     nullable: true
 *                   vehiculo:
 *                     type: string
 *                     nullable: true
 *                   vivienda:
 *                     type: string
 *                     nullable: true
 *               conyuge:
 *                 nullable: true
 *                 oneOf:
 *                   - type: object
 *                     properties:
 *                       apellido:
 *                         type: string
 *                         nullable: true
 *                       tipoDocumento:
 *                         type: string
 *                         nullable: true
 *                       nroDocumento:
 *                         type: string
 *                         nullable: true
 *                       fechaNacimiento:
 *                         type: string
 *                         format: date
 *                         nullable: true
 *                       sexo:
 *                         type: string
 *                         nullable: true
 *                       actividad:
 *                         type: string
 *                         nullable: true
 *                       ingresosMensuales:
 *                         type: number
 *                         nullable: true
 *                       nacionalidad:
 *                         type: string
 *                         nullable: true
 *                       nombre:
 *                         type: string
 *                         nullable: true
 *                   - type: "null"
 *               garantias:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     tipoRelacion:
 *                       type: string
 *                       nullable: true
 *                     tipoGarantia:
 *                       type: string
 *                       nullable: true
 *                     observaciones:
 *                       type: string
 *                       nullable: true
 *                     tipoDocumento:
 *                       type: string
 *                       nullable: true
 *                     nroDocumento:
 *                       type: string
 *                       nullable: true
 *                     persona:
 *                       type: string
 *                       nullable: true
 *                     cuit:
 *                       type: string
 *                       nullable: true
 *                     nroSocio:
 *                       type: string
 *                       nullable: true
 *                     denominacion:
 *                       type: string
 *                       nullable: true
 *                     nombre:
 *                       type: string
 *                       nullable: true
 *                     nombreCompleto:
 *                       type: string
 *                       nullable: true
 *                     sexo:
 *                       type: string
 *                       nullable: true
 *                     fechaNacimiento:
 *                       type: string
 *                       format: date
 *                       nullable: true
 *                     edad:
 *                       type: integer
 *                       nullable: true
 *                     email:
 *                       type: string
 *                       format: email
 *                       nullable: true
 *                     nacionalidad:
 *                       type: string
 *                       nullable: true
 *                     estadoCivil:
 *                       type: string
 *                       nullable: true
 *                     telefono:
 *                       type: string
 *                       nullable: true
 *                     celular:
 *                       type: string
 *                       nullable: true
 *                     domicilio:
 *                       type: string
 *                       nullable: true
 *                     ocupacion:
 *                       type: string
 *                       nullable: true
 *                     ingresoMensual:
 *                       type: number
 *                       nullable: true
 *                     fechaIngresoLaboral:
 *                       type: string
 *                       format: date
 *                       nullable: true
 *                     antiguedadLaboralMeses:
 *                       type: integer
 *                       nullable: true
 *                     sumaIngresos:
 *                       type: boolean
 *                     casadoConTitular:
 *                       type: boolean
 *                       nullable: true
 *           examples:
 *             patchBasico:
 *               summary: Patch de solicitud y titular
 *               value:
 *                 solicitud:
 *                   motivo: "Actualizado desde Swagger"
 *                   observaciones: null
 *                   fechaPrimerVencimiento: "2026-06-01"
 *                   nroOperacion: "OP-123"
 *                   cupoTitular: 150000
 *                 titular:
 *                   celular: "3415558888"
 *                   estadoCivil: "Soltero"
 *                   nacionalidad: "Argentina"
 *                   personaExpuestaPoliticamente: true
 *                   sexo: "M"
 *                   telefonoFijo: "3414444444"
 *                 datosLaborales:
 *                   empleador: "Empresa Dos"
 *             patchConyuge:
 *               summary: Crear o actualizar conyuge
 *               value:
 *                 conyuge:
 *                   apellido: "Gomez"
 *                   nombre: "Maria"
 *                   actividad: "Docente"
 *             patchBorraConyuge:
 *               summary: Eliminar conyuge
 *               value:
 *                 conyuge: null
 *             patchGarantias:
 *               summary: Reemplazar garantias completas
 *               value:
 *                 garantias:
 *                   - tipoRelacion: "Tio"
 *                     tipoGarantia: "Garante"
 *                     nombre: "Pedro"
 *                     nombreCompleto: "Pedro Garcia"
 *     responses:
 *       200:
 *         description: Solicitud updated.
 *       400:
 *         description: Invalid or empty patch payload.
 *       403:
 *         description: Forbidden.
 *       404:
 *         description: Solicitud not found.
 *       409:
 *         description: Solicitud not editable in current state.
 *       503:
 *         description: Legacy line validation unavailable.
 */

/**
 * @openapi
 * /solicitudes/{id}/transitions:
 *   get:
 *     summary: List available workflow actions for a solicitud
 *     description: |
 *       Devuelve las transiciones activas disponibles desde el estado actual.
 *       El usuario autenticado debe pertenecer al workflow owner del estado actual.
 *       Si no pertenece al owner responsable, la API responde `403`; no devuelve acciones.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Active workflow transitions.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   actionCode:
 *                     type: string
 *                   actionLabel:
 *                     type: string
 *                   defaultComment:
 *                     type: string
 *                     nullable: true
 *                   requiresComment:
 *                     type: boolean
 *                   saveAndExit:
 *                     type: boolean
 *                   toState:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                       name:
 *                         type: string
 *                       owner:
 *                         type: object
 *                         properties:
 *                           code:
 *                             type: string
 *                           name:
 *                             type: string
 *       403:
 *         description: User does not belong to the current workflow owner.
 *       404:
 *         description: Solicitud not found.
 *   post:
 *     summary: Execute a workflow action for a solicitud
 *     description: |
 *       Ejecuta una accion catalogada de cambio de estado.
 *       El backend resuelve el estado destino desde `from_state_id + actionCode`.
 *       No se aceptan `toStateId`, `toStateCode` ni campos libres de estado destino.
 *       No ejecuta integraciones con Tesoreria ni sistemas legacy.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - actionCode
 *             additionalProperties: false
 *             properties:
 *               actionCode:
 *                 type: string
 *               comment:
 *                 type: string
 *               reason:
 *                 type: string
 *           example:
 *             actionCode: "revisar"
 *             comment: "Falta documentacion"
 *             reason: "Documentacion incompleta"
 *     responses:
 *       200:
 *         description: Solicitud updated and next available actions.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 solicitud:
 *                   type: object
 *                 transitions:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Invalid payload or required comment missing.
 *       403:
 *         description: User does not belong to the current workflow owner.
 *       404:
 *         description: Solicitud not found.
 *       409:
 *         description: Transition not allowed or destination state inactive.
 */

/**
 * @openapi
 * /solicitudes/{id}/prestamo-legacy:
 *   post:
 *     summary: Create the legacy loan (prestamo) for a solicitud
 *     description: |
 *       Genera el prestamo en el sistema legado (Vimax) a partir de los
 *       datos actuales de la solicitud y persiste el `legacyOid` resultante
 *       junto con el link de firma digital. Requiere que el titular ya
 *       tenga socio dado de alta en el legado y que los datos de la
 *       solicitud esten completos.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Solicitud with the legacy loan created.
 *       400:
 *         description: Missing authenticated legacy user, or solicitud data incomplete.
 *       401:
 *         description: Invalid session.
 *       403:
 *         description: User does not belong to the current workflow owner.
 *       404:
 *         description: Solicitud not found.
 *       409:
 *         description: |
 *           El prestamo ya fue generado, el socio titular todavia no fue
 *           dado de alta en el legado, o no se pudo determinar el vendedor
 *           en el legado para esta solicitud.
 *       422:
 *         description: El legado rechazo la creacion del prestamo.
 *       503:
 *         description: No se pudo conectar con el sistema legado.
 */

/**
 * @openapi
 * /solicitudes/{id}/assignment/agents:
 *   get:
 *     summary: List assignable agents for a solicitud
 *     description: |
 *       Lista usuarios asignables para la solicitud segun el workflow owner actual.
 *       La identidad del actor siempre se toma del usuario autenticado.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Assignable agents list.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   fullName:
 *                     type: string
 *                   workflowOwnerId:
 *                     type: string
 *                     format: uuid
 *       400:
 *         description: Invalid path parameter.
 *       403:
 *         description: User is not allowed to list assignable agents for the solicitud.
 *       404:
 *         description: Solicitud not found.
 *       409:
 *         description: Solicitud state does not allow assignment operations.
 */

/**
 * @openapi
 * /solicitudes/{id}/assignment/self:
 *   post:
 *     summary: Assign solicitud to authenticated user
 *     description: |
 *       Asigna la solicitud al usuario autenticado.
 *       El body publico es estricto y debe ser un objeto vacio.
 *       No se permite enviar `user` ni override del actor.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             properties: {}
 *           example: {}
 *     responses:
 *       200:
 *         description: Solicitud assigned to authenticated user.
 *       400:
 *         description: Invalid payload or path parameter.
 *       403:
 *         description: User is not allowed to assign the solicitud.
 *       404:
 *         description: Solicitud not found.
 *       409:
 *         description: Solicitud is already assigned or state does not allow assignment.
 */

/**
 * @openapi
 * /solicitudes/{id}/assignment:
 *   post:
 *     summary: Assign solicitud to a specific user
 *     description: |
 *       Asigna la solicitud al `targetUserId` indicado en el body.
 *       El actor siempre es el usuario autenticado.
 *       No se permite enviar `user` en el body.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - targetUserId
 *             additionalProperties: false
 *             properties:
 *               targetUserId:
 *                 type: string
 *                 format: uuid
 *           example:
 *             targetUserId: "5c53f830-9a69-4dfb-bf1a-2a7d5a4e2c53"
 *     responses:
 *       200:
 *         description: Solicitud assigned to target user.
 *       400:
 *         description: Invalid payload or path parameter.
 *       403:
 *         description: User is not allowed to assign the solicitud.
 *       404:
 *         description: Solicitud or target user not found.
 *       409:
 *         description: Solicitud is already assigned, target owner mismatch, or state does not allow assignment.
 */

/**
 * @openapi
 * /solicitudes/{id}/history:
 *   get:
 *     summary: List workflow history for a solicitud
 *     description: |
 *       Devuelve el historial de cambios de estado ordenado por `changedAt` descendente.
 *       Visible para usuarios autenticados activos.
 *     tags:
 *       - Solicitudes Core
 *     security:
 *       - accessTokenCookie: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Solicitud workflow history.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   changedBy:
 *                     type: string
 *                     nullable: true
 *                   changedAt:
 *                     type: string
 *                     format: date-time
 *                   estadoAnterior:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                         nullable: true
 *                       name:
 *                         type: string
 *                         nullable: true
 *                       ownerCode:
 *                         type: string
 *                         nullable: true
 *                   estadoNuevo:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                       name:
 *                         type: string
 *                       ownerCode:
 *                         type: string
 *                         nullable: true
 *                   actionCode:
 *                     type: string
 *                     nullable: true
 *                   actionLabel:
 *                     type: string
 *                     nullable: true
 *                   comentario:
 *                     type: string
 *                     nullable: true
 *                   motivo:
 *                     type: string
 *                     nullable: true
 *       403:
 *         description: Authenticated user is inactive or forbidden by authentication policy.
 *       404:
 *         description: Solicitud not found.
 */

export {};

