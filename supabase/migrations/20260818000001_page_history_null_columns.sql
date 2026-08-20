-- Fix: a page with no frame data could not be saved at all.
--
-- THE BUG
--
-- The owner reported that the About Us text on the Main Dashboard would not
-- save, with:
--
--   null value in column "frame_data" of relation "page_history"
--   violates not-null constraint
--
-- archive_page_version() is an UPDATE trigger on page_data that copies the OLD
-- row into page_history. The two tables disagree about nullability:
--
--   page_data.desc_data      jsonb NULL
--   page_data.frame_data     jsonb NULL
--   page_history.desc_data   jsonb NOT NULL
--   page_history.frame_data  jsonb NOT NULL
--
-- A dashboard has no frame data, so its frame_data is NULL. Updating its
-- desc_data fires the trigger, the INSERT violates NOT NULL, and the whole
-- UPDATE rolls back - so the save silently does nothing.
--
-- This is NOT specific to the owner tools. Any page whose row carries a NULL
-- in either column is unwritable by anything: the owner tools, an approved
-- revision, a regeneration job. Every dashboard, and any system, tool or
-- gallery page that never had frame data. Latent since 2026-08-02, and it only
-- bites the pages that skipped a column.
--
-- THE FIX
--
-- COALESCE at the point of copying, rather than dropping NOT NULL on
-- page_history. The history table's contract is worth keeping - every snapshot
-- has both documents - and '{}' is the honest value for a page that genuinely
-- has no frame data, where NULL would leave a reader of the history unable to
-- tell "empty" from "not recorded".
--
-- desc_data gets the same treatment. It is the same mismatch, and it fires on
-- the first save of any page created without one.
--
-- Behaviour-preserving for every page that already works: COALESCE only
-- changes rows where the INSERT would have raised.

CREATE OR REPLACE FUNCTION "public"."archive_page_version"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF (OLD.desc_data IS DISTINCT FROM NEW.desc_data OR OLD.frame_data IS DISTINCT FROM NEW.frame_data) THEN
        INSERT INTO public.page_history (page_id, desc_data, frame_data, updated_by_user)
        VALUES (
            OLD.page_id,
            COALESCE(OLD.desc_data, '{}'::jsonb),
            COALESCE(OLD.frame_data, '{}'::jsonb),
            COALESCE(NEW.last_editor_name, 'System Trigger')
        );
    END IF;
    RETURN NEW;
END;
$$;

-- No REVOKE/GRANT block: this is a TRIGGER function, not a callable RPC.
-- PostgREST cannot reach it, and it runs as the trigger owner regardless of
-- who performed the UPDATE - the row-level permission is enforced by the
-- policies on page_data, which this does not touch.
