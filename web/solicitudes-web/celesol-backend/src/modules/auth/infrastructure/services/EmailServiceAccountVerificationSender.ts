import type { EmailService } from "../../../email/email.service";
import type { AccountVerificationEmailSender } from "../../domain/services/AccountVerificationEmailSender";

export class EmailServiceAccountVerificationSender
  implements AccountVerificationEmailSender
{
  private readonly emailService: EmailService;

  constructor(emailService: EmailService) {
    this.emailService = emailService;
  }

  sendAccountVerificationEmail(input: { code: string; to: string }) {
    return this.emailService.sendConfirmAccountEmail(input);
  }
}
