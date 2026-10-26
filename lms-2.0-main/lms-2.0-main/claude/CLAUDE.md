# CLAUDE.md

@AGENTS.md

The above file (`AGENTS.md`) is the primary, tool-agnostic instructions file
for this repo — read it first, every session. Everything below is Claude-Code-specific on top of it.

## Session habits for this repo specifically

- This is a large, multi-phase migration (see `MIGRATION_PLAN.md`). Don't try
  to complete a whole phase's worth of files in a way that skips verification
  — after each meaningful chunk, actually run it (boot the app, hit the
  endpoint, run the test) before moving on. A phase isn't "done" because the
  files exist; it's done because it was exercised.
- For anything touching more than 2-3 files or spanning multiple services,
  use the `Explore` agent (or a background research agent) to inventory the
  matching Node source first, rather than re-reading files ad hoc — this repo
  has 26 service files and ~120 endpoints; a targeted inventory pass is much
  cheaper than rediscovering business rules by trial and error.
- For a genuinely large architectural decision (a new phase, a cross-cutting
  change), use plan mode and write/update the plan before touching code — this
  project has already gone through that once for the migration itself; keep
  doing it for major sub-decisions (e.g. how the mobile app's offline story
  should work, once that phase starts).
- Prefer background agents for independent, parallelizable chunks (e.g.
  porting several small unrelated services at once) — but never for the
  ordered, dependency-sensitive phases (auth before everything else, core
  leave-lifecycle before jobs) called out in `MIGRATION_PLAN.md` §4.
- When a Node service file has a comment referencing a business rule
  (`BR-XX`, `LMS-XXX`, `NFR-XX`), that comment is load-bearing spec, not
  incidental — preserve it in the ported Python code.

## Where things are

See `AGENTS.md`'s "Docs map" section.
