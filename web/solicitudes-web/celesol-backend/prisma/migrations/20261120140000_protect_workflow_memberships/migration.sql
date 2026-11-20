BEGIN;

ALTER TABLE solicitudes ADD COLUMN pending_reassignment_area_id UUID;

CREATE OR REPLACE FUNCTION sync_user_workflow_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workflow_owner_id IS NOT DISTINCT FROM OLD.workflow_owner_id THEN
      RETURN NEW;
    END IF;
    IF (SELECT count(*) FROM user_workflow_owners WHERE user_id = NEW.usr_id) > 1 THEN
      -- The multi-area writer has already replaced the set before moving its representative.
      IF EXISTS (SELECT 1 FROM user_workflow_owners WHERE user_id = NEW.usr_id AND workflow_owner_id = NEW.workflow_owner_id)
         AND NOT EXISTS (SELECT 1 FROM user_workflow_owners WHERE user_id = NEW.usr_id AND workflow_owner_id = OLD.workflow_owner_id) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Esta cuenta tiene varias áreas. Editalas desde el formulario de Áreas.' USING ERRCODE = '23514';
    END IF;
  END IF;

  DELETE FROM user_workflow_owners
  WHERE user_id = NEW.usr_id AND workflow_owner_id IS DISTINCT FROM NEW.workflow_owner_id;
  IF NEW.workflow_owner_id IS NOT NULL THEN
    INSERT INTO user_workflow_owners (user_id, workflow_owner_id)
    VALUES (NEW.usr_id, NEW.workflow_owner_id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Capture the actual revocation. Administrators can legitimately assign across areas.
CREATE FUNCTION update_area_reassignment_cases() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE solicitudes s SET pending_reassignment_area_id = OLD.workflow_owner_id
    FROM workflow_states st
    WHERE s.assigned_to_user_id = OLD.user_id AND s.archived_at IS NULL
      AND st.id = s.estado_actual_id AND NOT st.is_terminal AND st.owner_id = OLD.workflow_owner_id;
  ELSE
    UPDATE solicitudes SET pending_reassignment_area_id = NULL
    WHERE assigned_to_user_id = NEW.user_id AND pending_reassignment_area_id = NEW.workflow_owner_id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER update_area_reassignment_cases AFTER INSERT OR DELETE ON user_workflow_owners
  FOR EACH ROW EXECUTE FUNCTION update_area_reassignment_cases();

CREATE FUNCTION clear_resolved_area_reassignment() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assigned_to_user_id IS DISTINCT FROM OLD.assigned_to_user_id OR NEW.archived_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM workflow_states WHERE id = NEW.estado_actual_id
                    AND NOT is_terminal AND owner_id = OLD.pending_reassignment_area_id) THEN
    NEW.pending_reassignment_area_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER clear_resolved_area_reassignment BEFORE UPDATE OF assigned_to_user_id, archived_at, estado_actual_id ON solicitudes
  FOR EACH ROW WHEN (OLD.pending_reassignment_area_id IS NOT NULL)
  EXECUTE FUNCTION clear_resolved_area_reassignment();

COMMIT;
