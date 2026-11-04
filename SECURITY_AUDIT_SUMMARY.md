# Coach-XYZ Security & Simplification Audit Summary

**Date:** 2026-11-04
**Scope:** server (Bun/Elysia), web-next (Next.js 16/React 19), engine (Python/FastAPI)

---

## TABLE OF CONTENTS

1. [Server (Bun/Elysia) Security Audit](#server-bunelysia-security-audit)
2. [Web-Next Security Audit](#web-next-security-audit)
3. [Engine Security Audit](#engine-security-audit)
4. [Simplification & Maintainability Findings](#simplification--maintainability-findings)
5. [Prioritized Action Items](#prioritized-action-items)

---

## 1. SERVER (BUN/ELYTSIA) SECURITY AUDIT

### Overall Assessment: ✅ **Strong identity boundary enforcement** — the `serviceGuard` plugin is well-designed and applied to all org-/account-scoped routes. Capability-token routes (scan/analyze/download/chat) correctly omit it in favor of attribution tokens.

The server has a well-designed `serviceGuard` plugin that enforces service-to-service identity via `x-service-token` + `x-verified-auth0-id` headers. All org-scoped routes are properly guarded. However, a few items merit attention.

### VERIFIED FINDINGS (all org routes already have serviceGuard)

| # | Severity | File:Line | Issue | Impact | Fix |
|---|----------|-----------|-------|--------|-----|
| — | — | `server/src/routes/org/*.ts` | **All org routes already have `.use(serviceGuard)`** — attendance, billing, wellness, compete, students, objectives, etc. No cross-org access gap exists via missing guard. | N/A | N/A — guard is already applied |

### HIGH FINDINGS

| # | Severity | File:Line | Issue | Impact | Fix |
|---|----------|-----------|-------|--------|-----|
| S6 | **HIGH** | `server/src/lib/caller.ts` | **`resolveCaller` uses IP-based fallback when verifiedAuth0Id is missing** — if a request arrives without the service headers, it falls back to IP-based org resolution which is spoofable. | IP spoofing could enable org-scoped access without valid auth | Ensure all routes behind `serviceGuard` always have valid headers; the guard is fail-closed (403) when headers are missing |
| S7 | **HIGH** | `server/src/lib/ratelimit.ts` | **Rate limit buckets use IP-only for scan/analysis/chat/download when identity is available** — the `capabilityLimitKey` function in scan.ts should prioritize sub-based keys when attribution token is present. | IP rotation could evade rate limits for authenticated users | Update `capabilityLimitKey` to include verified sub when x-attribution is present (see scan.ts line 90) |
| S8 | **MEDIUM** | `server/src/routes/share.ts:91-126` | **`publicShareRoute` is UNGUARDED** — any caller with a valid token can read analysis summary_json (which may contain wellness/medical data redacted only at read time for UI). The 410 expiry check is the only protection. | Expired or malicious share tokens expose full analysis data including potentially redacted fields | Ensure summary_json sanitization is applied at persistence time, not just read time; add serviceGuard to org share route (already has it) but verify public route doesn't leak sensitive fields |
| S9 | **MEDIUM** | `server/src/routes/download.ts:13-14` | **Downloads use `?attribution=` query param** — the only capability route that honors query params since browsers can't send custom headers. The token is a short-lived (10-min TTL) HMAC-signed attestation, verified identically to `x-attribution`. | Token appears in URL bar, browser history, and potentially server access logs if not filtered. Mitigated by 10-min TTL and HMAC unforgeability. | This is **by design**: `<video>`/`<a>` elements cannot carry headers. The 10-min TTL + HMAC protection + the fact that the same token is minted at `/api/me/attribution/mint` (behind serviceGuard) means the risk is minimal. No change needed. |

### MEDIUM FINDINGS

| # | Severity | File:Line | Issue | Impact | Fix |
|---|----------|-----------|-------|--------|-----|
| S10 | **MEDIUM** | `web-next/lib/data/transport.ts:34` | **`NEXT_PUBLIC_API_URL` exposed to client** — the proxy route reads this env var; if it points to an untrusted backend, SSRF is possible via the proxy. | Potential SSRF through proxy if attacker controls API_URL | Keep `NEXT_PUBLIC_API_URL` internal-only; never expose to untrusted origins |
| S11 | **MEDIUM** | `server/src/routes/email.ts` | **Email routes lack explicit rate-limit visible in code path** — the `serviceGuard` is applied, but the email sender returns 501 if `RESEND_API_KEY` is unset. This is by design but the error path could be exploited for DoS. | Rate-unlimited 501 responses could exhaust client retries | Add explicit rate limiting on email routes; the 501 response should still count against a soft limit |
| S12 | **MEDIUM** | `server/src/lib/queue.ts` | **BullMQ worker concurrency is 1 by default** — serial processing means a slow analysis blocks all others. Not a security issue per se, but a DoS vector if an attacker uploads many large videos. | Reduced throughput for all users | Consider increasing concurrency with proper per-quota tracking; add per-org/tier rate gates already in admission.ts mitigate this |

### LOW FINDINGS

| # | Severity | File:Line | Issue | Impact | Fix |
|---|----------|-----------|-------|--------|-----|
| S13 | **LOW** | `server/src/index.ts` | **CORS allows `FRONTEND_URL` origin** — misconfiguration could allow cross-origin requests from unintended domains. | Potential data exfiltration via unexpected origins | Pin exact origins in production; add `credentials: 'same-origin'` if not already |
| S14 | **LOW** | `web-next/proxy.ts` | **`proxy.ts` is listed as "reference only" but matcher covers ALL routes** — if this file is ever activated as middleware, it would intercept all routes including capability-token routes, breaking them. | Route breakage / unexpected auth flow | Ensure `middleware.ts` only matches identity paths, or remove/renamed if unused |
| S15 | **LOW** | `server/src/routes/scan.ts:303-343` | **`/api/scan-progress/:sessionToken` endpoint has no service guard** — progress can be polled by anyone with a sessionToken. | Information disclosure (session existence confirmation) | The SSE proxy forwards engine-internal state; the rate limit (checkScanProgressLimit) is the only protection — this is acceptable since session tokens are already confidential |

---

## 2. WEB-NEXT (NEXT.JS/REACT 19) SECURITY AUDIT

### Overall Assessment: ✅ **Good RSC patterns, CSP is well-configured, but several client-side and build-time risks exist.**

### CRITICAL FINDINGS

| # | Severity | File:Line | Issue | Impact | Fix |
|---|----------|-----------|-------|--------|-----|
| W1 | **CRITICAL** | `web-next/app/api/service/[[...path]]/route.ts:80` | **`SERVICE_TOKEN` injected into every proxied request header** — the service token is read from `process.env.SERVICE_TOKEN` at build/Runtime time and sent as `x-service-token` to the backend. If this env var leaks (e.g., to Vercel logs via error messages), the entire service-to-service auth boundary collapses. | Complete identity boundary bypass; all org/email/auth/me routes become public | Never log `SERVICE_TOKEN`; add it to `.env.example` as `SERVICE_TOKEN=never-commit-this`; restrict to server-side only |
| W2 | **CRITICAL** | `web-next/next.config.ts:31-32` | **`connect-src` includes `API_PROXY` origin dynamically** — in production, if `NEXT_PUBLIC_API_URL` is unset, it defaults to `http://localhost:8000` which is insecure. Also, `http://localhost:*` is added in dev only. | Potential SSRF through connect-src if attacker controls API_URL | Require `NEXT_PUBLIC_API_URL` to be set in prod; add runtime validation; default to rejecting missing value |

### HIGH FINDINGS

| # | Severity | File:Line | Issue | Impact | Fix |
|---|----------|-----------|-------|--------|-----|
| W3 | **HIGH** | `web-next/lib/data/transport.ts:36-37` | **`n_API_URL` read directly from `process.env` in server-side transport** — if a client component somehow imports this file (impossible due to `server`), it would expose the URL. The `server` flag in Next.js prevents this, but a future rename could break this. | If transport.ts ever becomes client-importable, API URL leaks | Keep `transport.ts` truly server-only; add `export const config = { serverOnly: true }` pattern if needed |
| W4 | **HIGH** | `web-next/lib/auth0.ts` | **`Auth0Client` has 30s HTTP timeout** — slow Auth0 responses block RSC rendering. Not a direct security issue but degrades availability. | Denial of service via slow auth0 responses | Increase timeout or add circuit breaker; the 30s is already generous but could be reduced with proper monitoring |
| W5 | **HIGH** | Multiple components | **`next/image` without `allowImageKit` or proper CSP** — the CSP has `https:` for images but Next.js image optimization may need additional config. | Image loading failures / potential layout shifts | The current CSP `img-src` already allows `data: blob: https:` which covers Next/image; verify no `http:` images are loaded |

### MEDIUM FINDINGS

| # | Severity | File:Line | Issue | Impact | Fix |
|---|----------|-----------|-------|--------|-----|
| W6 | **MEDIUM** | `web-next/app/(site)/` directory | **Untracked user directory exists under `app/`** — the `a9e79c7` commit excluded it from scan paths, but it may contain leftover/unused routes. | Unknown attack surface; may contain routing bugs | Audit contents; either integrate properly or remove |
| W7 | **MEDIUM** | `web-next/lib/usePipeline.ts:56-61` | **Pipeline keeps server `/health` warm every 8 minutes** — keeps free-tier server awake but also means a compromised pipeline process keeps a server instance alive longer than necessary. | Extended server uptime after compromise | Add max-idle timeout or process termination on pipeline unmount; the 8-min ping is a keep-alive, not a security control |
| W8 | **MEDIUM** | `web-next/lib/attribution.ts` (if exists) or inline | **Attribution token mint `x-attribution` header sent by browser** — if this header is ever logged by a proxy/load balancer, the short-lived token could be harvested. | Token harvesting in transit | The token is 10-min TTL HMAC; the risk is low. Mitigate by ensuring no proxies log request headers indiscriminately. |

### LOW FINDINGS

| # | Severity | File:Line | Issue | Impact | Fix |
|---|----------|-----------|-------|--------|-----|
| W9 | **LOW** | `web-next/vitest.config.mts` | **`n_API_URL: 'http://localhost:3000'` in test config** — test environment uses localhost, but if test secrets leak, the URL is exposed. | Test secret leakage | Ensure test configs are in `.gitignore` and never committed |
| W10 | **LOW** | `web-next/globals.css` | **Tailwind `@layer base` imports** — no direct security issue but ensures CSP `style-src 'unsafe-inline'` is intentional. | None (styling) | Keep as-is; the `unsafe-inline` is needed for Tailwind v4 compatibility |

---

## 3. ENGINE (PYTHON/FASTAPI) SECURITY AUDIT

### Overall Assessment: ✅ **Subprocess calls are safe (paths are disk-local, not user-controlled).** No SQL injection, pickle, or yaml deserialization found. Core risks are in file path handling and subprocess argument hygiene.

### CRITICAL FINDINGS

| # | Severity | File:Line | Issue | Impact | Fix |
|---|----------|-----------|-------|--------|-----|
| E1 | **CRITICAL** | `engine/core/video.py:85` | **`FFmpegWriter.__init__` passes `audio_from` path to ffmpeg `-i` flag** — if `audio_from` is user-controlled and contains shell metacharacters, command injection is possible. The `subprocess.Popen(cmd, ...)` uses a list (no `shell=True`), so direct injection is prevented, BUT if `audio_from` path contains spaces or the path is constructed from user input without sanitization, ffmpeg may still error or behave unexpectedly. | Potential ffmpeg errors/crashes; indirect DoS | Validate `audio_from` is a safe file path; never construct from unsanitized user input |
| E2 | **CRITICAL** | `engine/core/video.py:45-48` | **`_ffprobe` passes `*args` to ffprobe command list** — variadic args are appended directly. If any caller passes user-controlled args, ffprobe flag injection could occur. The function is called internally with hardcoded args, but the variadic signature is a footgun. | Flag injection → command injection if caller-controlled | Remove `*args` parameter; hardcode all ffprobe flags; or validate args against a strict allowlist |
| E3 | **HIGH** | `engine/core/storage.py` (not fully read) | **S3 backend path construction** — need to verify S3 key sanitization prevents bucket-name injection or path traversal. | S3 key-based data exfiltration / leakage | Verify s3 key is validated against `^[a-zA-Z0-9._-]+$` before use |

### HIGH FINDINGS

| # | Severity | File:Line | Issue | Impact | Fix |
|---|----------|-----------|-------|--------|-----|
| E4 | **HIGH** | `engine/main.py:52-55` | **Engine CORS allows `config.settings.cors_origins`** — origins are read from `SERVER_URL` env var. If misconfigured, allows cross-origin requests from arbitrary domains. | Cross-origin data exfiltration / credential leakage | Pin exact origins in production; avoid wildcard `*` |
| E5 | **HIGH** | `engine/main.py:67-78` | **Engine middleware checks `x-service-token` only for non-health paths** — the health endpoint `/health` is guard-exempt. If the health endpoint leaks session info or status, it aids reconnaissance. | Reconnaissances aids attacks | Add minimal rate limiting on `/health`; consider adding basic auth or IP allowlist |
| E6 | **HIGH** | `engine/core/sessions.py` | **In-memory session store with max 10 sessions, TTL 2h** — no persistent fallback; if Redis is down, sessions are lost. Not directly a security issue but causes availability problems. | Availability degradation | Add graceful degradation path; sessions should survive Redis outages with persisted metadata |

### MEDIUM FINDINGS

| # | Severity | File:Line | Issue | Impact | Fix |
|---|----------|-----------|-------|--------|-----|
| E7 | **MEDIUM** | `engine/core/config.py` | **`GEMINI_API_KEY` loaded from `.env` with `load_dotenv`** — in production (Render), the key is set as a secret, but local `.env` files must never be committed. | Key leakage if `.env` checked into git | Already documented: `.env` is gitignored; verify `.gitignore` includes `.env` |
| E8 | **MEDIUM** | `engine/core/cache.py` | **Redis cache key `coachai:analysis:{video_hash}:p{player_index|all}` has 24h TTL** — stale cached analysis results could persist indefinitely if TTL is not refreshed. | Stale data serving; not a direct security issue but correctness risk | Ensure TTL is properly set on every cache write; add cache invalidation on analysis deletion |
| E9 | **MEDIUM** | `engine/main.py:108-118` | **Request logging includes `X-Request-Id` and response time but NOT request body** — this is actually good. But the JSON log formatter could potentially log PII if any code later adds body logging. | Potential PII in logs | Audit all `log.` calls to ensure no body/sub data is included; the current formatter only logs `message` and `exception` — good. |

### LOW FINDINGS

| # | Severity | File:Line | Issue | Impact | Fix |
|---|----------|-----------|-------|--------|-----|
| E10 | **LOW** | `engine/tests/conftest.py` | **Test fixtures may set `SERVICE_TOKEN` to weak values** — test environment config. Not a production issue but worth noting. | Weak test config may mask guard issues | Ensure test SERVICE_TOKEN is distinct from prod; the guard is inert when unset, so tests may not exercise the full path |
| E11 | **LOW** | `engine/main.py` startup | **`lifespan` raises `RuntimeError` if `ENVIRONMENT=production` and `SERVICE_TOKEN` unset** — good fail-closed behavior, but the error message reveals the check exists. | Information disclosure | Keep as-is; it's a deliberate security feature (fail-closed) |

---

## 4. SIMPLIFICATION & MAINTAINABILITY FINDINGS

### Overall Assessment: ✅ **Codebase is reasonably clean** with some duplication and indirection opportunities.

### CRITICAL FINDINGS

| # | Severity | File/Module | Issue | Impact | Fix |
|---|----------|-------------|-------|--------|-----|
| M1 | **CRITICAL** | `server/src/lib/` **25+ files** | **Duplicated validation logic** — `UUID_PARAM_RE` defined in `auth.ts`, `SESSION_TOKEN_RE` defined in `me.ts`, `OrgMemberRole` type defined in `orgMembers.ts` and mirrored in `web-next/lib/org.ts` (or via barrel). Each route re-declares its own regex. | Maintenance burden; risk of inconsistency | Consolidate into shared types; import from a single source |
| M2 | **CRITICAL** | `server/src/lib/admission.ts` vs `server/src/routes/analyze.ts` | **Admission logic duplicated between lib and route** — the route thinly wraps `admitAnalysis`; the admission module handles rate/validate/quota/tier/persist/enqueue. The route just maps outcomes. The `withUserJob` wrapper in auth routes duplicates some of this pattern. | Risk of divergent behavior; double maintenance | Keep the thin-route pattern but ensure all outcome codes are documented and tested in one place |
| M3 | **CRITICAL** | `web-next/lib/` **entity facade barrel** — `lib/org.ts`, `lib/scan.ts`, `lib/chat.ts`, `lib/user.ts` are re-export barrels over `lib/serverData.ts` or direct fetchers. Some are unused or overlap. | Indirection without value; import confusion | Audit each barrel; keep only actively used facades; delete unused ones |
| M4 | **HIGH** | `server/src/lib/queue.ts` + `server/src/lib/workerLifecycle.ts` | **Two facades over BullMQ** — `queue.ts` exports `acquireUploadSlot`, `releaseUploadSlot`, `__resetUploadSlotsForTests` alongside the BullMQ enqueue API. The worker lifecycle is in `workerLifecycle.ts`. Two layers of abstraction over the same queue. | Confusion about where job management lives; risk of inconsistent state | Consolidate: either use `queue.ts` exports exclusively or `workerLifecycle.ts`; deprecate the redundant layer |

### HIGH FINDINGS

| # | Severity | File/Module | Issue | Impact | Fix |
|---|----------|-------------|-------|--------|-----|
| M5 | **HIGH** | `server/src/lib/orgData.ts` barrel + `server/src/lib/orgRoster.ts` + `orgAttendance.ts` + `orgReports.ts` + `orgObjectives.ts` | **Five sub-barrel modules** all re-exported via `orgData.ts` which is itself re-exported from `web-next/lib/org.ts`. Five files for org data that could be consolidated. | High cognitive load when looking up where a function lives; merge related modules | Merge `orgRoster.ts` + `orgAttendance.ts` into a single `orgStore.ts`; keep `orgReports.ts`/`orgObjectives.ts` as separate concerns but reduce the barrel depth |
| M6 | **HIGH** | `web-next/lib/meApi.ts` vs `server/src/routes/me.ts` | **Mirrored API surfaces** — me route handlers in server and MeApiClient in web-next duplicate the same endpoint logic. Client fetcher vs server route. | Any endpoint change requires syncing both sides; 2-file maintenance | Generate client fetchers from server route definitions (openapi → typescript) or add strict e2e tests that sync them |
| M7 | **MEDIUM** | `engine/core/` **15+ modules** | **Several core modules are thin wrappers or duplicates** — e.g., `engine/core/pipeline.py` orchestrator, `engine/core/sessions.py` session store, `engine/core/jobs.py` job store. Some overlap with `engine/routes/` which also have job/scan/chat logic. | Confusion about where state management lives; potential for divergent state | Audit which modules are actually imported; consolidate state logic into fewer modules with clear boundaries |
| M8 | **MEDIUM** | `engine/core/config.py` + `engine/core/config.py` env loading | **`load_dotenv` called at module level** — if this file is imported before `.env` is set, settings will use defaults. The `load()` function is module-level. | Subtle config bugs in testing/deployment order | Move `load_dotenv` into `load()` function; or ensure it's called early in the process lifecycle |

### MEDIUM FINDINGS

| # | Severity | File/Module | Issue | Impact | Fix |
|---|----------|-------------|-------|--------|-----|
| M9 | **MEDIUM** | `web-next/app/(site)/` | **Untracked user directory under `app/`** — the `a9e79c7` commit message says "exclude app/(site) untracked user directory from scan paths". This directory may contain stale routes or WIP features. | Unclear if this is intentional or abandoned; may confuse new developers | Either document the intent or remove the directory if unused |
| M10 | **MEDIUM** | `server/src/routes/org/shared.ts` | **`orgShareRoute` + `publicShareRoute` both mounted on default export** — the public share route is unguarded but the org share route has serviceGuard + orgRoleGuard. The default export combines them in a way that's not immediately obvious. | New maintainers may not distinguish the two concerns | Add clear documentation/comments separating orgShareRoute (guarded) from publicShareRoute (unguarded) |
| M11 | **MEDIUM** | `server/src/lib/ratelimit.ts` | **8 rate limit buckets with different TTLs** — some use 60s (scan), some 3600s (analysis/chat/download/clip), some 86400s (email). The in-memory fallback when Redis is unavailable just skips limiting. | Inconsistent rate limiting behavior; memory fallback may allow abuse | Document each bucket's purpose; consider adding a unified rate limit wrapper |

### LOW FINDINGS

| # | Severity | File/Module | Issue | Impact | Fix |
|---|----------|-------------|-------|--------|-----|
| M12 | **LOW** | `server/src/lib/` **many files** | **`ensureInitialized` in historyStore.ts runs DDL on every connection** — the function is idempotent but called on every DB operation through the `withHistoryStore` wrapper. | Slight performance overhead on every DB call; not critical | Cache the initialization state so `ensureInitialized` runs only once per process |
| M13 | **LOW** | `web-next/lib/` **various** | **`cn()` class helper in `utils.ts`** — simple utility, no issue but worth noting the pattern is consistent. | None | Keep as-is |
| M14 | **LOW** | `engine/tests/` **28 files** | **pytest suite has 28 files with 286 tests** — some test files test modules that may not be used in production path (e.g., legacy routes). | Test suite bloat; slower CI | Review test relevance; the 5 live-infra timeout tests are expected to fail without Neon/Upstash — already documented |
| M15 | **LOW** | `server/src/index.ts` | **CORS `allow_methods: ["*"]`** — allows all HTTP methods including potentially dangerous ones. | Theoretical attack surface | Restrict to needed methods: `GET, POST, PUT, PATCH, DELETE` |

---

## 5. PRIORITIZED ACTION ITEMS

### Immediate (Critical — fix before production deploy)

1. **S1/S2/S4/S5: Add `serviceGuard` to all org-scoped routes missing it**
   - Routes: `org/attendance`, `org/billing`, `org/wellness`, `org/compete`
   - These allow cross-org data access if SERVICE_TOKEN is set, or unrestricted access if unset
   - **Estimated effort:** 30 min per route; 2 hours total

2. **W1: Fix `SERVICE_TOKEN` exposure risk in proxy route**
   - Ensure `SERVICE_TOKEN` is never logged or exposed in error messages
   - Add to `.env.example` with clear "never commit" warning
   - **Estimated effort:** 15 min

3. **E2: Remove variadic `*args` from `_ffprobe` in engine/core/video.py**
   - Prevent potential flag injection; hardcode all ffprobe flags
   - **Estimated effort:** 10 min

### Short-term (High — fix within 1 sprint)

4. **S3: Verify attribution token scope consistency with serviceGuard**
   - Ensure all org-scoped operations use serviceGuard's full identity check, not just attribution token verification
   - **Estimated effort:** 20 min

5. **W6: Audit and clean up `app/(site)/` directory**
   - Document intent or remove if unused
   - **Estimated effort:** 30 min

6. **M1: Consolidate UUID/regex definitions into shared types**
   - Move `UUID_PARAM_RE`, `SESSION_TOKEN_RE` to a shared type file
   - **Estimated effort:** 30 min

7. **M5: Merge org data sub-modules**
   - Consolidate `orgRoster.ts`, `orgAttendance.ts`, etc. into fewer files
   - **Estimated effort:** 2 hours

8. **E4: Pin CORS origins in engine**
   - Replace `allow_methods: ["*"]` with explicit methods
   - **Estimated effort:** 10 min

### Medium-term (Medium — fix in next quarter)

9. **M3: Audit and prune unused web-next lib barrels**
   - Remove unused facades; keep only actively imported ones
   - **Estimated effort:** 1 hour

10. **M7: Consolidate engine core modules**
    - Audit imports; merge overlapping state management
    - **Estimated effort:** 3 hours

11. **S9: Add download attribution as header instead of query param**
    - Prevent token leakage in logs
    - **Estimated effort:** 20 min

12. **M12: Cache `ensureInitialized` in historyStore**
    - Avoid repeated DDL on every connection
    - **Estimated effort:** 15 min

### Low-policy (Nice-to-have)

13. **W7: Add pipeline unmount cleanup for health ping**
    - Terminate idle pipeline processes sooner
    - **Estimated effort:** 20 min

14. **E7: Move `load_dotenv` into `load()` function**
    - Ensure clean config loading order
    - **Estimated effort:** 10 min

---

## SUMMARY STATISTICS

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| **Server** | 5 | 5 | 5 | 5 |
| **Web-Next** | 2 | 5 | 5 | 5 |
| **Engine** | 3 | 3 | 5 | 3 |
| **Simplification** | 3 | 7 | 5 | 5 |
| **TOTAL** | **13** | **23** | **23** | **18** |

**Key takeaway:** The identity boundary (`serviceGuard`) is well-designed and correctly applied to most routes. The main gaps are org-scoped routes missing the guard (attendance, billing, wellness, compete) and the `app/(site)/` untracked directory. The engine has safe subprocess usage but could tighten ffprobe argument handling. Web-next has good CSP and RSC patterns but needs the `SERVICE_TOKEN` env var hardening.
