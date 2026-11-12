import { useQuery } from "@tanstack/react-query";
import { Button } from "@/shared/components/ui/button";
import {
  getSolicitudPadrones,
  type PadronesSource,
} from "../services/padrones-api";

const loadedDate = (value: string) =>
  new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value));

function Source({ source }: { source: PadronesSource }) {
  const headers = [
    ...new Set(source.matches.flatMap((m) => Object.keys(m.data))),
  ];
  return (
    <article className="min-w-0 space-y-2 rounded-lg border border-border p-3">
      <h3 className="font-medium">
        {source.name}
        {source.period ? ` · ${source.period}` : ""}
      </h3>
      {source.loaded_at && (
        <p className="text-xs text-foreground-secondary">
          Cargado el {loadedDate(source.loaded_at)}
        </p>
      )}
      {source.status === "unpublished" ? (
        <p className="text-sm text-foreground-secondary">
          Sin una versión publicada.
        </p>
      ) : source.status === "needs_review" ? (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Esta carga requiere revisión. Consultá al equipo que administra los
          padrones.
        </p>
      ) : !source.matches.length ? (
        <p className="text-sm text-foreground-secondary">
          Sin coincidencias en esta fuente.
        </p>
      ) : (
        <>
          <p className="text-sm">
            {source.matches.length}{" "}
            {source.matches.length === 1 ? "coincidencia" : "coincidencias"}
          </p>
          {source.kind === "bajas" && (
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Figura en el archivo de bajas. Revisá fecha y causa junto con los
              demás padrones.
            </p>
          )}
          <div className="max-w-full overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {headers.map((h) => (
                    <th
                      className="whitespace-nowrap border-b border-border p-2"
                      key={h}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {source.matches.map((m) => (
                  <tr key={m.row}>
                    {headers.map((h) => (
                      <td
                        className="whitespace-nowrap border-b border-border p-2"
                        key={h}
                      >
                        {m.data[h] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </article>
  );
}

export function PadronesSection({
  solicitudId,
  isActive,
}: {
  solicitudId: string;
  isActive: boolean;
}) {
  const query = useQuery({
    queryKey: ["solicitudes-core", "padrones", solicitudId],
    queryFn: () => getSolicitudPadrones(solicitudId),
    enabled: isActive && Boolean(solicitudId),
    retry: false,
    staleTime: 60_000,
  });
  if (!isActive) return null;
  const result = query.data;
  return (
    <section
      aria-label="Padrones de empleados"
      className="m-3 min-w-0 space-y-3 rounded-xl border border-border bg-surface p-3 text-foreground md:m-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Padrones de empleados</h2>
        <Button
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Actualizar padrones
        </Button>
      </div>
      {query.isLoading ? (
        <p role="status" className="text-sm">
          Consultando padrones...
        </p>
      ) : query.isError || result?.status === "unavailable" ? (
        <p role="alert" className="text-sm">
          No pudimos consultar los padrones. Podés volver a intentarlo.
        </p>
      ) : result?.status === "not_configured" ? (
        <p className="text-sm">Los padrones todavía no están disponibles.</p>
      ) : result?.status === "missing_document" ? (
        <p className="text-sm">
          El titular no tiene un DNI o CUIL válido para consultar.
        </p>
      ) : result?.status === "available" ? (
        <>
          <p className="text-xs text-foreground-secondary">
            Documento consultado: {result.document} · Consulta del{" "}
            {loadedDate(result.queried_at)}
          </p>
          {result.sources.length ? (
            result.sources.map((source) => (
              <Source key={source.id} source={source} />
            ))
          ) : (
            <p className="text-sm">Todavía no hay fuentes registradas.</p>
          )}
        </>
      ) : null}
      <p className="text-xs text-foreground-secondary">
        Estas fuentes complementan el análisis. No aparecer en un padrón no
        demuestra ausencia de empleo.
      </p>
    </section>
  );
}
