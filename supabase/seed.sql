-- Fixtures for preview branches and local `supabase db reset`.
--
-- WHAT A PREVIEW BRANCH ALREADY HAS, and what it does not. It runs every
-- migration against an empty database, so it ends up holding exactly what the
-- migrations themselves insert - all 40 rows of the page registry from
-- 20260808000003, the hub copy from 20260809000001, the tier page settings
-- from 20260814000000. It is not a blank database.
--
-- What it does not have is CONTENT: everything the owner and contributors
-- wrote through the site, which lives only in production. No character has
-- frame data. No account exists at all.
--
-- That second gap is what this file closes. Every probe in
-- scripts/probe-release.js that needs USER_JWT or ADMIN_JWT has been skipped
-- since the day it was written - 40 of them - because a preview branch had
-- nobody to sign in as. RLS policies, table grants and RPC guards are exactly
-- what Playwright cannot reach and exactly what needs a real caller.
--
-- WHAT THIS CANNOT DO. Seeding runs AFTER migrations - config.toml says so at
-- [db.seed], and branch creation follows the same order - so a migration that
-- reads data at migration time still runs before any of this exists.
--
-- That is not hypothetical. 20260813000005 seeds the owner's tier list from a
-- page_data row for 'tierlist' carrying an 'overall' tab. No migration creates
-- that row; the owner authored it through the editor. So the DO block took its
-- `IF overall IS NULL THEN RETURN` path, and the `ORDER BY ur.created_at`
-- below it was never planned. It passed its own PR (#81) and passed the
-- release preview. Production had the row, took the other path, raised 42703,
-- and rolled back the five migrations behind it.
--
-- The fixture below adds that exact row, which makes the shape visible to
-- anyone reading this file - but adding it here would NOT have caught that
-- bug, because of the ordering above. The defence against that class is
-- static: tests/migration-columns.spec.js resolves column references against
-- the schema in supabase/migrations with no database at all, and it is in the
-- required `test` check.
--
-- SAFETY. This never runs against production: `supabase db push` does not
-- seed, and only branch creation and a local reset do. The guard below is a
-- second lock rather than the only one.

-- An empty auth.users is the honest signal for "fresh database". Page rows are
-- NOT - migrations insert those, so a preview branch has them from the first
-- second, and an earlier version of this guard keyed on them and refused to
-- run on every preview branch it was written for.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM auth.users LIMIT 1) THEN
        RAISE EXCEPTION
            'Refusing to seed: this database already has accounts, so it is not '
            'a fresh preview branch. Seeding here would create a fixture '
            'administrator alongside real users.';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- ACCOUNTS
-- ---------------------------------------------------------------------------
--
-- Two, because the interesting authorisation cases need three callers and the
-- third is anon, which needs no row:
--
--   admin@dogslamloop.test  -> user_roles.role = 'admin'
--   member@dogslamloop.test -> signed in, NO role at all
--
-- The second is deliberately roleless rather than 'viewer'. get_my_role()
-- returns NULL for it, which is the case that has broken this project twice:
-- `NULL <> 'admin'` is NULL, not true, so a guard written with <> instead of
-- IS DISTINCT FROM denies every ordinary user. A fixture that skips this shape
-- would not catch it.
--
-- Fixed UUIDs so probes can assert against them without a lookup round trip.
--
-- Wrapped with an exception handler because auth.users belongs to Supabase,
-- not to this repo, and its column set moves under us. `Supabase Preview` is a
-- required check on both branches now, so a hard failure here would block
-- every merge over a fixture. A shape change should cost the probes their
-- JWTs and nothing else.
DO $$
DECLARE
    admin_uid  uuid := '00000000-0000-4000-8000-00000000ad11';
    member_uid uuid := '00000000-0000-4000-8000-0000000000b0';
