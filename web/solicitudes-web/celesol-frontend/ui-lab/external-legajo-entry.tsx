import { DocumentReviewPanel } from "@/modules/solicitudes-core/components/document-review-panel";
import { UI_LAB_SOLICITUD_ID } from "./network-guard";

export function App() {
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-8">
      <p className="text-sm text-foreground-secondary">
        Laboratorio local · datos ficticios · sin conexiones operativas
      </p>
      <h1 className="text-xl font-semibold">Solicitud de ejemplo · Legajos</h1>
      <DocumentReviewPanel solicitudId={UI_LAB_SOLICITUD_ID} />
    </main>
  );
}
