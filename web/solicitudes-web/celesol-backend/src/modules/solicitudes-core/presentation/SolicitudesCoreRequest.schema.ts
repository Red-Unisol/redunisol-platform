import { z } from "zod";

const MIN_TITULAR_AGE_YEARS = 18;
const MAX_TITULAR_AGE_YEARS = 85;

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function isTitularBirthDateWithinAgeBounds(value: string): boolean {
  const birthDate = parseIsoDate(value).getTime();
  const now = new Date();
  const maxBirthDate = Date.UTC(
    now.getUTCFullYear() - MIN_TITULAR_AGE_YEARS,
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const minBirthDate = Date.UTC(
    now.getUTCFullYear() - MAX_TITULAR_AGE_YEARS,
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  return birthDate >= minBirthDate && birthDate <= maxBirthDate;
}

const titularFechaNacimientoSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isTitularBirthDateWithinAgeBounds, {
    message: `titular.fechaNacimiento must correspond to an age between ${MIN_TITULAR_AGE_YEARS} and ${MAX_TITULAR_AGE_YEARS} years`,
  });

const nullableTrimmedStringSchema = z.union([
  z.string().trim().min(1),
  z.null(),
]);

const nullableNormalizedStringSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}, z.union([z.string(), z.null()]));

const garantiaCreateSchema = z.object({
  antiguedadLaboralMeses: z.coerce.number().int().min(0).optional(),
  casadoConTitular: z.boolean().optional(),
  celular: z.string().trim().min(1).optional(),
  cuit: z.string().trim().min(1).optional(),
  denominacion: z.string().trim().min(1).optional(),
  domicilio: z.string().trim().min(1).optional(),
  edad: z.coerce.number().int().min(0).optional(),
  email: z.string().trim().email().optional(),
  estadoCivil: z.string().trim().min(1).optional(),
  fechaIngresoLaboral: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fechaNacimiento: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ingresoMensual: z.coerce.number().min(0).optional(),
  nacionalidad: z.string().trim().min(1).optional(),
  nombre: z.string().trim().min(1).optional(),
  nombreCompleto: z.string().trim().min(1).optional(),
  nroDocumento: z.string().trim().min(1).optional(),
  nroSocio: z.string().trim().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
  ocupacion: z.string().trim().min(1).optional(),
  persona: z.string().trim().min(1).optional(),
  sexo: z.string().trim().min(1).optional(),
  sumaIngresos: z.boolean().optional(),
  telefono: z.string().trim().min(1).optional(),
  tipoDocumento: z.string().trim().min(1).optional(),
  tipoGarantia: z.string().trim().min(1).optional(),
  tipoRelacion: z.string().trim().min(1).optional(),
}).strict();

const garantiaPatchSchema = z.object({
  antiguedadLaboralMeses: z
    .union([z.coerce.number().int().min(0), z.null()])
    .optional(),
  casadoConTitular: z.union([z.boolean(), z.null()]).optional(),
  celular: nullableTrimmedStringSchema.optional(),
  cuit: nullableTrimmedStringSchema.optional(),
  denominacion: nullableTrimmedStringSchema.optional(),
  domicilio: nullableTrimmedStringSchema.optional(),
  edad: z.union([z.coerce.number().int().min(0), z.null()]).optional(),
  email: z.union([z.string().trim().email(), z.null()]).optional(),
  estadoCivil: nullableTrimmedStringSchema.optional(),
  fechaIngresoLaboral: z
    .union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
    .optional(),
  fechaNacimiento: z
    .union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
    .optional(),
  ingresoMensual: z.union([z.coerce.number().min(0), z.null()]).optional(),
  nacionalidad: nullableTrimmedStringSchema.optional(),
  nombre: nullableTrimmedStringSchema.optional(),
  nombreCompleto: nullableTrimmedStringSchema.optional(),
  nroDocumento: nullableTrimmedStringSchema.optional(),
  nroSocio: nullableTrimmedStringSchema.optional(),
  observaciones: nullableTrimmedStringSchema.optional(),
  ocupacion: nullableTrimmedStringSchema.optional(),
  persona: nullableTrimmedStringSchema.optional(),
  sexo: nullableTrimmedStringSchema.optional(),
  sumaIngresos: z.boolean().optional(),
  telefono: nullableTrimmedStringSchema.optional(),
  tipoDocumento: nullableTrimmedStringSchema.optional(),
  tipoGarantia: nullableTrimmedStringSchema.optional(),
  tipoRelacion: nullableTrimmedStringSchema.optional(),
}).strict();

