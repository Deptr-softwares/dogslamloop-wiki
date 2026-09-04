-- Backfill site_pages.color from the dictionary that was code until yesterday.
--
-- 20260904000004 added the column and left it NULL, which was correct for a
-- schema change but left the site in a half-migrated state: js/site_meta.js
-- still held all 22 colours and rendered them correctly, while the database -
-- now the declared source of truth - knew none of them. Two visible
-- consequences:
--
--   * the owner tools showed an EMPTY colour for every existing character, so
--     the field looked broken rather than un-set;
--   * fetch-content.js found no coloured character and skipped the write, so
--     generation could never round-trip. Creating a new character meant
--     setting its colour and watching the other 21 stay code-only.
--
-- These values are not retyped. They were extracted from the generated region
-- of js/site_meta.js programmatically, so the backfill is the file by
-- construction rather than by proofreading - 22 hsl() triples is exactly the
-- kind of list a person transcribes one digit wrong.
--
-- Joined on NAME because that is the dictionary's key and what every consumer
-- looks up. site_pages.name is the same string - tests/character-colors.spec.js
-- already asserts every dictionary name is on the roster, so this join is the
-- one that is known to resolve.
--
-- Idempotent, and deliberately narrow: it only fills a colour that is NOT
-- already set. Re-running it cannot overwrite a colour the owner has since
-- changed in the tools, which matters because a migration that reads as
-- "restore the defaults" would quietly undo real edits if it ever ran twice.

UPDATE "public"."site_pages" AS sp
   SET "color" = v.color
  FROM (VALUES
        ('Vessel', 'hsl(0, 100%, 80%)'),
        ('Honored One', 'hsl(180, 100%, 83%)'),
        ('Restless Gambler', 'hsl(100, 100%, 75%)'),
        ('Ten Shadows', 'hsl(0, 0%, 47%)'),
        ('Perfection', 'hsl(300, 100%, 83%)'),
        ('Blood Manipulator', 'hsl(0, 39%, 48%)'),
        ('Switcher', 'hsl(180, 100%, 83%)'),
        ('Defense Attorney', 'hsl(35, 20%, 38%)'),
        ('Cursed Partners', 'hsl(300, 100%, 83%)'),
        ('Puppet Master', 'hsl(342, 91%, 46%)'),
        ('Salaryman', 'hsl(204, 100%, 68%)'),
        ('Head of the Hei', 'hsl(241, 100%, 75%)'),
        ('Disaster Plants', 'hsl(106, 28%, 72%)'),
        ('True Cannon', 'hsl(180, 100%, 83%)'),
        ('Register', 'hsl(0, 0%, 100%)'),
        ('Locust Guy', 'hsl(100, 100%, 75%)'),
        ('Star Rage', 'hsl(240, 100%, 83%)'),
        ('Aspiring Mangaka', 'hsl(0, 100%, 96%)'),
        ('Lucky Coward', 'hsl(272, 43%, 64%)'),
        ('Crow Charmer', 'hsl(233, 39%, 23%)'),
        ('Black Death', 'hsl(352, 49%, 27%)'),
        ('Boomcat', 'hsl(0, 1%, 75%)')
    ) AS v(name, color)
 WHERE sp."name" = v.name
   AND sp."page_type" = 'character'
   AND sp."color" IS NULL;

-- No policy or grant change: this writes an existing column on an existing
-- table, and site_pages already carries both.
