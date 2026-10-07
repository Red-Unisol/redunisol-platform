import { ApiError } from "@/shared/services/http/api-error";
import { DEFAULT_HTTP_TIMEOUT_MS } from "@/shared/services/http/http.constants";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

if (!API_BASE_URL) {
  throw new Error("Falta definir VITE_API_BASE_URL en el entorno.");
}

// En estas rutas un 401 no es "se vencio el token de acceso" (credenciales o
// clave actual incorrectas, o la propia renovacion): no se renueva ni reintenta.
const PATHS_SIN_RENOVACION = new Set([
  "/auth/login",
  "/auth/refresh",
  "/auth/logout",
  "/auth/register",
  "/auth/verify-email",
  "/auth/resend-verification-code",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/me/change-password",
]);

// El backend rota el refresh token en cada uso: dos renovaciones simultaneas
// harian fallar a la segunda. Todas las llamadas que reciban 401 a la vez
// comparten esta misma promesa.
let renovacionEnCurso: Promise<boolean> | null = null;

function renovarSesion(): Promise<boolean> {
  if (!renovacionEnCurso) {
    renovacionEnCurso = fetch(new URL("/auth/refresh", API_BASE_URL), {
      credentials: "include",
      method: "POST",
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        renovacionEnCurso = null;
      });
  }

  return renovacionEnCurso;
}

/**
 * fetch contra la API con la sesion del usuario. Si el token de acceso
 * (15 minutos) se vencio, lo renueva con el refresh token y reintenta una vez.
 */
export async function fetchConSesion(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const target = new URL(url, API_BASE_URL);
  const response = await fetch(target, { ...init, credentials: "include" });

  if (response.status !== 401 || PATHS_SIN_RENOVACION.has(target.pathname)) {
    return response;
  }

  const renovada = await renovarSesion();

  return renovada
    ? fetch(target, { ...init, credentials: "include" })
    : response;
}

function resolveErrorDetails(responseText: string): {
  code?: string;
  message: string;
} {
  if (!responseText) {
    return { message: "No se pudo completar la solicitud." };
  }

  try {
    const parsed = JSON.parse(responseText) as {
      error?: { code?: string; message?: string };
      message?: string;
    };
    return {
      code: parsed.error?.code,
      message: parsed.error?.message ?? parsed.message ?? responseText,
    };
  } catch {
    return { message: responseText };
  }
}

