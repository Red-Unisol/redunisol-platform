import type { CreateSolicitudInput } from "../dtos/CreateSolicitud.dto";
import {
  LegacyLineaPrestamoUnavailableError,
  MissingAuthenticatedLegacyUserError,
  MissingAuthenticatedSellerNameError,
  WorkflowInitialStateNotConfiguredError,
} from "../../domain/solicitudes-core-errors";
import type { SolicitudesCoreRepository } from "../../domain/repositories/SolicitudesCoreRepository";
import type { LineasPrestamoCatalog } from "../../domain/services/LineasPrestamoCatalog";
import type { WorkflowStateCatalog } from "../../domain/services/WorkflowStateCatalog";
import type { SimularCuotaSolicitud } from "../services/SimularCuotaSolicitud";

type Dependencies = {
  lineasPrestamoCatalog: LineasPrestamoCatalog;
  repository: SolicitudesCoreRepository;
  simularCuotaSolicitud: Pick<SimularCuotaSolicitud, "execute">;
  workflowStateCatalog: WorkflowStateCatalog;
};

export class CreateSolicitudUseCase {
  private readonly lineasPrestamoCatalog: LineasPrestamoCatalog;
  private readonly repository: SolicitudesCoreRepository;
  private readonly simularCuotaSolicitud: Pick<SimularCuotaSolicitud, "execute">;
  private readonly workflowStateCatalog: WorkflowStateCatalog;

  constructor(dependencies: Dependencies) {
    this.lineasPrestamoCatalog = dependencies.lineasPrestamoCatalog;
    this.repository = dependencies.repository;
    this.simularCuotaSolicitud = dependencies.simularCuotaSolicitud;
    this.workflowStateCatalog = dependencies.workflowStateCatalog;
  }

