import { useEffect, useState } from "react";
import type { UseFormReset } from "react-hook-form";
import type { NavigateFunction } from "react-router-dom";

import { getSolicitudDetailByOid } from "@/modules/solicitudes/services/solicitudes-api";
import type { LineaPrestamoPresolicitud } from "@/modules/solicitudes/types/solicitudes";
import { normalizeSolicitudNumber } from "@/modules/solicitudes/utils/solicitud-detail-navigation";

import { NUEVA_SOLICITUD_DEFAULT_VALUES } from "../constants/solicitud-default-values";
import type { NuevaSolicitudFormValues } from "../types";
import { legacyValueToString } from "../utils/legacy-options";

export function useSolicitudDetailHydration({
  isDetailRoute,
  navigate,
  nroSolicitudParam,
  oid,
  reset,
  searchParams,
  setLineas,
}: {
  isDetailRoute: boolean;
  navigate: NavigateFunction;
  nroSolicitudParam: string;
  oid: string;
  reset: UseFormReset<NuevaSolicitudFormValues>;
  searchParams: URLSearchParams;
  setLineas: (lineas: LineaPrestamoPresolicitud[]) => void;
}) {
  const [isLoadingLegacyData, setIsLoadingLegacyData] = useState(false);
  const [legacyNotice, setLegacyNotice] = useState<string | null>(null);
  const [detalleNroSolicitud, setDetalleNroSolicitud] =
    useState(nroSolicitudParam);

  useEffect(() => {
    setDetalleNroSolicitud(nroSolicitudParam);
  }, [nroSolicitudParam]);

  useEffect(() => {
    if (!isDetailRoute) {
      setLegacyNotice(null);
      return;
    }
    if (!oid) {
      setLegacyNotice(
        "No se recibió OID de la solicitud para hidratar el detalle.",
      );
      return;
    }
    const resolvedOid = oid;

    let isMounted = true;

    async function hydrateLegacyData() {
      setIsLoadingLegacyData(true);
      setLegacyNotice(null);

      try {
        const detail = await getSolicitudDetailByOid(resolvedOid);

        if (!isMounted) {
          return;
        }

        const { conyuge, economicosLaborales, solicitud, titular } = detail;
        const lineaDescripcion = solicitud.lineaPrestamoDescripcion ?? "";
        const resolvedNroSolicitud = normalizeSolicitudNumber(
          solicitud.nroSolicitud,
        );

        if (resolvedNroSolicitud) {
          setDetalleNroSolicitud(resolvedNroSolicitud);

          if (nroSolicitudParam !== resolvedNroSolicitud) {
            const nextSearchParams = new URLSearchParams(searchParams);
            nextSearchParams.set("nroSolicitud", resolvedNroSolicitud);
            navigate("/solicitudes/detalle?" + nextSearchParams.toString(), {
              replace: true,
            });
          }
        }

        reset({
          ...NUEVA_SOLICITUD_DEFAULT_VALUES,
          actividadConyuge: conyuge.actividad ?? "",
          actividadLaboral: economicosLaborales.actividadLaboral ?? "",
          antiguedadLaboral: legacyValueToString(
            economicosLaborales.antiguedad,
          ),
          apellidoConyuge: conyuge.apellido ?? "",
          apellidoDenominacion: titular.apellido ?? "",
          cbu: titular.cbu ?? "",
          celular: titular.celular ?? "",
          cupoTitular: legacyValueToString(solicitud.cupoTitular),
          cuotaResultante: solicitud.cuotaResultante ?? "",
          cuotas: legacyValueToString(solicitud.cuotas),
          cuit: titular.cuit ?? "",
          descuentosSueldo: legacyValueToString(
            economicosLaborales.descuentosSueldo,
          ),
          documento: titular.tipoDocumento ?? "DNI",
          domicilioCalle: titular.domicilioCalle ?? "",
          domicilioLaboralCalle:
            economicosLaborales.domicilioLaboralCalle ?? "",
          ejecutivoSolicitud: solicitud.ejecutivoSolicitud ?? "",
          email: titular.email ?? "",
          estado: solicitud.estado ?? "",
          estadoCivil: titular.estadoCivil ?? "",
          fechaIngresoLaboral:
            economicosLaborales.fechaIngresoLaboral ??
            titular.fechaIngresoLaboral ??
            "",
          fechaNacimiento: titular.fechaDeNacimiento ?? "",
          fechaNacimientoConyuge: conyuge.fechaNacimiento ?? "",
          fechaPrimerVencimiento: solicitud.fechaPrimerVencimiento ?? "",
          firmaDigitalmente: solicitud.firmaDigitalmente === true,
          ingresosConyuge: legacyValueToString(conyuge.ingresosMensuales),
          linea: lineaDescripcion,
          localidad: titular.localidad ?? "",
          localidadLaboral: economicosLaborales.domicilioLaboralLocalidad ?? "",
          montoAFinanciar: legacyValueToString(solicitud.montoAFinanciar),
          montoRecibo: legacyValueToString(
            economicosLaborales.montoRecibo ?? titular.montoRecibo,
          ),
          motivo: solicitud.motivo ?? "",
          nacionalidad: titular.nacionalidad ?? "",
          nacionalidadConyuge: conyuge.nacionalidad ?? "",
          nombreConyuge: "",
          nroOperacion: solicitud.nroOperacion ?? "",
          noDocumento: titular.nroDocumento ?? "",
          noDocumentoConyuge: conyuge.nroDocumento ?? "",
          noInterno: solicitud.nroInterno ?? "",
          noPuerta: titular.nroPuerta ?? "",
          noPuertaLaboral: economicosLaborales.domicilioLaboralNroPuerta ?? "",
          noSocio: titular.nroSocio ?? "",
          noSolicitud: solicitud.nroSolicitud ?? "",
          nombre: titular.nombre ?? "",
          observacionesSolicitud:
            solicitud.observaciones ?? titular.observaciones ?? "",
          personaExpuestaPoliticamente:
            titular.pep === "true" || titular.pep === "1",
          pisoDeptoLaboral: economicosLaborales.pisoDepto ?? "",
          relacionLaboral: economicosLaborales.relacionLaboral ?? "",
          sexo: titular.sexo ?? "",
          sexoConyuge: conyuge.sexo ?? "",
          tarjetas: economicosLaborales.tarjetas ?? "",
          telefonoFijo: titular.telefono ?? "",
          tipoDocumentoConyuge: conyuge.tipoDocumento ?? "DNI",
          ultimaNovedad: solicitud.ultimaNovedad ?? "",
          vehiculo: economicosLaborales.vehiculo ?? "",
          vendedorSolicitud: solicitud.vendedorSolicitud ?? "",
          vivienda: economicosLaborales.vivienda ?? "",
        });

        if (lineaDescripcion) {
          setLineas([
            {
              cantidadMaximaCuotas: null,
              cantidadMinimaCuotas: null,
              descripcion: lineaDescripcion,
              montoMaximo: null,
              montoMinimo: null,
              oid: null,
              tasa: null,
              vigente: true,
            },
          ]);
        }
      } catch {
        if (!isMounted) {
          return;
        }

        setLegacyNotice(
          "No se pudieron cargar los datos legacy del detalle por OID.",
        );
      } finally {
        if (isMounted) {
          setIsLoadingLegacyData(false);
        }
      }
    }

    void hydrateLegacyData();

    return () => {
      isMounted = false;
    };
  }, [
    isDetailRoute,
    navigate,
    nroSolicitudParam,
    oid,
    reset,
    searchParams,
    setLineas,
  ]);

  return { detalleNroSolicitud, isLoadingLegacyData, legacyNotice };
}
