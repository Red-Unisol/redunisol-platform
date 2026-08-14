import { SolicitudesLoader } from "@/shared/components/ui/solicitudes-loader";

type SolicitudesContentLoaderProps = {
  label?: string;
};

export function SolicitudesContentLoader({
  label = "Cargando solicitudes...",
}: SolicitudesContentLoaderProps) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center rounded-md border border-border bg-surface">
      <SolicitudesLoader className="scale-[0.92]" label={label} size="md" />
    </div>
  );
}
