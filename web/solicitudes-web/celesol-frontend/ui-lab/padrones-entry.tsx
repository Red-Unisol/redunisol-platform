import { CredixsaInformeSection } from "@/modules/solicitudes-core/components/credixsa-informe-section";
import { UI_LAB_SOLICITUD_ID } from "./network-guard";

export function App() {
  return (
    <main className="min-w-0 bg-background text-foreground">
      <p className="p-3 text-sm">
        Entorno local · Datos ficticios · Consulta sin conexiones externas
      </p>
      <CredixsaInformeSection solicitudId={UI_LAB_SOLICITUD_ID} isActive />
    </main>
  );
}
