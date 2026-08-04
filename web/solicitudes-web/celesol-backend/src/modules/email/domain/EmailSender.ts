import type { EmailPayload } from "./EmailPayload";

export type EmailSender = {
  sendMail(payload: EmailPayload): Promise<void>;
};
