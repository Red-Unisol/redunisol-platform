import { useQuery } from "@tanstack/react-query";
import {
  listSolicitudesDelTitular,
  type SolicitudDelTitular,
} from "../services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "../services/solicitudes-core-query-keys";
import { formatLegacyDate } from "../utils/legacy-date-format";
import { formatNullableAmount } from "@/shared/utils/money-format";
import { Button } from "@/shared/components/ui/button";

const columns: [keyof SolicitudDelTitular, string][] = [
  ["nroSolicitud", "Número de solicitud"],
  ["fecha", "Fecha"],
  ["estado", "Estado"],
  ["vendedor", "Vendedor"],
  ["usuarioCreador", "Usuario creador"],
  ["linea", "Línea"],
  ["montoAFinanciar", "Monto a financiar"],
  ["montoADesembolsar", "Monto a desembolsar"],
  ["cuotas", "Cuotas"],
  ["cuotaResultante", "Cuota resultante"],
  ["nroCuentaPrestamo", "Número de cuenta del préstamo"],
  ["nroSocio", "Número de socio"],
  ["nroDocumento", "Número de documento"],
  ["nombreCompleto", "Nombre completo"],
];
function display(row: SolicitudDelTitular, key: keyof SolicitudDelTitular) {
  const value = row[key];
  if (value === null || value === "") return "-";
  if (key === "fecha") return formatLegacyDate(row.fecha);
  if (
    key === "montoAFinanciar" ||
    key === "montoADesembolsar" ||
    key === "cuotaResultante"
  )
    return formatNullableAmount(row[key]);
  return value;
}
export function SolicitudesDelTitularSection({
  solicitudId,
  documento,
}: {
  solicitudId: string;
  documento: string | null;
}) {
  const query = useQuery({
    queryKey: solicitudesCoreQueryKeys.solicitudesDelTitular(
      solicitudId,
      documento,
    ),
    queryFn: () => listSolicitudesDelTitular(solicitudId),
    retry: false,
  });
  if (query.isPending)
    return (
      <p role="status" className="p-4">
        Consultando solicitudes del titular…
      </p>
    );
  if (query.isError)
    return (
      <div role="alert" className="p-4">
        No se pudo obtener el historial de solicitudes.{" "}
        <Button variant="outline" onClick={() => void query.refetch()}>
          Reintentar
        </Button>
      </div>
    );
  if (query.data.status === "documento_invalido")
    return (
      <p role="status" className="p-4">
        El documento del titular no está disponible o no es válido. No se
        realizó la consulta.
      </p>
    );
  return (
    <div className="space-y-3 p-3">
      <p className="text-sm text-foreground-secondary">
        Hasta 50 solicitudes por documento del titular, sin filtros de fecha ni
        estado. Los resultados pueden no representar el historial completo.
      </p>
      {query.data.solicitudes.length === 0 ? (
        <p role="status">
          No se encontraron solicitudes para el documento del titular.
        </p>
      ) : (
        <div
          className="overflow-x-auto rounded-md border border-border"
          role="region"
          aria-label="Historial de solicitudes del titular"
          tabIndex={0}
        >
          <table className="min-w-[1800px] w-full text-sm">
            <caption className="sr-only">
              Solicitudes del titular, hasta 50 resultados
            </caption>
            <thead className="bg-background text-foreground-secondary">
              <tr>
                {columns.map(([key, label]) => (
                  <th
                    scope="col"
                    key={key}
                    className="border-r border-border px-3 py-2 text-left font-medium"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.data.solicitudes.map((row, index) => (
                <tr key={index} className="border-t border-border">
                  {columns.map(([key]) => (
                    <td key={key} className="border-r border-border px-3 py-2">
                      {display(row, key)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
