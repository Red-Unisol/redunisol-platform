import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";

import {
  ModalField,
  StyledSelect,
} from "@/modules/solicitudes-editor/components/fields/base";
import type { StyledSelectOption } from "@/modules/solicitudes-editor/types";
import type {
  UpdateAdminUserRequest,
  UsersAdminUser,
} from "@/modules/users-admin/services/users-admin-api";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";

export type AdminUserEditSubmission = {
  areaChanged: boolean;
  nextWorkflowOwnerId: string | null;
  userPayload: UpdateAdminUserRequest;
};

type AdminUserEditDialogProps = {
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (submission: AdminUserEditSubmission) => Promise<void>;
  open: boolean;
  user: UsersAdminUser | null;
  workflowOwnerOptions: StyledSelectOption[];
};

function isValidEmail(email: string) {
  if (email.length === 0) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function AdminUserEditDialog({
  isSubmitting,
  onOpenChange,
  onSubmit,
  open,
  user,
  workflowOwnerOptions,
}: AdminUserEditDialogProps) {
  return (
    <DialogRoot onOpenChange={onOpenChange} open={open}>
      {user ? (
        <AdminUserEditForm
          isSubmitting={isSubmitting}
          key={user.id}
          onOpenChange={onOpenChange}
          onSubmit={onSubmit}
          user={user}
          workflowOwnerOptions={workflowOwnerOptions}
        />
      ) : null}
    </DialogRoot>
  );
}

function AdminUserEditForm({
  isSubmitting,
  onOpenChange,
  onSubmit,
  user,
  workflowOwnerOptions,
}: {
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (submission: AdminUserEditSubmission) => Promise<void>;
  user: UsersAdminUser;
  workflowOwnerOptions: StyledSelectOption[];
}) {
  const stateOptions = useMemo<StyledSelectOption[]>(
    () => [
      { label: "Activo", value: "1" },
      { label: "Inactivo", value: "0" },
    ],
    [],
  );
  const [email, setEmail] = useState(user.email);
  const [firstName, setFirstName] = useState(user.firstName ?? "");
  const [lastName, setLastName] = useState(user.lastName ?? "");
  const [legacyUser, setLegacyUser] = useState(user.legacyUser ?? "");
  const [isSystemAdmin, setIsSystemAdmin] = useState(user.isSystemAdmin);
  const [state, setState] = useState<0 | 1>(user.state === 0 ? 0 : 1);
  const [stateTouched, setStateTouched] = useState(false);
  const [workflowOwnerId, setWorkflowOwnerId] = useState(
    user.workflowOwnerId ?? "",
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  const emailTrimmed = email.trim();
  const firstNameTrimmed = firstName.trim();
  const lastNameTrimmed = lastName.trim();
  const legacyUserTrimmed = legacyUser.trim();

  const emailChanged = emailTrimmed !== user.email;
  const firstNameChanged = firstNameTrimmed !== (user.firstName ?? "");
  const lastNameChanged = lastNameTrimmed !== (user.lastName ?? "");
  const legacyUserChanged = legacyUserTrimmed !== user.legacyUser;
  const adminChanged = isSystemAdmin !== user.isSystemAdmin;

  const canCompareStateDirectly = user.state !== 2;
  const stateChanged = canCompareStateDirectly
    ? state !== user.state
    : stateTouched;

  const areaEditAllowed = user.state !== 0;
  const areaChanged =
    areaEditAllowed && workflowOwnerId !== (user.workflowOwnerId ?? "");

  const hasChanges =
    emailChanged ||
    firstNameChanged ||
    lastNameChanged ||
    legacyUserChanged ||
    adminChanged ||
    stateChanged ||
    areaChanged;

  const emailIsValid = isValidEmail(emailTrimmed);
  const firstNameIsValid = !firstNameChanged || firstNameTrimmed.length > 0;
  const lastNameIsValid = !lastNameChanged || lastNameTrimmed.length > 0;
  const legacyUserIsValid = !legacyUserChanged || legacyUserTrimmed.length > 0;

  const canSubmit =
    hasChanges &&
    emailIsValid &&
    firstNameIsValid &&
    lastNameIsValid &&
    legacyUserIsValid &&
    !isSubmitting;

  const currentStateLabel = useMemo(() => {
    if (user.state === 0) {
      return "Inactivo";
    }

    if (user.state === 1) {
      return "Activo";
    }

    return "Pendiente de área";
  }, [user.state]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    const userPayload: UpdateAdminUserRequest = {};

    if (emailChanged) {
      userPayload.email = emailTrimmed;
    }

    if (firstNameChanged) {
      userPayload.firstName = firstNameTrimmed;
    }

    if (lastNameChanged) {
      userPayload.lastName = lastNameTrimmed;
    }

    if (legacyUserChanged) {
      userPayload.legacyUser = legacyUserTrimmed;
    }

    if (adminChanged) {
      userPayload.isSystemAdmin = isSystemAdmin;
    }

    if (stateChanged) {
      userPayload.state = state;
    }

    setSubmitError(null);

    try {
      await onSubmit({
        areaChanged,
        nextWorkflowOwnerId:
          workflowOwnerId.length > 0 ? workflowOwnerId : null,
        userPayload,
      });
    } catch (error) {
      if (error instanceof Error) {
        setSubmitError(error.message);
        return;
      }

      setSubmitError("No se pudo actualizar el usuario.");
    }
  }

  return (
    <DialogContent className="flex max-h-[calc(100vh-3rem)] max-w-[760px] flex-col overflow-hidden p-0">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface">
            <ShieldCheck className="size-4 text-foreground-secondary" />
          </div>
          <div className="min-w-0">
            <span className="inline-flex rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-foreground-secondary">
              Administración
            </span>
            <DialogTitle className="mt-1 text-base font-semibold text-foreground">
              Editar usuario
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-foreground-secondary">
              Actualiza datos personales, credenciales de acceso y estado
              operativo.
            </DialogDescription>
          </div>
        </div>
      </div>

      <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ModalField label="Email">
              <Input
                autoComplete="off"
                disabled={isSubmitting}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                value={email}
              />
              {!emailIsValid ? (
                <span className="text-xs text-destructive">
                  Ingresa un email válido.
                </span>
              ) : null}
            </ModalField>

            <ModalField label="Usuario legacy">
              <Input
                autoComplete="off"
                disabled={isSubmitting}
                onChange={(event) => setLegacyUser(event.target.value)}
                value={legacyUser}
              />
              {!legacyUserIsValid ? (
                <span className="text-xs text-destructive">
                  El usuario legacy no puede quedar vacío.
                </span>
              ) : null}
            </ModalField>

            <ModalField label="Nombre">
              <Input
                autoComplete="off"
                disabled={isSubmitting}
                onChange={(event) => setFirstName(event.target.value)}
                value={firstName}
              />
              {!firstNameIsValid ? (
                <span className="text-xs text-destructive">
                  El nombre no puede quedar vacío.
                </span>
              ) : null}
            </ModalField>

            <ModalField label="Apellido">
              <Input
                autoComplete="off"
                disabled={isSubmitting}
                onChange={(event) => setLastName(event.target.value)}
                value={lastName}
              />
              {!lastNameIsValid ? (
                <span className="text-xs text-destructive">
                  El apellido no puede quedar vacío.
                </span>
              ) : null}
            </ModalField>

            <ModalField label="Estado actual (contexto)">
              <Input disabled readOnly value={currentStateLabel} />
            </ModalField>

            <ModalField label="Nuevo estado">
              <StyledSelect
                disabled={isSubmitting}
                onChange={(nextValue) => {
                  if (nextValue !== "0" && nextValue !== "1") {
                    return;
                  }

                  setState(nextValue === "0" ? 0 : 1);
                  setStateTouched(true);
                }}
                options={stateOptions}
                value={String(state)}
              />
              {user.state === 2 ? (
                <span className="text-xs text-foreground-secondary">
                  El usuario está en estado pendiente de área; desde aquí solo
                  se permite guardar Activo o Inactivo.
                </span>
              ) : null}
            </ModalField>

            <ModalField label="Área">
              <StyledSelect
                disabled={isSubmitting || !areaEditAllowed}
                emptyOptionLabel="Sin área"
                onChange={setWorkflowOwnerId}
                options={workflowOwnerOptions}
                placeholder="Sin área"
                value={workflowOwnerId}
              />
              {!areaEditAllowed ? (
                <span className="text-xs text-foreground-secondary">
                  Los usuarios inactivos no pueden cambiar su área desde este
                  formulario.
                </span>
              ) : null}
            </ModalField>

            <ModalField label="Admin de sistema">
              <label className="flex h-10 items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={isSystemAdmin}
                  disabled={isSubmitting}
                  onCheckedChange={(checked) =>
                    setIsSystemAdmin(checked === true)
                  }
                />
                Admin de sistema
              </label>
            </ModalField>
          </div>

          {submitError ? (
            <p className="text-sm text-destructive">{submitError}</p>
          ) : null}
        </div>

        <div className="border-t border-border px-4 py-3">
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
                type="button"
                variant="outline"
              >
                Cancelar
              </Button>
            </DialogClose>
            <Button disabled={!canSubmit} type="submit">
              {isSubmitting ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </div>
      </form>
    </DialogContent>
  );
}
