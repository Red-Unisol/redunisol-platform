const AR_COUNTRY_CODE = "54";

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

// Socio phone numbers come from Vimax as bare local digits (area code +
// subscriber number, no trunk 0, no country code — e.g. "3512692519"),
// unlike the Solicitud legacy dialing format handled by legacy-phone-format.ts.
export function toDisplaySocioPhone(rawPhone: string | null | undefined) {
  const digits = onlyDigits(rawPhone ?? "");

  if (!digits) {
    return "";
  }

  const withoutCountryCode = digits.startsWith(AR_COUNTRY_CODE)
    ? digits.slice(AR_COUNTRY_CODE.length)
    : digits;

  return `+${AR_COUNTRY_CODE}${withoutCountryCode}`;
}

export function toStoredSocioPhone(displayPhone: string | null | undefined) {
  const digits = onlyDigits(displayPhone ?? "");

  if (!digits) {
    return "";
  }

  return digits.startsWith(AR_COUNTRY_CODE)
    ? digits.slice(AR_COUNTRY_CODE.length)
    : digits;
}
