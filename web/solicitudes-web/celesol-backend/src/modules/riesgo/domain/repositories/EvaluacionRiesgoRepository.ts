import type { SolicitudCoreState } from "../../../solicitudes-core/domain/entities/SolicitudCore.entity";

export type EvaluacionRiesgoGuardada = {
  guardadaEn: Date;
  guardadaPor: { id: string; nombre: string } | null;
  /** Evaluacion!D30 de la planilla, de 1 a 5. Null si no dio un numero. */
  nivelRiesgo: number | null;
  storageBucket: string;
  storageKey: string;
};

export type GuardarEvaluacionRiesgoInput = {
  guardadaEn: Date;
  guardadaPorId: string;
  nivelRiesgo: number | null;
  storageBucket: string;
  storageKey: string;
};

export type EvaluacionRiesgoRepository = {
  /** Estado actual de la solicitud, para decidir quien puede guardar. */
  findEstadoActualDeSolicitud(
    solicitudId: string,
  ): Promise<SolicitudCoreState | null>;
  findBySolicitudId(solicitudId: string): Promise<EvaluacionRiesgoGuardada | null>;
  /** Crea o pisa la evaluacion de la solicitud: solo se guarda la ultima. */
  guardar(solicitudId: string, input: GuardarEvaluacionRiesgoInput): Promise<void>;
};
