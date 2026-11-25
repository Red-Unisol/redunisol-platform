import { createContext, useContext, type ReactNode } from "react";
import { MonthlyCutoffNotice } from "@/modules/monthly-cutoffs/MonthlyCutoffNotice";

import {
  getFieldAccessFieldLabel,
  getFieldAccessGroupLabel,
} from "../utils/field-access-admin-labels";
import type {
  SellerReviewChange,
  SolicitudCoreResponse,
} from "@/modules/solicitudes/types/solicitudes-core";
import { calculateAge } from "@/modules/solicitudes-editor/utils/calculate-age";
import { sexoLegible } from "@/modules/solicitudes-editor/constants/legacy-options";
import { cn } from "@/shared/utils/cn";

import { formatLegacyDate } from "../utils/legacy-date-format";
import { formatMontoLista } from "../utils/lista-solicitudes-formato";
import { LinkFirmaDigital } from "./link-firma-digital";
import { CampoRevisado } from "./campo-revisado";
import { formatReviewValue } from "../utils/seller-review-value";

// Detalle en modo lectura: los datos como texto, ordenados igual que Nueva
// solicitud (titular a la izquierda, prestamo y gestion a la derecha). Al
// editar se usan los formularios de siempre.

type Valor = ReactNode | string | number | null | undefined;

const reviewFieldLabels: Record<string, string> = {
  "titular.nombre": "Nombre",
  "titular.apellidoDenominacion": "Apellido",
  "titular.cuit": "CUIT",
  "titular.fechaNacimiento": "Nacimiento",
  "titular.sexo": "Sexo",
  "titular.estadoCivil": "Estado civil",
  "titular.nacionalidad": "Nacionalidad",
  "titular.celular": "Celular",
  "titular.telefonoFijo": "Teléfono fijo",
  "titular.email": "Email",
  "titular.domicilioCalle": "Calle y número",
  "titular.localidad": "Localidad",
  "titular.personaExpuestaPoliticamente": "Persona expuesta políticamente",
  "datosLaborales.empleador": "Empleador",
  "datosLaborales.fechaIngresoLaboral": "Ingreso laboral",
  "datosLaborales.montoRecibo": "Monto del recibo",
  "titular.cbu": "CBU",
  "titular.cbuNoHabitual": "CBU cuenta no habitual",
  "solicitud.lineaPrestamoLegacyOid": "Línea",
  "solicitud.montoAFinanciar": "Monto a financiar",
  "solicitud.cuotas": "Cuotas",
  "solicitud.cupoTitular": "Cupo del titular",
  "solicitud.firmaDigitalmente": "Firma digital",
  "solicitud.fechaPrimerVencimiento": "Primer vencimiento",
  "solicitud.nroOperacion": "Nro. de operación",
  "solicitud.motivo": "Motivo",
  "solicitud.linkFirmaDigital": "Link de firma digital",
  "solicitud.observaciones": "Observaciones",
  "titular.nroDocumento": "Documento",
};
const fieldGroup: Record<string, string> = {
  "titular.tipoDocumento": "titular.nroDocumento",
  "titular.nroPuerta": "titular.domicilioCalle",
};
const SellerChanges = createContext<ReadonlyMap<string, SellerReviewChange[]>>(
  new Map(),
);

function labelForChange(field: string) {
  const [group, index, key] = field.split(".");
  if (group === "adjuntos") return "Adjunto nuevo";
  if (group === "garantias" && key)
    return `Garantía ${Number(index) + 1} · ${getFieldAccessFieldLabel(`garantias.${key}`)}`;
  return `${getFieldAccessGroupLabel(group)} · ${getFieldAccessFieldLabel(field)}`;
}

function vacio(value: Valor) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

function Campo({
  className,
  field,
  changes: suppliedChanges,
  label,
  value,
}: {
  className?: string;
  field?: string;
  changes?: SellerReviewChange[];
  label?: string;
  value: Valor;
}) {
  const changesByField = useContext(SellerChanges);
  const changes = suppliedChanges ?? changesByField.get(field ?? "");
  return (
    <CampoRevisado
      changes={changes}
      className={className}
      compound={
        field === "titular.nroDocumento" || field === "titular.domicilioCalle"
      }
    >
      <dt className="text-xs text-foreground-secondary">
        {label ?? reviewFieldLabels[field ?? ""]}
      </dt>
      <dd
        className={cn(
          "mt-0.5 text-sm break-words",
          vacio(value) ? "text-foreground-muted" : "text-foreground",
        )}
      >
        {vacio(value) ? "Sin cargar" : value}
      </dd>
    </CampoRevisado>
  );
}

