import { FileText, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { CreateSolicitudCoreGarantiaRequest } from "@/modules/solicitudes/types/solicitudes-core";
import { StaticMoneyInput } from "@/shared/components/forms/money-input-field";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { DateInput } from "@/shared/components/ui/date-input";
import {
  DialogClose,
  DialogContent,
  DialogRoot,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { StaticInternationalPhoneField } from "@/shared/components/ui/international-phone-field";

import {
  ESTADO_CIVIL_OPTIONS,
  SEXO_OPTIONS,
  TIPO_DOCUMENTO_OPTIONS,
  TIPO_GARANTIA_OPTIONS,
  TIPO_RELACION_OPTIONS,
} from "../constants/legacy-options";
import {
  LegacyIconButton,
  LegacyInputWithActions,
  ModalField,
  ModalSection,
  StyledSelect,
  legacyFieldClassName,
} from "./fields/base";
import { parseMoneyValue } from "../utils/money-format";

function toOptionalNumber(value: string) {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return undefined;
  }

  const parsedValue = Number(normalizedValue);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function toOptionalMoneyNumber(value: string) {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return undefined;
  }

  const parsedValue = parseMoneyValue(normalizedValue);

  return parsedValue > 0 ? parsedValue : undefined;
}

function toTrimmedString(value: string) {
  const normalizedValue = value.trim();

  return normalizedValue ? normalizedValue : undefined;
}

function parseIngresoLaboralDate(value: string) {
  const normalizedValue = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizedValue);
  const localMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalizedValue);
  const match = isoMatch ?? localMatch;

  if (!match) {
    return null;
  }

  const year = Number(isoMatch ? match[1] : match[3]);
  const month = Number(match[2]);
  const day = Number(isoMatch ? match[3] : match[1]);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function calculateAntiguedadLaboralMeses(fechaIngresoLaboral: string) {
  const startDate = parseIngresoLaboralDate(fechaIngresoLaboral);

  if (!startDate) {
    return "";
  }

  const today = new Date();
  let months =
    (today.getFullYear() - startDate.getFullYear()) * 12 +
    today.getMonth() -
    startDate.getMonth();

  if (today.getDate() < startDate.getDate()) {
    months -= 1;
  }

  return String(Math.max(0, months));
}

type NuevaGarantiaModalProps = {
  defaultValues?: Partial<CreateSolicitudCoreGarantiaRequest>;
  isFieldEditable?: (
    field: keyof CreateSolicitudCoreGarantiaRequest,
  ) => boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (garantia: CreateSolicitudCoreGarantiaRequest) => void;
  open: boolean;
  saveLabel?: string;
  title?: string;
};

