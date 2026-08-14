import { Users, X } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  CreateSocioRequest,
  Socio,
  SocioTipoPersona,
  UpdateSocioRequest,
} from "../types";
import { useCuitAvailabilityQuery } from "../hooks/use-cuit-availability-query";
import { useDocumentoAvailabilityQuery } from "../hooks/use-documento-availability-query";
import { Button } from "@/shared/components/ui/button";
import { DateInput } from "@/shared/components/ui/date-input";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { StaticInternationalPhoneField } from "@/shared/components/ui/international-phone-field";
import { ApiError } from "@/shared/services/http/api-error";
import { getBirthDateBounds } from "@/shared/utils/birth-date-bounds";
import { cn } from "@/shared/utils/cn";
import {
  toDisplaySocioPhone,
  toStoredSocioPhone,
} from "@/shared/utils/socio-phone-format";
import {
  ModalField,
  StyledSelect,
} from "@/modules/solicitudes-editor/components/fields/base";
import {
  SEXO_OPTIONS,
  TIPO_DOCUMENTO_OPTIONS,
} from "@/modules/solicitudes-editor/constants/legacy-options";

type DuplicateFieldError = {
  field: "cuit" | "nroDocumento";
  message: string;
};

const tipoPersonaOptions = [
  { label: "Persona física", value: "FISICA" },
  { label: "Persona jurídica", value: "JURIDICA" },
];

function toTrimmedValue(value: string) {
  const nextValue = value.trim();
  return nextValue.length > 0 ? nextValue : undefined;
}

function isValidEmail(value: string) {
  if (value.length === 0) {
    return true;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidDni(value: string) {
  return /^\d{7,8}$/.test(value);
}

function isValidCuit(value: string) {
  const digits = value.replace(/-/g, "");

  if (!/^\d{11}$/.test(digits)) {
    return false;
  }

  const multipliers = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = multipliers.reduce(
    (acc, mult, i) => acc + Number(digits[i]) * mult,
    0,
  );
  const remainder = sum % 11;
  let checkDigit = 11 - remainder;

  if (checkDigit === 11) checkDigit = 0;
  if (checkDigit === 10) return false;

  return checkDigit === Number(digits[10]);
}

function isValidCivilDate(value: string) {
  const normalized = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, month, day);

  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month &&
    parsed.getDate() === day
  );
}

type SocioFormDialogProps = {
  initialValues?: Partial<SocioFormState>;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CreateSocioRequest | UpdateSocioRequest) => Promise<void>;
  open: boolean;
  socio: Socio | null;
};

export type SocioFormState = {
  apellido: string;
  celular: string;
  cuit: string;
  domicilioCalle: string;
  domicilioCodigoPostal: string;
  domicilioLocalidad: string;
  domicilioNroPuerta: string;
  email: string;
  fechaDeNacimiento: string;
  nombre: string;
  nroDocumento: string;
  razonSocial: string;
  sexo: string;
  tipoDocumento: string;
  tipoPersona: SocioTipoPersona;
};

function buildInitialState(
  socio: Socio | null,
  initialValues?: Partial<SocioFormState>,
): SocioFormState {
  const baseState: SocioFormState = {
    apellido: socio?.tipoPersona === "FISICA" ? socio.apellido : "",
    celular: toDisplaySocioPhone(socio?.celular),
    cuit: socio?.cuit ?? "",
    domicilioCalle: socio?.domicilioCalle ?? "",
    domicilioCodigoPostal: socio?.domicilioCodigoPostal ?? "",
    domicilioLocalidad: socio?.domicilioLocalidad ?? "",
    domicilioNroPuerta: socio?.domicilioNroPuerta ?? "",
    email: socio?.email ?? "",
    fechaDeNacimiento:
      socio?.tipoPersona === "FISICA" ? socio.fechaDeNacimiento : "",
    nombre: socio?.tipoPersona === "FISICA" ? socio.nombre : "",
    nroDocumento: socio?.tipoPersona === "FISICA" ? socio.nroDocumento : "",
    razonSocial: socio?.tipoPersona === "JURIDICA" ? socio.razonSocial : "",
    sexo: socio?.tipoPersona === "FISICA" ? socio.sexo : "",
    tipoDocumento:
      socio?.tipoPersona === "FISICA" ? socio.tipoDocumento : "DNI",
    tipoPersona: socio?.tipoPersona ?? "FISICA",
  };

  if (socio) {
    return baseState;
  }

  return { ...baseState, ...initialValues };
}

