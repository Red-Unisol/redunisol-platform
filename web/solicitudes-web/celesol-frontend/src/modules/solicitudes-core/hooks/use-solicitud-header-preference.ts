import { useEffect, useState } from "react";

const STORAGE_KEY = "beex.solicitud-header-expanded";

/** A visual preference only; storage may be unavailable in private browsers. */
export function useSolicitudHeaderPreference() {
  const [expanded, setExpanded] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(expanded));
    } catch {
      // Folding remains usable when browser storage is disabled.
    }
  }, [expanded]);
  return [expanded, setExpanded] as const;
}
