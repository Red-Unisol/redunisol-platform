import { Pencil, Search } from "lucide-react";
import { Controller } from "react-hook-form";

import type { SolicitudCoreGarantiaResponse } from "@/modules/solicitudes/types/solicitudes-core";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { DateInputField } from "@/shared/components/forms/date-input-field";
import { MoneyInputField } from "@/shared/components/forms/money-input-field";
import { Input } from "@/shared/components/ui/input";
import { InternationalPhoneField } from "@/shared/components/ui/international-phone-field";
import { TableEmptyState } from "@/shared/components/ui/table-empty-state";
import { getBirthDateBounds } from "@/shared/utils/birth-date-bounds";

import { DATOS_PERSONALES_TABS } from "../constants/solicitud-tabs";
import type {
  DatosPersonalesTab,
  LegacyOption,
  SolicitudFormControl,
  SolicitudFormRegister,
} from "../types";
import {
  Field,
  Section,
  StyledSelect,
  SubsectionTabs,
  fieldClassName,
} from "./fields/base";

export type SolicitudDatosPersonalesSectionProps = {
  activeTab: DatosPersonalesTab;
  control: SolicitudFormControl;
  embedded?: boolean;
  estadoCivilOptions: LegacyOption[];
  garantias?: SolicitudCoreGarantiaResponse[];
  isEditing?: boolean;
  onGarantiaEdit?: (index: number) => void;
  onTabChange: (tab: DatosPersonalesTab) => void;
  register: SolicitudFormRegister;
  sexoConyugeOptions: LegacyOption[];
  sexoOptions: LegacyOption[];
  showTabs?: boolean;
};