export function NuevaGarantiaModal({
  defaultValues,
  isFieldEditable = () => true,
  onOpenChange,
  onSave,
  open,
  saveLabel = "Save",
  title = "Adicional Solicitud",
}: NuevaGarantiaModalProps) {
  const [tipoRelacion, setTipoRelacion] = useState("Co deudor");
  const [nroDocumento, setNroDocumento] = useState("");
  const [persona, setPersona] = useState("");
  const [cuit, setCuit] = useState("");
  const [nroSocio, setNroSocio] = useState("");
  const [denominacion, setDenominacion] = useState("");
  const [tipoDocumento, setTipoDocumento] = useState("DNI");
  const [nombre, setNombre] = useState("");
  const [sexo, setSexo] = useState("Masculino");
  const [fechaNacimiento, setFechaNacimiento] = useState("");
  const [edad, setEdad] = useState("");
  const [email, setEmail] = useState("");
  const [nacionalidad, setNacionalidad] = useState("Argentina");
  const [nombreCompleto, setNombreCompleto] = useState("");
  const [estadoCivil, setEstadoCivil] = useState("Soltero");
  const [telefono, setTelefono] = useState("");
  const [celular, setCelular] = useState("");
  const [domicilio, setDomicilio] = useState("");
  const [ocupacion, setOcupacion] = useState("");
  const [ingresoMensual, setIngresoMensual] = useState("");
  const [fechaIngresoLaboral, setFechaIngresoLaboral] = useState("");
  const [antiguedadLaboralMeses, setAntiguedadLaboralMeses] = useState("");
  const [sumaIngresos, setSumaIngresos] = useState(false);
  const [tipoGarantia, setTipoGarantia] = useState("Personal");
  const [observaciones, setObservaciones] = useState("");

  function applyDraft(
    nextValues?: Partial<CreateSolicitudCoreGarantiaRequest>,
  ) {
    setTipoRelacion(nextValues?.tipoRelacion ?? "Co deudor");
    setNroDocumento(nextValues?.nroDocumento ?? "");
    setPersona(nextValues?.persona ?? "");
    setCuit(nextValues?.cuit ?? "");
    setNroSocio(nextValues?.nroSocio ?? "");
    setDenominacion(nextValues?.denominacion ?? "");
    setTipoDocumento(nextValues?.tipoDocumento ?? "DNI");
    setNombre(nextValues?.nombre ?? "");
    setSexo(nextValues?.sexo ?? "Masculino");
    setFechaNacimiento(nextValues?.fechaNacimiento ?? "");
    setEdad(
      nextValues?.edad === null || nextValues?.edad === undefined
        ? ""
        : String(nextValues.edad),
    );
    setEmail(nextValues?.email ?? "");
    setNacionalidad(nextValues?.nacionalidad ?? "Argentina");
    setNombreCompleto(nextValues?.nombreCompleto ?? "");
    setEstadoCivil(nextValues?.estadoCivil ?? "Soltero");
    setTelefono(nextValues?.telefono ?? "");
    setCelular(nextValues?.celular ?? "");
    setDomicilio(nextValues?.domicilio ?? "");
    setOcupacion(nextValues?.ocupacion ?? "");
    setIngresoMensual(
      nextValues?.ingresoMensual === null ||
        nextValues?.ingresoMensual === undefined
        ? ""
        : String(nextValues.ingresoMensual),
    );
    setFechaIngresoLaboral(nextValues?.fechaIngresoLaboral ?? "");
    setAntiguedadLaboralMeses(
      nextValues?.antiguedadLaboralMeses === null ||
        nextValues?.antiguedadLaboralMeses === undefined
        ? ""
        : String(nextValues.antiguedadLaboralMeses),
    );
    setSumaIngresos(nextValues?.sumaIngresos ?? false);
    setTipoGarantia(nextValues?.tipoGarantia ?? "Personal");
    setObservaciones(nextValues?.observaciones ?? "");
  }

  useEffect(() => {
    setAntiguedadLaboralMeses(
      calculateAntiguedadLaboralMeses(fechaIngresoLaboral),
    );
  }, [fechaIngresoLaboral]);

  useEffect(() => {
    if (open) {
      applyDraft(defaultValues);
    }
  }, [defaultValues, open]);

  function resetDraft() {
    applyDraft();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetDraft();
    }

    onOpenChange(nextOpen);
  }

  function handleSave() {
    onSave({
      antiguedadLaboralMeses: toOptionalNumber(antiguedadLaboralMeses),
      celular: toTrimmedString(celular),
      cuit: toTrimmedString(cuit),
      denominacion: toTrimmedString(denominacion),
      domicilio: toTrimmedString(domicilio),
      edad: toOptionalNumber(edad),
      email: toTrimmedString(email),
      estadoCivil: toTrimmedString(estadoCivil),
      fechaIngresoLaboral: toTrimmedString(fechaIngresoLaboral),
      fechaNacimiento: toTrimmedString(fechaNacimiento),
      ingresoMensual: toOptionalMoneyNumber(ingresoMensual),
      nacionalidad: toTrimmedString(nacionalidad),
      nombre: toTrimmedString(nombre),
      nombreCompleto: toTrimmedString(nombreCompleto),
      nroDocumento: toTrimmedString(nroDocumento),
      nroSocio: toTrimmedString(nroSocio),
      observaciones: toTrimmedString(observaciones),
      ocupacion: toTrimmedString(ocupacion),
      persona: toTrimmedString(persona),
      sexo: toTrimmedString(sexo),
      sumaIngresos,
      telefono: toTrimmedString(telefono),
      tipoDocumento: toTrimmedString(tipoDocumento),
      tipoGarantia: toTrimmedString(tipoGarantia),
      tipoRelacion: toTrimmedString(tipoRelacion),
    });
    handleOpenChange(false);
  }

  return (
    <DialogRoot onOpenChange={handleOpenChange} open={open}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] max-w-[820px] flex-col overflow-hidden p-0">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-9 items-center justify-center rounded-full bg-background text-foreground-secondary">
              <FileText className="size-4" />
            </span>
            <DialogTitle className="text-2xl font-semibold leading-none text-foreground">
              {title}
            </DialogTitle>
          </div>
          <DialogClose asChild>
            <Button
              className="text-foreground-secondary"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <ModalField label="Tipo Relación*">
            <StyledSelect
              disabled={!isFieldEditable("tipoRelacion")}
              onChange={setTipoRelacion}
              options={TIPO_RELACION_OPTIONS}
              placeholder="Seleccione tipo de relación"
              value={tipoRelacion}
            />
          </ModalField>

          <ModalSection title="Datos Personales">
            <div className="grid gap-4 md:grid-cols-2">
              <ModalField label="Nro Documento">
                <LegacyInputWithActions>
                  <Input
                    disabled={!isFieldEditable("nroDocumento")}
                    onChange={(event) => setNroDocumento(event.target.value)}
                    value={nroDocumento}
                  />
                </LegacyInputWithActions>
              </ModalField>
              <ModalField label="Persona">
                <Input
                  disabled={!isFieldEditable("persona")}
                  onChange={(event) => setPersona(event.target.value)}
                  value={persona}
                />
              </ModalField>
              <ModalField label="CUIT">
                <Input
                  disabled={!isFieldEditable("cuit")}
                  onChange={(event) => setCuit(event.target.value)}
                  value={cuit}
                />
              </ModalField>
              <ModalField label="Nro Socio">
                <Input
                  disabled={!isFieldEditable("nroSocio")}
                  onChange={(event) => setNroSocio(event.target.value)}
                  value={nroSocio}
                />
              </ModalField>
              <ModalField label="Denominación*">
                <Input
                  disabled={!isFieldEditable("denominacion")}
                  onChange={(event) => setDenominacion(event.target.value)}
                  value={denominacion}
                />
              </ModalField>
              <ModalField label="Tipo Doc">
                <StyledSelect
                  disabled={!isFieldEditable("tipoDocumento")}
                  onChange={setTipoDocumento}
                  options={TIPO_DOCUMENTO_OPTIONS}
                  placeholder="Seleccione tipo documento"
                  value={tipoDocumento}
                />
              </ModalField>
              <ModalField label="Nombre*">
                <Input
                  disabled={!isFieldEditable("nombre")}
                  onChange={(event) => setNombre(event.target.value)}
                  value={nombre}
                />
              </ModalField>
              <ModalField label="Sexo">
                <StyledSelect
                  disabled={!isFieldEditable("sexo")}
                  onChange={setSexo}
                  options={SEXO_OPTIONS}
                  placeholder="Seleccione sexo"
                  value={sexo}
                />
              </ModalField>
              <ModalField label="Fecha De Nacimiento*">
                <DateInput
                  disabled={!isFieldEditable("fechaNacimiento")}
                  onChange={setFechaNacimiento}
                  value={fechaNacimiento}
                />
              </ModalField>
              <ModalField label="Edad">
                <Input
                  disabled={!isFieldEditable("edad")}
                  onChange={(event) => setEdad(event.target.value)}
                  value={edad}
                />
              </ModalField>
              <ModalField label="Email">
                <Input
                  disabled={!isFieldEditable("email")}
                  onChange={(event) => setEmail(event.target.value)}
                  value={email}
                />
              </ModalField>
              <ModalField label="Nacionalidad">
                <LegacyInputWithActions>
                  <Input
                    disabled={!isFieldEditable("nacionalidad")}
                    onChange={(event) => setNacionalidad(event.target.value)}
                    value={nacionalidad}
                  />
                </LegacyInputWithActions>
              </ModalField>
              <ModalField label="Nombre Completo">
                <Input
                  disabled={!isFieldEditable("nombreCompleto")}
                  onChange={(event) => setNombreCompleto(event.target.value)}
                  value={nombreCompleto}
                />
              </ModalField>
              <ModalField label="Estado Civil">
                <StyledSelect
                  disabled={!isFieldEditable("estadoCivil")}
                  onChange={setEstadoCivil}
                  options={ESTADO_CIVIL_OPTIONS}
                  placeholder="Seleccione estado civil"
                  value={estadoCivil}
                />
              </ModalField>
              <ModalField label="Teléfono">
                <StaticInternationalPhoneField
                  disabled={!isFieldEditable("telefono")}
                  onChange={setTelefono}
                  value={telefono}
                />
              </ModalField>
              <ModalField label="Celular">
                <StaticInternationalPhoneField
                  disabled={!isFieldEditable("celular")}
                  onChange={setCelular}
                  value={celular}
                />
              </ModalField>
              <ModalField className="md:col-span-2" label="Domicilio">
                <div className="flex min-w-0 gap-1">
                  <Input
                    disabled={!isFieldEditable("domicilio")}
                    onChange={(event) => setDomicilio(event.target.value)}
                    value={domicilio}
                  />
                  <LegacyIconButton className="text-foreground-secondary">
                    <Pencil className="size-4" />
                  </LegacyIconButton>
                </div>
              </ModalField>
            </div>
          </ModalSection>

          <ModalSection title="Garantia">
            <div className="grid gap-4 md:grid-cols-2">
              <ModalField label="Ocupación">
                <Input
                  disabled={!isFieldEditable("ocupacion")}
                  onChange={(event) => setOcupacion(event.target.value)}
                  value={ocupacion}
                />
              </ModalField>
              <ModalField label="Ingreso Mensual">
                <StaticMoneyInput
                  disabled={!isFieldEditable("ingresoMensual")}
                  onChange={setIngresoMensual}
                  value={ingresoMensual}
                />
              </ModalField>
              <ModalField label="Fecha Ingreso Laboral">
                <DateInput
                  disabled={!isFieldEditable("fechaIngresoLaboral")}
                  onChange={setFechaIngresoLaboral}
                  value={fechaIngresoLaboral}
                />
              </ModalField>
              <ModalField label="Antigüedad Laboral Meses">
                <Input
                  disabled={!isFieldEditable("antiguedadLaboralMeses")}
                  onChange={(event) =>
                    setAntiguedadLaboralMeses(event.target.value)
                  }
                  value={antiguedadLaboralMeses}
                />
              </ModalField>
              <ModalField label="Suma Ingresos">
                <div className="mt-2">
                  <Checkbox
                    checked={sumaIngresos}
                    disabled={!isFieldEditable("sumaIngresos")}
                    onCheckedChange={(checked) =>
                      setSumaIngresos(checked === true)
                    }
                  />
                </div>
              </ModalField>
              <ModalField className="md:col-span-2" label="Tipo Garantia*">
                <StyledSelect
                  disabled={!isFieldEditable("tipoGarantia")}
                  onChange={setTipoGarantia}
                  options={TIPO_GARANTIA_OPTIONS}
                  placeholder="Seleccione tipo de garantía"
                  value={tipoGarantia}
                />
              </ModalField>
            </div>
          </ModalSection>

          <ModalSection title="Observaciones">
            <textarea
              className={`${legacyFieldClassName} h-20 resize-none py-2`}
              disabled={!isFieldEditable("observaciones")}
              onChange={(event) => setObservaciones(event.target.value)}
              value={observaciones}
            />
          </ModalSection>
        </div>

        <footer className="shrink-0 border-t border-border bg-surface px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <Button onClick={handleSave} type="button">
              {saveLabel}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
          </div>
        </footer>
      </DialogContent>
    </DialogRoot>
  );
}
