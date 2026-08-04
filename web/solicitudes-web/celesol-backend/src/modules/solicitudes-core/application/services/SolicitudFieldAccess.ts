import type { UpdateSolicitudInput } from "../dtos/UpdateSolicitud.dto";
import {
  type SolicitudAppearance,
  type SolicitudCore,
  type SolicitudFieldAccess,
  type SolicitudFieldGroup,
  type SolicitudFieldKey,
} from "../../domain/entities/SolicitudCore.entity";
import type { SolicitudFieldAccessRuleRecord } from "../../domain/repositories/SolicitudFieldAccessRulesRepository";
import { SolicitudFieldNotEditableInCurrentStateError } from "../../domain/solicitudes-core-errors";
import type { FieldAccessRuleSource } from "../../domain/repositories/SolicitudFieldAccessAdminRepository";

export const READONLY_REASON =
  "La solicitud no admite edicion de datos en su estado actual.";

const EDITABLE_STATE_CODES = new Set(["CargaVendedor", "Revisar"]);

export const SOLICITUD_EDITABLE_FIELDS = [
  "solicitud.cupoTitular",
  "solicitud.cuotaResultante",
  "solicitud.cuotas",
  "solicitud.fechaPrimerVencimiento",
  "solicitud.firmaDigitalmente",
  "solicitud.linkFirmaDigital",
  "solicitud.montoAFinanciar",
  "solicitud.motivo",
  "solicitud.nroOperacion",
  "solicitud.observaciones",
  "solicitud.vendedorSolicitud",
] as const satisfies readonly SolicitudFieldKey[];

export const TITULAR_EDITABLE_FIELDS = [
  "titular.apellidoDenominacion",
  "titular.cbu",
  "titular.celular",
  "titular.cuit",
  "titular.domicilioCalle",
  "titular.email",
  "titular.estadoCivil",
  "titular.fechaNacimiento",
  "titular.localidad",
  "titular.nacionalidad",
  "titular.nombre",
  "titular.nroDocumento",
  "titular.nroPuerta",
  "titular.nroSocio",
  "titular.personaExpuestaPoliticamente",
  "titular.sexo",
  "titular.telefonoFijo",
  "titular.tipoDocumento",
] as const satisfies readonly SolicitudFieldKey[];

export const CONYUGE_EDITABLE_FIELDS = [
  "conyuge.actividad",
  "conyuge.apellido",
  "conyuge.fechaNacimiento",
  "conyuge.ingresosMensuales",
  "conyuge.nacionalidad",
  "conyuge.nombre",
  "conyuge.nroDocumento",
  "conyuge.sexo",
  "conyuge.tipoDocumento",
] as const satisfies readonly SolicitudFieldKey[];

export const DATOS_LABORALES_EDITABLE_FIELDS = [
  "datosLaborales.actividadLaboral",
  "datosLaborales.antiguedadLaboralMeses",
  "datosLaborales.descuentosSueldo",
  "datosLaborales.domicilioLaboralCalle",
  "datosLaborales.domicilioLaboralLocalidad",
  "datosLaborales.domicilioLaboralNroPuerta",
  "datosLaborales.domicilioLaboralPisoDepto",
  "datosLaborales.empleador",
  "datosLaborales.fechaIngresoLaboral",
  "datosLaborales.montoRecibo",
  "datosLaborales.relacionLaboral",
  "datosLaborales.tarjetas",
  "datosLaborales.vehiculo",
  "datosLaborales.vivienda",
] as const satisfies readonly SolicitudFieldKey[];

export const GARANTIAS_EDITABLE_FIELDS = [
  "garantias.antiguedadLaboralMeses",
  "garantias.casadoConTitular",
  "garantias.celular",
  "garantias.cuit",
  "garantias.denominacion",
  "garantias.domicilio",
  "garantias.edad",
  "garantias.email",
  "garantias.estadoCivil",
  "garantias.fechaIngresoLaboral",
  "garantias.fechaNacimiento",
  "garantias.ingresoMensual",
  "garantias.nacionalidad",
  "garantias.nombre",
  "garantias.nombreCompleto",
  "garantias.nroDocumento",
  "garantias.nroSocio",
  "garantias.observaciones",
  "garantias.ocupacion",
  "garantias.persona",
  "garantias.sexo",
  "garantias.sumaIngresos",
  "garantias.telefono",
  "garantias.tipoDocumento",
  "garantias.tipoGarantia",
  "garantias.tipoRelacion",
] as const satisfies readonly SolicitudFieldKey[];