function buildCreatePayload(state: SocioFormState): CreateSocioRequest | null {
  const cuit = state.cuit.trim();
  const email = toTrimmedValue(state.email);
  const celular = toTrimmedValue(state.celular)
    ? toStoredSocioPhone(state.celular)
    : undefined;
  const domicilioCalle = state.domicilioCalle.trim();
  const domicilioNroPuerta = state.domicilioNroPuerta.trim();
  const domicilioLocalidad = state.domicilioLocalidad.trim();
  const domicilioCodigoPostal = state.domicilioCodigoPostal.trim();

  if (
    cuit.length === 0 ||
    !isValidCuit(cuit) ||
    !isValidEmail(state.email.trim()) ||
    domicilioCalle.length === 0 ||
    domicilioNroPuerta.length === 0 ||
    domicilioLocalidad.length === 0 ||
    domicilioCodigoPostal.length === 0
  ) {
    return null;
  }

  if (state.tipoPersona === "FISICA") {
    const apellido = state.apellido.trim();
    const nombre = state.nombre.trim();
    const nroDocumento = state.nroDocumento.trim();
    const tipoDocumento = state.tipoDocumento.trim();
    const sexo = state.sexo.trim();
    const fechaDeNacimiento = state.fechaDeNacimiento.trim();

    if (
      apellido.length === 0 ||
      nombre.length === 0 ||
      nroDocumento.length === 0 ||
      !isValidDni(nroDocumento) ||
      tipoDocumento.length === 0 ||
      sexo.length === 0 ||
      !isValidCivilDate(fechaDeNacimiento)
    ) {
      return null;
    }

    return {
      ...(celular ? { celular } : {}),
      ...(email ? { email } : {}),
      apellido,
      cuit,
      domicilioCalle,
      domicilioCodigoPostal,
      domicilioLocalidad,
      domicilioNroPuerta,
      fechaDeNacimiento,
      nombre,
      nroDocumento,
      sexo,
      tipoDocumento,
      tipoPersona: "FISICA",
    };
  }

  const razonSocial = state.razonSocial.trim();

  if (razonSocial.length === 0) {
    return null;
  }

  return {
    ...(celular ? { celular } : {}),
    ...(email ? { email } : {}),
    cuit,
    domicilioCalle,
    domicilioCodigoPostal,
    domicilioLocalidad,
    domicilioNroPuerta,
    razonSocial,
    tipoPersona: "JURIDICA",
  };
}

