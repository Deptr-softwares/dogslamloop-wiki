-- user_notifications has had SELECT/INSERT/DELETE policies since the initial
-- schema, but never an UPDATE one - so js/site_utils.js's markNotifRead
-- (.update({is_read: true})) was silently denied by RLS and nothing was ever
-- actually marked read. Invisible until v0.8 made the inbox modal reachable
-- at all; the optimistic UI update made it look like it had worked, and the
-- unread state came straight back on the next page load.
--
-- Same shape as the existing "Users read own notifications" / "Users delete
-- own notifications" policies: a user may only touch their own rows. WITH
-- CHECK additionally stops a row being reassigned to a different user_id.

CREATE POLICY "Users update own notifications" ON "public"."user_notifications"
    FOR UPDATE TO "authenticated"
    USING (("auth"."uid"() = "user_id"))
    WITH CHECK (("auth"."uid"() = "user_id"));
