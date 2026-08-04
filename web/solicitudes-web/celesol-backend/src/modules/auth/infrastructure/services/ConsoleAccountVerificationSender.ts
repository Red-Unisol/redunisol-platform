import type { AccountVerificationEmailSender } from "../../domain/services/AccountVerificationEmailSender";

export class ConsoleAccountVerificationSender
  implements AccountVerificationEmailSender
{
  async sendAccountVerificationEmail(input: { code: string; to: string }) {
    console.info(
      `[DEV EMAIL] Verification code for ${input.to}: ${input.code}`,
    );
  }
}
