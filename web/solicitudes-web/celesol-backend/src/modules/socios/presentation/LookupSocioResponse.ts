import type { SocioResponse } from "./SocioResponse";

export type LookupSocioResponse =
  | {
      match: "none";
    }
  | {
      match: "multiple";
    }
  | {
      match: "single";
      socio: SocioResponse;
    };

