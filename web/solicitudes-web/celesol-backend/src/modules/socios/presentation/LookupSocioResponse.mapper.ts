import type { LookupSocioByDocumentoResult } from "../application/use-cases/LookupSocioByDocumento.use-case";
import type { LookupSocioResponse } from "./LookupSocioResponse";
import { toSocioResponse } from "./SocioResponse.mapper";

export function toLookupSocioResponse(
  result: LookupSocioByDocumentoResult,
): LookupSocioResponse {
  if (result.match !== "single") {
    return result;
  }

  return {
    match: "single",
    socio: toSocioResponse(result.socio),
  };
}
