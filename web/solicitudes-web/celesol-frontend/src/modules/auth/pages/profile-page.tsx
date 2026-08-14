import {
  CircleAlert,
  CircleCheck,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  Save,
  User,
} from "lucide-react";
import { useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  useAuthSessionQuery,
  useChangeOwnPasswordMutation,
  useUpdateOwnProfileMutation,
} from "@/modules/auth/hooks/use-auth-session";
import {
  resendVerificationCode,
  verifyEmail,
} from "@/modules/auth/services/auth-api";
import { ApiError } from "@/shared/services/http/api-error";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";

type ProfileFormData = {
  email: string;
  firstName: string;
  lastName: string;
};

type PasswordFormData = {
  confirmNewPassword: string;
  currentPassword: string;
  newPassword: string;
};

type VerifyEmailFormData = {
  code: string;
};

const PROFILE_VALIDATION_TOAST_ID = "profile-validation-error";
const PASSWORD_VALIDATION_TOAST_ID = "profile-password-validation-error";
const VERIFY_CODE_VALIDATION_TOAST_ID = "profile-verify-code-validation-error";

export function ProfilePage() {
  const navigate = useNavigate();
  const sessionQuery = useAuthSessionQuery();
  const user = sessionQuery.data;
  const updateProfileMutation = useUpdateOwnProfileMutation();
  const changePasswordMutation = useChangeOwnPasswordMutation();
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmNewPassword, setShowConfirmNewPassword] = useState(false);
  const [isResendingCode, setIsResendingCode] = useState(false);

  // `values` (not `defaultValues`) keeps the form in sync once the async
  // session query resolves — this component renders before `user` exists.
  const profileForm = useForm<ProfileFormData>({
    values: {
      email: user?.email ?? "",
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
    },
  });
  const passwordForm = useForm<PasswordFormData>({
    defaultValues: {
      confirmNewPassword: "",
      currentPassword: "",
      newPassword: "",
    },
  });
  const verifyForm = useForm<VerifyEmailFormData>({
    defaultValues: { code: "" },
  });

  async function onSubmitProfile(values: ProfileFormData) {
    const previousEmail = user?.email.toLowerCase();
    const nextEmail = values.email.trim().toLowerCase();

    try {
      await updateProfileMutation.mutateAsync({
        email: values.email,
        firstName: values.firstName,
        lastName: values.lastName,
      });

      if (previousEmail && nextEmail !== previousEmail) {
        toast.success(
          "Datos actualizados. Te enviamos un código para verificar tu nuevo email.",
          { icon: <CircleCheck className="size-5" /> },
        );
      } else {
        toast.success("Datos actualizados.", {
          icon: <CircleCheck className="size-5" />,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudieron guardar los datos.";
      toast.error(message, { icon: <CircleAlert className="size-5" /> });
    }
  }

  function onInvalidProfile(errors: FieldErrors<ProfileFormData>) {
    const message =
      errors.firstName?.message ??
      errors.lastName?.message ??
      errors.email?.message ??
      "Revisá los datos ingresados.";

    toast.error(String(message), {
      duration: 3500,
      icon: <CircleAlert className="size-5" />,
      id: PROFILE_VALIDATION_TOAST_ID,
    });
  }

  async function onSubmitPassword(values: PasswordFormData) {
    try {
      await changePasswordMutation.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });

      toast.success("Contraseña actualizada. Iniciá sesión nuevamente.", {
        icon: <CircleCheck className="size-5" />,
      });
      navigate("/login", { replace: true });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 401
          ? "La contraseña actual es incorrecta."
          : error instanceof Error
            ? error.message
            : "No se pudo cambiar la contraseña.";

      toast.error(message, { icon: <CircleAlert className="size-5" /> });
    }
  }

  function onInvalidPassword(errors: FieldErrors<PasswordFormData>) {
    const message =
      errors.currentPassword?.message ??
      errors.newPassword?.message ??
      errors.confirmNewPassword?.message ??
      "Revisá los datos ingresados.";

    toast.error(String(message), {
      duration: 3500,
      icon: <CircleAlert className="size-5" />,
      id: PASSWORD_VALIDATION_TOAST_ID,
    });
  }

  function onInvalidVerifyCode(errors: FieldErrors<VerifyEmailFormData>) {
    const message =
      errors.code?.message ?? "Ingresá el código de verificación.";

    toast.error(String(message), {
      duration: 3500,
      icon: <CircleAlert className="size-5" />,
      id: VERIFY_CODE_VALIDATION_TOAST_ID,
    });
  }

  async function onSubmitVerifyCode(values: VerifyEmailFormData) {
    if (!user) {
      return;
    }

    try {
      await verifyEmail({ code: values.code, identifier: user.email });
      await sessionQuery.refetch();
      toast.success("Email verificado.", {
        icon: <CircleCheck className="size-5" />,
      });
      verifyForm.reset({ code: "" });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo verificar el código.";
      toast.error(message, { icon: <CircleAlert className="size-5" /> });
    }
  }

  async function onResendCode() {
    if (!user || isResendingCode) {
      return;
    }

    try {
      setIsResendingCode(true);
      await resendVerificationCode({ identifier: user.email });
      toast.success("Te enviamos un nuevo código.", {
        icon: <CircleCheck className="size-5" />,
      });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 429
          ? "Alcanzaste el límite de envíos. Esperá unos minutos e intentá nuevamente."
          : error instanceof Error
            ? error.message
            : "No se pudo reenviar el código.";
      toast.error(message, { icon: <CircleAlert className="size-5" /> });
    } finally {
      setIsResendingCode(false);
    }
  }

  const isSavingProfile = updateProfileMutation.isPending;
  const isSavingPassword = changePasswordMutation.isPending;
  const isVerifyingCode = verifyForm.formState.isSubmitting;

  const newPasswordValue = passwordForm.watch("newPassword") ?? "";
  const confirmNewPasswordValue =
    passwordForm.watch("confirmNewPassword") ?? "";
  const passwordsMatch =
    confirmNewPasswordValue.length > 0 &&
    confirmNewPasswordValue === newPasswordValue;
  const passwordChecks = [
    { label: "Mínimo 8 caracteres", met: newPasswordValue.length >= 8 },
    { label: "Una letra mayúscula", met: /[A-Z]/.test(newPasswordValue) },
    { label: "Una letra minúscula", met: /[a-z]/.test(newPasswordValue) },
    { label: "Un número", met: /\d/.test(newPasswordValue) },
    { label: "Un símbolo", met: /[^A-Za-z0-9]/.test(newPasswordValue) },
  ];

  if (sessionQuery.isPending || !user) {
    return null;
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-6 p-4 md:p-6">
      {!user.emailVerified ? (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-5">
          <div className="flex items-center gap-2 text-amber-800">
            <Mail className="size-5" />
            <h2 className="text-base font-semibold">Verificá tu email</h2>
          </div>
          <p className="mt-1 text-sm text-amber-800">
            Te enviamos un código a {user.email}. Ingresalo para verificar tu
            dirección de correo.
          </p>
          <form
            className="mt-3 flex flex-wrap items-end gap-3"
            onSubmit={verifyForm.handleSubmit(
              onSubmitVerifyCode,
              onInvalidVerifyCode,
            )}
          >
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-amber-800">
                Código de verificación
              </label>
              <input
                className="h-10 w-40 rounded-md border border-amber-300 bg-white px-3 text-center text-sm tracking-wide text-foreground outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                maxLength={6}
                placeholder="000000"
                {...verifyForm.register("code", {
                  maxLength: {
                    message: "El código debe tener 6 dígitos.",
                    value: 6,
                  },
                  minLength: {
                    message: "El código debe tener 6 dígitos.",
                    value: 6,
                  },
                  required: "Ingresá el código de verificación.",
                })}
              />
            </div>
            <button
              className="h-10 rounded-md bg-amber-600 px-4 text-sm font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isVerifyingCode}
              type="submit"
            >
              {isVerifyingCode ? "Verificando..." : "Verificar"}
            </button>
            <button
              className="h-10 rounded-md border border-amber-300 px-4 text-sm font-medium text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isResendingCode}
              onClick={onResendCode}
              type="button"
            >
              {isResendingCode ? "Reenviando..." : "Reenviar código"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold text-foreground">
          Datos personales
        </h2>
        <form
          className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2"
          noValidate
          onSubmit={profileForm.handleSubmit(onSubmitProfile, onInvalidProfile)}
        >
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground-secondary">
              Nombre
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <Input
                className="pl-9"
                disabled={isSavingProfile}
                {...profileForm.register("firstName", {
                  required: "El nombre no debe estar vacío.",
                })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground-secondary">
              Apellido
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <Input
                className="pl-9"
                disabled={isSavingProfile}
                {...profileForm.register("lastName", {
                  required: "El apellido no debe estar vacío.",
                })}
              />
            </div>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="block text-xs font-medium text-foreground-secondary">
              Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <Input
                className="pl-9"
                disabled={isSavingProfile}
                type="email"
                {...profileForm.register("email", {
                  pattern: {
                    message: "El email no es válido.",
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                  },
                  required: "El email no debe estar vacío.",
                })}
              />
            </div>
            <p className="text-xs text-foreground-muted">
              Si lo cambiás, vas a tener que verificarlo de nuevo.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 md:col-span-2">
            <Button
              disabled={isSavingProfile}
              onClick={() => profileForm.reset()}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button disabled={isSavingProfile} type="submit">
              <Save className="size-4" />
              {isSavingProfile ? "Guardando..." : "Guardar datos"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold text-foreground">
          Cambiar contraseña
        </h2>
        <form
          className="mt-4 space-y-4"
          noValidate
          onSubmit={passwordForm.handleSubmit(
            onSubmitPassword,
            onInvalidPassword,
          )}
        >
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground-secondary">
              Contraseña actual
            </label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <Input
                className="pl-9"
                disabled={isSavingPassword}
                type={showCurrentPassword ? "text" : "password"}
                {...passwordForm.register("currentPassword", {
                  required: "Ingresá tu contraseña actual.",
                })}
              />
              <button
                aria-label={
                  showCurrentPassword
                    ? "Ocultar contraseña"
                    : "Mostrar contraseña"
                }
                className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-foreground-muted transition hover:text-foreground"
                disabled={isSavingPassword}
                onClick={() =>
                  setShowCurrentPassword((currentValue) => !currentValue)
                }
                type="button"
              >
                {showCurrentPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-foreground-secondary">
              Nueva contraseña
            </label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <Input
                className="pl-9"
                disabled={isSavingPassword}
                type={showNewPassword ? "text" : "password"}
                {...passwordForm.register("newPassword", {
                  minLength: {
                    message: "La contraseña debe tener al menos 8 caracteres.",
                    value: 8,
                  },
                  pattern: {
                    message:
                      "Usá al menos una minúscula, una mayúscula, un número y un símbolo.",
                    value:
                      /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).+$/,
                  },
                  required: "Ingresá la nueva contraseña.",
                })}
              />
              <button
                aria-label={
                  showNewPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                }
                className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-foreground-muted transition hover:text-foreground"
                disabled={isSavingPassword}
                onClick={() =>
                  setShowNewPassword((currentValue) => !currentValue)
                }
                type="button"
              >
                {showNewPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
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
              Confirmar nueva contraseña
            </label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-muted" />
              <Input
                className="pl-9"
                disabled={isSavingPassword}
                type={showConfirmNewPassword ? "text" : "password"}
                {...passwordForm.register("confirmNewPassword", {
                  required: "Confirmá la nueva contraseña.",
                  validate: (value) =>
                    value === newPasswordValue ||
                    "Las contraseñas no coinciden.",
                })}
              />
              <button
                aria-label={
                  showConfirmNewPassword
                    ? "Ocultar contraseña"
                    : "Mostrar contraseña"
                }
                className="absolute top-1/2 right-2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-foreground-muted transition hover:text-foreground"
                disabled={isSavingPassword}
                onClick={() =>
                  setShowConfirmNewPassword((currentValue) => !currentValue)
                }
                type="button"
              >
                {showConfirmNewPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            <p
              className={
                passwordForm.formState.errors.confirmNewPassword?.message
                  ? "text-xs text-red-500"
                  : passwordsMatch
                    ? "text-xs text-emerald-600"
                    : "text-xs text-foreground-muted"
              }
            >
              {passwordForm.formState.errors.confirmNewPassword?.message
                ? String(
                    passwordForm.formState.errors.confirmNewPassword.message,
                  )
                : passwordsMatch
                  ? "✓ Las contraseñas coinciden"
                  : "○ Las contraseñas deben coincidir"}
            </p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              disabled={isSavingPassword}
              onClick={() => passwordForm.reset()}
              type="button"
              variant="outline"
            >
              Cancelar
            </Button>
            <Button
              disabled={isSavingPassword}
              type="submit"
              variant="destructive"
            >
              {isSavingPassword ? "Guardando..." : "Cambiar contraseña"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
