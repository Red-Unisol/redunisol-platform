import { useState } from "react";
import { filtrarHistorialSolicitudes } from "../utils/filtrar-historial-solicitudes";
import { useQuery } from "@tanstack/react-query";
import {
  listSolicitudesDelTitular,
  type SolicitudDelTitular,
} from "../services/solicitudes-core-api";
import { solicitudesCoreQueryKeys } from "../services/solicitudes-core-query-keys";
import { formatLegacyDate } from "../utils/legacy-date-format";
import { formatNullableAmount } from "@/shared/utils/money-format";
import { Button } from "@/shared/components/ui/button";
import { TABLA } from "../utils/tabla-detalle";

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
export function SolicitudesDelTitularSection(props: {
  solicitudId: string;
  documento: string | null;
}) {
  return (
    <HistorialSolicitudes
      key={JSON.stringify([props.solicitudId, props.documento])}
      {...props}
    />
  );
}
function HistorialSolicitudes({
  solicitudId,
  documento,
}: {
  solicitudId: string;
  documento: string | null;
}) {
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState("");
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
  const rows = filtrarHistorialSolicitudes(
    query.data.solicitudes,
    texto,
    estado,
  );
  const estados = [
    ...new Set(
      query.data.solicitudes
        .map((row) => row.estado)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort((a, b) => a.localeCompare(b, "es"));
  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Buscar en solicitudes"
          placeholder="Buscar en solicitudes…"
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm focus-visible:outline-primary"
        />
        <select
          aria-label="Filtrar solicitudes por estado"
          value={estado}
          onChange={(event) => setEstado(event.target.value)}
          className="h-8 max-w-full rounded-md border border-border bg-surface px-2 text-sm focus-visible:outline-primary"
        >
          <option value="">Todos los estados</option>
          {estados.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!texto && !estado}
          onClick={() => {
            setTexto("");
            setEstado("");
          }}
        >
          Limpiar filtros
        </Button>
        <span className="text-xs text-foreground-secondary" role="status">
          {rows.length} de {query.data.solicitudes.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <p role="status" className={TABLA.vacio}>
          {query.data.solicitudes.length === 0
            ? "No se encontraron solicitudes para el documento del titular."
            : "No hay solicitudes que coincidan con los filtros aplicados."}
        </p>
      ) : (
        <div
          className={TABLA.contenedor}
          role="region"
          aria-label="Historial de solicitudes del titular"
          tabIndex={0}
        >
          <table className="w-full min-w-[960px] table-fixed border-collapse text-xs">
            <caption className="sr-only">
              Solicitudes del titular, hasta 50 resultados
            </caption>
            <colgroup>
              {[6, 9, 7, 8, 7, 8, 8, 8, 4, 7, 7, 5, 7, 9].map(
                (width, index) => (
                  <col key={columns[index][0]} style={{ width: `${width}%` }} />
                ),
              )}
            </colgroup>
            <thead className={TABLA.encabezado}>
              <tr>
                {columns.map(([key, label]) => (
                  <th
                    scope="col"
                    aria-sort={key === "fecha" ? "descending" : undefined}
                    key={key}
                    className="px-2 py-2.5 text-left align-top font-semibold wrap-anywhere"
                  >
                    {label}
                    {key === "fecha" ? " ↓" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className={TABLA.fila}>
                  {columns.map(([key]) => (
                    <td
                      key={key}
                      className="px-2 py-2.5 align-top wrap-anywhere"
                    >
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
