import { Search } from "lucide-react";
import { Controller, useWatch } from "react-hook-form";

import { DateInputField } from "@/shared/components/forms/date-input-field";
import { MoneyInputField } from "@/shared/components/forms/money-input-field";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { InternationalPhoneField } from "@/shared/components/ui/international-phone-field";
import { getBirthDateBounds } from "@/shared/utils/birth-date-bounds";

import {
  ESTADO_CIVIL_OPTIONS,
  SEXO_OPTIONS,
  TIPO_DOCUMENTO_OPTIONS,
} from "../constants/legacy-options";
import type { SolicitudFormControl, SolicitudFormRegister } from "../types";
import { calculateAge } from "../utils/calculate-age";
import {
  LegacyField,
  LegacyIconButton,
  StyledSelect,
  legacyFieldClassName,
} from "./fields/base";

const birthDateBounds = getBirthDateBounds();

export function NuevaSolicitudTitularFields({
  control,
  errors,
  onLookupByDocumento,
  register,
}: {
  control: SolicitudFormControl;
  errors?: Partial<Record<string, { message?: string }>>;
  onLookupByDocumento?: () => void;
  register: SolicitudFormRegister;
}) {
  const fechaNacimiento = useWatch({ control, name: "fechaNacimiento" });
  const edad = calculateAge(fechaNacimiento ?? "");

  return (
    <div className="space-y-2 pt-2">
      <LegacyField label="Documento" required>
        <Controller
          control={control}
          name="documento"
          render={({ field }) => (
            <StyledSelect
              invalid={!!errors?.documento}
              onChange={field.onChange}
              options={TIPO_DOCUMENTO_OPTIONS}
              placeholder="Seleccione tipo documento"
              value={field.value}
            />
          )}
        />
      </LegacyField>
      <LegacyField label="Nro Documento" required>
        <input
          aria-invalid={!!errors?.noDocumento}
          className={legacyFieldClassName}
          {...register("noDocumento", {
            onBlur: () => {
              onLookupByDocumento?.();
            },
          })}
        />
      </LegacyField>
      <LegacyField label="CUIT" required>
        <input
          aria-invalid={!!errors?.cuit}
          className={legacyFieldClassName}
          {...register("cuit")}
        />
      </LegacyField>
      <LegacyField label="Apellido/Denominación" required>
        <input
          aria-invalid={!!errors?.apellidoDenominacion}
          autoComplete="family-name"
          className={legacyFieldClassName}
          {...register("apellidoDenominacion")}
        />
      </LegacyField>
      <LegacyField label="Nombre" required>
        <input
          aria-invalid={!!errors?.nombre}
          autoComplete="given-name"
          className={legacyFieldClassName}
          {...register("nombre")}
        />
      </LegacyField>
      <LegacyField label="Fecha Nacimiento" required>
        <DateInputField
          className="h-9"
          control={control}
          invalid={!!errors?.fechaNacimiento}
          max={birthDateBounds.max}
          min={birthDateBounds.min}
          name="fechaNacimiento"
        />
      </LegacyField>
      <LegacyField label="Edad">
        <input
          className={legacyFieldClassName}
          disabled
          readOnly
          value={edad}
        />
      </LegacyField>
      <div className="grid grid-cols-[13.5rem_minmax(0,1fr)_auto_minmax(0,0.55fr)_auto_minmax(0,0.75fr)] items-center gap-2">
        <span className="text-xs font-medium text-foreground-secondary">
          Domicilio Calle
        </span>
        <input
          className={legacyFieldClassName}
          {...register("domicilioCalle")}
        />
        <span className="text-xs font-medium text-foreground-secondary">
          Nro Puerta
        </span>
        <input className={legacyFieldClassName} {...register("noPuerta")} />
        <span className="text-xs font-medium text-foreground-secondary">
          Localidad
        </span>
        <div className="flex min-w-0 gap-1">
          <input className={legacyFieldClassName} {...register("localidad")} />
          <LegacyIconButton className="text-foreground-secondary">
            <Search className="size-4" />
          </LegacyIconButton>
        </div>
      </div>
      <div className="grid grid-cols-[13.5rem_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <span className="text-xs font-medium text-foreground-secondary">
          Celular
        </span>
        <InternationalPhoneField
          control={control}
          inputAutoComplete="tel-national"
          name="celular"
        />
        <span className="text-xs font-medium text-foreground-secondary">
          Teléfono Fijo
        </span>
        <InternationalPhoneField
          control={control}
          inputAutoComplete="tel-local"
          name="telefonoFijo"
        />
      </div>
      <LegacyField label="Email">
        <input
          autoComplete="email"
          className={legacyFieldClassName}
          {...register("email")}
        />
      </LegacyField>
      <LegacyField label="Nacionalidad">
        <input className={legacyFieldClassName} {...register("nacionalidad")} />
      </LegacyField>
      <LegacyField label="Sexo">
        <Controller
          control={control}
          name="sexo"
          render={({ field }) => (
            <StyledSelect
              onChange={field.onChange}
              options={SEXO_OPTIONS}
              placeholder="Seleccione sexo"
              value={field.value}
            />
          )}
        />
      </LegacyField>
      <LegacyField label="Estado Civil">
        <Controller
          control={control}
          name="estadoCivil"
          render={({ field }) => (
            <StyledSelect
              emptyOptionLabel="---"
              onChange={field.onChange}
              options={ESTADO_CIVIL_OPTIONS}
              placeholder="---"
              value={field.value}
            />
          )}
        />
      </LegacyField>
      <LegacyField label="Persona Expuesta Políticamente">
        <Controller
          control={control}
          name="personaExpuestaPoliticamente"
          render={({ field }) => (
            <div className="flex h-9 items-center rounded-md border border-input-border bg-input-background px-3">
              <Checkbox
                checked={field.value}
                className="size-4 rounded-md [&_svg]:size-3.5"
                name={field.name}
                onBlur={field.onBlur}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
            </div>
          )}
        />
      </LegacyField>
      <LegacyField label="Monto Recibo">
        <MoneyInputField control={control} name="montoRecibo" />
      </LegacyField>
      <LegacyField label="Fecha Ingreso Laboral">
        <DateInputField
          className="h-9"
          control={control}
          name="fechaIngresoLaboral"
        />
      </LegacyField>
      <LegacyField label="CBU">
        <input className={legacyFieldClassName} {...register("cbu")} />
      </LegacyField>
      <LegacyField label="Cbu Transferencias Cuenta No Habitual">
        <input
          className={legacyFieldClassName}
          {...register("cbuTransferenciasCuentaNoHabitual")}
        />
      </LegacyField>
      <LegacyField className="items-start" label="Observaciones">
        <textarea
          className={`${legacyFieldClassName} h-20 resize-none py-2`}
          {...register("observacionesSolicitud")}
        />
      </LegacyField>
    </div>
  );
}
