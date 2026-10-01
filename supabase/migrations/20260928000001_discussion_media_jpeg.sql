-- Discussion images accept JPEG as well as WebP.
--
-- 20260928000000 allowed WebP only, on the plan that the page re-encodes
-- every image as WebP before upload. Safari cannot: its canvas has never
-- encoded WebP, and toBlob('image/webp') silently hands back a PNG. Every
-- browser on iOS is Safari underneath, so on a WebP-only bucket no iPhone could
-- attach an image at all. The page now encodes WebP where the browser can and
-- JPEG where it cannot. Every browser encodes JPEG, with a working quality
-- setting, so the 1 MB limit holds either way.
--
-- A new migration rather than an edit: 20260928000000 has already been applied
-- on the batch 3 preview, which records it by version and will not run it again.

UPDATE "storage"."buckets"
SET "allowed_mime_types" = ARRAY['image/webp', 'image/jpeg']
WHERE "id" = 'discussion-media';

-- Body carried from 20260928000000; the only change is the extension in the
-- path rule, `\.(webp|jpg)$` where it was `\.webp$`.
CREATE OR REPLACE FUNCTION "public"."enforce_discussion_shape"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    caller_email text;
    caller_meta jsonb;
    parent_row record;
BEGIN
    NEW.author_id := auth.uid();

    IF NEW.author_id IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to post.' USING ERRCODE = '42501';
    END IF;

    SELECT email, raw_user_meta_data INTO caller_email, caller_meta
    FROM auth.users WHERE id = NEW.author_id;

    NEW.author_name := COALESCE(
        NULLIF(caller_meta->>'display_name', ''),
        NULLIF(caller_meta->>'full_name', ''),
        NULLIF(caller_meta->'custom_claims'->>'global_name', ''),
        NULLIF(caller_meta->>'user_name', ''),
        NULLIF(split_part(COALESCE(caller_email, ''), '@', 1), ''),
        'Unknown'
    );

    NEW.status := 'visible';
    NEW.removed_at := NULL;
    NEW.removed_by := NULL;

    NEW.images := COALESCE(NEW.images, '{}'::text[]);

    IF cardinality(NEW.images) > 0 THEN
        IF NOT "public"."can_upload_media"() THEN
            RAISE EXCEPTION 'Attaching images needs the upload media permission.'
                USING ERRCODE = '42501';
        END IF;

        IF EXISTS (
            SELECT 1 FROM unnest(NEW.images) AS img
            WHERE img IS NULL
               OR img !~ ('^' || NEW.author_id::text || '/[A-Za-z0-9_-]{1,64}\.(webp|jpg)$')
        ) THEN
            RAISE EXCEPTION 'An attached image must be one you uploaded to this thread''s storage.'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    IF btrim(NEW.body) = '' AND cardinality(NEW.images) = 0 THEN
        RAISE EXCEPTION 'A post needs words or an image.' USING ERRCODE = '22023';
    END IF;

    IF NEW.parent_id IS NOT NULL THEN
        SELECT id, page_id, parent_id INTO parent_row
        FROM public.page_discussions WHERE id = NEW.parent_id;

        IF parent_row.id IS NULL THEN
            RAISE EXCEPTION 'That post no longer exists.' USING ERRCODE = 'P0002';
        END IF;

        IF parent_row.parent_id IS NOT NULL THEN
            NEW.parent_id := parent_row.parent_id;
        END IF;

        NEW.page_id := parent_row.page_id;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."enforce_discussion_shape"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."enforce_discussion_shape"() FROM "authenticated";