export const EDITABLE_FIELDS = [
  ...SOLICITUD_EDITABLE_FIELDS,
  ...TITULAR_EDITABLE_FIELDS,
  ...CONYUGE_EDITABLE_FIELDS,
  ...DATOS_LABORALES_EDITABLE_FIELDS,
  ...GARANTIAS_EDITABLE_FIELDS,
] as const satisfies readonly SolicitudFieldKey[];

export const EDITABLE_GROUPS = [] as const satisfies readonly SolicitudFieldGroup[];

export const LEGACY_EDITABLE_GROUPS = [
  "garantias",
] as const satisfies readonly SolicitudFieldGroup[];

export const BLOCKED_FIELD_KEYS = [
  "solicitud.lineaPrestamoLegacyOid",
  "solicitud.ejecutivoSolicitud",
] as const;

const EDITABLE_FIELD_KEY_SET = new Set<string>(EDITABLE_FIELDS);
const EDITABLE_GROUP_KEY_SET = new Set<string>(EDITABLE_GROUPS);
const LEGACY_EDITABLE_GROUP_KEY_SET = new Set<string>(LEGACY_EDITABLE_GROUPS);
const BLOCKED_FIELD_KEY_SET = new Set<string>(BLOCKED_FIELD_KEYS);

type PatchAccessTargets = {
  blockedFields: string[];
  fields: SolicitudFieldKey[];
  groups: SolicitudFieldGroup[];
};

export function buildSolicitudFieldAccess(
  solicitud: Pick<SolicitudCore, "estadoActual">,
  ruleRecord?: SolicitudFieldAccessRuleRecord | null,
  isSystemAdmin?: boolean,
  isAnalista?: boolean,
): SolicitudFieldAccess {
  if (isSystemAdmin || isAnalista) {
    return {
      defaultMode: "readonly",
      editableFields: [...EDITABLE_FIELDS],
      editableGroups: [...EDITABLE_GROUPS, ...LEGACY_EDITABLE_GROUPS],
    };
  }

  if (ruleRecord !== undefined) {
    return resolveFieldAccessRuleRecord(ruleRecord, {
      stateCode: solicitud.estadoActual.code,
    }).fieldAccess;
  }

  if (!EDITABLE_STATE_CODES.has(solicitud.estadoActual.code)) {
    return buildReadonlyFieldAccess();
  }

  return {
    defaultMode: "readonly",
    editableFields: [...EDITABLE_FIELDS],
    editableGroups: [...EDITABLE_GROUPS],
  };
}

export function buildSolicitudAppearance(
  solicitud: Pick<SolicitudCore, "estadoActual">,
  ruleRecord?: SolicitudFieldAccessRuleRecord | null,
  isSystemAdmin?: boolean,
  isAnalista?: boolean,
): SolicitudAppearance {
  if (isSystemAdmin || isAnalista) {
    return { backgroundColor: null, textColor: null };
  }

  if (ruleRecord !== undefined) {
    return resolveFieldAccessRuleRecord(ruleRecord, {
      stateCode: solicitud.estadoActual.code,
    }).appearance;
  }

  return buildReadonlyAppearance();
}

export function buildFieldAccessFromRuleRecord(
  ruleRecord: SolicitudFieldAccessRuleRecord | null,
  context?: {
    stateCode?: string;
  },
): SolicitudFieldAccess {
  return resolveFieldAccessRuleRecord(ruleRecord, context).fieldAccess;
}

export function buildFieldAccessAppearanceFromRuleRecord(
  ruleRecord: SolicitudFieldAccessRuleRecord | null,
  context?: {
    stateCode?: string;
  },
): SolicitudAppearance {
  return resolveFieldAccessRuleRecord(ruleRecord, context).appearance;
}

