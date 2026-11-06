CREATE TABLE "monthly_cutoffs" (
  "period" TEXT PRIMARY KEY, "cutoff_date" DATE NOT NULL, "note" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
  "actor_name" TEXT NOT NULL, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "monthly_cutoff_period" CHECK ("period" ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "monthly_cutoff_date_period" CHECK (to_char("cutoff_date", 'YYYY-MM') = "period"),
  CONSTRAINT "monthly_cutoff_version" CHECK ("version" > 0),
  CONSTRAINT "monthly_cutoff_note_length" CHECK (length("note") <= 1000)
);
CREATE TABLE "monthly_cutoff_changes" (
  "id" UUID PRIMARY KEY, "period" TEXT NOT NULL REFERENCES "monthly_cutoffs"("period") ON DELETE RESTRICT ON UPDATE CASCADE,
  "cutoff_date" DATE NOT NULL, "previous_date" DATE, "note" TEXT, "version" INTEGER NOT NULL,
  "actor_id" UUID NOT NULL REFERENCES "users"("usr_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "real_actor_id" UUID NOT NULL REFERENCES "users"("usr_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actor_name" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("period", "version")
);
CREATE FUNCTION beex_monthly_cutoff_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'BEEX_MONTHLY_CUTOFF_HISTORY_IMMUTABLE'; END;
$$;
CREATE TRIGGER monthly_cutoff_history_immutable BEFORE UPDATE OR DELETE ON "monthly_cutoff_changes"
FOR EACH ROW EXECUTE FUNCTION beex_monthly_cutoff_history_immutable();
