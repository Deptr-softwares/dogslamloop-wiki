-- Completes the previous migration (20260803000000). Verified live against
-- production that the RLS policy alone wasn't enough: a truly anonymous
-- (not-logged-in) visitor connects as Postgres role "anon", not
-- "authenticated" - and "anon" had zero SELECT grant on this table at all
-- (only REFERENCES/TRIGGER/TRUNCATE), so PostgREST rejected the request
-- with 401 before RLS policies were even evaluated. The previous migration
-- fixed the row-level policy; this fixes the table-level grant it depends
-- on. Matches page_data's existing grant shape, which already includes
-- anon for exactly this "public read" reason.
GRANT SELECT ON TABLE "public"."pending_revisions" TO "anon";
