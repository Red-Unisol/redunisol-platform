import type { LegacyOption } from "../types";

export const SEXO_OPTIONS: LegacyOption[] = [
  { label: "Masculino", value: "Masculino" },

  { label: "Femenino", value: "Femenino" },

  { label: "Otro", value: "Otro" },
];

// Vimarx guarda el sexo como codigo (0 Masculino, 1 Femenino, 2 persona
// juridica, 3 Otro; verificado en prod el 29/10) y al crear el socio recibe el
// nombre. En Sol Web puede llegar de las dos formas: se muestra y se edita
// siempre con el nombre.
const SEXO_POR_CODIGO: Record<string, string> = {
  "0": "Masculino",
  "1": "Femenino",
  "2": "PersonaJuridica",
  "3": "Otro",
  F: "Femenino",
  M: "Masculino",
};

export function normalizarSexo(value?: string | null) {
  const texto = value?.trim() ?? "";
  return SEXO_POR_CODIGO[texto.toUpperCase()] ?? texto;
}

export function sexoLegible(value?: string | null) {
  const nombre = normalizarSexo(value);
  if (nombre === "PersonaJuridica") return "No aplica (persona jurídica)";
  return nombre || null;
}

export const ESTADO_CIVIL_OPTIONS: LegacyOption[] = [
  { label: "Soltero", value: "Soltero" },

  { label: "Casado", value: "Casado" },

  { label: "Viudo", value: "Viudo" },

  { label: "Separado", value: "Separado" },

  { label: "Union de hecho", value: "Union de hecho" },

  { label: "Union civil", value: "Union civil" },

  { label: "No corresponde", value: "No corresponde" },

  { label: "Divorciado", value: "Divorciado" },
];

export const TIPO_GARANTIA_OPTIONS: LegacyOption[] = [
  { label: "Personal", value: "Personal" },

  { label: "Prendaria", value: "Prendaria" },

  { label: "Hipotecaria", value: "Hipotecaria" },

  { label: "AMT", value: "AMT" },

  { label: "Documento", value: "Documento" },

  { label: "Valor", value: "Valor" },

  { label: "Otros", value: "Otros" },

  { label: "Caucion", value: "Caucion" },

  { label: "Moneda extranjera", value: "Moneda extranjera" },

  { label: "Sola firma", value: "Sola firma" },
];

export const TIPO_RELACION_OPTIONS: LegacyOption[] = [
  { label: "Titular", value: "Titular" },
  { label: "Cotitular", value: "Cotitular" },
  { label: "Co deudor", value: "Co deudor" },
  { label: "Apoderado", value: "Apoderado" },
  { label: "Informante", value: "Informante" },
  { label: "Autorizado", value: "Autorizado" },
  { label: "Usuario menor", value: "Usuario menor" },
];

export const TIPO_DOCUMENTO_OPTIONS: LegacyOption[] = [
  { label: "DNI", value: "DNI" },
  { label: "Libreta Civica", value: "LC" },
  { label: "Libreta de Enrolamiento", value: "LE" },
  { label: "Pasaporte", value: "PASAPORTE" },
  { label: "Cedula de Identidad", value: "CI" },
  { label: "Otro", value: "OTRO" },
];
