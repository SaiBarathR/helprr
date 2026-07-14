# Upstream compatibility

Last verified: **2026-07-14**, from Helprr's isolated development stack after the
Helprr 1.0.0 release.

## How to read this matrix

The versions below are exact, point-in-time reference versions that Helprr has
actually connected to. They are not minimums, maximums, or promises that every
release between two versions is compatible. The API contract column records the
namespace Helprr currently calls; it must not be read as a supported product-version
range.

No minimum or maximum upstream version is claimed yet. A different patch, minor, or
major version may work when it preserves the same API, but it remains unqualified until
the affected Helprr flows are tested. Unversioned hosted APIs can change without a
product release number.

## Verified reference versions

| Service type | Integration | API contract used by Helprr | Exact version verified | Verification evidence |
| --- | --- | --- | --- | --- |
| `SONARR` | Sonarr | REST `/api/v3` | `4.0.19.2979` (two instances) | Authenticated system-status probe; live queue, cleanup, file, and whole-series operations |
| `RADARR` | Radarr | REST `/api/v3` | `6.2.1.10461` (two instances) | Authenticated system-status probe; live cleanup and whole-movie operations |
| `LIDARR` | Lidarr | REST `/api/v1` | `3.1.2.4913` | Authenticated system-status probe; live track-file and album operations |
| `QBITTORRENT` | qBittorrent | Web API `/api/v2` | `v5.1.4` | Authenticated app-version probe; live queue, cleanup, keep-data, and delete-data operations |
| `PROWLARR` | Prowlarr | REST `/api/v1` | `2.4.0.5397` | Authenticated system-status probe |
| `JELLYFIN` | Jellyfin | Unversioned REST routes such as `/System/Info` | `10.11.11` | Authenticated system-information and admin-access probe |
| `TMDB` | TMDB | Hosted API `v3` | No product version exposed | Authenticated `/configuration` request succeeded |
| `ANILIST` | AniList | Hosted GraphQL API at `graphql.anilist.co` | No product version exposed | OAuth-authenticated Viewer query succeeded |
| `SEERR` | Seerr | REST `/api/v1` | `3.3.0` | Authenticated current-user and status probes |

The live probes above used the isolated Helprr development database and application.
They made read-only status, configuration, or viewer requests. The destructive-flow
evidence refers to intentionally created test downloads/media and did not target the
stable Helprr database.

## Before reporting an upstream compatibility problem

1. In **Settings → Instances**, re-test the affected connection and record the exact
   upstream version.
2. Reproduce the smallest affected Helprr flow. A successful connection test proves
   authentication and the status endpoint only; it does not prove every feature.
3. Download the admin support bundle from **Settings → Service status**. Review it
   before sharing because operational metadata and recent redacted logs may still be
   private.
4. Include the Helprr version/commit, upstream product version, failing action, HTTP
   status, and whether the same action still works in the upstream application's UI.

## Maintaining this matrix

Update a row only after observing the version from the isolated development stack and
testing the affected integration. Record a new verification date and state whether the
evidence was only a connection probe or included real feature flows. Do not turn two
successful point versions into an inclusive range: a minimum/maximum claim requires
explicit boundary testing and remains outside Helprr's current compatibility policy.
