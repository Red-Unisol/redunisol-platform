import {
  CircleAlert,
  CircleCheck,
  ArrowLeft,
  Mail,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import {
  resendVerificationCode,
  verifyEmail,
} from "@/modules/auth/services/auth-api";
import { ApiError } from "@/shared/services/http/api-error";

type VerifyEmailFormData = {
  code: string;
  email: string;
};

export function VerifyEmailPage() {
  const navigate = useNavigate();
  const [isResending, setIsResending] = useState(false);
  const [searchParams] = useSearchParams();
  const emailFromQuery = searchParams.get("email") ?? "";
  const identifierFromQuery = searchParams.get("identifier") ?? "";
  const { handleSubmit, register, getValues, formState } =
    useForm<VerifyEmailFormData>({
      defaultValues: {
        code: "",
        email: emailFromQuery,
      },
    });

  async function onSubmit(values: VerifyEmailFormData) {
    const email = values.email.trim();
    const identifier = identifierFromQuery || email;

    if (!identifier) {
      toast.error(
        "No hay un usuario para verificar. Vuelve al login e intenta de nuevo.",
        {
          icon: <CircleAlert className="size-5" />,
        },
      );
      return;
    }

    try {
      await verifyEmail({
        code: values.code,
        email: email || undefined,
        identifier,
      });
      toast.success("Correo verificado.", {
        icon: <CircleCheck className="size-5" />,
      });
      navigate("/login", { replace: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "No se pudo verificar.";
      toast.error(message, { icon: <CircleAlert className="size-5" /> });
    }
  }

  async function onResend() {
    if (isResending) {
      return;
    }

    const email = getValues("email").trim();
    const identifier = identifierFromQuery || email;

    if (!identifier) {
      toast.error(
        "No hay un usuario para reenviar. Vuelve al login e intenta de nuevo.",
        {
          icon: <CircleAlert className="size-5" />,
        },
      );
      return;
    }

    try {
      setIsResending(true);
      await resendVerificationCode({ identifier });
      toast.success("Si la cuenta existe, se envió un nuevo código.", {
        icon: <CircleCheck className="size-5" />,
      });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429
          ? "Alcanzaste el límite de envíos. Espera unos minutos e intenta nuevamente."
          : error instanceof Error
            ? error.message
            : "No se pudo reenviar.";
      toast.error(message, { icon: <CircleAlert className="size-5" /> });
    } finally {
      setIsResending(false);
    }
  }

  return (
    <section className="w-full max-w-[500px]">
      <div className="rounded-lg border border-border bg-surface px-8 py-7 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
        <header className="mb-7 text-center">
          <h1 className="text-[2rem] leading-tight font-semibold text-foreground">
            Verificar correo electrónico
          </h1>
          <p className="mx-auto mt-3 max-w-[380px] text-sm text-foreground-secondary">
            Hemos enviado un código de seguridad a su dirección de correo. Por
            favor, revise su bandeja de entrada y la carpeta de spam.
          </p>
        </header>

        <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-full bg-primary-soft/45 text-primary">
          <Mail className="size-6" />
        </div>

        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <input type="hidden" {...register("email")} />

          <div className="space-y-1.5">
            <label
              className="block text-sm font-medium text-foreground-secondary"
              htmlFor="verification-code"
            >
              Código de verificación
            </label>
            <input
              className="h-12 w-full rounded-md border border-input-border bg-input-background px-3 text-center text-lg font-semibold tracking-wide text-foreground outline-none transition placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-primary-soft"
              id="verification-code"
              placeholder="000000"
              {...register("code", {
                required: true,
                minLength: 6,
                maxLength: 6,
              })}
            />
            <p className="text-xs text-foreground-muted">
              Ingrese el código de 6 dígitos enviado a su bandeja de entrada.
            </p>
          </div>

          <button
            className="mt-1 h-12 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground"
            disabled={formState.isSubmitting}
            type="submit"
          >
            {formState.isSubmitting ? "Verificando..." : "Verificar cuenta"}
          </button>

          <div className="pt-2">
            <div className="mb-3 border-t border-border" />
            <button
              className="mx-auto flex items-center gap-2 text-sm font-medium text-primary transition hover:opacity-90"
              disabled={isResending}
              onClick={onResend}
              type="button"
            >
              <RotateCcw className="size-3.5" />
              {isResending ? "Reenviando..." : "Reenviar código"}
            </button>
          </div>

          <p className="pt-1 text-center text-sm text-foreground-secondary">
            <Link
              className="inline-flex items-center gap-2 hover:text-foreground"
              to="/login"
            >
              <ArrowLeft className="size-3.5" />
              Volver al inicio de sesión
            </Link>
          </p>
        </form>
      </div>
    </section>
  );
}
