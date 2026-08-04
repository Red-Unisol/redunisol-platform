export type SolicitudesCoreRecientesDateRange = {
  createdFrom: string;
  createdTo: string;
};

function formatDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function buildRecientesDateRange(
  now = new Date(),
): SolicitudesCoreRecientesDateRange {
  const createdTo = new Date(now);
  const createdFrom = new Date(now);

  createdFrom.setDate(createdFrom.getDate() - 21);

  return {
    createdFrom: formatDateOnly(createdFrom),
    createdTo: formatDateOnly(createdTo),
  };
}
