import { useState, type FormEvent } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  History,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  displayDate,
  type MonthlyCutoffData,
  type SaveCutoffInput,
} from "./api";

type Props = {
  period: string;
  onPeriodChange: (period: string) => void;
  data?: MonthlyCutoffData;
  isLoading?: boolean;
  error?: string;
  onReload: () => Promise<MonthlyCutoffData | undefined>;
  onSave: (input: SaveCutoffInput) => Promise<MonthlyCutoffData>;
};
export function MonthlyCutoffScreen(props: Props) {
  const { data, period } = props;
  return (
    <article className="h-full min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-background">
      <header className="border-b border-border bg-surface px-5 py-6 md:px-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary">
          Solicitudes · Configuración operativa
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-marino">
          Fechas de corte
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground-secondary">
          Confirmá la fecha mensual informada por AMEJUCA. Una sola carga se
          aplica a sus líneas Especial, Premium y Recurrentes, incluidas las
          variantes Red Unisol.
        </p>
      </header>
      <div className="mx-auto grid max-w-5xl gap-5 p-4 md:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <label
            className="grid gap-2 text-sm font-medium"
            htmlFor="cutoff-period"
          >
            Período
            <Input
              id="cutoff-period"
              type="month"
              min="2000-01"
              max="2099-12"
              value={period}
              className="min-h-11 w-52"
              onChange={(e) => {
                if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value))
                  props.onPeriodChange(e.target.value);
              }}
            />
          </label>
          <span className="rounded-full bg-muted px-4 py-2 text-sm font-semibold text-marino">
            Grupo AMEJUCA
          </span>
        </div>
        {props.isLoading ? (
          <p role="status">Cargando el corte del mes...</p>
        ) : props.error ? (
          <div
            role="alert"
            className="rounded-xl border border-border bg-surface p-5"
          >
            <p>{props.error}</p>
            <Button className="mt-3" variant="outline" onClick={props.onReload}>
              Volver a intentar
            </Button>
          </div>
        ) : data ? (
          <CutoffForm
            key={period}
            data={data}
            onSave={props.onSave}
            onReload={props.onReload}
          />
        ) : null}
      </div>
    </article>
  );
}
function CutoffForm({
  data,
  onSave,
  onReload,
}: {
  data: MonthlyCutoffData;
  onSave: Props["onSave"];
  onReload: Props["onReload"];
}) {
  const [date, setDate] = useState(data.record?.cutoffDate ?? "");
  const [note, setNote] = useState(data.record?.note ?? "");
  const [version, setVersion] = useState(data.record?.version ?? 0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);
    setPending(true);
    try {
      const result = await onSave({
        cutoffDate: date,
        note,
        expectedVersion: version,
      });
      setVersion(result.record!.version);
      setDate(result.record!.cutoffDate);
      setNote(result.record!.note ?? "");
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo guardar. Conservamos lo que ingresaste.",
      );
    } finally {
      setPending(false);
    }
  }
  const lastDay = new Date(
    Date.UTC(Number(data.period.slice(0, 4)), Number(data.period.slice(5)), 0),
  )
    .toISOString()
    .slice(0, 10);
  const confirmed = data.status === "confirmed";
  return (
    <>
      <section
        role="status"
        className={`rounded-xl border p-5 ${confirmed ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950"}`}
      >
        <div className="flex items-start gap-3">
          {confirmed ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0" />
          ) : (
            <Clock3 className="mt-0.5 size-5 shrink-0" />
          )}
          <div>
            <h2 className="font-semibold">
              {confirmed
                ? `Corte confirmado: ${displayDate(data.record!.cutoffDate)}`
                : "Corte del mes pendiente de confirmar"}
            </h2>
            <p className="mt-1 text-sm leading-6">
              {confirmed
                ? "Se usa la fecha exacta informada, sin ajuste por fines de semana."
                : "Todavía no se cargó la fecha informada por AMEJUCA. El vencimiento se estima con la fórmula de Vimarx."}
            </p>
            {data.record ? (
              <p className="mt-2 text-xs">
                Guardado por {data.record.updatedBy} ·{" "}
                {new Date(data.record.updatedAt).toLocaleString("es-AR", {
                  timeZone: "America/Argentina/Buenos_Aires",
                })}
              </p>
            ) : null}
          </div>
        </div>
      </section>
      <form
        onSubmit={(event) => void submit(event)}
        className="rounded-xl border border-border bg-surface p-5 md:p-6"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold text-marino">
          <CalendarDays className="size-5" />
          Configurar corte mensual
        </h2>
        <p className="mt-2 text-sm leading-6 text-foreground-secondary">
          Elegí la fecha que informó AMEJUCA para este período. El día del corte
          está incluido.
        </p>
        <fieldset
          disabled={pending || !data.canManage}
          className="mt-5 grid gap-5"
        >
          <label
            className="grid max-w-sm gap-2 text-sm font-medium"
            htmlFor="cutoff-date"
          >
            Fecha de corte confirmada
            <Input
              id="cutoff-date"
              type="date"
              required
              min={data.period + "-01"}
              max={lastDay}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSaved(false);
              }}
              className="min-h-11"
            />
          </label>
          <label
            className="grid gap-2 text-sm font-medium"
            htmlFor="cutoff-note"
          >
            Observación <span className="sr-only">(opcional)</span>
            <textarea
              id="cutoff-note"
              placeholder="Opcional: referencia al aviso recibido de AMEJUCA."
              maxLength={1000}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                setSaved(false);
              }}
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
            />
          </label>
          <div className="rounded-lg bg-muted/50 p-4 text-sm leading-6">
            <p>
              Emisión hasta el corte inclusive: primer vencimiento a fin del
              mismo mes.
            </p>
            <p>
              Emisión después del corte: primer vencimiento a fin del mes
              siguiente.
            </p>
          </div>
          {data.canManage ? (
            <Button
              type="submit"
              disabled={!date || pending}
              className="min-h-11 justify-self-start"
            >
              {pending ? "Guardando..." : "Guardar corte"}
            </Button>
          ) : (
            <p className="text-sm">
              La carga está disponible para analistas de Riesgo y
              administradores.
            </p>
          )}
        </fieldset>
        {error ? (
          <div role="alert" className="mt-4 space-y-3 text-sm text-destructive">
            <p>{error}</p>
            <p>
              Los datos ingresados se conservan. Si hubo un conflicto, recargá
              antes de volver a guardar.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void onReload().then((latest) => {
                  if (!latest) return;
                  setDate(latest.record?.cutoffDate ?? "");
                  setNote(latest.record?.note ?? "");
                  setVersion(latest.record?.version ?? 0);
                  setError("");
                  setSaved(false);
                });
              }}
            >
              Descartar borrador y recargar
            </Button>
          </div>
        ) : null}
        {saved ? (
          <p
            role="status"
            className="mt-4 text-sm font-medium text-emerald-800"
          >
            Corte guardado. Revisá y guardá nuevamente las condiciones de las
            solicitudes pendientes antes de generar el préstamo.
          </p>
        ) : null}
      </form>
      <section className="rounded-xl border border-border bg-surface p-5 md:p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-marino">
          <History className="size-5" />
          Historial del período
        </h2>
        {data.history.length ? (
          <ol className="mt-4 divide-y divide-border">
            {data.history.map((item) => (
              <li key={item.version} className="py-3 text-sm">
                <p className="font-medium">
                  {item.previousDate
                    ? `${displayDate(item.previousDate)} → `
                    : "Corte cargado: "}
                  {displayDate(item.cutoffDate)}
                </p>
                <p className="mt-1 text-foreground-secondary">
                  {item.updatedBy} ·{" "}
                  {new Date(item.updatedAt).toLocaleString("es-AR", {
                    timeZone: "America/Argentina/Buenos_Aires",
                  })}
                </p>
                {item.note ? (
                  <p className="mt-1 whitespace-pre-wrap break-words">
                    {item.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-foreground-secondary">
            Todavía no hay cambios registrados para este mes.
          </p>
        )}
        <Button
          type="button"
          variant="ghost"
          className="mt-3 min-h-11"
          onClick={onReload}
        >
          <RefreshCw className="mr-2 size-4" />
          Actualizar historial
        </Button>
      </section>
    </>
  );
}
