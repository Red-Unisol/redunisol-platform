import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Controller, useWatch } from "react-hook-form";

import { LocalidadSelect } from "@/modules/socios/components/localidad-select";
import { DateInputField } from "@/shared/components/forms/date-input-field";
import { MoneyInputField } from "@/shared/components/forms/money-input-field";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { InternationalPhoneField } from "@/shared/components/ui/international-phone-field";
import { getBirthDateBounds } from "@/shared/utils/birth-date-bounds";
import { cn } from "@/shared/utils/cn";

import {
  ESTADO_CIVIL_OPTIONS,
  SEXO_OPTIONS,
  TIPO_DOCUMENTO_OPTIONS,
} from "../constants/legacy-options";
import type { SolicitudFormControl, SolicitudFormRegister } from "../types";
import { calculateAge } from "../utils/calculate-age";
import { StyledSelect, legacyFieldClassName } from "./fields/base";
import { mensajeDeError } from "../utils/mensaje-de-error";
import { StackedField } from "./fields/form-card";

const birthDateBounds = getBirthDateBounds();

type TitularFieldsProps = {
  control: SolicitudFormControl;
  errors?: Partial<Record<string, { message?: string }>>;
  register: SolicitudFormRegister;
};

// Quien es: documento primero (al salir se buscan sus datos si ya es socio).
export function IdentificacionTitularFields({
  aviso,
  control,
  errors,
  onLookupByDocumento,
  register,
}: TitularFieldsProps & {
  aviso?: { texto: string; tipo: "info" | "ok" } | null;
  onLookupByDocumento?: () => void;
}) {
  const errorDe = mensajeDeError(errors);

  return (
    <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,0.9fr)]">
      <StackedField error={errorDe("nombre")} label="Nombre" required>
        <input
          aria-invalid={!!errors?.nombre}
          autoComplete="given-name"
          className={legacyFieldClassName}
          {...register("nombre")}
        />
      </StackedField>
      <StackedField
        error={errorDe("apellidoDenominacion")}
        label="Apellido"
        required
      >
        <input
          aria-invalid={!!errors?.apellidoDenominacion}
          autoComplete="family-name"
          className={legacyFieldClassName}
          {...register("apellidoDenominacion")}
        />
      </StackedField>
      <StackedField
        error={errorDe("noDocumento") ?? errorDe("documento")}
        hint={
          aviso ? (
            <span
              aria-live="polite"
              className={
                aviso.tipo === "ok" ? "text-verde" : "text-foreground-secondary"
              }
            >
              {aviso.texto}
            </span>
          ) : undefined
        }
        label="Documento"
        required
      >
        {/* Tipo y numero en una sola caja: el tipo va como prefijo. */}
        <div
          className={cn(
            "flex h-9 min-w-0 items-stretch rounded-md border border-input-border bg-input-background shadow-xs transition focus-within:border-input-focus focus-within:ring-2 focus-within:ring-input-focus/20",
            (errors?.documento || errors?.noDocumento) &&
              "border-destructive ring-2 ring-destructive/20",
          )}
        >
          <div className="w-[4.75rem] shrink-0 border-r border-input-border">
            <Controller
              control={control}
              name="documento"
              render={({ field }) => (
                <StyledSelect
                  className="!h-full !rounded-r-none !border-0 !bg-transparent !px-2.5 !shadow-none !ring-0"
                  onChange={field.onChange}
                  options={TIPO_DOCUMENTO_OPTIONS}
                  placeholder="Tipo"
                  value={field.value}
                />
              )}
            />
          </div>
          <input
            aria-invalid={!!errors?.noDocumento}
            aria-label="Número de documento"
            className="min-w-0 flex-1 rounded-r-md bg-transparent px-3 text-sm font-medium text-foreground tabular-nums outline-none placeholder:text-foreground-muted"
            inputMode="numeric"
            placeholder="Número"
            {...register("noDocumento", {
              onBlur: () => {
                onLookupByDocumento?.();
              },
            })}
          />
        </div>
      </StackedField>
      <StackedField error={errorDe("cuit")} label="CUIT" required>
        <input
          aria-invalid={!!errors?.cuit}
          className={cn(legacyFieldClassName, "tabular-nums")}
          inputMode="numeric"
          {...register("cuit")}
        />
      </StackedField>
    </div>
  );
}

function Grupo({
  aside,
  children,
  title,
}: {
  aside?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="border-t border-border-soft py-2.5 last:pb-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-foreground-secondary">
          {title}
        </h3>
        {aside}
      </div>
      <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-12">
        {children}
      </div>
    </div>
  );
}

