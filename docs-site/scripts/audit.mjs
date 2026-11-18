// `npm audit --audit-level=high` for the guides site, with a short, dated list of
// advisories that have no fixed release yet. Each entry names the advisory, why
// the guides build is not exposed, and the day it stops being accepted, so it
// fails again then. Any other high or critical advisory fails as before.
// Run from docs-site/:
//   node scripts/audit.mjs
import { spawnSync } from 'node:child_process';

const ACCEPTED = [
  {
    id: 'GHSA-fc5q-39xc-vjpf',
    package: 'picomatch',
    until: '2026-12-31',
    reason: 'ReDoS through repeated extglobs; no fixed picomatch release yet (<= 4.0.7). '
      + 'Only Astro, Vite and their file watchers use it here, at build time, on the '
      + "guides' own file paths: nothing outside reaches it.",
  },
];

const today = new Date().toISOString().slice(0, 10);
const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error(result.stdout || result.stderr);
  console.error('npm audit gave no JSON report.');
  process.exit(1);
}

const advisoryId = (url) => /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/.exec(url ?? '')?.[0];
const serious = new Map();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via ?? []) {
    if (typeof via !== 'object' || !['high', 'critical'].includes(via.severity)) continue;
    const id = advisoryId(via.url) ?? via.title;
    serious.set(id, { id, title: via.title, severity: via.severity, package: via.name ?? vulnerability.name });
  }
}

let failed = false;
for (const advisory of serious.values()) {
  const accepted = ACCEPTED.find((entry) => entry.id === advisory.id);
  if (accepted && today <= accepted.until) {
    console.log(`accepted until ${accepted.until}: ${advisory.id} (${advisory.package}, ${advisory.severity}): ${accepted.reason}`);
  } else {
    failed = true;
    const why = accepted ? `its acceptance ended on ${accepted.until}` : 'not accepted';
    console.error(`${advisory.severity}: ${advisory.id} ${advisory.package}: ${advisory.title} (${why})`);
  }
}
for (const entry of ACCEPTED) {
  if (!serious.has(entry.id)) console.log(`no longer reported, remove from the list: ${entry.id} (${entry.package})`);
}
if (failed) process.exit(1);
console.log(`audit: no high or critical advisory beyond the accepted ones (${serious.size} reported).`);
