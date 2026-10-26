import { DocumentReviewError } from "./domain";
import { getSignatureApproval, isAnalysisReady, signatureSourceInclude, type SignatureDatabase } from "./signature-workflow";

export function finalizationAction(approved: boolean) {
  return approved ? "liquidar_con_firma" : "liquidar";
}

export async function assertSignatureTransferReady(db: SignatureDatabase, id: string, analysisFinishing = false) {
  const row = await db.solicitud.findUnique({ where: { id }, include: signatureSourceInclude });
  if (!row || row.archivedAt || row.estadoActual.isTerminal)
    throw new DocumentReviewError("La solicitud no está disponible para transferir.");
  if (!analysisFinishing && !isAnalysisReady(row))
    throw new DocumentReviewError("Finalizá el análisis antes de mandar a transferir.");
  const signature = await getSignatureApproval(db, id);
  if (!signature.approved)
    throw new DocumentReviewError("Se requiere una firma vigente aprobada por Legajos Digitales antes de transferir.");
  return signature;
}
