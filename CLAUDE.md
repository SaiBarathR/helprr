# CLAUDE.md

This file supplements `AGENTS.md` for Claude Code. Read `AGENTS.md` completely
before each work cycle; it is the authoritative repository contract.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists (but don't try to hide bugs or issues because you think it's simpler), say so. Push back when warranted. Also if you are not sure about the approach, ask.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

Performance and security are important.
Stability and instant feedback for the users using this application is also important.
Also, the code should be easy to understand and maintain.

## High-Risk Work

- For destructive operations, authentication/permissions, schema migrations,
  cleanup, backup/restore, runtime configuration, or releases, identify the
  safety boundary and failure cases before editing.
- Keep API authorization fail-closed and preserve ownership checks. Never treat
  UI visibility as authorization.
- Keep stable and development Docker data isolated. Never mutate stable data or
  deployments without explicit action-time permission.
- Keep Prisma on version 6 and use committed migrations only.
- Never expose env values, service credentials, database dumps, support bundles,
  tokens, or SSH passwords in code, output, documentation, or Git.
- Do not commit, push, open/merge a PR, tag, publish, promote, or deploy unless
  the owner explicitly requests that exact action.

## Verification

Use the commands and task-specific gates in `AGENTS.md`. Prefer focused tests
while iterating, then run the full required gate before completion. For a
user-facing or operational change, static inspection alone is insufficient when
the relevant browser, API, Compose, migration, or runtime flow can be exercised
safely.

## Documentation

- `docs/architecture.md` contains detailed architecture, auth, cleanup, audit,
  polling, PWA, persistence, readiness, and CI behavior.
- `docs/maintainer-development-release-workflow.md` is the release/deployment
  source of truth.
- `docs/upstream-compatibility.md` records qualified upstream evidence.
- `README.md` is the user-facing installation and operations guide.

Keep this file concise. Put durable technical detail in the appropriate tracked
document and temporary execution notes in gitignored `plans/`.
