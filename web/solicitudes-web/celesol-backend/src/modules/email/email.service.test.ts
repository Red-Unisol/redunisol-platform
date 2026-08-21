import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

import { EmailService } from "./email.service";

describe("EmailService", () => {
  it("sends mail through the configured transporter", async () => {
    const sentMessages: unknown[] = [];
    const transporter = {
      sendMail: async (message: unknown) => {
        sentMessages.push(message);
      },
    } as unknown as nodemailer.Transporter<SMTPTransport.SentMessageInfo>;
    const service = new EmailService(
      {
        appName: "Celesol",
        defaultSender: "noreply@example.com",
        smtpHost: "smtp.gmail.com",
        smtpPassword: "password",
        smtpPort: 587,
        smtpUser: "user@example.com",
      },
      transporter,
    );

    await service.sendMail({
      html: "<p>Hello</p>",
      subject: "Subject",
      to: "to@example.com",
    });

    assert.deepEqual(sentMessages, [
      {
        from: "noreply@example.com",
        html: "<p>Hello</p>",
        subject: "Subject",
        to: "to@example.com",
      },
    ]);
  });

  it("renders and sends confirm account email", async () => {
    const sentMessages: Array<{ html?: string; subject?: string; to?: string }> =
      [];
    const transporter = {
      sendMail: async (message: unknown) => {
        sentMessages.push(
          message as { html?: string; subject?: string; to?: string },
        );
      },
    } as unknown as nodemailer.Transporter<SMTPTransport.SentMessageInfo>;
    const service = new EmailService(
      {
        appName: "Celesol",
        defaultSender: "noreply@example.com",
        smtpHost: "smtp.gmail.com",
        smtpPassword: "password",
        smtpPort: 587,
        smtpUser: "user@example.com",
      },
      transporter,
    );

    await service.sendConfirmAccountEmail({
      code: "123456",
      to: "to@example.com",
    });

    assert.equal(sentMessages[0]?.to, "to@example.com");
    assert.equal(
      sentMessages[0]?.subject,
      "Código de verificación - Confirma tu cuenta",
    );
    assert.match(sentMessages[0]?.html ?? "", /123456/);
    assert.match(sentMessages[0]?.html ?? "", /Celesol/);
  });
});
