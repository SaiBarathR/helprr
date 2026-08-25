# Image Cache Notes

The 2026-07-30 Lua empty-array incident and the former quota-lock contention
issue are closed. Their durable invariants now live in
[`docs/architecture.md`](docs/architecture.md):

- Redis Lua registration must encode an empty eviction list as `[]`; JavaScript
  doubles must follow every script-version change, and the real-Redis test path
  covers Lua/cjson behavior.
- Cold fills write immutable bytes before taking a short accounting lock, wait
  for that lock within a bounded budget, and delete unregistered files on every
  failure or generation change.
- Retention uses the same token-checked lock key with a separate longer
  maintenance lease and rechecks the active generation before mutation.

Current cache behavior, persistence, queueing, stale revalidation, diagnostics,
and operational guidance are documented in `docs/architecture.md` and the
README. This file remains only as a pointer for links in older investigation
records.