export function resolveFieldAccessRuleRecord(
  ruleRecord: SolicitudFieldAccessRuleRecord | null,
  context?: {
    stateCode?: string;
  },
): {
  appearance: SolicitudAppearance;
  fieldAccess: SolicitudFieldAccess;
  source: FieldAccessRuleSource;
} {
  if (!ruleRecord || !ruleRecord.active) {
    return {
      appearance: buildReadonlyAppearance(),
      fieldAccess: buildReadonlyFieldAccess(),
      source: !ruleRecord ? "fallback_missing" : "fallback_inactive",
    };
  }

  if (
    ruleRecord.defaultMode !== "readonly" ||
    hasDuplicates(ruleRecord.editableFields) ||
    hasDuplicates(ruleRecord.editableGroups)
  ) {
    logInvalidRuleFallback(
      ruleRecord,
      context,
      ruleRecord.defaultMode !== "readonly"
        ? "invalid_default_mode"
        : hasDuplicates(ruleRecord.editableFields)
          ? "duplicate_editable_fields"
          : "duplicate_editable_groups",
    );
    return {
      appearance: buildReadonlyAppearance(),
      fieldAccess: buildReadonlyFieldAccess(),
      source: "fallback_invalid",
    };
  }

  for (const field of ruleRecord.editableFields) {
    if (
      !EDITABLE_FIELD_KEY_SET.has(field) ||
      BLOCKED_FIELD_KEY_SET.has(field)
    ) {
      logInvalidRuleFallback(
        ruleRecord,
        context,
        BLOCKED_FIELD_KEY_SET.has(field)
          ? "blocked_editable_field"
          : "unknown_editable_field",
        field,
      );
      return {
        appearance: buildReadonlyAppearance(),
        fieldAccess: buildReadonlyFieldAccess(),
        source: "fallback_invalid",
      };
    }
  }

  for (const group of ruleRecord.editableGroups) {
    if (
      !EDITABLE_GROUP_KEY_SET.has(group) &&
      !LEGACY_EDITABLE_GROUP_KEY_SET.has(group)
    ) {
      logInvalidRuleFallback(
        ruleRecord,
        context,
        "unknown_editable_group",
        group,
      );
      return {
        appearance: buildReadonlyAppearance(),
        fieldAccess: buildReadonlyFieldAccess(),
        source: "fallback_invalid",
      };
    }
  }

  if (
    ruleRecord.editableFields.length === 0 &&
    ruleRecord.editableGroups.length === 0
  ) {
    return {
      appearance: {
        backgroundColor: ruleRecord.backgroundColor,
        textColor: ruleRecord.textColor,
      },
      fieldAccess: buildReadonlyFieldAccess(
        ruleRecord.readonlyReason ?? READONLY_REASON,
      ),
      source: "persisted",
    };
  }

  return {
    appearance: {
      backgroundColor: ruleRecord.backgroundColor,
      textColor: ruleRecord.textColor,
    },
    fieldAccess: {
      defaultMode: "readonly",
      editableFields: expandLegacyEditableFields(
        [...ruleRecord.editableFields] as SolicitudFieldKey[],
        [...ruleRecord.editableGroups] as SolicitudFieldGroup[],
      ),
      editableGroups: [...ruleRecord.editableGroups] as SolicitudFieldGroup[],
    },
    source: "persisted",
  };
}

export function assertPatchMatchesFieldAccess(
  input: UpdateSolicitudInput,
  fieldAccess: SolicitudFieldAccess,
  currentSolicitud?: Pick<SolicitudCore, "garantias">,
) {
  if (input.currentUser.isSystemAdmin) {
    return;
  }

  const targets = extractSolicitudPatchAccessTargets(
    input,
    currentSolicitud?.garantias,
  );

  if (targets.blockedFields.length > 0) {
    throw new SolicitudFieldNotEditableInCurrentStateError(
      targets.blockedFields[0],
    );
  }

  for (const group of targets.groups) {
    if (!fieldAccess.editableGroups.includes(group)) {
      throw new SolicitudFieldNotEditableInCurrentStateError(group);
    }
  }

  for (const field of targets.fields) {
    if (
      !fieldAccess.editableFields.includes(field) &&
      !(
        isGarantiasFieldKey(field) &&
        fieldAccess.editableGroups.includes("garantias")
      )
    ) {
      throw new SolicitudFieldNotEditableInCurrentStateError(field);
    }
  }
}

export function extractSolicitudPatchAccessTargets(
  input: UpdateSolicitudInput,
  currentGarantias: SolicitudCore["garantias"] = [],
): PatchAccessTargets {
  const blockedFields = new Set<string>();
  const fields = new Set<SolicitudFieldKey>();
  const groups = new Set<SolicitudFieldGroup>();

  collectDefinedFieldKeys("solicitud", input.solicitud, blockedFields, fields);
  collectDefinedFieldKeys("titular", input.titular, blockedFields, fields);
  collectDefinedFieldKeys(
    "datosLaborales",
    input.datosLaborales,
    blockedFields,
    fields,
  );

  if (input.conyuge === null) {
    CONYUGE_EDITABLE_FIELDS.forEach((field) => fields.add(field));
  } else {
    collectDefinedFieldKeys("conyuge", input.conyuge, blockedFields, fields);
  }

  if (input.garantias !== undefined) {
    collectGarantiasFieldKeys(input.garantias, currentGarantias, fields);
  }

  return {
    blockedFields: Array.from(blockedFields),
    fields: Array.from(fields),
    groups: Array.from(groups),
  };
}