export const createSolicitudBodySchema = z.object({
  cupoTitular: z.coerce.number().min(0).optional(),
  cuotaResultante: z.string().trim().min(1).optional(),
  cuotas: z.coerce.number().int().positive().optional(),
  ejecutivoSolicitud: z.string().trim().min(1).optional(),
  linkFirmaDigital: nullableNormalizedStringSchema.optional(),
  firmaDigitalmente: z.boolean().optional(),
  garantias: z.array(garantiaCreateSchema).optional(),
  fechaPrimerVencimiento: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  lineaPrestamoLegacyOid: z.string().trim().min(1),
  montoAFinanciar: z.coerce.number().positive().optional(),
  motivo: z.string().trim().min(1).optional(),
  nroOperacion: z.string().trim().min(1).optional(),
  observaciones: z.string().trim().min(1).optional(),
  conyuge: z
    .object({
      actividad: z.string().trim().min(1).optional(),
      apellido: z.string().trim().min(1).optional(),
      fechaNacimiento: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ingresosMensuales: z.coerce.number().positive().optional(),
      nacionalidad: z.string().trim().min(1).optional(),
      nombre: z.string().trim().min(1).optional(),
      nroDocumento: z.string().trim().min(1).optional(),
      sexo: z.string().trim().min(1).optional(),
      tipoDocumento: z.string().trim().min(1).optional(),
    })
    .strict()
    .optional(),
  datosLaborales: z.object({
    actividadLaboral: z.string().trim().min(1).optional(),
    antiguedadLaboralMeses: z.coerce.number().int().min(0).optional(),
    descuentosSueldo: z.coerce.number().min(0).optional(),
    domicilioLaboralCalle: z.string().trim().min(1).optional(),
    domicilioLaboralLocalidad: z.string().trim().min(1).optional(),
    domicilioLaboralNroPuerta: z.string().trim().min(1).optional(),
    domicilioLaboralPisoDepto: z.string().trim().min(1).optional(),
    empleador: z.string().trim().min(1).optional(),
    fechaIngresoLaboral: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    montoRecibo: z.coerce.number().min(0).optional(),
    relacionLaboral: z.string().trim().min(1).optional(),
    tarjetas: z.string().trim().min(1).optional(),
    vehiculo: z.string().trim().min(1).optional(),
    vivienda: z.string().trim().min(1).optional(),
  }).strict(),
  titular: z.object({
    apellidoDenominacion: z.string().trim().min(1),
    cbu: z.string().trim().min(1).optional(),
    celular: z.string().trim().min(1).optional(),
    cuit: z.string().trim().min(1).optional(),
    domicilioCalle: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    estadoCivil: z.string().trim().min(1).optional(),
    fechaNacimiento: titularFechaNacimientoSchema.optional(),
    localidad: z.string().trim().min(1).optional(),
    nacionalidad: z.string().trim().min(1).optional(),
    nombre: z.string().trim().min(1),
    nroDocumento: z.string().trim().min(1),
    nroPuerta: z.string().trim().min(1).optional(),
    nroSocio: z.string().trim().min(1).optional(),
    personaExpuestaPoliticamente: z.boolean().optional(),
    sexo: z.string().trim().min(1).optional(),
    telefonoFijo: z.string().trim().min(1).optional(),
    tipoDocumento: z.string().trim().min(1),
  }).strict(),
  vendedorSolicitud: z.string().trim().min(1).optional(),
}).strict();

