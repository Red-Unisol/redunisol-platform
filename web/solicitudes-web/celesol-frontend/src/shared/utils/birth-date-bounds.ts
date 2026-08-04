const MIN_AGE_YEARS = 18;
const MAX_AGE_YEARS = 85;

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getBirthDateBounds(referenceDate: Date = new Date()) {
  const max = new Date(
    referenceDate.getFullYear() - MIN_AGE_YEARS,
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const min = new Date(
    referenceDate.getFullYear() - MAX_AGE_YEARS,
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );

  return { max: toIsoDate(max), min: toIsoDate(min) };
}
