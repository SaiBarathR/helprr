---
title: Prowlarr
description: Connect Prowlarr to Helprr.
---

**Usual port:** 9696. **Key:** in Prowlarr, **Settings → General → API Key**.

**What it adds:** Indexers and their health, search across all indexers with grab, app sync, history and statistics.

In **Settings → Instances**, open **Prowlarr** under **Services**. Enter the address
([which one?](/helprr/connect/#which-address-to-use)) and the key, then **Test**, and
**Save** once it works.

Once Prowlarr is connected, **Settings → Instances** lists the Sonarr, Radarr and Lidarr
it syncs to. Prowlarr does not give their keys, so type each one's key before **Test and
add**.
