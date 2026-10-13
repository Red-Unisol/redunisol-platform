CREATE TABLE "ReconocimientoRecibosConfiguracion" (
    "id" TEXT NOT NULL PRIMARY KEY CHECK ("id" = 'global'),
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "ReconocimientoRecibosConfiguracion" ("id") VALUES ('global') ON CONFLICT ("id") DO NOTHING;
