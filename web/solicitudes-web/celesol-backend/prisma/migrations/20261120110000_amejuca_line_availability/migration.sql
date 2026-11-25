BEGIN;

CREATE TYPE "amejuca_variant" AS ENUM ('CELESOL', 'RED_UNISOL');

CREATE TABLE "amejuca_line_availability" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
  "variant" "amejuca_variant" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_by" UUID
);

INSERT INTO "amejuca_line_availability" ("id", "variant") VALUES (1, 'CELESOL');

COMMIT;