export const listSolicitudesQuerySchema = z.object({
  createdFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  createdTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  excludeEstado: z.string().trim().min(1).optional(),
  estado: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  nroDocumento: z.string().trim().min(1).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  scope: z.enum(["historicas", "recientes", "tracking", "work"]).default("work"),
});

export const solicitudByIdParamsSchema = z.object({
  id: z.string().uuid("id must be a valid uuid"),
});

// Replica la forma de POST /api/redunisol/finSolicitud/:ntrans/:sol (ver
// finalizar-api-caja-celesol-contrato.txt). "ntrans" se acepta pero no se
// usa -- el legacy tampoco lo usaba, Laravel mandaba "0" por default.
// "sol" acepta tanto el uuid interno de la solicitud como el legacyOid
// (el id que genera Vimax al otorgar el prestamo) -- ver GetFinSolicitudDatos.use-case.ts.
export const finSolicitudParamsSchema = z.object({
  ntrans: z.string(),
  sol: z.string().trim().min(1),
});

export const assignSolicitudToSelfBodySchema = z
  .object({})
  .strict();

export const assignSolicitudToUserBodySchema = z
  .object({
    targetUserId: z.string().uuid(),
  })
  .strict();

export const patchSolicitudBodySchema = z.object({
  conyuge: z
    .union([
      z.object({
        actividad: nullableTrimmedStringSchema.optional(),
        apellido: nullableTrimmedStringSchema.optional(),
        fechaNacimiento: z
          .union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
          .optional(),
        ingresosMensuales: z
          .union([z.coerce.number().positive(), z.null()])
          .optional(),
        nacionalidad: nullableTrimmedStringSchema.optional(),
        nombre: nullableTrimmedStringSchema.optional(),
        nroDocumento: nullableTrimmedStringSchema.optional(),
        sexo: nullableTrimmedStringSchema.optional(),
        tipoDocumento: nullableTrimmedStringSchema.optional(),
      }).strict(),
      z.null(),
    ])
    .optional(),
  garantias: z.array(garantiaPatchSchema).optional(),
  datosLaborales: z
    .object({
      actividadLaboral: nullableTrimmedStringSchema.optional(),
      antiguedadLaboralMeses: z
        .union([z.coerce.number().int().min(0), z.null()])
        .optional(),
      descuentosSueldo: z.union([z.coerce.number().min(0), z.null()]).optional(),
      domicilioLaboralCalle: nullableTrimmedStringSchema.optional(),
      domicilioLaboralLocalidad: nullableTrimmedStringSchema.optional(),
      domicilioLaboralNroPuerta: nullableTrimmedStringSchema.optional(),
      domicilioLaboralPisoDepto: nullableTrimmedStringSchema.optional(),
      empleador: nullableTrimmedStringSchema.optional(),
      fechaIngresoLaboral: z
        .union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
        .optional(),
      montoRecibo: z.union([z.coerce.number().min(0), z.null()]).optional(),
      relacionLaboral: nullableTrimmedStringSchema.optional(),
      tarjetas: nullableTrimmedStringSchema.optional(),
      vehiculo: nullableTrimmedStringSchema.optional(),
      vivienda: nullableTrimmedStringSchema.optional(),
    })
    .strict()
    .optional(),
  solicitud: z
    .object({
      cupoTitular: z.union([z.coerce.number().min(0), z.null()]).optional(),
      cuotaResultante: nullableTrimmedStringSchema.optional(),
      cuotas: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
      ejecutivoSolicitud: nullableTrimmedStringSchema.optional(),
      linkFirmaDigital: nullableNormalizedStringSchema.optional(),
      firmaDigitalmente: z.boolean().optional(),
      fechaPrimerVencimiento: z
        .union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()])
        .optional(),
      lineaPrestamoLegacyOid: z.string().trim().min(1).optional(),
      montoAFinanciar: z
        .union([z.coerce.number().positive(), z.null()])
        .optional(),
      motivo: nullableTrimmedStringSchema.optional(),
      nroOperacion: nullableTrimmedStringSchema.optional(),
      observaciones: nullableTrimmedStringSchema.optional(),
      vendedorSolicitud: nullableTrimmedStringSchema.optional(),
    })
    .strict()
    .optional(),
  titular: z
    .object({
      apellidoDenominacion: z.string().trim().min(1).optional(),
      cbu: nullableTrimmedStringSchema.optional(),
      celular: nullableTrimmedStringSchema.optional(),
      cuit: nullableTrimmedStringSchema.optional(),
      domicilioCalle: nullableTrimmedStringSchema.optional(),
      email: z.union([z.string().trim().email(), z.null()]).optional(),
      estadoCivil: nullableTrimmedStringSchema.optional(),
      fechaNacimiento: z
        .union([titularFechaNacimientoSchema, z.null()])
        .optional(),
      localidad: nullableTrimmedStringSchema.optional(),
      nacionalidad: nullableTrimmedStringSchema.optional(),
      nombre: z.string().trim().min(1).optional(),
      nroDocumento: z.string().trim().min(1).optional(),
      nroPuerta: nullableTrimmedStringSchema.optional(),
      nroSocio: nullableTrimmedStringSchema.optional(),
      personaExpuestaPoliticamente: z.union([z.boolean(), z.null()]).optional(),
      sexo: nullableTrimmedStringSchema.optional(),
      telefonoFijo: nullableTrimmedStringSchema.optional(),
      tipoDocumento: z.string().trim().min(1).optional(),
    })
    .strict()
    .optional(),
}).strict();