function Tarjeta({
  children,
  className,
  extra,
  title,
}: {
  children: ReactNode;
  className?: string;
  // Al lado del titulo (p. ej. si es socio).
  extra?: ReactNode;
  title: string;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-surface",
        className,
      )}
    >
      <header className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-t-[inherit] bg-marino px-4 py-2 text-white">
        <h2 className="font-marca text-[1.0625rem] font-bold tracking-[-0.01em]">
          {title}
        </h2>
        {extra}
      </header>
      <div className="min-w-0 p-4">{children}</div>
    </section>
  );
}

// Columnas angostas: los datos quedan juntos a la izquierda.
export const COLUMNAS_TITULAR =
  "grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,13rem))]";

export const DOS_COLUMNAS =
  "grid grid-cols-[repeat(2,minmax(0,12rem))] gap-x-6 gap-y-3";

function siNo(value: boolean | null | undefined) {
  if (value === null || value === undefined) return null;
  return value ? "Sí" : "No";
}

function pesos(value: number | string | null | undefined) {
  const texto = formatMontoLista(value ?? null);
  if (!texto) return null;
  return texto.startsWith("$") ? texto : `$ ${texto}`;
}

export function DetalleLectura({
  comparacionBancaria,
  ejecutivo,
  firmaLegajo,
  prestamoEditable,
  situacionSocio,
  solicitud,
  titularEditable,
}: {
  comparacionBancaria?: ReactNode;
  // undefined = no se muestra (el vendedor no ve quien analiza su solicitud).
  ejecutivo?: string | null;
  // Panel de firma del legajo digital (Beex), abajo a todo el ancho.
  firmaLegajo?: ReactNode;
  // Socio o no, creditos y mora, al lado del titulo Titular.
  situacionSocio?: ReactNode;
  // Al editar: los mismos campos con caja, en el mismo lugar.
  prestamoEditable?: ReactNode;
  titularEditable?: ReactNode;
  solicitud: SolicitudCoreResponse;
}) {
  const titular = solicitud.titular;
  const laborales = solicitud.datosLaborales;
  const edad = titular.fechaNacimiento
    ? calculateAge(titular.fechaNacimiento.slice(0, 10))
    : "";
  const nacimiento = formatLegacyDate(titular.fechaNacimiento);
  const domicilio = [titular.domicilioCalle, titular.nroPuerta]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");
  const cuota = pesos(solicitud.cuotaResultante);
  const groupedChanges = new Map<string, SellerReviewChange[]>();
  const otherChanges: SellerReviewChange[] = [];
  for (const change of solicitud.sellerReviewChanges ?? []) {
    const field = fieldGroup[change.field] ?? change.field;
    if (!(field in reviewFieldLabels)) {
      otherChanges.push(change);
    } else {
      groupedChanges.set(field, [...(groupedChanges.get(field) ?? []), change]);
    }
  }

  const detail = (
    <div className="space-y-3">
      {/* Titular y Prestamo, del mismo alto. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Tarjeta extra={situacionSocio} title="Titular">
          {titularEditable ?? (
            <dl className={COLUMNAS_TITULAR}>
              <Campo field="titular.nombre" value={titular.nombre} />
              <Campo
                field="titular.apellidoDenominacion"
                value={titular.apellidoDenominacion}
              />
              <Campo
                field="titular.nroDocumento"
                label={titular.tipoDocumento?.trim() || "Documento"}
                value={titular.nroDocumento}
              />
              <Campo field="titular.cuit" value={titular.cuit} />

              <Campo
                field="titular.fechaNacimiento"
                value={
                  nacimiento && nacimiento !== "-"
                    ? `${nacimiento}${edad ? ` (${edad} años)` : ""}`
                    : null
                }
              />
              <Campo field="titular.sexo" value={sexoLegible(titular.sexo)} />
              <Campo field="titular.estadoCivil" value={titular.estadoCivil} />
              <Campo
                field="titular.nacionalidad"
                value={titular.nacionalidad}
              />

              <Campo field="titular.celular" value={titular.celular} />
              <Campo
                field="titular.telefonoFijo"
                value={titular.telefonoFijo}
              />
              <Campo
                className="lg:col-span-2"
                field="titular.email"
                value={titular.email}
              />

              <Campo
                className="lg:col-span-2"
                field="titular.domicilioCalle"
                value={domicilio}
              />
              <Campo field="titular.localidad" value={titular.localidad} />
              <Campo
                field="titular.personaExpuestaPoliticamente"
                value={siNo(titular.personaExpuestaPoliticamente)}
              />

              <Campo
                field="datosLaborales.empleador"
                value={laborales.empleador}
              />
              <Campo
                field="datosLaborales.fechaIngresoLaboral"
                value={
                  laborales.fechaIngresoLaboral
                    ? formatLegacyDate(laborales.fechaIngresoLaboral)
                    : null
                }
              />
              <Campo
                className="lg:col-span-2"
                field="datosLaborales.montoRecibo"
                value={pesos(laborales.montoRecibo)}
              />

              {!comparacionBancaria ? (
                <>
                  <Campo
                    className="lg:col-span-2"
                    field="titular.cbu"
                    value={titular.cbu}
                  />
                  <Campo
                    className="lg:col-span-2"
                    field="titular.cbuNoHabitual"
                    value={titular.cbuNoHabitual}
                  />
                </>
              ) : null}
            </dl>
          )}
          {comparacionBancaria}
        </Tarjeta>

        <Tarjeta title="Préstamo">
          <MonthlyCutoffNotice
            lineId={solicitud.lineaPrestamoLegacyOid}
            hasLoan={Boolean(solicitud.legacyOid)}
          />
          {prestamoEditable ?? (
            <>
              <dl className={DOS_COLUMNAS}>
                <Campo
                  className="col-span-2"
                  field="solicitud.lineaPrestamoLegacyOid"
                  value={solicitud.lineaPrestamoDescripcion}
                />
                <Campo
                  field="solicitud.montoAFinanciar"
                  value={pesos(solicitud.montoAFinanciar)}
                />
                <Campo field="solicitud.cuotas" value={solicitud.cuotas} />
                <Campo
                  label="Cuota por mes"
                  value={
                    cuota ? (
                      <span className="font-semibold text-verde">{cuota}</span>
                    ) : null
                  }
                />
                <Campo
                  field="solicitud.cupoTitular"
                  value={pesos(solicitud.cupoTitular)}
                />
                <Campo
                  field="solicitud.firmaDigitalmente"
                  value={siNo(solicitud.firmaDigitalmente)}
                />
                <Campo
                  field="solicitud.fechaPrimerVencimiento"
                  value={
                    solicitud.fechaPrimerVencimiento
                      ? formatLegacyDate(solicitud.fechaPrimerVencimiento)
                      : null
                  }
                />
              </dl>
              {/* Gestion dentro de la misma tarjeta: quien la vende y la sigue. */}
              <dl
                className={`${DOS_COLUMNAS} mt-3 border-t border-border-soft pt-3`}
              >
                <Campo label="Vendedor" value={solicitud.vendedorSolicitud} />
                {ejecutivo !== undefined ? (
                  <Campo label="Ejecutivo" value={ejecutivo} />
                ) : null}
                {solicitud.nroOperacion ||
                groupedChanges.has("solicitud.nroOperacion") ? (
                  <Campo
                    field="solicitud.nroOperacion"
                    value={solicitud.nroOperacion}
                  />
                ) : null}
                {solicitud.motivo || groupedChanges.has("solicitud.motivo") ? (
                  <Campo field="solicitud.motivo" value={solicitud.motivo} />
                ) : null}
                {solicitud.linkFirmaDigital ||
                groupedChanges.has("solicitud.linkFirmaDigital") ? (
                  <Campo
                    className="col-span-2"
                    field="solicitud.linkFirmaDigital"
                    value={
                      solicitud.linkFirmaDigital && (
                        <LinkFirmaDigital
                          conWhatsapp={false}
                          url={solicitud.linkFirmaDigital}
                        />
                      )
                    }
                  />
                ) : null}
                <Campo
                  className="col-span-2"
                  field="solicitud.observaciones"
                  value={solicitud.observaciones}
                />
              </dl>
            </>
          )}
        </Tarjeta>
      </div>
      {otherChanges.length > 0 && (
        <Tarjeta title="Otros cambios de Vendedores">
          <dl className={COLUMNAS_TITULAR}>
            {otherChanges.map((change) => (
              <Campo
                key={change.field}
                label={labelForChange(change.field)}
                changes={[change]}
                value={formatReviewValue(change.field, change.after)}
              />
            ))}
          </dl>
        </Tarjeta>
      )}
      {firmaLegajo}
    </div>
  );
  return (
    <SellerChanges.Provider value={groupedChanges}>
      {detail}
    </SellerChanges.Provider>
  );
}
