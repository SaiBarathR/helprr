/**
 * Release notes from CHANGELOG.md (Keep a Changelog format), for "What's new".
 * Pure text handling only, so the client can use the block parser too.
 */

export interface ReleaseNotes {
  version: string;
  date: string | null;
  body: string;
}

export type NotesBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: { depth: number; text: string }[] };

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
// "## [1.14.0] - 2026-11-06"; also takes another dash and a trailing marker such as [YANKED].
const RELEASE_HEADING = /^## \[(\d+\.\d+\.\d+)\](?:\s*[-–—]\s*(\d{4}-\d{2}-\d{2}))?/;

/** A plain release version ("1.14.0"); branch builds ("development") and anything else are null. */
export function parseSemver(version: string | null | undefined): [number, number, number] | null {
  const match = version ? SEMVER.exec(version) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Orders two release versions (both must parse); negative when a is older. */
export function compareVersions(a: string, b: string): number {
  const left = parseSemver(a)!;
  const right = parseSemver(b)!;
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/** The released sections newer than `after` (all of them when null) up to and including `upTo`, newest first. */
export function releasesBetween(changelog: string, after: string | null, upTo: string): ReleaseNotes[] {
  const releases: ReleaseNotes[] = [];
  let current: { version: string; date: string | null; lines: string[] } | null = null;
  const close = () => {
    if (current) releases.push({ version: current.version, date: current.date, body: current.lines.join('\n').trim() });
    current = null;
  };
  for (const line of changelog.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      close();
      const heading = RELEASE_HEADING.exec(line);
      // [Unreleased] and anything that is not a version heading starts no section.
      if (heading) current = { version: heading[1], date: heading[2] ?? null, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  close();
  return releases
    .filter((release) => compareVersions(release.version, upTo) <= 0 && (after === null || compareVersions(release.version, after) > 0))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** Splits a release's notes into headings, paragraphs and (one level of nested) bullet lists. */
export function parseNotes(body: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  let paragraph: { type: 'paragraph'; text: string } | null = null;
  let item: { depth: number; text: string } | null = null;

  for (const line of body.split(/\r?\n/)) {
    const text = line.trim();
    const bullet = /^(\s*)[-*] (.*)$/.exec(line);
    if (!text) {
      paragraph = null;
    } else if (text.startsWith('#')) {
      blocks.push({ type: 'heading', text: text.replace(/^#+\s*/, '') });
      paragraph = null;
      item = null;
    } else if (bullet) {
      const next = { depth: bullet[1].length >= 2 ? 1 : 0, text: bullet[2].trim() };
      const last = blocks.at(-1);
      if (last?.type === 'list' && item) last.items.push(next);
      else blocks.push({ type: 'list', items: [next] });
      item = next;
      paragraph = null;
    } else if (/^\s/.test(line) && item) {
      // A wrapped bullet continues on an indented line.
      item.text += ` ${text}`;
    } else if (paragraph) {
      paragraph.text += ` ${text}`;
    } else {
      paragraph = { type: 'paragraph', text };
      blocks.push(paragraph);
      item = null;
    }
  }
  return blocks;
}
