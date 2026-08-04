import type { PasswordResetEmailSender } from "../../domain/services/PasswordResetEmailSender";
import type { EmailService } from "../../../email/email.service";

export class EmailServicePasswordResetSender
  implements PasswordResetEmailSender
{
  private readonly emailService: EmailService;

  constructor(emailService: EmailService) {
    this.emailService = emailService;
  }

  sendPasswordResetEmail(input: { resetUrl: string; to: string }) {
    return this.emailService.sendPasswordResetEmail(input);
  }
}
