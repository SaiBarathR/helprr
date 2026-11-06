import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { APP_VERSION } from '@/lib/app-version';
import { compareVersions, parseSemver, releasesBetween, type ReleaseNotes } from '@/lib/changelog';

/**
 * "What's new" after an update: the release notes between the last version this user
 * saw and the running one, once per user (on every device). Notes come from the
 * CHANGELOG.md shipped with the build (next.config.ts traces it into the standalone
 * output), so nothing is fetched from GitHub.
 */

// A long jump (1.0 to today) would be the whole file; the rest is behind the full-changelog link.
export const WHATS_NEW_MAX_RELEASES = 5;

export interface WhatsNew {
  version: string;
  releases: ReleaseNotes[];
  /** Releases in range left out by WHATS_NEW_MAX_RELEASES. */
  omitted: number;
}

let changelog: Promise<string> | null = null;
function readChangelog(): Promise<string> {
  changelog ??= readFile(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8').catch(() => '');
  return changelog;
}

function capped(version: string, releases: ReleaseNotes[]): WhatsNew {
  return {
    version,
    releases: releases.slice(0, WHATS_NEW_MAX_RELEASES),
    omitted: Math.max(0, releases.length - WHATS_NEW_MAX_RELEASES),
  };
}

/**
 * Notes to show this user now: none on a branch or local build without a release
 * version, none on their first visit (that only records the version), and none once
 * they have seen this version or a newer one.
 */
export async function getWhatsNew(userId: string, version: string = APP_VERSION): Promise<WhatsNew> {
  const none = { version, releases: [], omitted: 0 };
  if (!parseSemver(version)) return none;
  const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { lastSeenVersion: true } });
  const seen = settings?.lastSeenVersion;
  if (!seen) {
    await markWhatsNewSeen(userId, version);
    return none;
  }
  if (!parseSemver(seen) || compareVersions(version, seen) <= 0) return none;
  return capped(version, releasesBetween(await readChangelog(), seen, version));
}

/** The running release's own notes, for Settings → About. */
export async function getCurrentReleaseNotes(version: string = APP_VERSION): Promise<WhatsNew> {
  const release = parseSemver(version)
    ? releasesBetween(await readChangelog(), null, version).find((notes) => notes.version === version)
    : undefined;
  return { version, releases: release ? [release] : [], omitted: 0 };
}

/**
 * Records `version` as seen. Only moves forward, so closing a tab still showing older
 * notes (the server was updated or rolled back meanwhile) neither skips nor repeats a release.
 */
export async function markWhatsNewSeen(userId: string, version: string = APP_VERSION): Promise<void> {
  if (!parseSemver(version)) return;
  const settings = await prisma.userSettings.findUnique({ where: { userId }, select: { lastSeenVersion: true } });
  const seen = settings?.lastSeenVersion;
  if (seen && parseSemver(seen) && compareVersions(version, seen) <= 0) return;
  const data = { lastSeenVersion: version };
  try {
    await prisma.userSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  } catch (error) {
    // Two first writes for a user race on the unique userId: the loser updates instead.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    await prisma.userSettings.update({ where: { userId }, data });
  }
}