BEGIN
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) VALUES
    (
        '00000000-0000-0000-0000-000000000000', admin_uid,
        'authenticated', 'authenticated', 'admin@dogslamloop.test',
        extensions.crypt('seed-admin-password', extensions.gen_salt('bf')),
        now(), now() - interval '30 days', now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"display_name":"Seed Admin"}'::jsonb, false
    ),
    (
        '00000000-0000-0000-0000-000000000000', member_uid,
        'authenticated', 'authenticated', 'member@dogslamloop.test',
        extensions.crypt('seed-member-password', extensions.gen_salt('bf')),
        -- Older than the 7 days submit_tier_votes asks of a voter (v0.14). At
        -- 2 days the probe's "user may vote" leg was refused on every preview
        -- by a rule working correctly, while it passed on production, where
        -- the user token belongs to a real, older account (2026-10-01).
        now(), now() - interval '10 days', now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"display_name":"Seed Member"}'::jsonb, false
    );

    -- GoTrue resolves a password login through auth.identities, not through
    -- auth.users alone. Without these two rows both accounts exist and neither
    -- can sign in, which is the failure mode that looks like a wrong password.
    INSERT INTO auth.identities (
        provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
    ) VALUES
    (
        admin_uid::text, admin_uid,
        jsonb_build_object('sub', admin_uid::text, 'email', 'admin@dogslamloop.test',
                           'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now()
    ),
    (
        member_uid::text, member_uid,
        jsonb_build_object('sub', member_uid::text, 'email', 'member@dogslamloop.test',
                           'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now()
    );

    -- One role, one row. UNIQUE(user_id) enforces it; multi-role previously
    -- broke get_my_role() with "more than one row returned by a subquery" and
    -- took that user's access down everywhere.
    INSERT INTO public.user_roles (user_id, role) VALUES (admin_uid, 'admin');

    RAISE NOTICE 'Seeded admin@dogslamloop.test and member@dogslamloop.test.';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Account fixtures skipped: % (%). Probes needing a JWT will '
                  'have nothing to sign in with; the page fixtures below are '
                  'unaffected.', SQLERRM, SQLSTATE;
END $$;

-- ---------------------------------------------------------------------------
-- TWO MORE ACCOUNTS, for the upload permission (v0.20 batch 3)
-- ---------------------------------------------------------------------------
--
--   trusted@dogslamloop.test -> 'trusted_editor', no flags: can_upload_media()
--                               must be TRUE from the role alone
--   banned@dogslamloop.test  -> 'viewer' WITH can_upload_media ticked: must be
--                               FALSE, because a ban wins over a perk
--
-- Passwords follow the pattern above: seed-trusted-password and
-- seed-banned-password.
--
-- Their own block and their own handler, so a failure here costs these two
-- and never the admin and member that every other probe needs.
DO $$
DECLARE
    trusted_uid uuid := '00000000-0000-4000-8000-0000000000e1';
    banned_uid  uuid := '00000000-0000-4000-8000-0000000000f1';
BEGIN
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) VALUES
    (
        '00000000-0000-0000-0000-000000000000', trusted_uid,
        'authenticated', 'authenticated', 'trusted@dogslamloop.test',
        extensions.crypt('seed-trusted-password', extensions.gen_salt('bf')),
        now(), now() - interval '10 days', now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"display_name":"Seed Trusted"}'::jsonb, false
    ),
    (
        '00000000-0000-0000-0000-000000000000', banned_uid,
        'authenticated', 'authenticated', 'banned@dogslamloop.test',
        extensions.crypt('seed-banned-password', extensions.gen_salt('bf')),
        now(), now() - interval '5 days', now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"display_name":"Seed Banned"}'::jsonb, false
    );

    INSERT INTO auth.identities (
        provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
    ) VALUES
    (
        trusted_uid::text, trusted_uid,
        jsonb_build_object('sub', trusted_uid::text, 'email', 'trusted@dogslamloop.test',
                           'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now()
    ),
    (
        banned_uid::text, banned_uid,
        jsonb_build_object('sub', banned_uid::text, 'email', 'banned@dogslamloop.test',
                           'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now()
    );

    INSERT INTO public.user_roles (user_id, role) VALUES (trusted_uid, 'trusted_editor');
    INSERT INTO public.user_roles (user_id, role, can_upload_media) VALUES (banned_uid, 'viewer', true);

    RAISE NOTICE 'Seeded trusted@dogslamloop.test and banned@dogslamloop.test.';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Upload-permission fixtures skipped: % (%).', SQLERRM, SQLSTATE;
END $$;

-- ---------------------------------------------------------------------------
-- AN OWNER, for the owner tools (2026-10-01)
-- ---------------------------------------------------------------------------
--
--   owner@dogslamloop.test -> 'owner', password seed-owner-password
--
-- probe-release.js's ADMIN_JWT has meant "the OWNER's token" since the v0.17
-- owner/admin split, and no fixture held the role. So every preview run
-- reported the owner tools (list_personnel, assign_role_by_email and seven
-- more) as failures, which were admin@ being refused correctly. v0.20's release
-- preview needed the admin promoted by hand to tell the two apart. admin@ stays
-- 'admin', so the refusal itself is still there to probe.
--
-- Its own block, like the two above it.
DO $$
DECLARE
    owner_uid uuid := '00000000-0000-4000-8000-0000000000c1';
BEGIN
    INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) VALUES (
        '00000000-0000-0000-0000-000000000000', owner_uid,
        'authenticated', 'authenticated', 'owner@dogslamloop.test',
        extensions.crypt('seed-owner-password', extensions.gen_salt('bf')),
        now(), now() - interval '30 days', now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"display_name":"Seed Owner"}'::jsonb, false
    );

    INSERT INTO auth.identities (
        provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
    ) VALUES (
        owner_uid::text, owner_uid,
        jsonb_build_object('sub', owner_uid::text, 'email', 'owner@dogslamloop.test',
                           'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now()
    );

    INSERT INTO public.user_roles (user_id, role) VALUES (owner_uid, 'owner');

    RAISE NOTICE 'Seeded owner@dogslamloop.test.';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Owner fixture skipped: % (%).', SQLERRM, SQLSTATE;
END $$;

-- ---------------------------------------------------------------------------
-- SIGN-IN: no NULL token columns
-- ---------------------------------------------------------------------------
--
-- GoTrue reads these four columns as strings and fails the whole sign-in on a
-- NULL, answering 500 "Database error querying schema". A row it creates itself
-- gets '' in each; a row inserted by hand, like the ones above, gets NULL. So
-- until 2026-09-28 no fixture account could sign in at all, and every probe
-- that needed a JWT had nothing to sign in with. That is how is_owner()
-- answering NULL for a roleless account (20260927000000) went unseen: the one
-- probe that would have shown it could never run.
--
-- After every account block, so it covers each of them; its own handler, so a
-- change to auth.users costs the sign-ins and nothing else.
DO $$
BEGIN
    UPDATE auth.users
    SET confirmation_token     = COALESCE(confirmation_token, ''),
        recovery_token         = COALESCE(recovery_token, ''),
        email_change           = COALESCE(email_change, ''),
        email_change_token_new = COALESCE(email_change_token_new, '')
    WHERE email LIKE '%@dogslamloop.test';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Fixture token columns not filled: % (%). Fixture sign-ins may fail.', SQLERRM, SQLSTATE;
END $$;

-- ---------------------------------------------------------------------------
-- CONTENT
-- ---------------------------------------------------------------------------
--
-- Only what no migration provides. site_pages is deliberately untouched:
-- 20260808000003 seeds the whole registry, which is a better fixture than any
-- subset written here, and it already includes the three rows worth caring
-- about - the legacy nav_ids whose identifier no longer resembles the name:
--
--     nav_id       name              page_id
--     Locust    -> Locust Guy        locust_guy
--     Mangaka   -> Aspiring Mangaka  aspiring_mangaka
--     Sus-Sister-> Crow Charmer      crow_charmer
--
-- Anything joining nav_id to page_id on a normalised string resolves those
-- three through its fallback rather than the easy path, so the tier fixture
-- below stores nav_ids in its `characters` arrays. That mismatch IS the
-- fallback's reason to exist.
--
-- ON CONFLICT DO NOTHING throughout: a later migration may start seeding one
-- of these, and this file should go quiet when that happens rather than break
-- every preview branch on a duplicate key.

-- The Overall tab in the shape 20260813000005 reads. Inert now - that
-- migration has recorded itself and will not run again - but the next data
-- migration to read page_data will find it, and a reviewer can see what the
-- shape actually is instead of reconstructing it from a DO block.
INSERT INTO public.page_data (page_id, page_type, desc_data)
VALUES (
    'tierlist', 'tierlist',
    jsonb_build_object('tabs', jsonb_build_array(
        jsonb_build_object(
            'id', 'overall',
            'name', 'Overall',
            'tiers', jsonb_build_array(
                jsonb_build_object('name', 'S', 'color', 'hsl(0, 70%, 55%)',
                                   'characters', jsonb_build_array('Ten-Shadows', 'Register')),
                jsonb_build_object('name', 'A', 'color', 'hsl(30, 70%, 55%)',
                                   'characters', jsonb_build_array('Locust', 'Mangaka')),
                jsonb_build_object('name', 'B', 'color', 'hsl(60, 70%, 55%)',
                                   'characters', jsonb_build_array('Sus-Sister'))
            )
        )
    ))
)
ON CONFLICT (page_id) DO NOTHING;

-- One character page with frame data, so anything reading frame_data meets the
-- real column shape rather than an empty set. The numbers are invented and say
-- nothing about the character - startup/active/recovery and the two advantage
-- figures are here to be parsed, not to be believed.
INSERT INTO public.page_data (page_id, page_type, desc_data, frame_data)
VALUES (
    'ten_shadows', 'character',
    jsonb_build_object('profile', jsonb_build_object('image', ''), 'tabs', jsonb_build_array()),
    jsonb_build_object('moves', jsonb_build_array(
        jsonb_build_object('name', 'M1', 'startup', 8, 'active', 3, 'recovery', 14,
                           'onBlock', -4, 'onHit', 2)
    ))
)
ON CONFLICT (page_id) DO NOTHING;
