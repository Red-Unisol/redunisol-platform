export type SignatureNotificationEvent = {
  type: "signature_received" | "signature_requested";
  solicitudId: string;
  loanId: string;
  cycleId: string;
  verificationId?: string;
  reason?: string;
  requestId?: string;
};
