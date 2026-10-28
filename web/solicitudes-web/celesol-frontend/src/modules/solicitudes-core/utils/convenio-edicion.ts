export type ConvenioSocioValores = {
  beneficio: string | null;
  caja40: number | null;
  convAux: number | null;
  observaciones: string | null;
};

export type ConvenioForm = Record<keyof ConvenioSocioValores, string>;
export type ConvenioSocioRequest = {
  [K in keyof ConvenioSocioValores]?: {
    original: ConvenioSocioValores[K];
    valor: ConvenioSocioValores[K];
  };
};

export function toConvenioForm(convenio: ConvenioSocioValores): ConvenioForm {
  return {
    beneficio: convenio.beneficio ?? "",
    caja40: convenio.caja40 === null ? "" : String(convenio.caja40),
    convAux: convenio.convAux === null ? "" : String(convenio.convAux),
    observaciones: convenio.observaciones ?? "",
  };
}

/** Diff against the snapshot being edited, never against a background refetch. */
export function toConvenioRequest(
  form: ConvenioForm,
  original: ConvenioSocioValores,
): ConvenioSocioRequest | undefined {
  const cambios: ConvenioSocioRequest = {};
  for (const key of ["beneficio", "observaciones"] as const) {
    const valor = form[key].trim() || null;
    const anterior = original[key]?.trim() || null;
    if (valor !== anterior) cambios[key] = { original: anterior, valor };
  }
  for (const key of ["caja40", "convAux"] as const) {
    const valor = form[key].trim() ? Number(form[key]) : null;
    if (valor !== original[key])
      cambios[key] = { original: original[key], valor };
  }
  return Object.keys(cambios).length > 0 ? cambios : undefined;
}
