BEGIN;

CREATE TABLE "user_workflow_owners" (
  "user_id" UUID NOT NULL REFERENCES "users"("usr_id") ON DELETE CASCADE ON UPDATE CASCADE,
  "workflow_owner_id" UUID NOT NULL REFERENCES "workflow_owners"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("user_id", "workflow_owner_id")
);
CREATE INDEX "user_workflow_owners_workflow_owner_id_user_id_idx"
  ON "user_workflow_owners" ("workflow_owner_id", "user_id");

-- Older application instances and the bootstrap seed write the singular column.
-- When that column changes, their operation replaces the previous assignment.
CREATE FUNCTION sync_user_workflow_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.workflow_owner_id IS NOT DISTINCT FROM NEW.workflow_owner_id THEN
    RETURN NEW;
  END IF;
  DELETE FROM user_workflow_owners
  WHERE user_id = NEW.usr_id AND workflow_owner_id IS DISTINCT FROM NEW.workflow_owner_id;
  IF NEW.workflow_owner_id IS NOT NULL THEN
    INSERT INTO user_workflow_owners (user_id, workflow_owner_id)
    VALUES (NEW.usr_id, NEW.workflow_owner_id)
    ON CONFLICT (user_id, workflow_owner_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sync_user_workflow_owner
  AFTER INSERT OR UPDATE OF workflow_owner_id ON users
  FOR EACH ROW EXECUTE FUNCTION sync_user_workflow_owner();

-- Assignment dates were not recorded for existing users.
INSERT INTO "user_workflow_owners" ("user_id", "workflow_owner_id", "assigned_at")
SELECT "usr_id", "workflow_owner_id", '1970-01-01 00:00:00+00'::timestamptz
FROM "users" WHERE "workflow_owner_id" IS NOT NULL;

COMMIT;
