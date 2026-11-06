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
        from: '"Celesol" <noreply@example.com>',
        headers: { "X-Mailer": "Celesol" },
        html: "<p>Hello</p>",
        subject: "Subject",
        to: "to@example.com",
      },
    ]);
  });

  it("renders and sends confirm account email", async () => {
    const sentMessages: Array<{
      html?: string;
      subject?: string;
      text?: string;
      to?: string;
    }> = [];
    const transporter = {
      sendMail: async (message: unknown) => {
        sentMessages.push(
          message as {
            html?: string;
            subject?: string;
            text?: string;
            to?: string;
          },
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
    assert.equal(sentMessages[0]?.subject, "Tu código de acceso a Celesol");
    assert.match(sentMessages[0]?.html ?? "", /123456/);
    assert.match(sentMessages[0]?.html ?? "", /Celesol/);
    assert.match(sentMessages[0]?.text ?? "", /123456/);
    // El texto oculto del preheader sumaba HIDDEN_TEXT en el filtro de spam.
    assert.doesNotMatch(sentMessages[0]?.html ?? "", /display:none/);
  });

  it("keeps a sender that already has a display name", async () => {
    const sentMessages: Array<{ from?: string }> = [];
    const transporter = {
      sendMail: async (message: unknown) => {
        sentMessages.push(message as { from?: string });
      },
    } as unknown as nodemailer.Transporter<SMTPTransport.SentMessageInfo>;
    const service = new EmailService(
      {
        appName: "Celesol",
        defaultSender: "Redunisol <noreply@example.com>",
        smtpHost: "smtp.gmail.com",
        smtpPassword: "password",
        smtpPort: 587,
        smtpUser: "user@example.com",
      },
      transporter,
    );

    await service.sendMail({ html: "<p>Hi</p>", subject: "S", to: "t@example.com" });

    assert.equal(sentMessages[0]?.from, "Redunisol <noreply@example.com>");
  });
});
