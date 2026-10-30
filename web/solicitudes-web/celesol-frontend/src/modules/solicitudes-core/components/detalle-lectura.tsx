import type { ReactNode } from "react";

import type { SolicitudCoreResponse } from "@/modules/solicitudes/types/solicitudes-core";
import { calculateAge } from "@/modules/solicitudes-editor/utils/calculate-age";
import { sexoLegible } from "@/modules/solicitudes-editor/constants/legacy-options";
import { cn } from "@/shared/utils/cn";

import { formatLegacyDate } from "../utils/legacy-date-format";
import { formatMontoLista } from "../utils/lista-solicitudes-formato";
import { LinkFirmaDigital } from "./link-firma-digital";

// Detalle en modo lectura: los datos como texto, ordenados igual que Nueva
// solicitud (titular a la izquierda, prestamo y gestion a la derecha). Al
// editar se usan los formularios de siempre.

// Titulo de cada seccion del detalle (Titular, Prestamo, pestanas de Mas
// informacion): la letra y el marino de la marca.
export const TITULO_SECCION =
  "font-marca text-[1.0625rem] font-bold tracking-[-0.01em] text-marino";

type Valor = ReactNode | string | number | null | undefined;

function vacio(value: Valor) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

function Campo({
  className,
  label,
  value,
}: {
  className?: string;
  label: string;
  value: Valor;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-foreground-secondary">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-sm break-words",
          vacio(value) ? "text-foreground-muted" : "text-foreground",
        )}
      >
        {vacio(value) ? "Sin cargar" : value}
      </dd>
    </div>
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
        "rounded-lg border border-border bg-surface p-4",
        className,
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border-soft pb-2">
        <h2 className={TITULO_SECCION}>{title}</h2>
        {extra}
      </div>
      {children}
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
  ejecutivo,
  firmaLegajo,
  prestamoEditable,
  situacionSocio,
  solicitud,
  titularEditable,
}: {
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

  return (
    <div className="space-y-3">
      {/* Titular y Prestamo, del mismo alto. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Tarjeta extra={situacionSocio} title="Titular">
          {titularEditable ?? (
            <dl className={COLUMNAS_TITULAR}>
              <Campo label="Nombre" value={titular.nombre} />
              <Campo label="Apellido" value={titular.apellidoDenominacion} />
              <Campo
                label={titular.tipoDocumento?.trim() || "Documento"}
                value={titular.nroDocumento}
              />
              <Campo label="CUIT" value={titular.cuit} />

              <Campo
                label="Nacimiento"
                value={
                  nacimiento && nacimiento !== "-"
                    ? `${nacimiento}${edad ? ` (${edad} años)` : ""}`
                    : null
                }
              />
              <Campo label="Sexo" value={sexoLegible(titular.sexo)} />
              <Campo label="Estado civil" value={titular.estadoCivil} />
              <Campo label="Nacionalidad" value={titular.nacionalidad} />

              <Campo label="Celular" value={titular.celular} />
              <Campo label="Teléfono fijo" value={titular.telefonoFijo} />
              <Campo
                className="lg:col-span-2"
                label="Email"
                value={titular.email}
              />

              <Campo
                className="lg:col-span-2"
                label="Calle y número"
                value={domicilio}
              />
              <Campo label="Localidad" value={titular.localidad} />
              <Campo
                label="Persona expuesta políticamente"
                value={siNo(titular.personaExpuestaPoliticamente)}
              />

              <Campo label="Empleador" value={laborales.empleador} />
              <Campo
                label="Ingreso laboral"
                value={
                  laborales.fechaIngresoLaboral
                    ? formatLegacyDate(laborales.fechaIngresoLaboral)
                    : null
                }
              />
              <Campo
                className="lg:col-span-2"
                label="Monto del recibo"
                value={pesos(laborales.montoRecibo)}
              />

              <Campo
                className="lg:col-span-2"
                label="CBU"
                value={titular.cbu}
              />
              <Campo
                className="lg:col-span-2"
                label="CBU cuenta no habitual"
                value={titular.cbuNoHabitual}
              />
            </dl>
          )}
        </Tarjeta>

        <Tarjeta title="Préstamo">
          {prestamoEditable ?? (
            <>
              <dl className={DOS_COLUMNAS}>
                <Campo
                  className="col-span-2"
                  label="Línea"
                  value={solicitud.lineaPrestamoDescripcion}
                />
                <Campo
                  label="Monto a financiar"
                  value={pesos(solicitud.montoAFinanciar)}
                />
                <Campo label="Cuotas" value={solicitud.cuotas} />
                <Campo
                  label="Cuota por mes"
                  value={
                    cuota ? (
                      <span className="font-semibold text-verde">{cuota}</span>
                    ) : null
                  }
                />
                <Campo
                  label="Cupo del titular"
                  value={pesos(solicitud.cupoTitular)}
                />
                <Campo
                  label="Firma digital"
                  value={siNo(solicitud.firmaDigitalmente)}
                />
                <Campo
                  label="Primer vencimiento"
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
                {solicitud.nroOperacion ? (
                  <Campo
                    label="Nro. de operación"
                    value={solicitud.nroOperacion}
                  />
                ) : null}
                {solicitud.motivo ? (
                  <Campo label="Motivo" value={solicitud.motivo} />
                ) : null}
                {solicitud.linkFirmaDigital ? (
                  <Campo
                    className="col-span-2"
                    label="Link de firma digital"
                    value={
                      <LinkFirmaDigital
                        conWhatsapp={false}
                        url={solicitud.linkFirmaDigital}
                      />
                    }
                  />
                ) : null}
                <Campo
                  className="col-span-2"
                  label="Observaciones"
                  value={solicitud.observaciones}
                />
              </dl>
            </>
          )}
        </Tarjeta>
      </div>
      {firmaLegajo}
    </div>
  );
}