  async execute(input: CreateSolicitudInput) {
    const createdByLegacyUser = input.createdByLegacyUser.trim();
    const authenticatedSellerName = formatAuthenticatedSellerName(
      input.authenticatedSellerName,
    );

    if (!createdByLegacyUser) {
      throw new MissingAuthenticatedLegacyUserError();
    }

    if (!authenticatedSellerName) {
      throw new MissingAuthenticatedSellerNameError();
    }

    const lineaPrestamo = await this.lineasPrestamoCatalog.findByLegacyUserAndOid(
      createdByLegacyUser,
      input.lineaPrestamoLegacyOid,
    );

    if (!lineaPrestamo || !lineaPrestamo.vigente) {
      throw new LegacyLineaPrestamoUnavailableError();
    }

    const initialState = await this.workflowStateCatalog.getInitialState();

    if (!initialState) {
      throw new WorkflowInitialStateNotConfiguredError();
    }

    // La cuota y la fecha del primer vencimiento las calcula el legado, igual
    // que hace Vimarx al guardar. Si no se pueden obtener se guarda lo que
    // haya mandado el formulario (que puede venir del simulador) o null.
    const simulacion = await this.simularCuotaSolicitud.execute({
      cuotas: input.cuotas ?? null,
      fechaPrimerVencimiento: input.fechaPrimerVencimiento ?? null,
      lineaPrestamoLegacyOid: lineaPrestamo.legacyOid,
      montoAFinanciar: input.montoAFinanciar ?? null,
    });

    return this.repository.create({
      createdBy: input.createdBy,
      conyuge: input.conyuge
        ? {
            actividad: input.conyuge.actividad ?? null,
            apellido: input.conyuge.apellido ?? null,
            fechaNacimiento: input.conyuge.fechaNacimiento ?? null,
            ingresosMensuales: input.conyuge.ingresosMensuales ?? null,
            nacionalidad: input.conyuge.nacionalidad ?? null,
            nombre: input.conyuge.nombre ?? null,
            nroDocumento: input.conyuge.nroDocumento ?? null,
            sexo: input.conyuge.sexo ?? null,
            tipoDocumento: input.conyuge.tipoDocumento ?? null,
          }
        : null,
      cupoTitular: input.cupoTitular ?? null,
      garantias: (input.garantias ?? []).map((garantia) => ({
        antiguedadLaboralMeses: garantia.antiguedadLaboralMeses ?? null,
        casadoConTitular: garantia.casadoConTitular ?? null,
        celular: garantia.celular ?? null,
        cuit: garantia.cuit ?? null,
        denominacion: garantia.denominacion ?? null,
        domicilio: garantia.domicilio ?? null,
        edad: garantia.edad ?? null,
        email: garantia.email ?? null,
        estadoCivil: garantia.estadoCivil ?? null,
        fechaIngresoLaboral: garantia.fechaIngresoLaboral ?? null,
        fechaNacimiento: garantia.fechaNacimiento ?? null,
        ingresoMensual: garantia.ingresoMensual ?? null,
        nacionalidad: garantia.nacionalidad ?? null,
        nombre: garantia.nombre ?? null,
        nombreCompleto: garantia.nombreCompleto ?? null,
        nroDocumento: garantia.nroDocumento ?? null,
        nroSocio: garantia.nroSocio ?? null,
        observaciones: garantia.observaciones ?? null,
        ocupacion: garantia.ocupacion ?? null,
        persona: garantia.persona ?? null,
        sexo: garantia.sexo ?? null,
        sumaIngresos: garantia.sumaIngresos ?? false,
        telefono: garantia.telefono ?? null,
        tipoDocumento: garantia.tipoDocumento ?? null,
        tipoGarantia: garantia.tipoGarantia ?? null,
        tipoRelacion: garantia.tipoRelacion ?? null,
      })),
      cuotaResultante:
        simulacion?.cuotaResultante ?? input.cuotaResultante ?? null,
      cuotas: input.cuotas ?? null,
      fechaPrimerVencimiento:
        simulacion?.fechaPrimerVencimiento ??
        input.fechaPrimerVencimiento ??
        null,
      datosLaborales: {
        actividadLaboral: input.datosLaborales.actividadLaboral ?? null,
        antiguedadLaboralMeses:
          input.datosLaborales.antiguedadLaboralMeses ?? null,
        descuentosSueldo: input.datosLaborales.descuentosSueldo ?? null,
        domicilioLaboralCalle:
          input.datosLaborales.domicilioLaboralCalle ?? null,
        domicilioLaboralLocalidad:
          input.datosLaborales.domicilioLaboralLocalidad ?? null,
        domicilioLaboralNroPuerta:
          input.datosLaborales.domicilioLaboralNroPuerta ?? null,
        domicilioLaboralPisoDepto:
          input.datosLaborales.domicilioLaboralPisoDepto ?? null,
        empleador: input.datosLaborales.empleador ?? null,
        fechaIngresoLaboral: input.datosLaborales.fechaIngresoLaboral ?? null,
        montoRecibo: input.datosLaborales.montoRecibo ?? null,
        relacionLaboral: input.datosLaborales.relacionLaboral ?? null,
        tarjetas: input.datosLaborales.tarjetas ?? null,
        vehiculo: input.datosLaborales.vehiculo ?? null,
        vivienda: input.datosLaborales.vivienda ?? null,
      },
      ejecutivoSolicitud: input.ejecutivoSolicitud ?? null,
      linkFirmaDigital: input.linkFirmaDigital ?? null,
      estadoActual: initialState,
      firmaDigitalmente: input.firmaDigitalmente ?? false,
      lineaPrestamoDescripcion: lineaPrestamo.descripcion,
      lineaPrestamoLegacyOid: lineaPrestamo.legacyOid,
      montoAFinanciar: input.montoAFinanciar ?? null,
      motivo: input.motivo ?? null,
      nroOperacion: input.nroOperacion ?? null,
      observaciones: input.observaciones ?? null,
      titular: {
        apellidoDenominacion: input.titular.apellidoDenominacion,
        cbu: input.titular.cbu ?? null,
        celular: input.titular.celular ?? null,
        cuit: input.titular.cuit ?? null,
        domicilioCalle: input.titular.domicilioCalle ?? null,
        email: input.titular.email ?? null,
        estadoCivil: input.titular.estadoCivil ?? null,
        fechaNacimiento: input.titular.fechaNacimiento ?? null,
        localidad: input.titular.localidad ?? null,
        nacionalidad: input.titular.nacionalidad ?? null,
        nombre: input.titular.nombre,
        nroDocumento: input.titular.nroDocumento,
        nroPuerta: input.titular.nroPuerta ?? null,
        nroSocio: input.titular.nroSocio ?? null,
        personaExpuestaPoliticamente:
          input.titular.personaExpuestaPoliticamente ?? null,
        sexo: input.titular.sexo ?? null,
        telefonoFijo: input.titular.telefonoFijo ?? null,
        tipoDocumento: input.titular.tipoDocumento,
      },
      vendedorSolicitud: authenticatedSellerName,
    });
  }
}

function formatAuthenticatedSellerName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const normalizedWord = word.toLowerCase();

      return (
        normalizedWord.charAt(0).toUpperCase() + normalizedWord.slice(1)
      );
    })
    .join(" ");
}
