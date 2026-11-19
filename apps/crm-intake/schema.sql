-- Apply to the isolated intake database. Existing declarations and interpretations stay intact.
CREATE SCHEMA IF NOT EXISTS crm_intake;

CREATE TABLE IF NOT EXISTS crm_intake.form_revisions (
    id uuid PRIMARY KEY,
    channel text NOT NULL CHECK (channel IN ('web', 'whatsapp')),
    source_scope text NOT NULL,
    provider_form_id text NOT NULL,
    provider_revision text NOT NULL,
    definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
    fingerprint text NOT NULL CHECK (length(fingerprint) = 64),
    UNIQUE (channel, source_scope, provider_form_id, provider_revision)
);

CREATE TABLE IF NOT EXISTS crm_intake.submissions (
    id uuid PRIMARY KEY,
    channel text NOT NULL CHECK (channel IN ('web', 'whatsapp')),
    source_scope text NOT NULL,
    source_id text NOT NULL,
    form_version text NOT NULL,
    declared_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL,
    original_payload jsonb NOT NULL CHECK (jsonb_typeof(original_payload) = 'object'),
    fingerprint text NOT NULL CHECK (length(fingerprint) = 64),
    UNIQUE (channel, source_scope, source_id)
);

-- The earlier draft did not have the original body or an archived form revision.
-- Their absence on earlier rows is retained as unknown.
ALTER TABLE crm_intake.submissions
    ADD COLUMN IF NOT EXISTS original_body text,
    ADD COLUMN IF NOT EXISTS source_metadata jsonb NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS answers_path jsonb NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS form_revision_id uuid REFERENCES crm_intake.form_revisions(id);

CREATE TABLE IF NOT EXISTS crm_intake.interpretations (
    submission_id uuid NOT NULL REFERENCES crm_intake.submissions(id),
    normalizer_version text NOT NULL,
    interpreted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    PRIMARY KEY (submission_id, normalizer_version)
);

CREATE TABLE IF NOT EXISTS crm_intake.normalization_jobs (
    submission_id uuid NOT NULL REFERENCES crm_intake.submissions(id),
    normalizer_version text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retry', 'completed', 'blocked', 'failed')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at timestamptz NOT NULL,
    finished_at timestamptz,
    last_error text,
    PRIMARY KEY (submission_id, normalizer_version)
);

CREATE INDEX IF NOT EXISTS normalization_jobs_ready
    ON crm_intake.normalization_jobs (normalizer_version, available_at, submission_id)
    WHERE status IN ('pending', 'retry');

CREATE OR REPLACE FUNCTION crm_intake.require_new_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.original_body IS NULL OR NEW.form_revision_id IS NULL
       OR jsonb_typeof(NEW.source_metadata) <> 'object'
       OR jsonb_typeof(NEW.answers_path) <> 'array' THEN
        RAISE EXCEPTION 'new CRM intake evidence requires the original document and exact form revision'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER require_new_submission_snapshot
    BEFORE INSERT ON crm_intake.submissions
    FOR EACH ROW EXECUTE FUNCTION crm_intake.require_new_snapshot();

CREATE OR REPLACE FUNCTION crm_intake.reject_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'CRM intake evidence is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE TRIGGER submissions_append_only
    BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_intake.submissions
    FOR EACH STATEMENT EXECUTE FUNCTION crm_intake.reject_snapshot_mutation();

CREATE OR REPLACE TRIGGER forms_append_only
    BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_intake.form_revisions
    FOR EACH STATEMENT EXECUTE FUNCTION crm_intake.reject_snapshot_mutation();

CREATE OR REPLACE TRIGGER interpretations_append_only
    BEFORE UPDATE OR DELETE OR TRUNCATE ON crm_intake.interpretations
    FOR EACH STATEMENT EXECUTE FUNCTION crm_intake.reject_snapshot_mutation();