// El resto de los datos, agrupados y con anchos segun lo que llevan.
export function DatosTitularFields({
  control,
  errors,
  register,
}: TitularFieldsProps) {
  const fechaNacimiento = useWatch({ control, name: "fechaNacimiento" });
  const edad = calculateAge(fechaNacimiento ?? "");
  const errorDe = mensajeDeError(errors);
  const observaciones = useWatch({ control, name: "observacionesSolicitud" });
  const [mostrarObservaciones, setMostrarObservaciones] = useState(false);
  const observacionesVisibles =
    mostrarObservaciones || Boolean(observaciones?.trim());

  return (
    <div>
      <Grupo title="Personales">
        <StackedField
          className="sm:col-span-3"
          error={errorDe("fechaNacimiento")}
          label={edad ? `Nacimiento (${edad} años)` : "Nacimiento"}
          required
        >
          <DateInputField
            className="h-9"
            control={control}
            invalid={!!errors?.fechaNacimiento}
            max={birthDateBounds.max}
            min={birthDateBounds.min}
            name="fechaNacimiento"
          />
        </StackedField>
        <StackedField className="sm:col-span-3" label="Sexo">
          <Controller
            control={control}
            name="sexo"
            render={({ field }) => (
              <StyledSelect
                onChange={field.onChange}
                options={SEXO_OPTIONS}
                placeholder="Seleccione"
                value={field.value}
              />
            )}
          />
        </StackedField>
        <StackedField className="sm:col-span-3" label="Estado civil">
          <Controller
            control={control}
            name="estadoCivil"
            render={({ field }) => (
              <StyledSelect
                emptyOptionLabel="---"
                onChange={field.onChange}
                options={ESTADO_CIVIL_OPTIONS}
                placeholder="Seleccione"
                value={field.value}
              />
            )}
          />
        </StackedField>
        <StackedField className="sm:col-span-3" label="Nacionalidad">
          <input
            className={legacyFieldClassName}
            {...register("nacionalidad")}
          />
        </StackedField>
        <Controller
          control={control}
          name="personaExpuestaPoliticamente"
          render={({ field }) => (
            <label className="flex items-center gap-2 justify-self-start text-sm text-foreground sm:col-span-12">
              <Checkbox
                checked={field.value}
                className="size-4 rounded-md [&_svg]:size-3.5"
                name={field.name}
                onBlur={field.onBlur}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
              Persona expuesta políticamente
            </label>
          )}
        />
      </Grupo>

      <Grupo title="Contacto">
        <StackedField className="sm:col-span-4" label="Celular">
          <InternationalPhoneField
            control={control}
            inputAutoComplete="tel-national"
            placeholder="Código de área y número"
            name="celular"
          />
        </StackedField>
        <StackedField className="sm:col-span-4" label="Teléfono fijo">
          <InternationalPhoneField
            control={control}
            inputAutoComplete="tel-local"
            placeholder="Código de área y número"
            name="telefonoFijo"
          />
        </StackedField>
        <StackedField className="sm:col-span-4" label="Email">
          <input
            autoComplete="email"
            className={legacyFieldClassName}
            inputMode="email"
            {...register("email")}
          />
        </StackedField>
      </Grupo>

      <Grupo title="Domicilio">
        <StackedField className="sm:col-span-6" label="Calle">
          <input
            className={legacyFieldClassName}
            {...register("domicilioCalle")}
          />
        </StackedField>
        <StackedField className="sm:col-span-2" label="Número">
          <input
            className={legacyFieldClassName}
            inputMode="numeric"
            {...register("noPuerta")}
          />
        </StackedField>
        <StackedField className="sm:col-span-4" label="Localidad">
          {/* El mismo buscador de Vimarx que el alta de socio, pero opcional.
              Se guarda el nombre: el finalizar y la revision documental leen
              la localidad de la solicitud como texto. */}
          <Controller
            control={control}
            name="localidad"
            render={({ field }) => (
              <LocalidadSelect
                onBlur={field.onBlur}
                onClear={() => field.onChange("")}
                onPick={(localidad) => field.onChange(localidad.nombre)}
                value=""
                valueLabel={field.value ?? ""}
              />
            )}
          />
        </StackedField>
      </Grupo>

      <Grupo title="Cobro">
        <StackedField className="sm:col-span-4" label="Monto del recibo">
          <MoneyInputField control={control} name="montoRecibo" />
        </StackedField>
        <StackedField className="sm:col-span-4" label="Ingreso laboral">
          <DateInputField
            className="h-9"
            control={control}
            name="fechaIngresoLaboral"
          />
        </StackedField>
        <StackedField
          className="sm:col-span-4"
          error={errorDe("cbu")}
          label="CBU"
        >
          <input
            aria-invalid={!!errors?.cbu}
            className={cn(legacyFieldClassName, "tabular-nums")}
            inputMode="numeric"
            {...register("cbu")}
          />
        </StackedField>
        <StackedField
          className="sm:col-span-6"
          error={errorDe("cbuNoHabitual")}
          label="CBU cuenta no habitual"
        >
          <input
            aria-invalid={!!errors?.cbuNoHabitual}
            className={cn(legacyFieldClassName, "tabular-nums")}
            inputMode="numeric"
            {...register("cbuNoHabitual")}
          />
        </StackedField>
        <div className="flex items-end sm:col-span-6">
          {observacionesVisibles ? (
            <StackedField label="Observaciones">
              <textarea
                autoFocus={mostrarObservaciones}
                className={`${legacyFieldClassName} h-16 resize-y py-2`}
                {...register("observacionesSolicitud")}
              />
            </StackedField>
          ) : (
            <button
              className="inline-flex items-center gap-1.5 text-sm font-medium text-verde hover:underline"
              onClick={() => setMostrarObservaciones(true)}
              type="button"
            >
              <Plus className="size-4" />
              Agregar observaciones
            </button>
          )}
        </div>
      </Grupo>
    </div>
  );
}
