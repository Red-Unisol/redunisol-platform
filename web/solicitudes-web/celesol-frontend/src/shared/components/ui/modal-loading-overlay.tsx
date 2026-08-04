import { TableLoader } from "@/shared/components/ui/table-loader";

type ModalLoadingOverlayProps = {
  label?: string;
};

export function ModalLoadingOverlay({ label }: ModalLoadingOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
      <TableLoader
        className="rounded-md border border-border bg-surface px-6 py-5 shadow-xl"
        label={label}
      />
    </div>
  );
}
