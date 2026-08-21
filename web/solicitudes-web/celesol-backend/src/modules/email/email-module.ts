import { env } from "../../config/env";
import { EmailService } from "./email.service";

export const emailService = new EmailService({
  appName: env.APP_NAME,
  defaultSender: env.DEFAULT_MAIL_SENDER,
  smtpHost: env.SMTP_HOST,
  smtpPassword: env.SMTP_PASSWORD,
  smtpPort: env.SMTP_PORT,
  smtpUser: env.SMTP_USER,
});