function buildUpdatePayload(
  state: SocioFormState,
  socio: Socio,
): UpdateSocioRequest | null {
  const payload: UpdateSocioRequest = {};
  const cuit = state.cuit.trim();
  const email = toTrimmedValue(state.email);
  const celular = toTrimmedValue(state.celular)
    ? toStoredSocioPhone(state.celular)
    : undefined;

  if (state.email.trim().length > 0 && !isValidEmail(state.email.trim())) {
    return null;
  }

  if (cuit.length > 0 && !isValidCuit(cuit)) {
    return null;
  }

  if (cuit.length > 0 && cuit !== socio.cuit) {
    payload.cuit = cuit;
  }

  if (email && email !== (socio.email ?? "")) {
    payload.email = email;
  }

  if (celular && celular !== (socio.celular ?? "")) {
    payload.celular = celular;
  }

  const domicilioCalle = state.domicilioCalle.trim();
  const domicilioNroPuerta = state.domicilioNroPuerta.trim();
  const domicilioLocalidad = state.domicilioLocalidad.trim();
  const domicilioCodigoPostal = state.domicilioCodigoPostal.trim();

  if (domicilioCalle !== (socio.domicilioCalle ?? "")) {
    payload.domicilioCalle = domicilioCalle;
  }

  if (domicilioNroPuerta !== (socio.domicilioNroPuerta ?? "")) {
    payload.domicilioNroPuerta = domicilioNroPuerta;
  }

  if (domicilioLocalidad !== (socio.domicilioLocalidad ?? "")) {
    payload.domicilioLocalidad = domicilioLocalidad;
  }

  if (domicilioCodigoPostal !== (socio.domicilioCodigoPostal ?? "")) {
    payload.domicilioCodigoPostal = domicilioCodigoPostal;
  }

  if (socio.tipoPersona === "FISICA") {
    const apellido = state.apellido.trim();
    const nombre = state.nombre.trim();
    const nroDocumento = state.nroDocumento.trim();
    const tipoDocumento = state.tipoDocumento.trim();
    const sexo = state.sexo.trim();
    const fechaDeNacimiento = state.fechaDeNacimiento.trim();

    if (
      apellido.length === 0 ||
      nombre.length === 0 ||
      nroDocumento.length === 0 ||
      !isValidDni(nroDocumento) ||
      tipoDocumento.length === 0 ||
      sexo.length === 0 ||
      !isValidCivilDate(fechaDeNacimiento)
    ) {
      return null;
    }

    if (apellido !== socio.apellido) {
      payload.apellido = apellido;
    }

    if (nombre !== socio.nombre) {
      payload.nombre = nombre;
    }

    if (nroDocumento !== socio.nroDocumento) {
      payload.nroDocumento = nroDocumento;
    }

    if (tipoDocumento !== socio.tipoDocumento) {
      payload.tipoDocumento = tipoDocumento;
    }

    if (sexo !== socio.sexo) {
      payload.sexo = sexo;
    }

    if (fechaDeNacimiento !== socio.fechaDeNacimiento) {
      payload.fechaDeNacimiento = fechaDeNacimiento;
    }
  } else {
    const razonSocial = state.razonSocial.trim();

    if (razonSocial.length === 0) {
      return null;
    }

    if (razonSocial !== socio.razonSocial) {
      payload.razonSocial = razonSocial;
    }
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

export function SocioFormDialog({
  initialValues,
  isSaving,
  onOpenChange,
  onSubmit,
  open,
  socio,
}: SocioFormDialogProps) {
  return (
    <DialogRoot
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onOpenChange(false);
        }
      }}
      open={open}
    >
      {open ? (
        <SocioFormDialogContent
          initialValues={initialValues}
          isSaving={isSaving}
          key={socio?.id ?? "create"}
          onSubmit={onSubmit}
          socio={socio}
        />
      ) : null}
    </DialogRoot>
  );
}

