---
title: TMDB
description: Connect TMDB to Helprr for Discover and the For You page.
---

**Address:** `https://api.themoviedb.org/3`. **Key:** the API key, or the API read
access token, from your TMDB account's
[Settings → API](https://www.themoviedb.org/settings/api) page.

**What it adds:** Discover, the For You page, collections, people and credits, and
artwork for films and series. Without it, those pages ask for it.

A TMDB account and its API key are free. In **Settings → Instances**, open **TMDB** under
**Services**, enter the address above and the key, then **Test**, and **Save** once it
works.

## AniList

The Anime pages use AniList's public catalogue, so they need no connection. Connecting
an AniList account, on **Settings → Instances** with an AniList API client's ID and
secret, is only for tracking an admin's own lists. In production it needs `APP_ORIGIN`
set to Helprr's HTTPS address, which the AniList client's redirect URL must match.
