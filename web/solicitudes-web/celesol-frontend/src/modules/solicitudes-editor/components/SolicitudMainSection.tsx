import { Controller } from "react-hook-form";

import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";
import { DateInputField } from "@/shared/components/forms/date-input-field";
import { MoneyInputField } from "@/shared/components/forms/money-input-field";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";

import type {
  SolicitudFormControl,
  SolicitudFormErrors,
  SolicitudFormRegister,
} from "../types";
import { parseMoneyValue } from "../utils/money-format";
import { Field, Section, StyledSelect, fieldClassName } from "./fields/base";

export type SolicitudMainSectionProps = {
  control: SolicitudFormControl;
  errors: SolicitudFormErrors;
  isLoadingLineas: boolean;
  lineas: LineaPrestamoPresolicitud[];
  register: SolicitudFormRegister;
  selectedLinea: LineaPrestamoPresolicitud | undefined;
};

export function SolicitudMainSection({
  control,
  errors,
  isLoadingLineas,
  lineas,
  register,
  selectedLinea,
}: SolicitudMainSectionProps) {
  const lineaOptions = lineas.flatMap((linea) => {
    const descripcion = linea.descripcion?.trim() ?? "";
    const oid = linea.oid?.trim() ?? "";

    if (!descripcion) {
      return [];
    }

    return [{ label: descripcion, value: oid || descripcion }];
  });

  return (
    <Section title="Solicitud">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Línea">
            <Controller
              control={control}
              name="linea"
              render={({ field }) => (
                <StyledSelect
                  disabled={isLoadingLineas}
                  onChange={field.onChange}
                  options={lineaOptions}
                  placeholder={
                    isLoadingLineas
                      ? "Cargando líneas..."
                      : "Seleccione una línea"
                  }
                  searchable
                  value={field.value}
                />
              )}
            />
            {isLoadingLineas ? (
              <span className="text-xs text-foreground-muted">
                Cargando líneas...
              </span>
            ) : null}
          </Field>
          <Field label="Cuotas">
            <Input
              {...register("cuotas", {
                validate: (value) => {
                  if (!value || !selectedLinea) {
                    return true;
                  }

                  const cuotas = Number(value);

                  if (Number.isNaN(cuotas)) {
                    return "Ingrese un número válido.";
                  }

                  const min = selectedLinea.cantidadMinimaCuotas;
                  const max = selectedLinea.cantidadMaximaCuotas;

                  if (min !== null && cuotas < min) {
                    return `La línea requiere al menos ${min} cuotas.`;
                  }

                  if (max !== null && cuotas > max) {
                    return `La línea permite hasta ${max} cuotas.`;
                  }

                  return true;
                },
              })}
            />
            {errors.cuotas ? (
              <span className="text-xs text-danger">
                {errors.cuotas.message}
              </span>
            ) : null}
          </Field>
          <Field label="Fecha Primer Vencimiento">
            <DateInputField control={control} name="fechaPrimerVencimiento" />
          </Field>
          <Field label="Motivo">
            <Input {...register("motivo")} />
          </Field>
          <Field label="Nro Solicitud">
            <Input {...register("noSolicitud")} />
          </Field>
          <Field label="Estado">
            <Input {...register("estado")} />
          </Field>
          <Field label="Última Novedad">
            <Input {...register("ultimaNovedad")} />
          </Field>
          <Field label="Cupo Titular">
            <MoneyInputField
              className={fieldClassName}
              control={control}
              name="cupoTitular"
            />
          </Field>
        </div>

        <div className="space-y-3">
          <Field label="Monto A Financiar">
            <MoneyInputField
              className={fieldClassName}
              control={control}
              name="montoAFinanciar"
              validate={(value) => {
                if (!value || !selectedLinea) {
                  return true;
                }

                const monto = parseMoneyValue(value);
                const min = selectedLinea.montoMinimo;
                const max = selectedLinea.montoMaximo;

                if (min !== null && monto < min) {
                  return `El monto mínimo para la línea es ${min}.`;
                }

                if (max !== null && monto > max) {
                  return `El monto máximo para la línea es ${max}.`;
                }

                return true;
              }}
            />
            {errors.montoAFinanciar ? (
              <span className="text-xs text-danger">
                {errors.montoAFinanciar.message}
              </span>
            ) : null}
          </Field>
          {/*
            Solo lectura: la cuota la calcula el legado al guardar, a partir de
            monto, cuotas, linea, tasa y fecha de primer vencimiento. No hay
            caso donde se escriba a mano.

            Ademas no puede ser un MoneyInputField: ese componente reformatea
            con formatMoneyValue en cada render, que borra todo lo que no sea
            digito. Una cuota de 677.916,20 se mostraba como $67.791.620.
          */}
          <Field label="Cuota Resultante">
            <Input
              className="bg-disabled-background text-disabled-foreground"
              placeholder="Se calcula al guardar"
              readOnly
              tabIndex={-1}
              {...register("cuotaResultante")}
            />
          </Field>
          <Field label="Nro Operación">
            <Input {...register("nroOperacion")} />
          </Field>
          <Field label="Ejecutivo Solicitud">
            <Input {...register("ejecutivoSolicitud")} />
          </Field>
          <Field label="Vendedor Solicitud">
            <Input {...register("vendedorSolicitud")} />
          </Field>
          <Field label="Nro Interno">
            <Input {...register("noInterno")} />
          </Field>
          <Field label="Firma Digitalmente">
            <div className="mt-2 inline-flex items-center">
              <Controller
                control={control}
                name="firmaDigitalmente"
                render={({ field }) => (
                  <Checkbox
                    checked={field.value}
                    className="size-7 rounded-md [&_svg]:size-6"
                    name={field.name}
                    onBlur={field.onBlur}
                    onCheckedChange={(checked) =>
                      field.onChange(checked === true)
                    }
                  />
                )}
              />
            </div>
          </Field>
          <div className="h-[3.25rem]" />
        </div>
      </div>
      <div className="mt-3">
        <Field label="Observaciones">
          <textarea
            className={`${fieldClassName} min-h-20 resize-y py-2`}
            {...register("observacionesSolicitud")}
          />
        </Field>
      </div>
    </Section>
  );
}
