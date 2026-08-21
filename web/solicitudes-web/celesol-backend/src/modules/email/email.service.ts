import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

import type { EmailPayload } from "./domain/EmailPayload";
import type { EmailSender } from "./domain/EmailSender";
import {
  getConfirmAccountEmailMetadata,
  getResetPasswordEmailMetadata,
} from "./config/email-metadata-config";
import { ConfirmAccountTemplate } from "./templates/confirmAccount";
import { ResetPasswordTemplate } from "./templates/resetPassword";

type EmailServiceConfig = {
  appName: string;
  defaultSender: string;
  smtpHost: string;
  smtpPassword: string;
  smtpPort: number;
  smtpUser: string;
};

export class EmailService implements EmailSender {
  private readonly config: EmailServiceConfig;
  private readonly transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo>;

  constructor(
    config: EmailServiceConfig,
    transporter?: nodemailer.Transporter<SMTPTransport.SentMessageInfo>,
  ) {
    this.config = config;
    this.transporter =
      transporter ??
      nodemailer.createTransport({
        auth: {
          pass: config.smtpPassword,
          user: config.smtpUser,
        },
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpPort === 465,
      });
  }

  async sendMail(payload: EmailPayload) {
    await this.transporter.sendMail({
      from: payload.from ?? this.config.defaultSender,
      html: payload.html,
      subject: payload.subject,
      to: payload.to,
    });
  }

  async sendConfirmAccountEmail(input: { code: string; to: string }) {
    const html = await render(
      ConfirmAccountTemplate(
        getConfirmAccountEmailMetadata({
          appName: this.config.appName,
          code: input.code,
        }),
      ),
    );

    await this.sendMail({
      html,
      subject: "Código de verificación - Confirma tu cuenta",
      to: input.to,
    });
  }

  async sendPasswordResetEmail(input: { resetUrl: string; to: string }) {
    const html = await render(
      ResetPasswordTemplate(
        getResetPasswordEmailMetadata({
          appName: this.config.appName,
          resetUrl: input.resetUrl,
        }),
      ),
    );

    await this.sendMail({
      html,
      subject: "Restablece tu contraseña",
      to: input.to,
    });
  }
}
