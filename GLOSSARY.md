# GLOSSARY.md — CoachXYZ domain + architecture terms

Domain terms follow `ARCHITECTURE.md` / `docs/CODEBASE_MAP.md`. Architecture
terms follow the deep-module vocabulary (module, interface, implementation,
depth, seam, adapter, leverage, locality).

## Agreed module names (deepened 2026-10-11 — see docs/CODEBASE_MAP.md)

- **data core** — the one deep web data module owning transport, attribution, error shape, and cache identity (`web-next/lib`).
- **entity facade** — thin per-entity file over the data core preserving direct-path imports (no barrels).
- **pipeline** (unified) — the single module owning upload → scan → analyze → poll → retry phases for coach and player surfaces.
- **admission** — the single server module owning rate → validate → quota → tier → owner-bind → enqueue → persist for analyze entries.
- **entry context** — the one data shape describing an analyze entry (identity, org scope, job payload).
- **worker lifecycle** — the server module owning retry/persist/events/sweeps/shutdown across job kinds.
- **job-kind adapter** — thin plug-in behind the worker lifecycle (`analysis`, `ai-report`).
- **job-guard** — the server module owning analysis/finding ownership, review, and failed-mark checks.
- **chat-turn** — the server module owning one assistant turn (context build, engine call, keyword fallback).
- **page shell** — the single RSC helper owning session + gate + org context + fetchers + fallback for dashboard pages.
