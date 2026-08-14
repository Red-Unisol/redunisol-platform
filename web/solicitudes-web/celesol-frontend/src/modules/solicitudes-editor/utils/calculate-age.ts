function parseCivilDate(value: string) {
  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return null;
  }

  const parsed = new Date(`${trimmed.slice(0, 10)}T00:00:00.000Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function calculateAge(fechaNacimiento: string) {
  const birthDate = parseCivilDate(fechaNacimiento);

  if (!birthDate) {
    return "";
  }

  const today = new Date();
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const hasHadBirthdayThisYear =
    today.getUTCMonth() > birthDate.getUTCMonth() ||
    (today.getUTCMonth() === birthDate.getUTCMonth() &&
      today.getUTCDate() >= birthDate.getUTCDate());

  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }

  return String(Math.max(0, age));
}
