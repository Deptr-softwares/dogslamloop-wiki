#!/usr/bin/env node
/**
 * Guards data/navigation.json against the kind of drift that caused real
 * bugs (Template's Edit button visible despite being non-editable, tier-list
 * revisions mishandled by tools that only knew about two page types).
 * Run: node scripts/validate-navigation.js
 */

const path = require('path');
const nav = require(path.join(__dirname, '..', 'data', 'navigation.json'));

const { VALID_PAGE_TYPES, VALID_EDIT_ROLES } = require(path.join(__dirname, 'page-types.js'));

const errors = [];
const seenPageIds = new Map();

for (const [category, entries] of Object.entries(nav)) {
    if (!Array.isArray(entries)) {
        errors.push(`Category "${category}" is not an array.`);
        continue;
    }

    entries.forEach((entry, idx) => {
        const where = `${category}[${idx}] (id: ${entry.id || '<missing>'})`;

        if (!entry.id || typeof entry.id !== 'string') {
            errors.push(`${where}: missing or non-string "id".`);
        }
        if (!entry.cms_config || typeof entry.cms_config !== 'object') {
            errors.push(`${where}: missing "cms_config" object.`);
            return;
        }

        const { pageType, pageId, editRole } = entry.cms_config;

        if (!pageId || typeof pageId !== 'string') {
            errors.push(`${where}: cms_config.pageId must be a non-empty string.`);
        } else {
            if (seenPageIds.has(pageId)) {
                errors.push(`${where}: cms_config.pageId "${pageId}" duplicates ${seenPageIds.get(pageId)}.`);
            } else {
                seenPageIds.set(pageId, where);
            }
        }

        if (!pageType || !VALID_PAGE_TYPES.has(pageType)) {
            errors.push(`${where}: cms_config.pageType "${pageType}" must be one of ${[...VALID_PAGE_TYPES].join(', ')}.`);
        }

        if (!editRole || !VALID_EDIT_ROLES.has(editRole)) {
            errors.push(`${where}: cms_config.editRole "${editRole}" must be one of ${[...VALID_EDIT_ROLES].join(', ')}.`);
        }
    });
}

if (errors.length > 0) {
    console.error(`navigation.json validation FAILED with ${errors.length} error(s):\n`);
    errors.forEach(e => console.error(`  - ${e}`));
    process.exit(1);
}

console.log(`navigation.json validation passed (${seenPageIds.size} entries, all unique pageIds).`);