function collectDefinedFieldKeys(
  prefix: "solicitud" | "titular" | "conyuge" | "datosLaborales",
  value: Record<string, unknown> | null | undefined,
  blockedFields: Set<string>,
  fields: Set<SolicitudFieldKey>,
) {
  if (!value) {
    return;
  }

  for (const key of Object.keys(value)) {
    const fieldKey = `${prefix}.${key}`;

    if (value[key] === undefined) {
      continue;
    }

    if (BLOCKED_FIELD_KEY_SET.has(fieldKey)) {
      blockedFields.add(fieldKey);
      continue;
    }

    if (EDITABLE_FIELD_KEY_SET.has(fieldKey)) {
      fields.add(fieldKey as SolicitudFieldKey);
    }
  }
}

function collectGarantiasFieldKeys(
  nextGarantias: NonNullable<UpdateSolicitudInput["garantias"]>,
  currentGarantias: SolicitudCore["garantias"],
  fields: Set<SolicitudFieldKey>,
) {
  const maxLength = Math.max(currentGarantias.length, nextGarantias.length);

  for (let index = 0; index < maxLength; index += 1) {
    const currentGarantia = normalizeGarantiaValue(currentGarantias[index]);
    const nextGarantia = normalizeGarantiaValue(nextGarantias[index]);

    for (const fieldKey of GARANTIAS_EDITABLE_FIELDS) {
      const property = fieldKey.slice("garantias.".length) as keyof typeof currentGarantia;

      if (currentGarantia[property] !== nextGarantia[property]) {
        fields.add(fieldKey);
      }
    }
  }
}

function normalizeGarantiaValue(
  garantia:
    | SolicitudCore["garantias"][number]
    | NonNullable<UpdateSolicitudInput["garantias"]>[number]
    | undefined,
) {
  return {
    antiguedadLaboralMeses: garantia?.antiguedadLaboralMeses ?? null,
    casadoConTitular: garantia?.casadoConTitular ?? null,
    celular: garantia?.celular ?? null,
    cuit: garantia?.cuit ?? null,
    denominacion: garantia?.denominacion ?? null,
    domicilio: garantia?.domicilio ?? null,
    edad: garantia?.edad ?? null,
    email: garantia?.email ?? null,
    estadoCivil: garantia?.estadoCivil ?? null,
    fechaIngresoLaboral: garantia?.fechaIngresoLaboral ?? null,
    fechaNacimiento: garantia?.fechaNacimiento ?? null,
    ingresoMensual: garantia?.ingresoMensual ?? null,
    nacionalidad: garantia?.nacionalidad ?? null,
    nombre: garantia?.nombre ?? null,
    nombreCompleto: garantia?.nombreCompleto ?? null,
    nroDocumento: garantia?.nroDocumento ?? null,
    nroSocio: garantia?.nroSocio ?? null,
    observaciones: garantia?.observaciones ?? null,
    ocupacion: garantia?.ocupacion ?? null,
    persona: garantia?.persona ?? null,
    sexo: garantia?.sexo ?? null,
    sumaIngresos: garantia?.sumaIngresos ?? false,
    telefono: garantia?.telefono ?? null,
    tipoDocumento: garantia?.tipoDocumento ?? null,
    tipoGarantia: garantia?.tipoGarantia ?? null,
    tipoRelacion: garantia?.tipoRelacion ?? null,
  };
}

function expandLegacyEditableFields(
  editableFields: SolicitudFieldKey[],
  editableGroups: SolicitudFieldGroup[],
) {
  if (!editableGroups.includes("garantias")) {
    return editableFields;
  }

  return Array.from(new Set([...editableFields, ...GARANTIAS_EDITABLE_FIELDS]));
}

function isGarantiasFieldKey(field: SolicitudFieldKey) {
  return field.startsWith("garantias.");
}

function buildReadonlyFieldAccess(
  readonlyReason: string = READONLY_REASON,
): SolicitudFieldAccess {
  return {
    defaultMode: "readonly",
    editableFields: [],
    editableGroups: [],
    readonlyReason,
  };
}

function buildReadonlyAppearance(): SolicitudAppearance {
  return {
    backgroundColor: null,
    textColor: null,
  };
}

function hasDuplicates(values: readonly string[]) {
  return new Set(values).size !== values.length;
}

function logInvalidRuleFallback(
  ruleRecord: SolicitudFieldAccessRuleRecord,
  context:
    | {
        stateCode?: string;
      }
    | undefined,
  reason: string,
  invalidKey?: string,
) {
  console.error("solicitud_field_access_invalid_rule_fallback", {
    fallback: "readonly",
    invalidKey,
    reason,
    stateCode: context?.stateCode,
    workflowStateId: ruleRecord.workflowStateId,
  });
}
