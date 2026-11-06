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
      from: payload.from ?? this.formatDefaultSender(),
      // Sin X-Mailer el filtro de salida de DonWeb suma MISSING_XM_UA.
      headers: { "X-Mailer": this.config.appName },
      html: payload.html,
      subject: payload.subject,
      ...(payload.text ? { text: payload.text } : {}),
      to: payload.to,
    });
  }

  // Remitente con nombre visible ("Celesol <noreply@...>"). Si la variable ya
  // trae un nombre, se respeta tal cual.
  private formatDefaultSender() {
    const sender = this.config.defaultSender.trim();
    if (sender.includes("<")) {
      return sender;
    }
    return `"${this.config.appName}" <${sender}>`;
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

    // El asunto anterior ("Código de verificación - Confirma tu cuenta") esta
    // en la lista de asuntos de spam del filtro de salida de DonWeb
    // (MB_SUBJECT_USED_IN_SPAM_CLAMAV) y los correos rebotaban con 550.
    await this.sendMail({
      html,
      subject: `Tu código de acceso a ${this.config.appName}`,
      text: [
        `Tu código para verificar tu cuenta en ${this.config.appName} es: ${input.code}`,
        "",
        "Si no solicitaste este registro, podés ignorar este mensaje.",
      ].join("\n"),
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
      subject: `Cambio de contraseña en ${this.config.appName}`,
      text: [
        `Recibimos una solicitud para cambiar la contraseña de tu cuenta en ${this.config.appName}.`,
        "",
        `Para elegir una nueva, abrí este enlace: ${input.resetUrl}`,
        "",
        "El enlace vence pronto. Si no solicitaste este cambio, podés ignorar este mensaje.",
      ].join("\n"),
      to: input.to,
    });
  }
}
