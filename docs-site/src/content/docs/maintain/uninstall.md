---
title: Uninstall
description: Remove Helprr, with or without its data.
---

```bash
docker compose down          # stops and removes containers; your data volumes remain
docker compose down -v       # ⚠ ALSO DELETES the database, Redis, and log volumes
docker image rm ghcr.io/saibarathr/helprr:stable   # or your pinned :X.Y.Z tag
```

:::danger
`docker compose down -v` permanently deletes all application data — every
user, connection, watchlist, and history row. There is no undo. Take a
backup first unless you truly mean it.
:::
