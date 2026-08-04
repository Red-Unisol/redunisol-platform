export type ConfirmAccountEmailMetadata = {
  appName: string;
  backgroundColor: string;
  code: string;
  primaryColor: string;
  secondaryTextColor: string;
  textColor: string;
};

export type ResetPasswordEmailMetadata = {
  appName: string;
  backgroundColor: string;
  primaryColor: string;
  resetUrl: string;
  secondaryTextColor: string;
  textColor: string;
};

export function getConfirmAccountEmailMetadata(input: {
  appName: string;
  code: string;
}): ConfirmAccountEmailMetadata {
  return {
    appName: input.appName,
    backgroundColor: "#f8fafc",
    code: input.code,
    primaryColor: "#2563eb",
    secondaryTextColor: "#64748b",
    textColor: "#0f172a",
  };
}

export function getResetPasswordEmailMetadata(input: {
  appName: string;
  resetUrl: string;
}): ResetPasswordEmailMetadata {
  return {
    appName: input.appName,
    backgroundColor: "#f8fafc",
    primaryColor: "#2563eb",
    resetUrl: input.resetUrl,
    secondaryTextColor: "#64748b",
    textColor: "#0f172a",
  };
}
