import {
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  User,
} from "lucide-react";
import { useState } from "react";
import { useForm, useWatch, type FieldErrors } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { register } from "@/modules/auth/services/auth-api";
import { ApiError } from "@/shared/services/http/api-error";

type RegisterFormData = {
  confirmPassword: string;
  confirmEmail: string;
  email: string;
  firstName: string;
  lastName: string;
  legacyUser: string;
  password: string;
};

const REGISTER_VALIDATION_TOAST_ID = "register-validation-error";

function buildRegisterValidationMessage(errors: FieldErrors<RegisterFormData>) {
  if (errors.confirmPassword?.message) {
    return String(errors.confirmPassword.message);
  }

  if (errors.email?.message) {
    return String(errors.email.message);
  }

  if (errors.password?.message) {
    return String(errors.password.message);
  }

  if (
    errors.firstName?.message ||
    errors.lastName?.message ||
    errors.legacyUser?.message
  ) {
    return "Complete todos los campos obligatorios.";
  }

  return "Revise los datos ingresados.";
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const {
    handleSubmit,
    register: registerField,
    control,
    formState,
  } = useForm<RegisterFormData>({
    defaultValues: {
      confirmPassword: "",
      confirmEmail: "",
      email: "",
      firstName: "",
      lastName: "",
      legacyUser: "",
      password: "",
    },
  });

  async function onSubmit(values: RegisterFormData) {
    toast.dismiss(REGISTER_VALIDATION_TOAST_ID);

    try {
      const response = await register({
        email: values.email,
        firstName: values.firstName,
        lastName: values.lastName,
        legacyUser: values.legacyUser,
        password: values.password,
      });

      toast.success(
        response.verificationEmailSent
          ? "Cuenta creada. Revisa tu correo para verificarla."
          : response.message || "Cuenta creada. Solicita un nuevo código.",
        { icon: <CircleCheck className="size-5" /> },
      );

      navigate(`/verify-email?email=${encodeURIComponent(values.email)}`, {
        replace: true,
      });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 409
          ? "El email o usuario legacy ya existe."
          : error instanceof Error
            ? error.message
            : "No se pudo crear la cuenta.";

      toast.error(message, { icon: <CircleAlert className="size-5" /> });
    }
  }

  function onInvalid(errors: FieldErrors<RegisterFormData>) {
    toast.error(buildRegisterValidationMessage(errors), {
      duration: 3500,
      icon: <CircleAlert className="size-5" />,
      id: REGISTER_VALIDATION_TOAST_ID,
    });
  }

  const isSubmitting = formState.isSubmitting;
  const passwordValue = useWatch({ control, name: "password" }) ?? "";
  const confirmPasswordValue =
    useWatch({ control, name: "confirmPassword" }) ?? "";
  const emailValue = useWatch({ control, name: "email" }) ?? "";
  const confirmEmailValue = useWatch({ control, name: "confirmEmail" }) ?? "";
  const passwordsMatch =
    confirmPasswordValue.length > 0 && confirmPasswordValue === passwordValue;
  const emailsMatch =
    confirmEmailValue.length > 0 && confirmEmailValue === emailValue;
  const passwordChecks = [
    {
      label: "Minimo 8 caracteres",
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
    <section className="w-full max-w-[760px]">
      <div className="rounded-lg border border-border bg-surface px-7 py-6 shadow-[0_8px_24px_rgba(15,23,42,0.08)]">
        <header className="mb-6">
          <h1 className="text-center text-[1.8rem] leading-tight font-semibold text-foreground">
            Crear cuenta
          </h1>
          <p className="mt-2 text-center text-sm text-foreground-secondary">
            Complete los datos para registrarse en nuestra plataforma.
          </p>
        </header>

        <form
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
          noValidate
          onSubmit={handleSubmit(onSubmit, onInvalid)}
        >
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground-secondary">
              Nombre
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <input
                className="h-11 w-full rounded-md border border-input-border bg-input-background pr-3 pl-9 text-sm text-foreground outline-none transition placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-primary-soft"
                disabled={isSubmitting}
                placeholder="Ej. Juan"
                {...registerField("firstName", {
                  required: "El nombre es obligatorio.",
                })}
              />
            </div>
            {formState.errors.firstName?.message ? (
              <p className="text-xs text-red-500">
                {String(formState.errors.firstName.message)}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground-secondary">
              Apellido
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <input
                className="h-11 w-full rounded-md border border-input-border bg-input-background pr-3 pl-9 text-sm text-foreground outline-none transition placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-primary-soft"
                disabled={isSubmitting}
                placeholder="Ej. Perez"
                {...registerField("lastName", {
                  required: "El apellido es obligatorio.",
                })}
              />
            </div>
            {formState.errors.lastName?.message ? (
              <p className="text-xs text-red-500">
                {String(formState.errors.lastName.message)}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground-secondary">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <input
                className="h-11 w-full rounded-md border border-input-border bg-input-background pr-3 pl-9 text-sm text-foreground outline-none transition placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-primary-soft"
                disabled={isSubmitting}
                placeholder="correo@ejemplo.com"
                type="email"
                {...registerField("email", {
                  pattern: {
                    message: "Ingrese un email valido.",
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  },
                  required: "El email es obligatorio.",
                })}
              />
            </div>
            {formState.errors.email?.message ? (
              <p className="text-xs text-red-500">
                {String(formState.errors.email.message)}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground-secondary">
              Confirmar email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <input
                className="h-11 w-full rounded-md border border-input-border bg-input-background pr-3 pl-9 text-sm text-foreground outline-none transition placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-primary-soft"
                disabled={isSubmitting}
                placeholder="correo@ejemplo.com"
                type="email"
                {...registerField("confirmEmail", {
                  required: "Debe confirmar el email.",
                  validate: (value) =>
                    value === emailValue || "Los emails no coinciden.",
                })}
              />
            </div>
            <p
              className={
                formState.errors.confirmEmail?.message
                  ? "text-xs text-red-500"
                  : emailsMatch
                    ? "text-xs text-emerald-600"
                    : "text-xs text-foreground-muted"
              }
            >
              {formState.errors.confirmEmail?.message
                ? String(formState.errors.confirmEmail.message)
                : emailsMatch
                  ? "✓ Los emails coinciden"
                  : "○ Los emails deben coincidir"}
            </p>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="block text-xs font-medium text-foreground-secondary">
              Nombre de Usuario
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <input
                className="h-11 w-full rounded-md border border-input-border bg-input-background pr-3 pl-9 text-sm text-foreground outline-none transition placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-primary-soft"
                disabled={isSubmitting}
                placeholder="usuario123"
                {...registerField("legacyUser", {
                  required: "El nombre de usuario legacy es obligatorio.",
                })}
              />
            </div>
            <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              Debe ser exactamente igual a su usuario en el sistema legacy.
            </p>
            {formState.errors.legacyUser?.message ? (
              <p className="text-xs text-red-500">
                {String(formState.errors.legacyUser.message)}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="block text-xs font-medium text-foreground-secondary">
              Contraseña
            </label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <input
                className="h-11 w-full rounded-md border border-input-border bg-input-background pr-10 pl-9 text-sm text-foreground outline-none transition placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-primary-soft"
                disabled={isSubmitting}
                placeholder="........"
                type={showPassword ? "text" : "password"}
                {...registerField("password", {
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

          <div className="space-y-1.5 md:col-span-2">
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
                {...registerField("confirmPassword", {
                  required: "Debe confirmar la contraseña.",
                  validate: (value) =>
                    value === passwordValue || "Las contraseñas no coinciden.",
                })}
              />
              <button
                aria-label={
                  showConfirmPassword
                    ? "Ocultar confirmacion de contraseña"
                    : "Mostrar confirmacion de contraseña"
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
            className="mt-2 h-11 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground md:col-span-2"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Registrando..." : "Registrarme"}
          </button>

          <p className="pt-1 text-center text-sm text-primary md:col-span-2">
            <Link className="hover:underline" to="/login">
              Ya tengo una cuenta
            </Link>
          </p>
        </form>
      </div>

      <p className="mt-6 text-center text-xs text-foreground-muted">
        Al registrarse, usted acepta nuestros Términos de Servicio y Política de
        Privacidad.
      </p>
    </section>
  );
}
