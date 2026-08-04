import {
  ChevronDown,
  FileText,
  Plus,
  Search,
  Send,
  Trash2,
  Upload,
} from "lucide-react";

import type { CreateSolicitudCoreGarantiaRequest } from "@/modules/solicitudes/types/solicitudes-core";
import { Button } from "@/shared/components/ui/button";

import { LegacyIconButton, legacyFieldClassName } from "./fields/base";
import { formatNullableAmount } from "../utils/money-format";

export function GarantiasSection({
  garantias,
  onNew,
}: {
  garantias: CreateSolicitudCoreGarantiaRequest[];
  onNew: () => void;
}) {
  const columns = [
    "",
    "",
    "Nombre Compl...",
    "Nro Socio",
    "Observaciones",
    "Ocupación",
    "Ingreso Mensual",
    "Tipo Relación",
    "Denominación",
    "Fecha Ingreso Laboral",
    "Nombre",
    "Antigüedad Laboral Meses",
    "Fecha De Nacimiento",
    "Suma Ingresos",
    "Nro Docu...",
    "Nro Documento",
    "CUIT",
    "Casado Con Titular",
  ];

  return (
    <div className="pt-3">
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Button
          className="h-9 px-3 text-foreground-secondary"
          onClick={onNew}
          type="button"
          variant="outline"
        >
          <Plus className="size-4 text-primary" />
          Nuevo
        </Button>
        <Button
          className="h-9 px-3 text-foreground-secondary"
          type="button"
          variant="outline"
        >
          <FileText className="size-4 text-blue-500" />
          Enlazar
        </Button>
        <Button
          className="h-9 px-3 text-foreground-secondary"
          disabled
          type="button"
          variant="outline"
        >
          Desvincular
        </Button>
        <LegacyIconButton className="size-9" disabled>
          <Trash2 className="size-4" />
        </LegacyIconButton>
        <div className="flex h-9 w-64 items-center gap-1">
          <input
            className={legacyFieldClassName}
            placeholder="Texto a buscar"
            type="text"
          />
          <LegacyIconButton className="size-9 text-primary">
            <Search className="size-4" />
          </LegacyIconButton>
        </div>
        <LegacyIconButton className="size-9">
          <Send className="size-4 text-primary" />
        </LegacyIconButton>
        <LegacyIconButton className="size-9">
          <ChevronDown className="size-4" />
        </LegacyIconButton>
        <LegacyIconButton className="size-9">
          <FileText className="size-4" />
        </LegacyIconButton>
        <LegacyIconButton className="size-9">
          <Upload className="size-4 text-primary" />
        </LegacyIconButton>
      </div>
      <div className="overflow-x-auto border border-border">
        <table className="w-full min-w-[1450px] border-collapse text-sm">
          <thead className="bg-background text-left text-xs text-foreground-secondary">
            <tr>
              {columns.map((column, index) => (
                <th
                  className="h-12 border-r border-border px-3 py-2 font-medium last:border-r-0"
                  key={`${column}-${index}`}
                >
                  {index === 0 ? (
                    <input type="checkbox" />
                  ) : index === 1 ? (
                    <Plus className="size-4 text-primary" />
                  ) : (
                    <span className="inline-flex w-full items-center justify-between gap-1">
                      {column}
                      <Search className="size-3.5 text-foreground-secondary" />
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {garantias.length > 0 ? (
              garantias.map((garantia, index) => (
                <tr key={`${garantia.nroDocumento ?? "garantia"}-${index}`}>
                  <td className="border-t border-r border-border px-3 py-2">
                    <input type="checkbox" />
                  </td>
                  <td className="border-t border-r border-border px-3 py-2" />
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.nombreCompleto ?? ""}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.nroSocio ?? ""}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.observaciones ?? ""}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.ocupacion ?? ""}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {formatNullableAmount(garantia.ingresoMensual)}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.tipoRelacion ?? ""}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.denominacion ?? ""}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.fechaIngresoLaboral ?? ""}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.nombre ?? ""}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.antiguedadLaboralMeses ?? ""}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.fechaNacimiento ?? ""}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.sumaIngresos ? "Sí" : "No"}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.tipoDocumento ?? ""}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.nroDocumento ?? ""}
                  </td>
                  <td className="border-t border-r border-border px-3 py-2">
                    {garantia.cuit ?? ""}
                  </td>
                  <td className="border-t border-border px-3 py-2">
                    {garantia.casadoConTitular === undefined
                      ? ""
                      : garantia.casadoConTitular
                        ? "Sí"
                        : "No"}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  className="h-28 text-center text-xs font-semibold text-foreground-muted"
                  colSpan={columns.length}
                >
                  Sin datos para mostrar
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-x border-b border-border px-2 py-2">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
          1
        </span>
        <div className="flex items-center gap-2 text-xs text-foreground-secondary">
          <span>Tamaño de página:</span>
          <Button size="sm" type="button" variant="outline">
            20
            <ChevronDown className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
