---
title: Jellyfin
description: Connect Jellyfin to Helprr.
---

**Usual port:** 8096. **Key:** an **admin API key**, from Jellyfin's **Dashboard → Advanced → API Keys**.

**What it adds:** Libraries and watch status, watching in Helprr, active sessions and devices, playback statistics, and server tasks.

Open **Settings → Instances → Jellyfin**, enter the address ([which one?](/helprr/connect/#which-address-to-use))
and the key, then **Test** and **Save**.

After **Test**, choose the **Primary Default User**: the Jellyfin user whose libraries
Helprr shows for admins.

Each person who watches in Helprr connects their own Jellyfin account, so what they
watch is saved to their account: signing in with **Sign in with Jellyfin** does it, and
anyone with a Helprr password can do it in **Settings → Account**. See
[People and permissions](/helprr/people/).

Statistics need Jellyfin's **Playback Reporting** plugin.
