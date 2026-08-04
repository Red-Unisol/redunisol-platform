import { CircleAlert, Eye, EyeOff, LockKeyhole, User } from "lucide-react";
import { useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useLoginMutation } from "@/modules/auth/hooks/use-auth-session";
import { getDefaultAuthenticatedRoute } from "@/modules/auth/utils/auth-user";
import { ApiError } from "@/shared/services/http/api-error";

type LoginFormData = {
  username: string;
  password: string;
};

const LOGIN_VALIDATION_TOAST_ID = "login-validation-error";
const LOGIN_REQUEST_TOAST_ID = "login-request-error";

function buildLoginValidationMessage(errors: FieldErrors<LoginFormData>) {
  const usernameMessage = errors.username?.message;
  const passwordMessage = errors.password?.message;

  if (usernameMessage && passwordMessage) {
    return "El nombre de usuario y la contraseña no deben estar vacíos.";
  }

  if (usernameMessage) {
    return "El nombre de usuario no debe estar vacío.";
  }

  if (passwordMessage) {
    return "La contraseña no debe estar vacía.";
  }

  return null;
}

export function LoginForm() {
  const navigate = useNavigate();
  const loginMutation = useLoginMutation();
  const [showPassword, setShowPassword] = useState(false);
  const { handleSubmit, register } = useForm<LoginFormData>({
    defaultValues: {
      username: "",
      password: "",
    },
  });

  async function onSubmit(data: LoginFormData) {
    toast.dismiss(LOGIN_VALIDATION_TOAST_ID);
    toast.dismiss(LOGIN_REQUEST_TOAST_ID);

    try {
      const response = await loginMutation.mutateAsync({
        identifier: data.username,
        password: data.password,
      });

      navigate(getDefaultAuthenticatedRoute(response.user), { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        const query = new URLSearchParams();
        query.set("identifier", data.username);
        if (data.username.includes("@")) {
          query.set("email", data.username);
        }
        navigate(`/verify-email?${query.toString()}`, { replace: true });
        return;
      }

      const message =
        error instanceof ApiError && error.status === 401
          ? "Usuario o contraseña incorrectos."
          : error instanceof Error
            ? error.message
            : "No se pudo iniciar sesión.";

      toast.error(message, {
        id: LOGIN_REQUEST_TOAST_ID,
        icon: <CircleAlert className="size-5" />,
        duration: 3500,
      });
    }
  }

  function onInvalid(fieldErrors: FieldErrors<LoginFormData>) {
    const message = buildLoginValidationMessage(fieldErrors);

    if (!message) {
      toast.dismiss(LOGIN_VALIDATION_TOAST_ID);
      return;
    }

    toast.error(message, {
      id: LOGIN_VALIDATION_TOAST_ID,
      icon: <CircleAlert className="size-5" />,
      duration: 3500,
    });
  }

  const isSubmitting = loginMutation.isPending;

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={handleSubmit(onSubmit, onInvalid)}
    >
      <div className="space-y-1.5">
        <label
          className="block text-xs font-medium text-foreground-secondary"
          htmlFor="username"
        >
          Nombre de Usuario
        </label>
        <div className="relative">
          <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
          <input
            autoComplete="username"
            className="h-10 w-full rounded-sm border border-input-border bg-input-background pr-3 pl-9 text-sm text-foreground shadow-none outline-none transition placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-primary-soft disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground"
            disabled={isSubmitting}
            id="username"
            placeholder="Ej. juan.perez"
            type="text"
            {...register("username", {
              required: "El nombre de usuario no debe estar vacío.",
            })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label
          className="block text-xs font-medium text-foreground-secondary"
          htmlFor="password"
        >
          Contraseña
        </label>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
          <input
            autoComplete="current-password"
            className="h-10 w-full rounded-sm border border-input-border bg-input-background pr-10 pl-9 text-sm text-foreground shadow-none outline-none transition placeholder:text-foreground-muted focus:border-input-focus focus:ring-2 focus:ring-primary-soft disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground"
            disabled={isSubmitting}
            id="password"
            placeholder="........"
            type={showPassword ? "text" : "password"}
            {...register("password", {
              required: "La contraseña no debe estar vacía.",
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
      </div>

      <button
        className="mt-1 h-10 w-full rounded-sm bg-primary text-sm font-semibold text-primary-foreground transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-disabled-background disabled:text-disabled-foreground"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? "Conectando..." : "Conectarse"}
      </button>
    </form>
  );
}
