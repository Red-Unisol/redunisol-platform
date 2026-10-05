import type {
  InformeCredixsaGuardado,
  SolicitudCredixsaInformeRepository,
} from "../../domain/repositories/SolicitudCredixsaInformeRepository";
import type { SolicitudCredixsaInformesPrismaDatasource } from "../datasources/SolicitudCredixsaInformesPrismaDatasource";

export class SolicitudCredixsaInformeRepositoryImpl
  implements SolicitudCredixsaInformeRepository
{
  private readonly datasource: SolicitudCredixsaInformesPrismaDatasource;

  constructor(datasource: SolicitudCredixsaInformesPrismaDatasource) {
    this.datasource = datasource;
  }

  findBySolicitudId(solicitudId: string) {
    return this.datasource.findBySolicitudId(solicitudId);
  }

  guardar(solicitudId: string, informe: InformeCredixsaGuardado) {
    return this.datasource.guardar(solicitudId, informe);
  }
}
