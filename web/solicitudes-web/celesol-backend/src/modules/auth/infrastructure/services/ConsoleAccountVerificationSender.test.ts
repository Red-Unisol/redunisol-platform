import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConsoleAccountVerificationSender } from "./ConsoleAccountVerificationSender";

describe("ConsoleAccountVerificationSender", () => {
  it("logs verification code for development", async () => {
    const originalInfo = console.info;
    const messages: unknown[][] = [];
    console.info = (...args: unknown[]) => {
      messages.push(args);
    };

    try {
      const sender = new ConsoleAccountVerificationSender();
      await sender.sendAccountVerificationEmail({
        code: "123456",
        to: "user@example.com",
      });

      assert.deepEqual(messages, [
        ["[DEV EMAIL] Verification code for user@example.com: 123456"],
      ]);
    } finally {
      console.info = originalInfo;
    }
  });
});
