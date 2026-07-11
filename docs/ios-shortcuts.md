# iOS Shortcuts

Helprr can be driven from Apple's **Shortcuts** app. Helprr is a PWA, so it can't register native
App Intents — but it already ships a deep-link surface (`/protocol`) that the Shortcuts "Open URLs"
action can call to add to your watchlist, request via Seerr, search Discover, or jump to a section.

> In the app, this page is reachable from **Settings → Appearance & Layout → App → Siri Shortcuts**,
> where each recipe below is shown with your host pre-filled and a copy button.

## Two ways to trigger Helprr

Helprr accepts two URL shapes:

1. **`https://<your-host>/protocol?cmd=…`** — direct HTTPS. **Recommended.**
2. **`web+helprr://…`** — the custom scheme registered by the web app manifest.

Prefer the **HTTPS** form. iOS support for web-registered custom protocols inside Shortcuts is
inconsistent, whereas "Open URLs" on an in-scope HTTPS link reliably launches the installed PWA.

## Prerequisites

- **Install Helprr to the Home Screen** (Share → *Add to Home Screen*), so URLs open in the
  standalone PWA and carry your logged-in session.
- **Stay signed in** — the action runs with your session cookie.

## Recipes

Build each as a Shortcut with a single **"Open URLs"** action (add **"Ask for Input"** /
**"Get Details"** first when you need to feed in a value). Replace `<your-host>` with your Helprr
origin, and the `<…>` placeholders with real values.

| Action | URL |
|--------|-----|
| Add to watchlist | `https://<your-host>/protocol?cmd=watchlist&tmdbId=<id>&type=tv` (use `type=movie` for films) |
| Request via Seerr | `https://<your-host>/protocol?cmd=request&tmdbId=<id>&type=movie` |
| Search Discover | `https://<your-host>/protocol?cmd=discover&query=<text>` (pair with "Ask for Input" for a voice "Search Helprr") |
| Open a section | `https://<your-host>/calendar`, `/activity`, `/series`, `/movies`, `/watchlist` |

### Share-sheet add (no Shortcut needed)

Helprr registers a **share target**. Share a TMDB, IMDb, or TVDB link from any app into Helprr and
it will add the item — this appears in the iOS share sheet once Helprr is installed.

## Limits

These shortcuts **open the app** to perform the action (foreground). They are **not** background
Siri intents. True hands-free / App-Intent automation would require a native app wrapper, which is a
separate decision from this PWA.
