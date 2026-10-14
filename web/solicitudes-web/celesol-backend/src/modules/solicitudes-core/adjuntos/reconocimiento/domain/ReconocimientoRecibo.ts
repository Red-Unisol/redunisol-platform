export type CodigoErrorReconocimiento =
  | "limite_proveedor"
  | "autenticacion_proveedor"
  | "timeout_proveedor"
  | "modelo_no_disponible"
  | "respuesta_invalida"
  | "conexion_proveedor"
  | "servicio_proveedor";
export type ConfiguracionReconocimiento = {
  habilitado: boolean;
  version: number;
};
export type ResultadoReconocimiento = {
  resultado:
    | "recibo"
    | "no_recibo"
    | "indeterminado"
    | "error"
    | "deshabilitado";
  version: number;
  codigoError?: CodigoErrorReconocimiento;
  motivo?: "credencial" | "proveedor" | "formato" | "procesamiento";
};
export type ArchivoReconocimiento = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  size: number;
};
export interface ConfiguracionReconocimientoRepository {
  get(): Promise<ConfiguracionReconocimiento>;
  update(habilitado: boolean): Promise<ConfiguracionReconocimiento>;
}
export interface ReconocimientoReciboGateway {
  reconocer(
    file: ArchivoReconocimiento,
    signal?: AbortSignal,
  ): Promise<Omit<ResultadoReconocimiento, "version">>;
}
