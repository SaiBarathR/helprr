#!/usr/bin/env node
// Guards the invariant documented in src/lib/settings-export.ts: every key in
// store.ts PERSISTED_KEYS must appear in exactly one UI_PREF_CATEGORY_FIELDS
// category, or it silently resets on settings import. Sole exception:
// discoverLayout, which is server-owned and travels via its dedicated export
// section. Parses the source text (no TS runtime needed); runs as part of
// `npm run lint`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = 'src/lib/store.ts';
const EXPORT = 'src/lib/settings-export.ts';
const EXCEPTIONS = new Set(['discoverLayout']);

function extractQuotedStrings(file, startMarker, endMarker) {
  const source = readFileSync(join(root, file), 'utf8');
  const start = source.indexOf(startMarker);
  if (start === -1) {
    console.error(`check-settings-export: could not find \`${startMarker}\` in ${file}`);
    process.exit(1);
  }
  const end = source.indexOf(endMarker, start);
  if (end === -1) {
    console.error(`check-settings-export: could not find end of \`${startMarker}\` block in ${file}`);
    process.exit(1);
  }
  const block = source.slice(start + startMarker.length, end);
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const persistedKeys = extractQuotedStrings(STORE, 'const PERSISTED_KEYS = [', '] as const');
const categoryFields = extractQuotedStrings(EXPORT, 'export const UI_PREF_CATEGORY_FIELDS', '\n};');

const errors = [];

const fieldCounts = new Map();
for (const field of categoryFields) {
  fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
}

for (const key of persistedKeys) {
  if (EXCEPTIONS.has(key)) continue;
  if (!fieldCounts.has(key)) {
    errors.push(`'${key}' is in ${STORE} PERSISTED_KEYS but in no UI_PREF_CATEGORY_FIELDS category — it will not survive settings export/import`);
  }
}
for (const [field, count] of fieldCounts) {
  if (!persistedKeys.includes(field)) {
    errors.push(`'${field}' is in UI_PREF_CATEGORY_FIELDS but not in ${STORE} PERSISTED_KEYS — stale export field`);
  }
  if (count > 1) {
    errors.push(`'${field}' appears in ${count} UI_PREF_CATEGORY_FIELDS categories — must be exactly one`);
  }
}

if (errors.length > 0) {
  console.error(`check-settings-export: ${EXPORT} has drifted from ${STORE}:`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`check-settings-export: OK (${persistedKeys.length} persisted keys, ${EXCEPTIONS.size} documented exception)`);
