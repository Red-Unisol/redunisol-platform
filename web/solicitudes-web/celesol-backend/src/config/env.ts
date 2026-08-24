import { z } from "zod";

const normalizeCommaSeparatedList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

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
  LEGACY_API_BASE_URL: z
    .string()
    .url("LEGACY_API_BASE_URL must be a valid URL"),
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
  MINIO_REGION: z.string().default(""),
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
