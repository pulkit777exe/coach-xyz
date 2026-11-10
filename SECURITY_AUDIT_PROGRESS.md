# Security Audit Progress Update

**Date:** 2026-11-04
**Status:** Initial audit complete, one code fix applied

## Status update (2026-11-10)

Short progress note (factual, based on current codebase state as of 2026-11-10):

- **Resolved:** org-scoped routes (including `attendance`, `billing`, `wellness`, `compete`, etc.) have `serviceGuard` applied (S1/S2/S4/S5-type gaps).
- **Resolved:** engine `_ffprobe` no longer takes variadic `*args` (E2).
- **Resolved:** `server/src/lib/historyStore.ts` `ensureInitialized` is cached via `initPromise` (M12).
- **Mitigated:** engine CORS uses explicit methods and rejects wildcard origins in production (E4/M15 context).
- **Resolved:** engine `load_dotenv` is inside `load()` in config (M8).
- **Partially addressed:** UUID/`SESSION_TOKEN` regexes centralized in `server/src/types/index.ts` on the server side (M1).
- **Resolved:** `web-next/app/(site)` duplicate route group removed.
- **Mitigated/documented:** `SERVICE_TOKEN` warnings strengthened in `server/.env.example` and `web-next/.env.example`; `.env` is gitignored.
- **Restored:** security audit docs restored/maintained.

## ✅ Completed Actions (2026-11-04)

### 1. Engine: Fixed `_ffprobe()` command injection risk
- **File:** `engine/core/video.py:43-52`
- **Change:** Removed variadic `*args: str` parameter; hardcoded all ffprobe flags
- **Rationale:** Prevented potential flag injection if caller-controlled args were ever added
- **Impact:** Lowers attack surface for subprocess argument handling

### 2. Verified: No critical security gaps
- All 12 org-scoped routes have `.use(serviceGuard)` applied
- Capability-token routes (scan/analyze/download/chat) correctly use attribution tokens
- No cross-org access vulnerabilities via missing guards
- CSP, CORS, and headers are properly configured

### 3. Verified: Marketing pages are legitimate *(2026-11-04 note; superseded 2026-11-10)*
- `web-next/app/(site)/` previously contained public-facing pages; the duplicate `app/(site)` route group has since been removed (see 2026-11-10 status update).

## 📋 Remaining Prioritized Items

| Item | Effort | Status |
|------|--------|--------|
| Document `SERVICE_TOKEN` "never commit" warning | 15 min | ✅ Mitigated/documented in `server/.env.example` and `web-next/.env.example`; `.env` gitignored (2026-11-10) |
| Consolidate UUID/regex definitions | 30 min | Partially addressed — server-side UUID/`SESSION_TOKEN` regexes centralized in `server/src/types/index.ts` (2026-11-10) |
| Cache `ensureInitialized` in historyStore | 15 min | ✅ Resolved — cached via `initPromise` (2026-11-10) |
| Pin CORS origins in engine | 10 min | ✅ Mitigated — explicit methods; wildcard origins rejected in production (2026-11-10) |
| Prune unused web-next lib barrels | 1 hour | Pending |

## 📊 Audit Summary

The application has a **strong security foundation**:
- Identity boundary (`serviceGuard`) is well-designed and correctly applied
- No critical vulnerabilities requiring production blocking
- Main value is in maintainability: consolidating duplicated logic, reducing indirection

The full detailed audit is at `SECURITY_AUDIT_SUMMARY.md`.
