const AR_COUNTRY_CODE = "54";
const MOBILE_MARKER = "15";
const MOBILE_MARKER_AREA_CODE_LENGTHS = [2, 3, 4];
const SUBSCRIBER_NUMBER_LENGTHS = [6, 7, 8];

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

// Legacy numbers are dialed locally as 0 + area code + (15 for mobile) + subscriber.
// Area codes vary in length (2-4 digits) with no lookup table available, so the 15
// marker is located heuristically: the first split that leaves a plausible-length
// subscriber number (6-8 digits) wins.
function stripMobileMarker(digits: string) {
  for (const areaCodeLength of MOBILE_MARKER_AREA_CODE_LENGTHS) {
    const areaCode = digits.slice(0, areaCodeLength);
    const rest = digits.slice(areaCodeLength);

    if (
      rest.startsWith(MOBILE_MARKER) &&
      SUBSCRIBER_NUMBER_LENGTHS.includes(rest.length - MOBILE_MARKER.length)
    ) {
      return areaCode + rest.slice(MOBILE_MARKER.length);
    }
  }

  return digits;
}

export function toDisplayPhone(rawLegacyPhone: string | null | undefined) {
  const digits = onlyDigits(rawLegacyPhone ?? "");

  if (!digits) {
    return "";
  }

  const withoutTrunkPrefix = digits.startsWith("0") ? digits.slice(1) : digits;

  return `+${AR_COUNTRY_CODE}${stripMobileMarker(withoutTrunkPrefix)}`;
}

export function toLegacyPhone(displayPhone: string | null | undefined) {
  const digits = onlyDigits(displayPhone ?? "");

  if (!digits) {
    return "";
  }

  const withoutCountryCode = digits.startsWith(AR_COUNTRY_CODE)
    ? digits.slice(AR_COUNTRY_CODE.length)
    : digits;

  return `0${withoutCountryCode}`;
}
