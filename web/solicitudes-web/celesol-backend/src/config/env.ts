import { z } from "zod";

const normalizeCommaSeparatedList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

// El finalizar de siempre. Sirve de default para no cambiar el comportamiento
// de produccion mientras dev apunta a su propia ruta.
const FINALIZAR_FIRMA_DIGITAL_BASE_URL_POR_DEFECTO =
  "https://redunisol.com.ar/finalizar.php";

const envSchema = z.object({
  ACCESS_TOKEN_SECRET: z
    .string()
    .min(32, "ACCESS_TOKEN_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce
    .number()
    .int("ACCESS_TOKEN_TTL_MINUTES must be an integer")
    .positive("ACCESS_TOKEN_TTL_MINUTES must be greater than 0")
    .default(15),
  ADJUNTOS_ALLOWED_EXTENSIONS: z
    .string()
    .min(1, "ADJUNTOS_ALLOWED_EXTENSIONS is required")
    .transform(normalizeCommaSeparatedList)
    .refine(
      (items) => items.length > 0,
      "ADJUNTOS_ALLOWED_EXTENSIONS must include at least one extension",
    ),
  ADJUNTOS_ALLOWED_MIME_TYPES: z
    .string()
    .min(1, "ADJUNTOS_ALLOWED_MIME_TYPES is required")
    .transform(normalizeCommaSeparatedList)
    .refine(
      (items) => items.length > 0,
      "ADJUNTOS_ALLOWED_MIME_TYPES must include at least one MIME type",
    ),
  ADJUNTOS_MAX_FILE_SIZE_BYTES: z.coerce
    .number()
    .int("ADJUNTOS_MAX_FILE_SIZE_BYTES must be an integer")
    .positive("ADJUNTOS_MAX_FILE_SIZE_BYTES must be greater than 0"),
  APP_ORIGIN: z.string().url("APP_ORIGIN must be a valid URL"),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid URL"),
  DEFAULT_MAIL_SENDER: z.string().email("DEFAULT_MAIL_SENDER must be an email"),
  EMAIL_VERIFICATION_CODE_TTL_MINUTES: z.coerce
    .number()
    .int("EMAIL_VERIFICATION_CODE_TTL_MINUTES must be an integer")
    .positive("EMAIL_VERIFICATION_CODE_TTL_MINUTES must be greater than 0")
    .default(15),
  EMAIL_SEND_RATE_LIMIT_MAX: z.coerce
    .number()
    .int("EMAIL_SEND_RATE_LIMIT_MAX must be an integer")
    .positive("EMAIL_SEND_RATE_LIMIT_MAX must be greater than 0")
    .default(5),
  EMAIL_SEND_RATE_LIMIT_WINDOW_MINUTES: z.coerce
    .number()
    .int("EMAIL_SEND_RATE_LIMIT_WINDOW_MINUTES must be an integer")
    .positive("EMAIL_SEND_RATE_LIMIT_WINDOW_MINUTES must be greater than 0")
    .default(15),
  // URL completa de la pagina de firma digital, incluido el path: en el link
  // que se le manda al socio se le agregan linea, ntrans y sol. Cambia por
  // ambiente porque dev tiene su propio sitio y su propia ruta.
  //
  // El preprocess es a proposito y no decorativo: docker compose pasa la
  // variable como cadena vacia cuando el env no la define, y una cadena vacia
  // no dispara el default de zod -- haria fallar la validacion y el server no
  // arrancaria. Vacia o ausente caen las dos en el valor por defecto.
  FINALIZAR_FIRMA_DIGITAL_BASE_URL: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() !== ""
        ? value.trim()
        : FINALIZAR_FIRMA_DIGITAL_BASE_URL_POR_DEFECTO,
    z.string().url("FINALIZAR_FIRMA_DIGITAL_BASE_URL must be a valid URL"),
  ),
  // URL completa del webhook de Kestra que consulta CredixSA al crear una
  // solicitud (el envoltorio consulta_credixsa_por_solicitud), con la clave
  // incluida -- se guarda entera para que la clave no quede en el codigo,
  // igual que hace redunisol-web. El informe que devuelve queda guardado en
  // la base para la pestaña.
  //
  // Vacia o ausente deshabilita la consulta: la app arranca igual y la
  // pestaña consulta CredixSA en el momento.
  CREDIXSA_CONSULTA_WEBHOOK_URL: z
    .string()
    .trim()
    .default(""),
  // Webhook que consulta la pestaña. Apunta directo a consulta_quiebra_credix,
  // el mismo flow que usan los analistas a mano, y NO al envoltorio que dispara
  // la consulta al crear la solicitud.
  //
  // La diferencia importa: el envoltorio tiene concurrency 1 para que los
  // disparos automaticos no se pisen entre si, y eso deja a la pestaña
  // encolada detras de ellos. Lo que espera una persona no puede compartir
  // cola con lo que corre en background.
  //
  // Las dos vias comparten la misma cache, asi que la consulta al crear la
  // solicitud le sigue sirviendo a esta.
  CREDIXSA_INFORME_WEBHOOK_URL: z.string().trim().default(""),
  // Alto a proposito: con la cache fria hay que esperar el scraping, que en el
  // ambiente real tardo entre 1 y 2 minutos.
  CREDIXSA_INFORME_TIMEOUT_MS: z.coerce
    .number()
    .int("CREDIXSA_INFORME_TIMEOUT_MS must be an integer")
    .positive("CREDIXSA_INFORME_TIMEOUT_MS must be greater than 0")
    .default(180000),
  // Cuanto espera el alta de una solicitud la respuesta de Kestra para
  // guardar el informe. Corre en segundo plano, sin nadie esperando del otro
  // lado, asi que es alto: tiene que cubrir la cola del envoltorio
  // (concurrency 1) mas el scraping.
  //
  // Subirlo de 5 minutos no sirve: el fetch de Node (undici) corta solo si la
  // respuesta no empezo a llegar en ese tiempo, y el webhook de Kestra no
  // manda nada hasta terminar. Si se corta no se pierde la consulta: el flow
  // termina igual, deja la cache de Kestra lista y la pestaña la aprovecha.
  CREDIXSA_CONSULTA_TIMEOUT_MS: z.coerce
    .number()
    .int("CREDIXSA_CONSULTA_TIMEOUT_MS must be an integer")
    .positive("CREDIXSA_CONSULTA_TIMEOUT_MS must be greater than 0")
    .default(300000),
  LEGACY_API_BASE_URL: z.string().url("LEGACY_API_BASE_URL must be a valid URL"),
  LEGACY_API_TIMEOUT_MS: z.coerce
    .number()
    .int("LEGACY_API_TIMEOUT_MS must be an integer")
    .positive("LEGACY_API_TIMEOUT_MS must be greater than 0")
    .default(10000),
  MAIL_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  MINIO_ACCESS_KEY: z.string().min(1, "MINIO_ACCESS_KEY is required"),
  MINIO_BUCKET_SOLICITUDES: z
    .string()
    .min(1, "MINIO_BUCKET_SOLICITUDES is required"),
  MINIO_ENDPOINT: z.string().min(1, "MINIO_ENDPOINT is required"),
  MINIO_PORT: z.coerce
    .number()
    .int("MINIO_PORT must be an integer")
    .positive("MINIO_PORT must be greater than 0"),
  MINIO_SECRET_KEY: z.string().min(1, "MINIO_SECRET_KEY is required"),
  MINIO_USE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce
    .number()
    .int("PASSWORD_RESET_TOKEN_TTL_MINUTES must be an integer")
    .positive("PASSWORD_RESET_TOKEN_TTL_MINUTES must be greater than 0")
    .default(15),
  PORT: z.coerce
    .number()
    .int("PORT must be an integer")
    .positive("PORT must be greater than 0")
    .default(3001),
  REFRESH_TOKEN_TTL_DAYS: z.coerce
    .number()
    .int("REFRESH_TOKEN_TTL_DAYS must be an integer")
    .positive("REFRESH_TOKEN_TTL_DAYS must be greater than 0")
    .default(7),
  SMTP_HOST: z.string().min(1, "SMTP_HOST is required"),
  SMTP_PASSWORD: z.string().min(1, "SMTP_PASSWORD is required"),
  SMTP_PORT: z.coerce
    .number()
    .int("SMTP_PORT must be an integer")
    .positive("SMTP_PORT must be greater than 0")
    .default(587),
  SMTP_USER: z.string().min(1, "SMTP_USER is required"),
  APP_NAME: z.string().min(1, "APP_NAME is required").default("Celesol"),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");

  throw new Error(`Invalid environment configuration: ${issues}`);
}

export const env = parsedEnv.data;