function SocioFormDialogContent({
  initialValues,
  isSaving,
  onSubmit,
  socio,
}: Pick<
  SocioFormDialogProps,
  "initialValues" | "isSaving" | "onSubmit" | "socio"
>) {
  const [formState, setFormState] = useState<SocioFormState>(() =>
    buildInitialState(socio, initialValues),
  );
  // Los campos que llegan prellenados (p.ej. desde el titular de una
  // solicitud) arrancan "touched": si el dato prellenado es inválido o
  // vino vacío (como una fecha de nacimiento que el legado no tiene
  // cargada), el error se ve apenas se abre el modal en vez de quedar
  // oculto hasta que el usuario edite ese campo a mano.
  const [touchedFields, setTouchedFields] = useState<Set<string>>(
    () => new Set(initialValues ? Object.keys(initialValues) : []),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicateFieldError, setDuplicateFieldError] =
    useState<DuplicateFieldError | null>(null);

  function markTouched(field: string) {
    setTouchedFields((prev) => {
      const next = new Set(prev);
      next.add(field);
      return next;
    });
  }

  function clearDuplicateFieldError(field: DuplicateFieldError["field"]) {
    setDuplicateFieldError((current) =>
      current?.field === field ? null : current,
    );
  }

  const isEditing = socio !== null;
  const currentTipoPersona = isEditing
    ? socio.tipoPersona
    : formState.tipoPersona;
  const createPayload = !isEditing ? buildCreatePayload(formState) : null;
  const updatePayload = isEditing ? buildUpdatePayload(formState, socio) : null;
  const payload = isEditing ? updatePayload : createPayload;

  const trimmedEmail = formState.email.trim();
  const trimmedCuit = formState.cuit.trim();
  const trimmedRazonSocial = formState.razonSocial.trim();
  const isPhysical = currentTipoPersona === "FISICA";

  const touched = (field: string) => touchedFields.has(field);

  const cuitFormatError = touched("cuit")
    ? trimmedCuit.length === 0
      ? "El CUIT/CUIL es obligatorio."
      : !isValidCuit(trimmedCuit)
        ? "El CUIT/CUIL ingresado no es válido."
        : null
    : null;
  const cuitChangedFromOriginal = isEditing ? trimmedCuit !== socio.cuit : true;
  const cuitAvailabilityQuery = useCuitAvailabilityQuery({
    cuit: trimmedCuit,
    enabled:
      touched("cuit") && cuitFormatError === null && cuitChangedFromOriginal,
    excludeSocioId: isEditing ? socio.id : undefined,
  });
  const cuitIsDuplicate = cuitAvailabilityQuery.data?.exists === true;
  const cuitIsChecking =
    cuitAvailabilityQuery.isFetching && cuitFormatError === null;
  const cuitError =
    cuitFormatError ??
    (cuitIsDuplicate ? "Ya existe un socio con ese CUIT." : null) ??
    (duplicateFieldError?.field === "cuit"
      ? duplicateFieldError.message
      : null);

  const trimmedNroDocumento = formState.nroDocumento.trim();
  const nroDocumentoFormatError = touched("nroDocumento")
    ? trimmedNroDocumento.length === 0
      ? "El número de documento es obligatorio."
      : !isValidDni(trimmedNroDocumento)
        ? "El DNI debe tener 7 u 8 dígitos numéricos."
        : null
    : null;
  const originalNroDocumento =
    isEditing && socio.tipoPersona === "FISICA"
      ? socio.nroDocumento
      : undefined;
  const nroDocumentoChangedFromOriginal = isEditing
    ? trimmedNroDocumento !== (originalNroDocumento ?? "")
    : true;
  const documentoAvailabilityQuery = useDocumentoAvailabilityQuery({
    enabled:
      isPhysical &&
      touched("nroDocumento") &&
      nroDocumentoFormatError === null &&
      nroDocumentoChangedFromOriginal,
    excludeSocioId: isEditing ? socio.id : undefined,
    nroDocumento: trimmedNroDocumento,
  });
  const documentoIsDuplicate = documentoAvailabilityQuery.data?.exists === true;
  const documentoIsChecking =
    documentoAvailabilityQuery.isFetching && nroDocumentoFormatError === null;

  const canSubmit =
    payload !== null &&
    !isSaving &&
    !cuitIsDuplicate &&
    !(isPhysical && documentoIsDuplicate);
  const emailError =
    touched("email") && trimmedEmail.length > 0 && !isValidEmail(trimmedEmail)
      ? "El email ingresado no es válido."
      : null;
  const physicalErrors = isPhysical
    ? {
        apellido:
          touched("apellido") && formState.apellido.trim().length === 0
            ? "El apellido es obligatorio."
            : null,
        fechaDeNacimiento:
          touched("fechaDeNacimiento") &&
          !isValidCivilDate(formState.fechaDeNacimiento.trim())
            ? "La fecha de nacimiento es obligatoria y debe ser válida."
            : null,
        nombre:
          touched("nombre") && formState.nombre.trim().length === 0
            ? "El nombre es obligatorio."
            : null,
        nroDocumento:
          nroDocumentoFormatError ??
          (documentoIsDuplicate
            ? "Ya existe un socio con ese documento."
            : null) ??
          (duplicateFieldError?.field === "nroDocumento"
            ? duplicateFieldError.message
            : null),
        sexo:
          touched("sexo") && formState.sexo.trim().length === 0
            ? "El sexo es obligatorio."
            : null,
        tipoDocumento:
          touched("tipoDocumento") &&
          formState.tipoDocumento.trim().length === 0
            ? "El tipo de documento es obligatorio."
            : null,
      }
    : null;
  const juridicalError =
    !isPhysical && touched("razonSocial") && trimmedRazonSocial.length === 0
      ? "La razón social es obligatoria."
      : null;
  const domicilioErrors = {
    domicilioCalle:
      touched("domicilioCalle") && formState.domicilioCalle.trim().length === 0
        ? "La calle es obligatoria."
        : null,
    domicilioCodigoPostal:
      touched("domicilioCodigoPostal") &&
      formState.domicilioCodigoPostal.trim().length === 0
        ? "El código postal es obligatorio."
        : null,
    domicilioLocalidad:
      touched("domicilioLocalidad") &&
      formState.domicilioLocalidad.trim().length === 0
        ? "La localidad es obligatoria."
        : null,
    domicilioNroPuerta:
      touched("domicilioNroPuerta") &&
      formState.domicilioNroPuerta.trim().length === 0
        ? "El número de puerta es obligatorio."
        : null,
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!payload) {
      return;
    }

    setSubmitError(null);
    setDuplicateFieldError(null);

    try {
      await onSubmit(payload);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "SocioCuitDuplicateError"
      ) {
        markTouched("cuit");
        setDuplicateFieldError({ field: "cuit", message: error.message });
        return;
      }

      if (
        error instanceof ApiError &&
        error.code === "SocioDocumentoDuplicateError"
      ) {
        markTouched("nroDocumento");
        setDuplicateFieldError({
          field: "nroDocumento",
          message: error.message,
        });
        return;
      }

      if (error instanceof Error) {
        setSubmitError(error.message);
        return;
      }

      setSubmitError("No se pudo guardar el socio.");
    }
  }

  const title = isEditing ? "Editar socio" : "Nuevo socio";
  const description = isEditing
    ? "Actualiza los datos permitidos del socio. El tipo de persona no se puede cambiar."
    : "Completa los datos del socio. El formulario ajusta los campos según el tipo de persona.";
  const birthDateBounds = useMemo(() => getBirthDateBounds(), []);

  return (
    <DialogContent className="flex max-h-[calc(100vh-3rem)] max-w-[900px] flex-col overflow-hidden p-0">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface">
            <Users className="size-4 text-foreground-secondary" />
          </div>
          <div className="min-w-0">
            <span className="inline-flex rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-foreground-secondary">
              Socios
            </span>
            <DialogTitle className="mt-1 text-base font-semibold text-foreground">
              {title}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-foreground-secondary">
              {description}
            </DialogDescription>
          </div>
        </div>

        <DialogClose asChild>
          <Button
            aria-label="Cerrar"
            disabled={isSaving}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        </DialogClose>
      </header>

      <form
        autoComplete="new-password"
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={handleSubmit}
      >
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">
              Datos generales
            </h3>
            <div className="grid gap-4 md:grid-cols-2">
              <ModalField label="Tipo de persona *">
                <StyledSelect
                  disabled={isSaving || isEditing}
                  onChange={(value) => {
                    if (value === "FISICA" || value === "JURIDICA") {
                      setFormState((currentState) => ({
                        ...currentState,
                        tipoPersona: value,
                      }));
                    }
                  }}
                  options={tipoPersonaOptions}
                  value={currentTipoPersona}
                />
                <span className="block min-h-[1rem]" />
              </ModalField>

              <ModalField label="CUIT *">
                <Input
                  aria-invalid={Boolean(cuitError)}
                  autoComplete="new-password"
                  disabled={isSaving}
                  inputMode="numeric"
                  onBlur={() => markTouched("cuit")}
                  onChange={(event) => {
                    clearDuplicateFieldError("cuit");
                    setFormState((currentState) => ({
                      ...currentState,
                      cuit: event.target.value,
                    }));
                  }}
                  value={formState.cuit}
                />
                <span
                  className={cn(
                    "block min-h-[1rem] text-xs",
                    cuitError ? "text-destructive" : "text-foreground-muted",
                  )}
                >
                  {cuitError ?? (cuitIsChecking ? "Verificando…" : null)}
                </span>
              </ModalField>

              <ModalField label="Email">
                <Input
                  aria-invalid={Boolean(emailError)}
                  autoComplete="new-password"
                  disabled={isSaving}
                  onBlur={() => markTouched("email")}
                  onChange={(event) =>
                    setFormState((currentState) => ({
                      ...currentState,
                      email: event.target.value,
                    }))
                  }
                  type="email"
                  value={formState.email}
                />
                <span className="block min-h-[1rem] text-xs text-destructive">
                  {emailError}
                </span>
              </ModalField>

              <ModalField label="Celular">
                <StaticInternationalPhoneField
                  className="w-full"
                  disabled={isSaving}
                  onChange={(value) =>
                    setFormState((currentState) => ({
                      ...currentState,
                      celular: value,
                    }))
                  }
                  value={formState.celular}
                />
                <span className="block min-h-[1rem]" />
              </ModalField>

              {isEditing ? (
                <ModalField className="md:col-span-2" label="Nro. socio legacy">
                  <Input
                    disabled
                    readOnly
                    value={socio.nroSocioLegacy ?? "-"}
                  />
                </ModalField>
              ) : null}
            </div>
          </div>

          {isPhysical ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                Persona física
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <ModalField label="Apellido *">
                  <Input
                    aria-invalid={Boolean(physicalErrors?.apellido)}
                    autoComplete="new-password"
                    disabled={isSaving}
                    onBlur={() => markTouched("apellido")}
                    onChange={(event) =>
                      setFormState((currentState) => ({
                        ...currentState,
                        apellido: event.target.value,
                      }))
                    }
                    value={formState.apellido}
                  />
                  <span className="block min-h-[1rem] text-xs text-destructive">
                    {physicalErrors?.apellido}
                  </span>
                </ModalField>

                <ModalField label="Nombre *">
                  <Input
                    aria-invalid={Boolean(physicalErrors?.nombre)}
                    autoComplete="new-password"
                    disabled={isSaving}
                    onBlur={() => markTouched("nombre")}
                    onChange={(event) =>
                      setFormState((currentState) => ({
                        ...currentState,
                        nombre: event.target.value,
                      }))
                    }
                    value={formState.nombre}
                  />
                  <span className="block min-h-[1rem] text-xs text-destructive">
                    {physicalErrors?.nombre}
                  </span>
                </ModalField>

                <ModalField label="Número de documento *">
                  <Input
                    aria-invalid={Boolean(physicalErrors?.nroDocumento)}
                    autoComplete="new-password"
                    disabled={isSaving}
                    inputMode="numeric"
                    onBlur={() => markTouched("nroDocumento")}
                    onChange={(event) => {
                      clearDuplicateFieldError("nroDocumento");
                      setFormState((currentState) => ({
                        ...currentState,
                        nroDocumento: event.target.value,
                      }));
                    }}
                    value={formState.nroDocumento}
                  />
                  <span
                    className={cn(
                      "block min-h-[1rem] text-xs",
                      physicalErrors?.nroDocumento
                        ? "text-destructive"
                        : "text-foreground-muted",
                    )}
                  >
                    {physicalErrors?.nroDocumento ??
                      (documentoIsChecking ? "Verificando…" : null)}
                  </span>
                </ModalField>

                <ModalField label="Tipo de documento *">
                  <StyledSelect
                    disabled={isSaving}
                    invalid={Boolean(physicalErrors?.tipoDocumento)}
                    onChange={(value) => {
                      markTouched("tipoDocumento");
                      setFormState((currentState) => ({
                        ...currentState,
                        tipoDocumento: value,
                      }));
                    }}
                    options={TIPO_DOCUMENTO_OPTIONS}
                    placeholder="Seleccione tipo documento"
                    value={formState.tipoDocumento}
                  />
                  <span className="block min-h-[1rem] text-xs text-destructive">
                    {physicalErrors?.tipoDocumento}
                  </span>
                </ModalField>

                <ModalField label="Sexo *">
                  <StyledSelect
                    disabled={isSaving}
                    invalid={Boolean(physicalErrors?.sexo)}
                    onChange={(value) => {
                      markTouched("sexo");
                      setFormState((currentState) => ({
                        ...currentState,
                        sexo: value,
                      }));
                    }}
                    options={SEXO_OPTIONS}
                    placeholder="Seleccione sexo"
                    value={formState.sexo}
                  />
                  <span className="block min-h-[1rem] text-xs text-destructive">
                    {physicalErrors?.sexo}
                  </span>
                </ModalField>

                <ModalField label="Fecha de nacimiento *">
                  <DateInput
                    aria-invalid={Boolean(physicalErrors?.fechaDeNacimiento)}
                    disabled={isSaving}
                    max={birthDateBounds.max}
                    min={birthDateBounds.min}
                    onChange={(value) => {
                      markTouched("fechaDeNacimiento");
                      setFormState((currentState) => ({
                        ...currentState,
                        fechaDeNacimiento: value,
                      }));
                    }}
                    value={formState.fechaDeNacimiento}
                  />
                  <span className="block min-h-[1rem] text-xs text-destructive">
                    {physicalErrors?.fechaDeNacimiento}
                  </span>
                </ModalField>
              </div>
            </div>
          ) : null}

          {!isPhysical ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">
                Persona jurídica
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <ModalField className="md:col-span-2" label="Razón social *">
                  <Input
                    aria-invalid={Boolean(juridicalError)}
                    autoComplete="new-password"
                    disabled={isSaving}
                    onBlur={() => markTouched("razonSocial")}
                    onChange={(event) =>
                      setFormState((currentState) => ({
                        ...currentState,
                        razonSocial: event.target.value,
                      }))
                    }
                    value={formState.razonSocial}
                  />
                  <span className="block min-h-[1rem] text-xs text-destructive">
                    {juridicalError}
                  </span>
                </ModalField>
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Domicilio</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <ModalField label="Calle *">
                <Input
                  aria-invalid={Boolean(domicilioErrors.domicilioCalle)}
                  autoComplete="new-password"
                  disabled={isSaving}
                  onBlur={() => markTouched("domicilioCalle")}
                  onChange={(event) =>
                    setFormState((currentState) => ({
                      ...currentState,
                      domicilioCalle: event.target.value,
                    }))
                  }
                  value={formState.domicilioCalle}
                />
                <span className="block min-h-[1rem] text-xs text-destructive">
                  {domicilioErrors.domicilioCalle}
                </span>
              </ModalField>

              <ModalField label="Nro. puerta *">
                <Input
                  aria-invalid={Boolean(domicilioErrors.domicilioNroPuerta)}
                  autoComplete="new-password"
                  disabled={isSaving}
                  onBlur={() => markTouched("domicilioNroPuerta")}
                  onChange={(event) =>
                    setFormState((currentState) => ({
                      ...currentState,
                      domicilioNroPuerta: event.target.value,
                    }))
                  }
                  value={formState.domicilioNroPuerta}
                />
                <span className="block min-h-[1rem] text-xs text-destructive">
                  {domicilioErrors.domicilioNroPuerta}
                </span>
              </ModalField>

              <ModalField label="Localidad (ID legado) *">
                <Input
                  aria-invalid={Boolean(domicilioErrors.domicilioLocalidad)}
                  autoComplete="new-password"
                  disabled={isSaving}
                  inputMode="numeric"
                  onBlur={() => markTouched("domicilioLocalidad")}
                  onChange={(event) =>
                    setFormState((currentState) => ({
                      ...currentState,
                      domicilioLocalidad: event.target.value,
                    }))
                  }
                  value={formState.domicilioLocalidad}
                />
                <span className="block min-h-[1rem] text-xs text-destructive">
                  {domicilioErrors.domicilioLocalidad}
                </span>
              </ModalField>

              <ModalField label="Código postal *">
                <Input
                  aria-invalid={Boolean(domicilioErrors.domicilioCodigoPostal)}
                  autoComplete="new-password"
                  disabled={isSaving}
                  onBlur={() => markTouched("domicilioCodigoPostal")}
                  onChange={(event) =>
                    setFormState((currentState) => ({
                      ...currentState,
                      domicilioCodigoPostal: event.target.value,
                    }))
                  }
                  value={formState.domicilioCodigoPostal}
                />
                <span className="block min-h-[1rem] text-xs text-destructive">
                  {domicilioErrors.domicilioCodigoPostal}
                </span>
              </ModalField>
            </div>
          </div>

          {submitError ? (
            <p className="text-sm text-destructive">{submitError}</p>
          ) : null}
        </div>

        <footer className="border-t border-border px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <DialogClose asChild>
              <Button disabled={isSaving} type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button disabled={!canSubmit} type="submit">
              {isSaving ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </footer>
      </form>
    </DialogContent>
  );
}
