import { ArrowLeft, CircleAlert, CircleCheck, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { requestPasswordReset } from "@/modules/auth/services/auth-api";
import { ApiError } from "@/shared/services/http/api-error";

type ForgotPasswordFormData = {
  email: string;
};

const SUCCESS_COOLDOWN_SECONDS = 60;
const RATE_LIMIT_COOLDOWN_SECONDS = 15 * 60;

export function ForgotPasswordPage() {
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const { handleSubmit, register, formState } = useForm<ForgotPasswordFormData>(
    {
      defaultValues: { email: "" },
    },
  );

  async function onSubmit(values: ForgotPasswordFormData) {
    try {
      const response = await requestPasswordReset(values);
      toast.success(response.message, {
        icon: <CircleCheck className="size-5" />,
      });
      setCooldownSeconds(SUCCESS_COOLDOWN_SECONDS);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setCooldownSeconds(RATE_LIMIT_COOLDOWN_SECONDS);
      }

      const message =
        error instanceof ApiError && error.status === 429
          ? "Alcanzaste el límite de envíos. Espera unos minutos e intenta nuevamente."
          : error instanceof Error
            ? error.message
            : "No se pudo procesar.";
      toast.error(message, { icon: <CircleAlert className="size-5" /> });
    }
  }

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return;
    }

    const intervalId = setInterval(() => {
      setCooldownSeconds((currentValue) => Math.max(0, currentValue - 1));
    }, 1000);

    return () => clearInterval(intervalId);
  }, [cooldownSeconds]);

  const isCooldownActive = cooldownSeconds > 0;
  const isSubmitting = formState.isSubmitting;
  const isButtonDisabled = isSubmitting || isCooldownActive;
  const cooldownMinutes = String(Math.floor(cooldownSeconds / 60)).padStart(
    2,
    "0",
  );
  const cooldownRemainderSeconds = String(cooldownSeconds % 60).padStart(
    2,
    "0",
  );

  return (
    <section className="w-full max-w-[500px]">
      <div className="rounded-lg border border-border bg-surface px-8 py-7 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
        <header className="mb-7 text-center">
          <h1 className="text-[2rem] leading-tight font-semibold text-foreground">
            Recuperar contraseña
          </h1>
          <p className="mx-auto mt-3 max-w-[380px] text-sm text-foreground-secondary">
            Ingrese su correo de recuperación para recibir instrucciones y
            restablecer su contraseña.
          </p>
        </header>

        <div className="mx-auto mb-6 flex size-14 items-center justify-center rounded-full bg-primary-soft/45 text-primary">
          <Mail className="size-6" />
        </div>

        <form
          className="space-y-4"
          noValidate
          onSubmit={handleSubmit(onSubmit)}
        >
          <div className="space-y-1.5">
            <label
              className="block text-sm font-medium text-foreground-secondary"
              htmlFor="recovery-email"
            >
              Correo electrónico de recuperación
            </label>
            <input
              className="h-12 w-full rounded-md border border-input-border bg-input-background px-3 text-sm text-foreground outline-none transition placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-primary-soft"
              id="recovery-email"
              placeholder="correo@ejemplo.com"
              type="email"
              {...register("email", { required: true })}
            />
            <p className="text-xs text-foreground-muted">
              Enviaremos un enlace para que pueda cambiar su contraseña.
            </p>
          </div>

          <button
            className="mt-1 h-12 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground"
            disabled={isButtonDisabled}
            type="submit"
          >
            {isSubmitting
              ? "Enviando..."
              : isCooldownActive
                ? `Reenviar en ${cooldownMinutes}:${cooldownRemainderSeconds}`
                : "Enviar correo"}
          </button>

          <div className="pt-2">
            <div className="mb-3 border-t border-border" />
            <p className="text-center text-sm text-foreground-secondary">
              <Link
                className="inline-flex items-center gap-2 hover:text-foreground"
                to="/login"
              >
                <ArrowLeft className="size-3.5" />
                Volver al inicio de sesión
              </Link>
            </p>
          </div>
        </form>
      </div>
    </section>
  );
}
