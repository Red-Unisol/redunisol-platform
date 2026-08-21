export type PasswordResetEmailSender = {
  sendPasswordResetEmail(input: {
    resetUrl: string;
    to: string;
  }): Promise<void>;
};
