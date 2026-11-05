---
title: Security notes
description: How Helprr protects accounts, credentials and connections.
---

- Use unique, long secrets and a private network or HTTPS reverse proxy. Do not expose Helprr directly to the public internet without understanding the security implications.
- Passwords are stored as per-user scrypt hashes. `APP_PASSWORD` seeds/resets only the bootstrap admin; it is not a universal login password.
- Local and Jellyfin credential requests are limited to 8 KiB; usernames are limited to 64 Unicode characters and passwords to 1,024 UTF-8 bytes. New and reset local passwords use the same byte ceiling. A separate 120-request-per-minute malformed-login backstop deliberately fails closed, so a sufficiently large malformed flood can briefly return 429 to otherwise valid sign-in attempts.
- Watching uses each member's own Jellyfin access token, not the Jellyfin admin API key, so a playback session is never more privileged than the member driving it. Those tokens are encrypted at rest and never returned by the API. A profile linked to a Jellyfin account can only connect that account; an unlinked profile links the account it signs in with, unless another profile already holds it. The connect endpoint shares the same rate limits as sign-in. If a Jellyfin administrator revokes a device, Helprr drops the token and asks that member to reconnect.
- Web Share Target requests accept only multipart or URL-encoded form bodies up to 16 KiB. Shared titles are limited to 256 Unicode characters, and shared text and URL fields are each limited to 2,048 UTF-8 bytes.
- Resetting the bootstrap password does not invalidate active sessions. Revoke sessions from **Settings → Sessions** when access needs to be removed.
- Service credentials and custom headers are sensitive. Restrict administrator accounts and protect backups/log exports.
- Verify AI-generated changes before deploying them. Keep your service containers and this project up to date, and test upgrades against a backup.
- Found a vulnerability? Please report it privately — see [SECURITY.md](https://github.com/SaiBarathR/helprr/blob/main/SECURITY.md).
