import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { MinioAdjuntosObjectStorage } from "../solicitudes-core/adjuntos/infrastructure/services/MinioAdjuntosObjectStorage";
import { LegacyFinancialGateway } from "./LegacyFinancialGateway";
import { createTransferenciasRouter } from "./router";
import { TransferenciasService } from "./TransferenciasService";
import { createPayWorkflow } from "./workflow";

export function createTransferenciasIntegrationRouter() {
  return createTransferenciasRouter({
    config: {
      tokenSha256: env.TRANSFERENCIAS_API_TOKEN_SHA256,
      userId: env.TRANSFERENCIAS_API_USER_ID,
      clientId: env.TRANSFERENCIAS_API_CLIENT_ID,
    },
    maxFileBytes: env.ADJUNTOS_MAX_FILE_SIZE_BYTES,
    findUser: (id) =>
      prisma.user.findUnique({
        where: { id },
        include: { workflowOwner: true },
      }),
    service: new TransferenciasService({
      db: prisma,
      financials: new LegacyFinancialGateway({
        baseUrl: env.LEGACY_API_BASE_URL,
        timeoutMs: env.LEGACY_API_TIMEOUT_MS,
      }),
      storage: new MinioAdjuntosObjectStorage({
        accessKey: env.MINIO_ACCESS_KEY,
        secretKey: env.MINIO_SECRET_KEY,
        endPoint: env.MINIO_ENDPOINT,
        port: env.MINIO_PORT,
        useSSL: env.MINIO_USE_SSL,
      }),
      bucket: env.MINIO_BUCKET_SOLICITUDES,
      pay: createPayWorkflow(prisma),
    }),
  });
}
