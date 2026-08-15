-- Fixtures for preview branches and local `supabase db reset`.
--
-- WHAT THIS IS FOR. A Supabase preview branch copies production's SCHEMA and
-- none of its DATA. That makes it useless for the one kind of verification
-- Playwright cannot do at all: RLS policies, table grants and RPC guards, all
-- of which need real rows and a real signed-in caller to say anything. Every
-- probe in scripts/probe-release.js that needs USER_JWT or ADMIN_JWT has been
-- skipped since it was written, for exactly this reason - 40 of them.
--
-- After this file, a preview branch has two accounts with known passwords, an
-- admin among them, and enough page rows to be worth querying. The probe
-- script can sign in against the branch and run its whole matrix.
--
-- WHAT THIS IS NOT FOR, AND CANNOT BE. Seeding runs AFTER migrations, not
-- before - config.toml says so at [db.seed], and branch creation follows the
-- same order. So a migration that reads data at migration time still sees an
-- empty database on a preview branch, and this file cannot change that.
--
-- That is not a hypothetical. 20260813000005 seeds the owner's tier list from
-- page_data inside a DO block that begins:
--
--     IF overall IS NULL THEN RAISE NOTICE '...'; RETURN; END IF;
--
-- On a preview branch page_data is empty, so it returned early, and the
-- `ORDER BY ur.created_at` five lines below was never planned. It passed its
-- own PR (#81) and passed the release preview. Production had the row, took
-- the other branch, and raised 42703 - which rolled back and took the five
-- migrations after it down with it.
--
-- The defence against THAT is static: tests/migration-columns.spec.js reads
-- the schema out of supabase/migrations and checks column references without a
-- database at all. It is in the required `test` check. Use it, not this file.
--
-- SAFETY. This never runs against production - `supabase db push` does not
-- seed, and only branch creation and a local reset do. The guard below is a
-- second lock rather than the only one: it refuses to touch a database that
-- already has page rows, so pointing a reset at something real fails loudly
-- instead of inventing an administrator on it.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.page_data LIMIT 1)
    OR EXISTS (SELECT 1 FROM public.site_pages LIMIT 1) THEN
        RAISE EXCEPTION
            'Refusing to seed: this database already has page rows, so it is '
            'not an empty preview branch. Seeding here would create a fixture '
            'administrator on real data.';
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
-- not to this repo, and its column set moves under us. A shape change here
-- should cost the probes their JWTs and nothing else - the seed still needs to
-- finish so the page fixtures below land. `Supabase Preview` is a required
-- check on both branches now, so a hard failure in this block would block
-- every merge over a fixture.
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
        now(), now() - interval '2 days', now(),
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

    -- One role, one row. UNIQUE(user_id) enforces it; multi-role broke
    -- get_my_role() with "more than one row returned by a subquery" and took
    -- that user's access down everywhere.
    INSERT INTO public.user_roles (user_id, role) VALUES (admin_uid, 'admin');

    RAISE NOTICE 'Seeded admin@dogslamloop.test and member@dogslamloop.test.';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Account fixtures skipped: % (%). Probes needing a JWT will '
                  'have nothing to sign in with; the page fixtures below are '
                  'unaffected.', SQLERRM, SQLSTATE;
END $$;

-- ---------------------------------------------------------------------------
-- PAGES
-- ---------------------------------------------------------------------------
--
-- Enough of the registry to query, chosen rather than sampled.
--
-- Three of these rows carry a LEGACY nav_id - an identifier kept from an
-- earlier naming pass that no longer resembles what the character is called
-- now:
--
--     nav_id       name              page_id
--     Locust    -> Locust Guy        locust_guy
--     Mangaka   -> Aspiring Mangaka  aspiring_mangaka
--     Sus-Sister-> Crow Charmer      crow_charmer
--
-- They are here on purpose. Anything joining nav_id to page_id on a
-- normalised string resolves those three through the fallback rather than the
-- easy path, and a fixture made only of Ten-Shadows-shaped rows - where all
-- three identifiers agree once punctuation is stripped - would let that
-- fallback rot unnoticed.
--
-- The tier fixture below stores nav_ids in its `characters` arrays, because
-- that is what the old Overall tab stored. That mismatch IS the fallback's
-- reason to exist.
INSERT INTO public.site_pages
    (page_id, nav_id, name, url, category, sort_order, page_type, edit_role)
VALUES
    ('ten_shadows',      'Ten-Shadows',  'Ten Shadows',      'characters/Ten_shadows/index.html',      'Characters',   1, 'character', 'open'),
    ('locust_guy',       'Locust',       'Locust Guy',       'characters/Locust_guy/index.html',       'Characters',   2, 'character', 'open'),
    ('aspiring_mangaka', 'Mangaka',      'Aspiring Mangaka', 'characters/Aspiring_mangaka/index.html', 'Characters',   3, 'character', 'open'),
    ('crow_charmer',     'Sus-Sister',   'Crow Charmer',     'characters/Crow_charmer/index.html',     'Characters',   4, 'character', 'open'),
    ('register',         'Register',     'Register',         'characters/Register/index.html',         'Characters',   5, 'character', 'trusted_editor'),
    ('framedata',        'framedata',    'Frame data',       'systems/framedata/index.html',           'System Pages', 6, 'system',    'open');

-- The Overall tab in the shape 20260813000005 reads. It is inert now - that
-- migration has already run and recorded itself, so it will not run again -
-- but the next data migration to read page_data will find something here, and
-- a reviewer reading this file can see what that shape actually is.
INSERT INTO public.page_data (page_id, page_type, desc_data)
VALUES (
    'tierlist', 'system',
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
);

-- A character page with a frame data table, so anything reading frame_data has
-- a row with the real column shape rather than an empty set. The numbers are
-- invented and say nothing about the character - startup/active/recovery and
-- the two advantage figures are here to be parsed, not to be believed.
INSERT INTO public.page_data (page_id, page_type, desc_data, frame_data)
VALUES (
    'ten_shadows', 'character',
    jsonb_build_object('profile', jsonb_build_object('image', ''), 'tabs', jsonb_build_array()),
    jsonb_build_object('moves', jsonb_build_array(
        jsonb_build_object('name', 'M1', 'startup', 8, 'active', 3, 'recovery', 14,
                           'onBlock', -4, 'onHit', 2)
    ))
);
