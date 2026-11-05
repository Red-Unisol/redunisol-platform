export type EmailPayload = {
  from?: string;
  html: string;
  subject: string;
  // Version en texto plano. Mandar solo HTML suma puntos de spam
  // (MIME_HTML_ONLY) en el filtro de salida de DonWeb.
  text?: string;
  to: string;
};
