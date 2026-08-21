import type {
  DatosPersonalesTab,
  NuevaSolicitudTab,
  SolicitanteTab,
  TabItem,
} from "../types";

export const SOLICITANTE_TABS: TabItem<SolicitanteTab>[] = [
  { label: "Solicitante", value: "solicitante" },
  { label: "Adjuntos", value: "adjuntos" },
];

export const NUEVA_SOLICITUD_TABS: TabItem<NuevaSolicitudTab>[] = [
  { label: "Titular", value: "titular" },
  { label: "Garantías", value: "garantias" },
];

export const DATOS_PERSONALES_TABS: TabItem<DatosPersonalesTab>[] = [
  { label: "Datos Personales", value: "datosPersonales" },

  { label: "Cónyuge", value: "conyuge" },

  { label: "Económicos/Laborales", value: "economicosLaborales" },

  { label: "Adicionales", value: "adicionales" },
];