export function SolicitudDatosPersonalesSection({
  activeTab,
  control,
  embedded = false,
  estadoCivilOptions,
  garantias = [],
  isEditing = false,
  onGarantiaEdit,
  onTabChange,
  register,
  sexoConyugeOptions,
  sexoOptions,
  showTabs = true,
}: SolicitudDatosPersonalesSectionProps) {
  const birthDateBounds = getBirthDateBounds();
  const content = (
    <>
      {showTabs ? (
        <SubsectionTabs<DatosPersonalesTab>
          activeTab={activeTab}
          onTabChange={onTabChange}
          tabs={DATOS_PERSONALES_TABS}
        />
      ) : null}

      {activeTab === "datosPersonales" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
          <Field className="xl:col-span-12" label="Documento" required>
            <Controller
              control={control}
              name="documento"
              render={({ field }) => (
                <StyledSelect
                  onChange={field.onChange}
                  options={[{ label: "DNI", value: "DNI" }]}
                  value={field.value}
                />
              )}
            />
          </Field>
          <div className="md:col-span-2 xl:col-span-12">
            <Field label="Nro Documento" required>
              <div className="flex gap-1">
                <Input
                  {...register("noDocumento")}
                  placeholder="Ingrese DNI y presione TAB"
                />
                <Button size="icon-sm" type="button" variant="outline">
                  <Search className="size-4" />
                </Button>
              </div>
            </Field>
          </div>
          <Field className="xl:col-span-12" label="CUIT" required>
            <Input {...register("cuit")} />
          </Field>
          <div className="md:col-span-2 xl:col-span-12">
            <Field label="Apellido/Denominación" required>
              <Input {...register("apellidoDenominacion")} />
            </Field>
          </div>
          <div className="md:col-span-2 xl:col-span-12">
            <Field label="Nombre" required>
              <Input {...register("nombre")} />
            </Field>
          </div>
          <Field className="xl:col-span-12" label="Fecha Nacimiento" required>
            <DateInputField
              className={fieldClassName}
              control={control}
              max={birthDateBounds.max}
              min={birthDateBounds.min}
              name="fechaNacimiento"
            />
          </Field>
          <Field className="xl:col-span-4" label="Domicilio Calle">
            <Input {...register("domicilioCalle")} />
          </Field>
          <Field className="xl:col-span-2" label="Nro Puerta">
            <Input {...register("noPuerta")} />
          </Field>
          <Field className="xl:col-span-3" label="Localidad">
            <Input {...register("localidad")} />
          </Field>
          <div className="hidden xl:block xl:col-span-3" />
          <Field className="xl:col-span-5" label="Celular" required>
            <InternationalPhoneField control={control} name="celular" />
          </Field>
          <Field className="xl:col-span-5" label="Teléfono Fijo">
            <InternationalPhoneField control={control} name="telefonoFijo" />
          </Field>
          <div className="hidden xl:block xl:col-span-2" />
          <Field className="xl:col-span-12" label="Email" required>
            <Input {...register("email")} />
          </Field>
          <Field className="xl:col-span-12" label="Monto Recibo">
            <MoneyInputField
              className={fieldClassName}
              control={control}
              name="montoRecibo"
            />
          </Field>
          <Field className="xl:col-span-12" label="Fecha Ingreso Laboral">
            <DateInputField
              className={fieldClassName}
              control={control}
              name="fechaIngresoLaboral"
            />
          </Field>
          <div className="md:col-span-2 xl:col-span-12">
            <Field label="CBU">
              <Input {...register("cbu")} />
            </Field>
          </div>
          <Field className="xl:col-span-6" label="Nro Socio">
            <Input {...register("noSocio")} />
          </Field>
          <Field
            className="xl:col-span-6"
            label="Persona Expuesta Políticamente"
          >
            <div className="mt-2 inline-flex items-center">
              <Controller
                control={control}
                name="personaExpuestaPoliticamente"
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
          <Field className="xl:col-span-4" label="Nacionalidad">
            <Input {...register("nacionalidad")} />
          </Field>
          <Field className="xl:col-span-4" label="Sexo" required>
            <Controller
              control={control}
              name="sexo"
              render={({ field }) => (
                <StyledSelect
                  emptyOptionLabel="---"
                  onChange={field.onChange}
                  options={sexoOptions}
                  placeholder="---"
                  value={field.value}
                />
              )}
            />
          </Field>
          <Field className="xl:col-span-4" label="Estado Civil">
            <Controller
              control={control}
              name="estadoCivil"
              render={({ field }) => (
                <StyledSelect
                  emptyOptionLabel="---"
                  onChange={field.onChange}
                  options={estadoCivilOptions}
                  placeholder="---"
                  value={field.value}
                />
              )}
            />
          </Field>
        </div>
      ) : null}

      {activeTab === "conyuge" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-12">
          <Field className="xl:col-span-12" label="Apellido">
            <Input {...register("apellidoConyuge")} />
          </Field>
          <Field className="xl:col-span-12" label="Nombre">
            <Input {...register("nombreConyuge")} />
          </Field>
          <Field className="xl:col-span-6" label="Documento">
            <Controller
              control={control}
              name="tipoDocumentoConyuge"
              render={({ field }) => (
                <StyledSelect
                  onChange={field.onChange}
                  options={[{ label: "DNI", value: "DNI" }]}
                  value={field.value}
                />
              )}
            />
          </Field>
          <Field className="xl:col-span-6" label="Nro Documento">
            <Input {...register("noDocumentoConyuge")} />
          </Field>
          <Field className="xl:col-span-6" label="Sexo">
            <Controller
              control={control}
              name="sexoConyuge"
              render={({ field }) => (
                <StyledSelect
                  emptyOptionLabel="---"
                  onChange={field.onChange}
                  options={sexoConyugeOptions}
                  placeholder="---"
                  value={field.value}
                />
              )}
            />
          </Field>
          <Field className="xl:col-span-6" label="Fecha Nacimiento">
            <DateInputField
              className={fieldClassName}
              control={control}
              name="fechaNacimientoConyuge"
            />
          </Field>
          <Field className="xl:col-span-12" label="Actividad">
            <Input {...register("actividadConyuge")} />
          </Field>
          <Field className="xl:col-span-6" label="Ingresos">
            <MoneyInputField
              className={fieldClassName}
              control={control}
              name="ingresosConyuge"
            />
          </Field>
          <Field className="xl:col-span-6" label="Nacionalidad">
            <Input {...register("nacionalidadConyuge")} />
          </Field>
        </div>
      ) : null}

      {activeTab === "economicosLaborales" ? (
        <div className="rounded-md border border-border">
          <div className="border-b border-border bg-background px-3 py-2">
            <h3 className="text-xs font-medium text-foreground">
              Datos Laborales
            </h3>
          </div>
          <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-12">
            <Field className="xl:col-span-12" label="Empleador">
              <Input {...register("empleador")} />
            </Field>
            <Field className="xl:col-span-6" label="Calle">
              <Input {...register("domicilioLaboralCalle")} />
            </Field>
            <Field className="xl:col-span-3" label="Nro Puerta">
              <Input {...register("noPuertaLaboral")} />
            </Field>
            <Field className="xl:col-span-3" label="Piso/Depto">
              <Input {...register("pisoDeptoLaboral")} />
            </Field>
            <Field className="xl:col-span-12" label="Localidad">
              <Input {...register("localidadLaboral")} />
            </Field>
            <Field className="xl:col-span-6" label="Monto Recibo">
              <MoneyInputField
                className={fieldClassName}
                control={control}
                name="montoRecibo"
              />
            </Field>
            <Field className="xl:col-span-6" label="Antigüedad">
              <Input {...register("antiguedadLaboral")} />
            </Field>
            <Field className="xl:col-span-12" label="Actividad Laboral">
              <Input {...register("actividadLaboral")} />
            </Field>
            <Field className="xl:col-span-12" label="Relación Laboral">
              <Input {...register("relacionLaboral")} />
            </Field>
            <Field className="xl:col-span-12" label="Descuentos Sueldo">
              <MoneyInputField
                className={fieldClassName}
                control={control}
                name="descuentosSueldo"
              />
            </Field>
            <Field className="xl:col-span-12" label="Tarjetas">
              <Input {...register("tarjetas")} />
            </Field>
            <Field className="xl:col-span-12" label="Vehículo">
              <Input {...register("vehiculo")} />
            </Field>
            <Field className="xl:col-span-12" label="Vivienda">
              <Input {...register("vivienda")} />
            </Field>
          </div>
        </div>
      ) : null}

      {activeTab === "adicionales" ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[1320px] border-collapse text-sm">
            <thead className="bg-background text-left text-xs text-foreground-secondary">
              <tr>
                <th className="border-r border-border px-3 py-2 font-medium">
                  Tipo relación
                </th>
                <th className="border-r border-border px-3 py-2 font-medium">
                  Tipo garantía
                </th>
                <th className="border-r border-border px-3 py-2 font-medium">
                  Nombre completo / denominación
                </th>
                <th className="border-r border-border px-3 py-2 font-medium">
                  Documento
                </th>
                <th className="border-r border-border px-3 py-2 font-medium">
                  CUIT
                </th>
                <th className="border-r border-border px-3 py-2 font-medium">
                  Teléfono / celular
                </th>
                <th className="border-r border-border px-3 py-2 font-medium">
                  Email
                </th>
                <th className="border-r border-border px-3 py-2 font-medium">
                  Ingreso mensual
                </th>
                <th className="border-r border-border px-3 py-2 font-medium">
                  Fecha ingreso laboral
                </th>
                <th className="border-r border-border px-3 py-2 font-medium">
                  Antigüedad laboral meses
                </th>
                <th className="border-r border-border px-3 py-2 font-medium">
                  Estado civil
                </th>
                <th className="px-3 py-2 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {garantias.length > 0 ? (
                garantias.map((garantia, index) => (
                  <tr className="border-t border-border" key={index}>
                    <td className="border-r border-border px-3 py-2">
                      {garantia.tipoRelacion ?? ""}
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {garantia.tipoGarantia ?? ""}
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {garantia.nombreCompleto ?? garantia.denominacion ?? ""}
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {garantia.tipoDocumento && garantia.nroDocumento
                        ? `${garantia.tipoDocumento} ${garantia.nroDocumento}`
                        : (garantia.nroDocumento ??
                          garantia.tipoDocumento ??
                          "")}
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {garantia.cuit ?? ""}
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {garantia.telefono ?? garantia.celular ?? ""}
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {garantia.email ?? ""}
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {garantia.ingresoMensual === null ||
                      garantia.ingresoMensual === undefined
                        ? ""
                        : garantia.ingresoMensual}
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {garantia.fechaIngresoLaboral ?? ""}
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {garantia.antiguedadLaboralMeses === null ||
                      garantia.antiguedadLaboralMeses === undefined
                        ? ""
                        : garantia.antiguedadLaboralMeses}
                    </td>
                    <td className="border-r border-border px-3 py-2">
                      {garantia.estadoCivil ?? ""}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        disabled={!isEditing || !onGarantiaEdit}
                        onClick={() => onGarantiaEdit?.(index)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Pencil className="size-4" />
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="border-t border-border">
                  <td className="px-3 py-3" colSpan={12}>
                    <TableEmptyState message="Sin garantías cargadas para mostrar." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return content;
  }

  return <Section title="Datos Personales">{content}</Section>;
}