function translateBackendMessage(message: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes(
      "if the account exists, a password reset email will be sent",
    )
  ) {
    return "Si la cuenta existe, se enviará un correo para restablecer la contraseña.";
  }

  if (
    normalized.includes(
      "if the account exists and is not verified, a new code was sent",
    )
  ) {
    return "Si la cuenta existe y no está verificada, se envió un nuevo código.";
  }

  if (
    normalized.includes(
      "user registered. verification email could not be sent. request a new code",
    )
  ) {
    return "Cuenta creada. No se pudo enviar el correo de verificación. Solicita un nuevo código.";
  }

  if (normalized.includes("password reset successfully")) {
    return "Contraseña actualizada correctamente.";
  }

  if (normalized.includes("request body invalido")) {
    return "Hay datos inválidos en el formulario.";
  }

  if (normalized.includes("invalid request body")) {
    return "Hay datos inválidos en el formulario.";
  }

  if (normalized.includes("invalid credentials")) {
    return "Usuario o contraseña incorrectos.";
  }

  if (normalized.includes("email not verified")) {
    return "La cuenta no está verificada.";
  }

  if (normalized.includes("email already registered")) {
    return "El email ya está registrado.";
  }

  if (normalized.includes("legacy user already registered")) {
    return "El usuario del sistema legacy ya está registrado.";
  }

  if (normalized.includes("legacy user not found")) {
    return "No se encontró el usuario en el sistema legacy.";
  }

  if (normalized.includes("legacy user is inactive")) {
    return "El usuario del sistema legacy está inactivo.";
  }

  if (normalized.includes("legacy service unavailable")) {
    return "El servicio legacy no está disponible en este momento.";
  }

  if (normalized.includes("email already verified")) {
    return "La cuenta ya está verificada. Inicia sesión normalmente.";
  }

  if (normalized.includes("invalid email verification code")) {
    return "El código de verificación es inválido.";
  }

  if (normalized.includes("invalid password reset token")) {
    return "El enlace de recuperación es inválido o vencido.";
  }

  if (normalized.includes("email delivery failed")) {
    return "No se pudo enviar el correo. Intente nuevamente en unos minutos.";
  }

  if (normalized.includes("demasiados envios de correo")) {
    return "Alcanzaste el límite de envíos. Espera unos minutos e intenta nuevamente.";
  }

  if (normalized.includes("email must be valid")) {
    return "El email ingresado no es válido.";
  }

  if (normalized.includes("password must be at least 8 characters")) {
    return "La contraseña debe tener al menos 8 caracteres.";
  }

  if (normalized.includes("password must include a lowercase letter")) {
    return "La contraseña debe incluir una letra minúscula.";
  }

  if (normalized.includes("password must include an uppercase letter")) {
    return "La contraseña debe incluir una letra mayúscula.";
  }

  if (normalized.includes("password must include a number")) {
    return "La contraseña debe incluir un número.";
  }

  if (normalized.includes("password must include a symbol")) {
    return "La contraseña debe incluir un símbolo.";
  }

  if (normalized.includes("request invalido")) {
    return "Hay datos inválidos en el formulario.";
  }

  if (normalized.includes("patch body cannot be empty")) {
    return "No hay cambios para guardar.";
  }

  if (normalized.includes("socio not found")) {
    return "No se encontró el socio.";
  }

  if (normalized.includes("socio cuit already exists")) {
    return "Ya existe un socio con ese CUIT.";
  }

  if (normalized.includes("socio document already exists")) {
    return "Ya existe un socio con ese documento.";
  }

  return message;
}

function normalizeResponseMessage<TResponse>(response: TResponse): TResponse {
  if (!response || typeof response !== "object") {
    return response;
  }

  const candidate = response as { message?: unknown };
  if (typeof candidate.message !== "string") {
    return response;
  }

  return {
    ...candidate,
    message: translateBackendMessage(candidate.message),
  } as TResponse;
}

async function request<TResponse>(
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT",
  url: string,
  body?: unknown,
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<TResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const hasBody = body !== undefined;
    const response = await fetchConSesion(url, {
      body: hasBody ? JSON.stringify(body) : undefined,
      headers: hasBody
        ? {
            "Content-Type": "application/json",
          }
        : undefined,
      method,
      signal: controller.signal,
    });

    const responseText = await response.text();

    if (!response.ok) {
      const { code, message: backendMessage } =
        resolveErrorDetails(responseText);
      throw new ApiError(
        translateBackendMessage(backendMessage),
        response.status,
        undefined,
        responseText,
        code,
      );
    }

    if (!responseText) {
      return undefined as TResponse;
    }

    try {
      const parsedResponse = JSON.parse(responseText) as TResponse;
      return normalizeResponseMessage(parsedResponse);
    } catch (cause) {
      throw new ApiError(
        "La respuesta del servidor no es JSON válido.",
        response.status,
        cause,
      );
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(
        "La solicitud excedió el tiempo límite.",
        undefined,
        error,
      );
    }

    throw new ApiError("No se pudo conectar con el backend.", undefined, error);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export const apiClient = {
  get<TResponse>(url: string, timeoutMs?: number) {
    return request<TResponse>("GET", url, undefined, timeoutMs);
  },
  put<TResponse>(url: string, body?: unknown, timeoutMs?: number) {
    return request<TResponse>("PUT", url, body, timeoutMs);
  },
  patch<TResponse>(url: string, body?: unknown, timeoutMs?: number) {
    return request<TResponse>("PATCH", url, body, timeoutMs);
  },
  post<TResponse>(url: string, body?: unknown, timeoutMs?: number) {
    return request<TResponse>("POST", url, body, timeoutMs);
  },
  delete<TResponse>(url: string, body?: unknown, timeoutMs?: number) {
    return request<TResponse>("DELETE", url, body, timeoutMs);
  },
};
