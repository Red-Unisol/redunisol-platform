import { useState } from "react";
import { SolicitudWorkflowActionDialog } from "@/modules/solicitudes-core/components/solicitud-workflow-action-dialog";
import type {
  ExecuteWorkflowTransitionRequest,
  WorkflowTransition,
} from "@/modules/solicitudes/types/solicitudes-core";

export function App() {
  const scenario = new URLSearchParams(location.search).get("scenario");
  const required = scenario === "required";
  const transfer = scenario === "transfer";
  const [open, setOpen] = useState(true);
  const [result, setResult] = useState<ExecuteWorkflowTransitionRequest | null>(
    null,
  );
  const transition: WorkflowTransition = {
    id: "fixture-transition",
    actionCode: required ? "revisar" : "liquidar",
    actionLabel: required
      ? "Devolver a Revisar"
      : transfer
        ? "Mandar a transferir"
        : "Enviar a firmar",
    blockedReason: null,
    defaultComment:
      required || transfer
        ? null
        : "Análisis finalizado; firma pendiente de aprobación.",
    description: null,
    requiresComment: required,
    saveAndExit: false,
    sortOrder: 20,
    toState: {
      code: required
        ? "Revisar"
        : transfer
          ? "Transferir"
          : "VerificarFirmaYDocumentacion",
      name: required
        ? "Revisar"
        : transfer
          ? "Para transferir"
          : "Revisión de firma",
      owner: {
        code: required
          ? "VENDEDORES"
          : transfer
            ? "TESORERIA"
            : "LEGAJOS_DIGITALES",
        name: "Área de ejemplo",
      },
    },
  };
  return (
    <main className="p-4 text-foreground">
      <p>Entorno local · Datos ficticios · No envía solicitudes</p>
      <button onClick={() => setOpen(true)}>Abrir confirmación</button>
      {result && (
        <output aria-label="Resultado de prueba">
          {JSON.stringify(result)}
        </output>
      )}
      <SolicitudWorkflowActionDialog
        open={open}
        transition={transition}
        onOpenChange={setOpen}
        onConfirm={(payload) => {
          setResult(payload);
          setOpen(false);
        }}
      />
    </main>
  );
}
