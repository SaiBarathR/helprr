import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareVersions, parseNotes, parseSemver, releasesBetween } from '@/lib/changelog';

const CHANGELOG = `# Changelog

Intro text.

## [Unreleased]

- Not released yet.

## [1.3.0] - 2026-11-06

### Added

- **Thing**: does a thing that wraps
  onto a second line.
- Second.

## [1.2.1] - 2026-11-03

Only a fix.

## [1.2.0] - 2026-10-30

### Fixed

- Old fix.

## [1.10.0] - 2026-12-01

- Out of order, and newer than 1.3.0.
`;

describe('parseSemver / compareVersions', () => {
  it('accepts only plain release versions', () => {
    expect(parseSemver('1.14.0')).toEqual([1, 14, 0]);
    for (const version of ['development', 'unknown', 'v1.14.0', '1.14', '1.14.0-rc.1', '', null, undefined]) {
      expect(parseSemver(version)).toBeNull();
    }
  });

  it('orders numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.2.1')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });
});

describe('releasesBetween', () => {
  it('returns the releases after the seen version up to the running one, newest first', () => {
    const releases = releasesBetween(CHANGELOG, '1.2.0', '1.3.0');
    expect(releases.map((release) => release.version)).toEqual(['1.3.0', '1.2.1']);
    expect(releases[0].date).toBe('2026-11-06');
    expect(releases[0].body).toContain('### Added');
    expect(releases[0].body).not.toContain('1.2.1');
    expect(releases[1].body).toBe('Only a fix.');
  });

  it('leaves out [Unreleased] and anything newer than the running version', () => {
    const all = releasesBetween(CHANGELOG, null, '1.3.0').map((release) => release.version);
    expect(all).toEqual(['1.3.0', '1.2.1', '1.2.0']);
    expect(releasesBetween(CHANGELOG, null, '1.10.0')[0].version).toBe('1.10.0');
  });

  it('is empty when nothing is newer than the seen version', () => {
    expect(releasesBetween(CHANGELOG, '1.3.0', '1.3.0')).toEqual([]);
    expect(releasesBetween('', '1.0.0', '1.3.0')).toEqual([]);
  });

  it("reads the repository's real CHANGELOG.md", () => {
    const real = readFileSync(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8');
    const releases = releasesBetween(real, '1.13.0', '1.14.0');
    expect(releases.map((release) => release.version)).toEqual(['1.14.0', '1.13.1']);
    expect(releases.every((release) => release.body.length > 0)).toBe(true);
  });

  it('finds every released section of the real CHANGELOG.md, each with notes', () => {
    const real = readFileSync(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8');
    const headings = real.split('\n').filter((line) => /^## \[\d+\.\d+\.\d+\]/.test(line));
    const releases = releasesBetween(real, null, '999.0.0');
    expect(releases).toHaveLength(headings.length);
    for (const release of releases) {
      expect(release.date, release.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(parseNotes(release.body).length, release.version).toBeGreaterThan(0);
    }
  });

  it('takes other dashes and a trailing marker in a heading', () => {
    const releases = releasesBetween('## [1.1.0] – 2026-01-02 [YANKED]\n\n- Pulled.\n', null, '1.1.0');
    expect(releases).toEqual([{ version: '1.1.0', date: '2026-01-02', body: '- Pulled.' }]);
  });
});

describe('parseNotes', () => {
  it('splits headings, wrapped bullets, nested bullets and paragraphs', () => {
    expect(parseNotes([
      'Intro that',
      'wraps.',
      '',
      '### Added',
      '',
      '- **Bold**: first',
      '  continued.',
      '  - Nested one.',
      '- Second.',
      '',
      'After the list.',
    ].join('\n'))).toEqual([
      { type: 'paragraph', text: 'Intro that wraps.' },
      { type: 'heading', text: 'Added' },
      {
        type: 'list',
        items: [
          { depth: 0, text: '**Bold**: first continued.' },
          { depth: 1, text: 'Nested one.' },
          { depth: 0, text: 'Second.' },
        ],
      },
      { type: 'paragraph', text: 'After the list.' },
    ]);
  });
});
