-- Provision only in a dedicated database before enabling operational intake.
CREATE SCHEMA IF NOT EXISTS crm_intake;

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

CREATE TABLE IF NOT EXISTS crm_intake.interpretations (
    submission_id uuid NOT NULL REFERENCES crm_intake.submissions(id),
    normalizer_version text NOT NULL,
    interpreted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    PRIMARY KEY (submission_id, normalizer_version)
);
