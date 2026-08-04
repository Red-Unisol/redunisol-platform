import type {
  PaginatedSolicitudesListResponse,
  SolicitudesListColumnFilters,
  SolicitudesListFilterOptions,
  SolicitudesListQuery,
  SolicitudPrecargaItem,
  SolicitudRecienteItem,
} from "@/modules/solicitudes/types/solicitudes";
import type {
  SolicitudesTableFilters,
  SolicitudesTableRow,
} from "@/modules/solicitudes-shared/components/solicitudes-table";

export function buildSolicitudesListQuery(
  params: Omit<SolicitudesListQuery, "filters"> & {
    filters: SolicitudesTableFilters;
  },
): SolicitudesListQuery {
  return {
    ...params,
    filters: params.filters as SolicitudesListColumnFilters,
  };
}

export function mapSolicitudListItemToTableRow(
  item: SolicitudPrecargaItem | SolicitudRecienteItem,
): SolicitudesTableRow {
  return {
    cuotaResultante:
      item.cuotaResultante !== null ? String(item.cuotaResultante) : "",
    cuotas: item.cuotas !== null ? String(item.cuotas) : "",
    estado: item.estado ?? "",
    fecha: item.fecha ?? "",
    id: item.id,
    lineaPrestamo: item.lineaPrestamo ?? "",
    montoFinal:
      item.montoAFinanciar !== null
        ? new Intl.NumberFormat("es-AR", {
            maximumFractionDigits: 2,
            minimumFractionDigits: 2,
            useGrouping: false,
          }).format(item.montoAFinanciar)
        : "",
    nombreCompleto: item.nombreCompleto ?? "",
    nroDocumento: item.nroDocumento ?? "",
    nroSolicitud: item.nroSolicitud ?? "",
    oid: item.oid ?? "",
    ultimaNovedad: item.ultimaNovedad ?? "",
    vendedorSolicitud: item.vendedorSolicitud ?? "",
  };
}

export function normalizeSolicitudesFilterOptions(
  filterOptions: SolicitudesListFilterOptions | undefined,
) {
  return filterOptions ?? {};
}

type SolicitudesListItem = SolicitudPrecargaItem | SolicitudRecienteItem;

export function normalizeSolicitudesListResponse(
  response:
    | PaginatedSolicitudesListResponse<SolicitudesListItem>
    | SolicitudesListItem[]
    | undefined,
) {
  if (!response) {
    return {
      filterOptions: {} as SolicitudesListFilterOptions,
      items: [] as SolicitudesListItem[],
      page: 1,
      pageSize: 30,
      total: 0,
    };
  }

  if (Array.isArray(response)) {
    return {
      filterOptions: {} as SolicitudesListFilterOptions,
      items: response,
      page: 1,
      pageSize: response.length || 30,
      total: response.length,
    };
  }

  return response;
}
