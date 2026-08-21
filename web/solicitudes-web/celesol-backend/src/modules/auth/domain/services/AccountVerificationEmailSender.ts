export type AccountVerificationEmailSender = {
  sendAccountVerificationEmail(input: {
    code: string;
    to: string;
  }): Promise<void>;
};