export const simularPrestamoBodySchema = z.object({
  capitalPuro: z.boolean().optional(),
  cuotas: z.coerce.number().int().positive(),
  fechaPrimerVencimiento: z.string().trim().min(1).optional(),
  lineaId: z.coerce.number().int().positive(),
  montoAFinanciar: z.coerce.number().positive(),
  tasa: z.coerce.number().optional(),
}).strict();

export const getSolicitudesStatsQuerySchema = z.object({
  fechaDesde: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fechaHasta: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  linea: z.string().trim().min(1).optional(),
  estado: z.string().trim().min(1).optional(),
  area: z.string().trim().min(1).optional(),
  vendedorId: z.string().trim().uuid().optional(),
  asignadoId: z.string().trim().min(1).optional(),
});

export const getAnalistaStatsQuerySchema = getSolicitudesStatsQuerySchema.extend({
  vista: z.enum(["mis_casos", "sin_asignar", "ambos"]).optional(),
  conRetrabajo: z.enum(["con", "sin"]).optional(),
  umbralDias: z.coerce.number().int().positive().max(365).optional(),
});

export type CreateSolicitudBody = z.infer<typeof createSolicitudBodySchema>;
export type GetSolicitudesStatsQuery = z.infer<typeof getSolicitudesStatsQuerySchema>;
export type GetAnalistaStatsQuery = z.infer<typeof getAnalistaStatsQuerySchema>;
export type ListSolicitudesQuery = z.infer<typeof listSolicitudesQuerySchema>;
export type PatchSolicitudBody = z.infer<typeof patchSolicitudBodySchema>;
export type SolicitudByIdParams = z.infer<typeof solicitudByIdParamsSchema>;
export type FinSolicitudParams = z.infer<typeof finSolicitudParamsSchema>;
export type AssignSolicitudToSelfBody = z.infer<typeof assignSolicitudToSelfBodySchema>;
export type AssignSolicitudToUserBody = z.infer<typeof assignSolicitudToUserBodySchema>;
export type SimularPrestamoBody = z.infer<typeof simularPrestamoBodySchema>;
