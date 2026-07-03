# Plan: Declarative Web Push as an Opt-In Delivery Mode

**Status: plan only — not implemented.**

## Why

iOS silently revokes a web push subscription after ~3 "silent pushes" (push events where the
service worker fails to display a notification). We hardened the SW push handlers so no code
path returns without `showNotification()`, but the strike rule still applies whenever the SW
can't run or errors for reasons outside our control (SW terminated mid-handler, storage
eviction, WebKit bugs after OS updates).

**Declarative Web Push** (Safari/iOS 18.4+, macOS 15.5+) removes the service worker from the
delivery path entirely: the OS parses the push payload and displays the notification itself.
There is no silent-push penalty by construction — if a SW handler exists and fails, the
declarative payload is displayed as an automatic fallback.

Most users don't hit the revocation problem, so this ships as an **opt-in per-device setting**:
an iPhone user whose notifications keep silently dying can flip it on; everyone else keeps the
current pipeline.

Reference: [WebKit — Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)

## How Declarative Web Push works (summary of the spec)

- The push payload is JSON with a top-level `"web_push": 8030` marker and a `"notification"`
  object: required `title` and `navigate` (URL opened on tap); optional `body`, `silent`,
  `app_badge`, `lang`, `dir`.
- Sending is unchanged: same endpoint, same VAPID auth, same `web-push` library call — only the
  payload shape differs. No new headers.
- **Backward compatible:** a browser that doesn't understand the declarative format just hands
  the JSON to the SW `push` handler like any other payload. One payload can serve both paths.
- If a root-scope SW exists on a supporting browser, it still receives a `PushEvent` and may
  *replace* the proposed notification; if it fails to show one, the declarative notification is
  displayed instead (this is what kills the strike rule).
- `window.pushManager` is exposed (subscription without a SW). We don't need this — we keep our
  SW for caching/badges — but `'pushManager' in window` is the feature-detect for "this browser
  supports declarative push."

## Design

### 1. Schema

`PushSubscription` gains one field:

```prisma
declarativePush Boolean @default(false)
```

Per-device (not per-user) because the problem is device-specific — the same account's Android
phone should keep the richer SW path (action buttons, custom handling).

`npm run db:push` — additive, no migration risk.

### 2. Server — `src/lib/notification-service.ts`

In `sendPushNotification`, when the subscription row has `declarativePush = true`, wrap the
existing payload:

```jsonc
{
  "web_push": 8030,
  "notification": {
    "title": "<title>",
    "body": "<body>",
    "navigate": "<absolute URL of payload.url>"   // must be absolute; needs the app origin
  },
  // existing fields kept alongside so a non-supporting browser's SW path
  // (and our own SW if it chooses to handle the event) still works:
  "title": "…", "body": "…", "tag": "…", "url": "…", "data": { }
}
```

Notes:
- `navigate` must be an absolute URL. Derive the origin from a new required-when-enabled
  setting or from `VAPID_SUBJECT`-adjacent config (`AppSettings.appUrl` — check if one already
  exists before adding).
- `app_badge`: optional phase 2 — include the recipient's unread count so the icon badge
  updates without the SW's `/api/badges` fetch. Requires a per-user count query at send time;
  skip in phase 1 to keep the fan-out cheap.
- Payload size: iOS limit is 4KB; the dual-format payload roughly doubles the envelope — keep
  `data`/`actions` out of the declarative branch and truncate bodies as today.

### 3. Service worker

On a declarative-enabled device the SW `push` handler still fires (iOS 18.4+ behavior) and its
`showNotification` would replace the declarative one. Two options:

- **Do nothing** (recommended): SW shows the same content; if the SW dies, the OS fallback
  shows. Either way a notification appears and no strike is recorded.
- Optionally, the SW could detect `data.web_push === 8030` and skip `showNotification`,
  letting the OS render — *do not do this*: on iOS versions before 18.4 that same skip would
  be a silent push. Keep the handler unconditional.

### 4. Settings UI — Settings → Notifications

- Per-device toggle on the device's notification card: **"Direct delivery (iOS 18.4+)"** with
  copy like *"Bypasses the service worker so iOS can't silently drop notifications. Enable if
  notifications on this iPhone keep stopping after a few days."*
- Show the toggle only when the current device is the one being edited and
  `'pushManager' in window` is true (feature-detect for declarative support), or always show it
  with a support hint — decide during implementation.
- API: extend the existing subscription update route (or `POST /api/push/subscribe` body) to
  accept `declarativePush`.

### 5. Trade-offs to surface in the PR

- Tap behavior on a declarative-rendered notification uses `navigate` directly — the SW
  `notificationclick` logic (focus-existing-window, approve/decline/retry actions) is bypassed
  when the OS renders. iOS already ignores action buttons, so iPhone users lose nothing; this
  is why the toggle should stay iOS-targeted rather than global.
- Grouped/digest notifications work unchanged (title/body/navigate map 1:1).
- Once validated in the field, consider making the dual-format payload the default for *all*
  devices (it's backward compatible), keeping only the SW-replacement behavior as the
  difference. That would remove the setting later rather than add more.

## Implementation order

1. Schema field + `db:push` → verify: Prisma client typechecks.
2. Payload branch in `sendPushNotification` → verify: unit-level check of payload JSON for both
   modes; send a test push (`POST /api/notifications/test`) to an iOS 18.4+ device with the
   flag on and confirm delivery with the app force-quit *and* with the SW deliberately broken
   (throw in dev SW) — the declarative fallback must still display.
3. Subscribe/update API accepts the flag → verify: toggle round-trips.
4. Settings UI toggle → verify: visible on iOS Safari 18.4+, persists, test push honors it.

Estimated size: small — one schema field, ~30 lines server, ~40 lines UI.
