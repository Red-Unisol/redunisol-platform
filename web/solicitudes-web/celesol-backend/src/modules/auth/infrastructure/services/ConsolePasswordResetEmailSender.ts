import type { PasswordResetEmailSender } from "../../domain/services/PasswordResetEmailSender";

export class ConsolePasswordResetEmailSender
  implements PasswordResetEmailSender
{
  async sendPasswordResetEmail(input: { resetUrl: string; to: string }) {
    console.info(
      `[DEV EMAIL] Password reset link for ${input.to}: ${input.resetUrl}`,
    );
  }
}
