import {
  ArrowLeft,
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  LockKeyhole,
} from "lucide-react";
import { useState } from "react";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { resetPassword } from "@/modules/auth/services/auth-api";

type ResetPasswordFormData = {
  confirmPassword: string;
  password: string;
  token: string;
};

const RESET_PASSWORD_VALIDATION_TOAST_ID = "reset-password-validation-error";

function buildResetPasswordValidationMessage(
  errors: FieldErrors<ResetPasswordFormData>,
) {
  if (errors.confirmPassword?.message) {
    return String(errors.confirmPassword.message);
  }

  if (errors.password?.message) {
    return String(errors.password.message);
  }

  return "Revise los datos ingresados.";
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const tokenFromQuery = searchParams.get("token") ?? "";
  const { handleSubmit, register, control, formState } =
    useForm<ResetPasswordFormData>({
      defaultValues: {
        confirmPassword: "",
        password: "",
        token: tokenFromQuery,
      },
    });

  async function onSubmit(values: ResetPasswordFormData) {
    try {
      const response = await resetPassword(values);
      toast.success(response.message, {
        icon: <CircleCheck className="size-5" />,
      });
      navigate("/login", { replace: true });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo cambiar la contraseña.";
      toast.error(message, { icon: <CircleAlert className="size-5" /> });
    }
  }

  function onInvalid(errors: FieldErrors<ResetPasswordFormData>) {
    toast.error(buildResetPasswordValidationMessage(errors), {
      duration: 3500,
      icon: <CircleAlert className="size-5" />,
      id: RESET_PASSWORD_VALIDATION_TOAST_ID,
    });
  }

  const isSubmitting = formState.isSubmitting;
  const passwordValue = useWatch({ control, name: "password" }) ?? "";
  const confirmPasswordValue =
    useWatch({ control, name: "confirmPassword" }) ?? "";
  const passwordsMatch =
    confirmPasswordValue.length > 0 && confirmPasswordValue === passwordValue;
  const passwordChecks = [
    {
      label: "Mínimo 8 caracteres",
      met: passwordValue.length >= 8,
    },
    {
      label: "Una letra mayúscula",
      met: /[A-Z]/.test(passwordValue),
    },
    {
      label: "Una letra minúscula",
      met: /[a-z]/.test(passwordValue),
    },
    {
      label: "Un número",
      met: /\d/.test(passwordValue),
    },
    {
      label: "Un símbolo",
      met: /[^A-Za-z0-9]/.test(passwordValue),
    },
  ];

  return (
    <section className="w-full max-w-[560px]">
      <div className="rounded-lg border border-border bg-surface px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
        <header className="mb-6 text-center">
          <h1 className="text-[1.8rem] leading-tight font-semibold text-foreground">
            Nueva contraseña
          </h1>
          <p className="mt-2 text-sm text-foreground-secondary">
            Ingrese una nueva contraseña para recuperar el acceso.
          </p>
        </header>

        <form
          className="space-y-4"
          noValidate
          onSubmit={handleSubmit(onSubmit, onInvalid)}
        >
          <input type="hidden" {...register("token", { required: true })} />

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground-secondary">
              Nueva contraseña
            </label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <input
                className="h-11 w-full rounded-md border border-input-border bg-input-background pr-10 pl-9 text-sm text-foreground outline-none transition placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-primary-soft"
                disabled={isSubmitting}
                placeholder="........"
                type={showPassword ? "text" : "password"}
                {...register("password", {
                  minLength: {
                    message: "La contraseña debe tener al menos 8 caracteres.",
                    value: 8,
                  },
                  pattern: {
                    message:
                      "Use al menos una minúscula, una mayúscula, un número y un símbolo.",
                    value:
                      /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).+$/,
                  },
                  required: "La contraseña es obligatoria.",
                })}
              />
              <button
                aria-label={
                  showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                }
                className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-foreground-muted transition hover:text-foreground"
                disabled={isSubmitting}
                onClick={() => setShowPassword((currentValue) => !currentValue)}
                type="button"
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            {formState.errors.password?.message ? (
              <p className="text-xs text-red-500">
                {String(formState.errors.password.message)}
              </p>
            ) : null}
            <div className="space-y-1.5 rounded-md border border-border/70 bg-background/50 p-3 text-xs">
              <p className="font-medium text-foreground-secondary">
                Requisitos de contraseña
              </p>
              <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                {passwordChecks.map((item) => (
                  <li
                    className={
                      item.met ? "text-emerald-600" : "text-foreground-muted"
                    }
                    key={item.label}
                  >
                    {item.met ? "✓" : "○"} {item.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground-secondary">
              Confirmar contraseña
            </label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <input
                className="h-11 w-full rounded-md border border-input-border bg-input-background pr-10 pl-9 text-sm text-foreground outline-none transition placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-primary-soft"
                disabled={isSubmitting}
                placeholder="........"
                type={showConfirmPassword ? "text" : "password"}
                {...register("confirmPassword", {
                  required: "Debe confirmar la contraseña.",
                  validate: (value) =>
                    value === passwordValue || "Las contraseñas no coinciden.",
                })}
              />
              <button
                aria-label={
                  showConfirmPassword
                    ? "Ocultar confirmación de contraseña"
                    : "Mostrar confirmación de contraseña"
                }
                className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-foreground-muted transition hover:text-foreground"
                disabled={isSubmitting}
                onClick={() =>
                  setShowConfirmPassword((currentValue) => !currentValue)
                }
                type="button"
              >
                {showConfirmPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            <p
              className={
                formState.errors.confirmPassword?.message
                  ? "text-xs text-red-500"
                  : passwordsMatch
                    ? "text-xs text-emerald-600"
                    : "text-xs text-foreground-muted"
              }
            >
              {formState.errors.confirmPassword?.message
                ? String(formState.errors.confirmPassword.message)
                : passwordsMatch
                  ? "✓ Las contraseñas coinciden"
                  : "○ Las contraseñas deben coincidir"}
            </p>
          </div>

          <button
            className="mt-2 h-11 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Guardando..." : "Actualizar contraseña"}
          </button>

          <p className="pt-1 text-center text-sm text-foreground-secondary">
            <Link
              className="inline-flex items-center gap-2 hover:text-foreground"
              to="/login"
            >
              <ArrowLeft className="size-3.5" />
              Volver al login
            </Link>
          </p>
        </form>
      </div>
    </section>
  );
}
