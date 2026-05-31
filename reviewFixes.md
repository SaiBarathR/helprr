# Multi-User Branch — Code Review Fix Plan

Review of `multiUser` vs `main`. All findings re-validated against current source before
inclusion. **Reset context:** the next release wipes data, so migration/backfill concerns are
out of scope (this prunes original finding #7 — see below).

**Regression guarantee:** Every gate below only restricts the new *member* role. Admins
short-circuit all capability checks (`permissions.ts:100`, `library-edit-guard.ts:121`), and
`main` had no members — so the single operator account behaves exactly as on `main`. No
main-branch feature is affected by any fix here.

Decisions locked with the operator:
- Grab/import routes → gate with `activity.manage`.
- AniList mutations → `requireAdmin` (shared single account).
- Library edits → non-admins may change *only* tags/path/monitoring; any other field is admin-only.
- Login throttle → mirror Google/Apple/AWS-Cognito layered model (see Fix 5).

---

## Fix 1 — Gate release-grab & manual-import routes  🔴 CONFIRMED

**Problem:** `POST /api/sonarr/release`, `POST /api/radarr/release`, and
`POST /api/activity/manualimport` use bare `requireAuth()` — a read-only member can grab
releases (start downloads) and commit manual imports. Their siblings
(`sonarr/command`, `radarr/command`, `activity/queue/[id]`) were gated with `activity.manage`
in this same branch; these three were missed (pre-existing files).

**Fix:** Add the standard two-line gate after `requireAuth()` in each POST handler:
```ts
const capError = await requireCapability('activity.manage');
if (capError) return capError;
```
- `src/app/api/sonarr/release/route.ts` — `postHandler` (line 51). Import `requireCapability`.
- `src/app/api/radarr/release/route.ts` — `postHandler` (line 46). Import `requireCapability`.
- `src/app/api/activity/manualimport/route.ts` — `postHandler` (line 61). Import `requireCapability`.

GET handlers stay at `requireAuth` (read-only release search is fine for members who can view).

**Verify:** member token → POST returns 403; admin token → 200. **No question.**

---

## Fix 2 — Scope "For You" recommendations to the current user  🔴 CONFIRMED

**Problem:** `src/app/api/recommendations/for-you/route.ts:70` queries
`watchlistItem.findMany({ where: { source: 'TMDB' } })` with no `userId` filter. Since
`WatchlistItem` is now per-user, the exclusion set is built from *every* user's watchlist —
a cross-tenant leak and wrong personalization. Every other watchlist route was scoped; this
one was missed.

**Fix:**
1. Swap `requireAuth()` → `requireUser()` (line 51) to obtain `auth.user.id` (mirrors
   `src/app/api/watchlist/route.ts`).
2. Add `userId: auth.user.id` to the `where` clause (line 71):
   ```ts
   where: { userId: auth.user.id, source: 'TMDB' },
   ```

Note: the recommendation *seeds* come from the shared Sonarr/Radarr library (intentionally
shared — not per-user), so only the watchlist-exclusion set changes. Behavior for the admin is
unchanged (admin still sees their own watchlist excluded).

**Verify:** two users with different watchlists get independently-filtered recommendations.
**No question.**

---

## Fix 3 — Library-edit guard: block all non-whitelisted field changes for non-admins  🟠 CONFIRMED

**Problem:** `guardLibraryEdit` (`library-edit-guard.ts:117`) only inspects tags/path/monitoring.
Any other PUT field (`qualityProfileId`, `seriesType`, `minimumAvailability`,
`monitorNewItems`, `seasonFolder`, `languageProfileId`, …) is unchecked, and both arr `[id]`
routes forward the full body. A view-only member can change those freely. There is no capability
for them today → operator chose: these are **admin-only**.

**IMPLEMENTED — design note (deviated from "diff whole object" for a good reason):**
The client round-trips the **entire** series/movie object into the PUT body
(`body: JSON.stringify({ ...series, monitored: !x })`). A "compare all non-whitelisted keys"
diff would therefore false-positive on volatile/computed fields (`statistics`, `nextAiring`,
`previousAiring`, `ratings`) that drift between the client's fetch and the guard's fresh fetch —
**falsely blocking a member from even toggling monitoring.** So instead of diffing everything, the
guard checks an explicit **protected-settings list** — the concrete config fields that have no
capability and must stay admin-only:
- Series: `qualityProfileId`, `languageProfileId`, `seriesType`, `seasonFolder`, `monitorNewItems`
- Movie: `qualityProfileId`, `minimumAvailability`

Same security outcome the operator chose (members can change *only* tags/path/monitoring), with
zero false-positives on volatile data.

What shipped in `library-edit-guard.ts`:
1. `other: boolean` added to `LibraryEditDiff`.
2. `protectedFieldChanged(current, body, keys)` — flags a present, differing primitive on any
   protected key (omitted field ≠ change; the upstream API validates crafted bodies).
3. `diffSeriesEdit` / `diffMovieEdit` set `other` from their respective key lists.
4. `guardLibraryEdit`: admin short-circuit first, then `if (diff.other) → 403` (only reachable by
   non-admins), then the per-capability checks. No-op early-return now includes `!diff.other`.

**Trade-off to know:** the protected list is explicit, so if Sonarr/Radarr add a *new* editable
settings field, it must be added here (documented in a code comment). This is strictly better than
the old 3-field guard and avoids the volatile-field regression a whole-object diff would cause.

**Verify (suggested test):** member PUT changing only `monitored` → allowed; member PUT flipping
`qualityProfileId` → 403; admin PUT flipping `qualityProfileId` → allowed.

---

## Fix 4 — Root-folder move detection: compare path segments, not raw prefix  🟠 CONFIRMED

**Problem:** `pathChanged` (`library-edit-guard.ts:55`) uses
`normPath(currentPath).startsWith(normPath(submittedRoot))`. `normPath` only trims trailing
slashes, so the prefix has no separator boundary: current `/media/tv-shows/My Show` + submitted
root `/media/tv` → `startsWith` true → guard reports "no move" → a member without
`series.changePath` relocates to a different root.

**Fix:** Make the prefix a path-segment-aware check. Replace the bare `startsWith` with a
boundary-checked helper:
```ts
function isUnder(child: string, parent: string): boolean {
  const c = normPath(child);
  const p = normPath(parent);
  return c === p || c.startsWith(p + '/') || c.startsWith(p + '\\');
}
// move detected when the current full path is NOT under the submitted root:
if (!isUnder(currentPath, submittedRoot)) return true;
```
So `/media/tv-shows/My Show` is **not** under `/media/tv` (needs `/media/tv/…`) → correctly
flagged as a move. Handles both `/` and `\` separators (Windows roots).

**Verify:** unit test — `isUnder('/media/tv-shows/x', '/media/tv') === false`,
`isUnder('/media/tv/x', '/media/tv') === true`. **No question.**

---

## Fix 5 — Login brute-force: layered throttle (Google/Apple/Cognito model)  🟠 CONFIRMED

**Problem:** `getClientIp` returns `undefined` unless `TRUST_FORWARDED_PROTO=true`, and
`enforceLoginRateLimit(undefined)` returns `null`. Default deployments have **no** throttle on
`/api/auth/login` or `/api/auth/jellyfin`. Not a regression vs `main` (single password, no
throttle), but multi-user adds real usernames to guess.

**Industry model (researched):** OWASP + AWS Cognito + Google/Apple all use a *layered* defense,
never one mechanism:
- **IP rate limit** as the first layer (already present; keep it for proxied deploys).
- **Per-account exponential backoff that auto-recovers** — AWS Cognito's published scheme: after
  5 failures lock 1s, doubling per failure, capped at 15 min. This throttles guessing of a *known
  username* even with no trusted IP, and because it auto-recovers it can't be weaponized into a
  permanent account-lockout DoS.
- **De-dupe identical wrong passwords** (Google/Apple): replaying the *same* wrong password
  doesn't advance the counter — stops a credential-stuffing replay from locking out a legit user.
- Always **reset on success**, count **failures only**.

**Fix — add an always-on per-username layer alongside the IP layer** (`src/lib/login-rate-limit.ts`):
1. New `enforceUsernameBackoff(username, password)`:
   - Redis key `login:user:{usernameLower}` holding `{ count, lockedUntil, lastPwHash }`.
   - Hash the submitted password (cheap, e.g. sha256) → if equal to `lastPwHash`, do **not**
     increment (dedupe identical wrong password). Store hash, not password.
   - On failure: `count++`; if `count >= 5`, `lockedUntil = now + min(2^(count-5) * 1s, 15min)`.
   - If `now < lockedUntil` → return 429 with `Retry-After`.
   - TTL the key to the 15-min cap so it self-cleans.
2. New `clearUsernameBackoff(username)` — called on successful login (alongside the existing
   `clearLoginAttempts(ip)`).
3. Wire into **both** routes:
   - `src/app/api/auth/login/route.ts`: after parsing `username`, before the user lookup, call
     the username layer (in addition to the IP layer at line 15). Clear on success (line 51-58).
   - `src/app/api/auth/jellyfin/route.ts`: same two calls.
4. Keep the existing IP bucket exactly as-is (it's the correct second layer when a proxy IP is
   trusted; the comment's reasoning about not trusting raw `x-forwarded-for` stands).

**Anti-DoS properties preserved:** auto-recovery cap (15 min) means a targeted attacker can delay
but never permanently lock a victim; the password-dedupe prevents accidental lockout from
retries/stuffing of one stale credential.

**Open sub-decision (low stakes, my default in brackets):** counter store — reuse the existing
Redis client [default], since the IP limiter already requires Redis. If Redis is down, fail the
same way the IP path does (503), so the throttle can't be bypassed by knocking out Redis.

**Verify:** 6 rapid wrong attempts on one username (no proxy) → 429 with growing `Retry-After`;
correct password before lockout → succeeds and resets; repeating the *same* wrong password many
times → counter doesn't escalate past the first.

---

## Fix 6 — Gate AniList list mutations to admin  🟠 CONFIRMED

**Problem:** `POST`/`DELETE /api/anilist/list-entry` mutate the single shared operator AniList
account (one OAuth token via `loadAniListConnection()`), guarded only by `requireAuth()`. Any
member can edit/delete the operator's personal list.

**Fix:** Replace `requireAuth()` with `requireAdmin()` in the `POST` and `DELETE` handlers
(`anilist/list-entry/route.ts:90`, `:169`). `requireAdmin` returns a result object, so adapt:
```ts
const admin = await requireAdmin();
if (!admin.ok) return admin.response;
```
Leave `GET` (line 60) at `requireAuth` — members with `anime.view` can still read entry status.

**Verify:** member POST/DELETE → 403; admin → works; member GET → still works. **No question.**

---

## Fix 7 — (DROPPED) Notification skip for owner-less subscriptions

Original finding: `notifyEvent` skips subscriptions whose `user` is null, so during an upgrade
window before backfill the operator gets zero pushes. **Moot given the reset** — all
subscriptions are recreated with a valid `userId`. No fix. (If desired later, a one-line
defensive log when `subscriptionCount > 0 && attempted === 0` would surface the silent-skip case.)

---

## Fix 8 — Eliminate the double session load per request  🟡 efficiency

**Problem:** ~80 gated routes call `requireAuth()` then `requireCapability()`; each independently
runs `loadAndTouchSession` (a `session.findUnique({ include: { user: true } })` + JWT verify).
Every authenticated mutation pays two identical session loads.

**Fix (smallest safe change):** Memoize per-request with React's `cache()` in `src/lib/auth.ts`:
```ts
import { cache } from 'react';
const loadAndTouchSessionCached = cache(loadAndTouchSession);
```
and route `getCurrentSession`, `requireAuth`, `requireSession`, `requireUser` through the cached
loader. `cache()` scopes to a single request render, so concurrent helpers in one request share
one DB hit; it does not leak across requests. The `lastSeenTouched` debounce already guards the
write side, so caching only collapses the read.

**Regression risk:** none functional — same data, fewer queries. Keep the `requireAuth` +
`requireCapability` call pattern as-is (don't remove `requireAuth` from the 80 routes — that's a
larger churn for no extra safety once the load is cached).

**Verify:** add a query counter/log in dev → one gated request issues one session load, not two.
**No question** (include if you want the perf win now; otherwise defer — purely internal).

---

## Fix 9 — Export watchlist filter must not collapse to "all users"  🟡 PLAUSIBLE

**Problem:** `settings/export/route.ts:194` uses `where: { userId: exporter?.id ?? undefined }`.
Prisma treats `userId: undefined` as *no filter* → if `getCurrentUser()` ever returns null
(user row deleted mid-request after the cap check passed), the export dumps every user's
watchlist.

**Fix:** Hard-fail instead of silently widening:
```ts
const exporter = await getCurrentUser();
if (!exporter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
// ...
where: { userId: exporter.id },
```

**Verify:** normal export contains only the caller's items; (synthetic) null user → 401, not a
dump. **No question.**

---

## Fix 10 — Sonarr PUT: validate body.id against the route param  🟡 minor

**Problem:** `sonarr/[id]/route.ts` `putHandler` (line 25) ignores `params.id` entirely and uses
client `body.id` for both the guard baseline and the write. Not an RBAC bypass (guard fetches the
same id it writes), but a PUT to `/api/sonarr/5` can update series 999. Radarr's route already
guards this (`radarr/[id]/route.ts:51`).

**Fix:** Mirror Radarr — accept `{ params }`, parse `pathId`, and reject mismatch:
```ts
async function putHandler(request, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAuth(); if (authError) return authError;
  const { id } = await params;
  // parse pathId (positive int) → 400 on bad input
  const body = await request.json();
  if ('id' in body && Number(body.id) !== pathId) {
    return NextResponse.json({ error: 'Path id and body id must match' }, { status: 400 });
  }
  const current = await client.getSeriesById(pathId);   // baseline by route id, not body id
  ...
```

**Verify:** PUT `/api/sonarr/5` with `body.id=999` → 400. **No question.**

---

## Optional cleanups (raise in PR, not blocking)

- **qbittorrent `actionCapability` fails open** (`qbittorrent/[hash]/route.ts:32`): unmapped action
  → `null` → no cap check. Currently every executable action is mapped, so no live hole, but it's
  fail-open. Recommend deny-by-default: an action that reaches dispatch but maps to `null` should
  403, not run. **Low priority** — confirm you want the hardening.
- **`series.markWatched` orphan capability** (`capabilities.ts:47`): defined but no route/UI/endpoint
  references it. Either remove it from the catalog or leave as a placeholder for a planned feature.
  **Your call** — harmless either way given the reset.

---

## Suggested PR grouping / order

1. **Security gates (Fixes 1, 6):** ungated routes → capability/admin. Small, high-value.
2. **Per-user scoping (Fix 2, 9):** watchlist leak + export filter.
3. **Library-edit guard (Fixes 3, 4):** the two guard bugs + tests (highest implementation care).
4. **Login throttle (Fix 5):** new per-username backoff layer + tests.
5. **Hardening/minor (Fixes 8, 10, optional cleanups):** id validation, session-load memoization.

Each group is independently shippable and independently testable.

---
---

# Second Review Pass (`multiUser` vs `main`, 2026-05-31)

A fresh high-recall review run **after** Fixes 1–10 above were implemented. These are
**new, non-overlapping** findings — all re-validated against current source, refuted candidates
dropped. Same **regression guarantee** as the first pass: every gate below only restricts the new
*member* role; admins short-circuit all capability checks, and `main` had no members, so the
single operator account behaves exactly as on `main`.

**Decisions locked with the operator (this pass):**
- `users.manage` → user-management routes become **admin-only** (`requireAdmin`).
- `services/health` → **filter** returned services by capability (don't break the member widget).
- `logs/client` → **no change** (browser-log ingestion stays open to authenticated users by design).
- Include the efficiency fixes, the null-owner hardening, and the shared-helper refactor.

Refuted in this pass (no action): watchlist `[id]` PATCH (has a `findFirst` ownership guard),
seerr "all-seasons" (re-derived by `createRequest`'s `?? 'all'`), pending-approve attribution
(unlinked members blocked at create), login `findFirst` (username is `@unique`).

---

## Fix S1 — `users.manage` is a privilege-escalation vector → make user routes admin-only  🔴 CONFIRMED

**Problem:** `/api/users` (POST), `/api/users/[id]` (PATCH/DELETE), and
`/api/users/[id]/permissions` (PUT) gate only on `requireCapability('users.manage')`. That
capability is an ordinary, grantable cap (`permissions.ts` `deltaFromTemplate` accepts any cap —
no allowlist). An admin who grants a member `users.manage` hands them full escalation: POST
`{role:'admin'}` mints an admin, or PATCH self → `{role:'admin'}` (the last-admin guard at
`users/[id]/route.ts:112` only blocks *demotion*, never *promotion*).

**Fix:** Replace the `requireAuth()` + `requireCapability('users.manage')` pair with `requireAdmin()`
in **every** handler of these three route files:
- `src/app/api/users/route.ts` — `getHandler`, `postHandler`
- `src/app/api/users/[id]/route.ts` — `getHandler`, `patchHandler`, `deleteHandler`
- `src/app/api/users/[id]/permissions/route.ts` — `getHandler`, `putHandler`

```ts
const admin = await requireAdmin();
if (!admin.ok) return admin.response;
```
Drop the now-unused `requireAuth`/`requireCapability` imports. `users.manage` stays in the catalog
(it still drives the Settings → Users *page guard* visibility), but it no longer authorizes the API.

**Regression check:** admins are unaffected (they pass `requireAdmin`); no `main` feature touched.
**Verify:** admin → 200; member (even with `users.manage` override) → 403 on POST/PATCH/PUT/DELETE.

---

## Fix S2 — `/api/services/health` leaks admin-only services → filter by capability  🟠 CONFIRMED

**Problem:** `services/health/route.ts:96` gates on bare `requireAuth()` and returns health for
**all** `ServiceConnection`s, including the privacy-sensitive ones (`QBITTORRENT`, `PROWLARR`) that
`permissions.ts` deliberately keeps admin-only. Any member with the Service Health widget (it ships
in the default layout, `registry.ts:148/219`, with no widget-level capability) sees them.

**Fix (operator chose: filter, keep the widget working):**
1. Swap `requireAuth()` → `requireUser()` to get the caller.
2. Map each `ServiceType` to its view capability and keep only services the caller `can()` see
   (admins keep all via the `can()` admin short-circuit):
   ```ts
   const SERVICE_VIEW_CAP: Record<ServiceType, Capability> = {
     SONARR: 'series.view', RADARR: 'movies.view', JELLYFIN: 'jellyfin.view',
     TMDB: 'discover.view', ANILIST: 'anime.view', SEERR: 'requests.view',
     QBITTORRENT: 'torrents.view', PROWLARR: 'prowlarr.view',
   };
   const connections = (await prisma.serviceConnection.findMany({ orderBy: { type: 'asc' } }))
     .filter((c) => can(auth.user, SERVICE_VIEW_CAP[c.type]));
   ```
   So members see Sonarr/Radarr/Jellyfin/TMDB/AniList/Seerr health and **not** qBittorrent/Prowlarr;
   admins see everything (no behavior change for the operator).

**Verify:** member response omits `QBITTORRENT`/`PROWLARR`; admin response unchanged.
**Sub-decision (low stakes):** mapping above is my default. Flag if you'd rather members *also* not
see Seerr/Jellyfin health when those pages are otherwise hidden — say so and I'll align the map.

---

## Fix S3 — `jellyfin.view` cluster: 7 routes serve Jellyfin data with no capability gate  🟠 CONFIRMED

**Problem:** these routes are `requireAuth`/`requireUser`-only — a member whose `jellyfin.view` was
revoked (UI hidden) can still hit them directly. (Default members *have* `jellyfin.view`, so no
regression for them — the gap only matters once an admin revokes it.)

**Fix:**
- `requireAuth`-only → add `requireCapability('jellyfin.view')` after `requireAuth`:
  `image`, `counts`, `lookup`, `recently-added`, `libraries`.
- `requireUser`-based (need the user for self-scoping) → gate with the new
  `requireUserCapability('jellyfin.view')` helper (Fix S8): `resume`, `playback/history`.
  These stay self-scoped to the caller's own `jellyfinUserId` as today.

**Verify:** member with `jellyfin.view` revoked → 403 on all 7; admin / default member → unchanged.

---

## Fix S4 — Sonarr/Radarr PUT: skip the live-item fetch for admins (regression + extra round-trip)  🟡 CONFIRMED

**Problem:** `sonarr/[id]/route.ts:51` (and `radarr/[id]/route.ts`) now `await client.getSeriesById(pathId)`
**unconditionally** before the update, inside the route `try`. The admin short-circuit lives *inside*
`guardLibraryEdit` (`library-edit-guard.ts:174`), so admins still pay the extra upstream call, and a
transient detail-fetch error now 500s an edit that previously only needed `updateSeries` to succeed.

**Fix:** Resolve the user first and skip the fetch+diff entirely for admins:
```ts
const user = await getCurrentUser();
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
if (user.role !== 'admin') {
  const current = await client.getSeriesById(pathId);
  const guardError = await guardLibraryEdit(diffSeriesEdit(current, body), { /* caps */ });
  if (guardError) return guardError;
}
const result = await client.updateSeries(body, moveFiles);
```
Admins: zero extra fetch, no new failure mode (back to `main` behavior). Members: unchanged
(fetch failure still fails closed, which is correct for a guard). Apply symmetrically to Radarr.

**Verify:** admin PUT issues no `getSeriesById` call; member PUT still 403s on protected-field change.

---

## Fix S5 — `User.seerrUserId` should be `@unique`  🟡 CONFIRMED (low, config-dependent)

**Problem:** `schema.prisma:39` `seerrUserId String?` (no `@unique`, unlike `jellyfinUserId`). Two
Helprr users linked to the same Seerr id would pass the `seerr/requests/[id]` ownership check
(`requestedBy.id === own seerrUserId`) for each other's requests.

**Fix:** add `@unique` (Postgres allows multiple NULLs, so unlinked users are fine):
```prisma
seerrUserId    String?   @unique
```
Run `npm run db:generate` + `npm run db:push` (reset context → no migration concern).

**Verify:** linking a second user to an in-use Seerr id is rejected at the DB layer.

---

## Fix S6 — Efficiency: polling N+1, per-nav SEERR count, boot backfill  🟡 (operator opted in)

**S6a — Polling owner lookup N+1** (`polling-service.ts:843`): the per-request
`prisma.user.findFirst({ where: { seerrUserId } })` runs inside the `for (const req of requests)`
loop. Batch it: before the loop, collect the distinct `seerrUserId`s of the requests that will
notify, do one `findMany({ where: { seerrUserId: { in: [...] } }, select: { id, seerrUserId } })`,
build a `Map<string,string>`, and look `ownerId` up from it.

**S6b — Per-nav SEERR count** (`layout.tsx:28`, `force-dynamic`): runs a `serviceConnection.count`
sequentially after `getCurrentUser` on every authenticated navigation. Run them in parallel:
```ts
const [user, seerrCount] = await Promise.all([
  getCurrentUser(),
  prisma.serviceConnection.count({ where: { type: 'SEERR' } }),
]);
if (!user) redirect('/login');
const seerrConfigured = seerrCount > 0;
```

**S6c — Boot-time backfill runs every reboot** (`bootstrap-admin.ts:87`):
`attachOwnerlessRowsToAdmin()` is called unconditionally. Move the call **inside** the two genuine
first-boot/upgrade branches (the `if (!existing)` create branch and the `!existing.passwordHash ||
forceReset` seed branch) so steady-state reboots do zero backfill writes — no schema change needed.

**Verify:** busy poll cycle issues one batched user query; nav issues the count in parallel; a
second reboot logs no "Attached ownerless rows".

---

## Fix S7 — Null-owner hardening (defensive; mostly moot post-reset)  ⚪ (operator opted in)

**S7a — Push** (`notification-service.ts:293`): a subscription with `user === null` is silently
skipped for every event. Post-reset every subscription has a `userId`, so this is a safety net:
after computing `results`, if `subscriptions.length > 0 && attempted === 0 && subscriptions.some(s => !s.user)`,
`logger.warn` once that owner-less subscriptions were skipped (surfaces the anomaly; no delivery
change — fail-closed stays).

**S7b — Session** (`auth.ts:97`): the gate `if (session.user && session.user.status !== 'active')`
lets a `userId === null` session stay valid (deliberate upgrade fail-open). Post-reset no such
session exists, so tighten to require a linked active user and update the comment:
```ts
if (!session.user || session.user.status !== 'active') return null;
```

**Verify:** a synthetic null-owner subscription logs a warning; a synthetic null-owner session →
treated as unauthenticated.

---

## Fix S8 — Shared-helper refactor: `requireUserCapability` + `ownerScope`  ⚪ (operator opted in)

**Problem:** the `requireUser()` + `can()` + manual-403 block is hand-copied across ~22 routes, and
the `user.role === 'admin' ? {} : { userId: user.id }` Prisma fragment across ~9. Each copy is a
place a gate can be silently dropped on a new route.

**Fix:**
1. `src/lib/auth.ts` — add:
   ```ts
   export async function requireUserCapability(cap: Capability): Promise<RequireUserResult> {
     const result = await requireUser();
     if (!result.ok) return result;
     if (!can(result.user, cap)) {
       return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
     }
     return result;
   }
   ```
2. `src/lib/user-dto.ts` — add:
   ```ts
   export function ownerScope(user: Pick<User, 'role' | 'id'>): { userId?: string } {
     return user.role === 'admin' ? {} : { userId: user.id };
   }
   ```
3. Migrate the copy-paste sites mechanically (dashboard-layouts ×6, watchlist ×8, seerr ×N,
   notifications ×4, and the Fix S3 `resume`/`playback-history`) to the helpers.

**Regression risk:** larger file count (you opted in). Keep each edit a pure substitution (same
status codes, same scope semantics), then `npm run lint` + `npm run build` to catch any drift.
**Sub-decision:** I'll do the migration in one commit *after* S1–S5 land, so the security fixes
aren't blocked on the refactor. Say if you'd rather land helpers first and write S1/S3 against them.

---

## Suggested order (second pass)

1. **S1** (admin-only user routes) — critical, tiny.
2. **S2 + S3** (health filter, jellyfin.view gate) — security gates.
3. **S4 + S5** (PUT admin-skip, seerrUserId unique) — regression + schema.
4. **S6** (efficiency) — independent.
5. **S7 + S8** (hardening + refactor) — last, after the above are green.

Open questions I still need you to confirm are inline at **S2** (service→cap map) and **S8**
(refactor sequencing); everything else is decided. Nothing here changes admin/`main` behavior.
</content>
</invoke>
