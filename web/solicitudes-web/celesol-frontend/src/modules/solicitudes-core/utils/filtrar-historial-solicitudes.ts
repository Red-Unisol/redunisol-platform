import type { SolicitudDelTitular } from "../services/solicitudes-core-api";

export function filtrarHistorialSolicitudes(rows: SolicitudDelTitular[], texto: string, estado: string) {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const words = normalize(texto.trim()).split(/\s+/).filter(Boolean);
  const time = (value: string | null) => {
    const parsed = value ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  return rows.filter(row => {
    const content = normalize(Object.values(row).filter(value => value !== null).join(" "));
    return (!estado || row.estado === estado) && words.every(word => content.includes(word));
  }).sort((a,b) => {
    const left = time(a.fecha), right = time(b.fecha);
    return left === right ? 0 : left > right ? -1 : 1;
  });
}
