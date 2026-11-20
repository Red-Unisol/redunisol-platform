export type SignatureNotificationEvent = {
  solicitudId: string;
  loanId: string;
  cycleId: string;
} & (
  | { type: "signature_received"; verificationId: string; submittedAt: Date }
  | { type: "signature_requested"; requestId: string; reason?: string; contractChanged?: false }
  | { type: "signature_requested"; contractChanged: true; reason?: string; requestId?: never }
);
