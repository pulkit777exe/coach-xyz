# CONTEXT.md — Domain Glossary

One line per term, sourced from actual code/docs (no invention). Deep detail lives in
`ARCHITECTURE.md`; feature narrative in `docs/V1_COACH.md` / `docs/V2_COACH.md`.

- **Analysis** — one analyzed video job. Two IDs: `server_job_id` (server's UUID, the
  user-facing id, mapping stored under `coachai:srv:*`, 2h TTL) and `engine_job_id`
  (engine's UUID, job state under `coachai:job:*`); mapping written/read by
  `server/src/lib/jobs.ts`.
- **Scan / Session** — the upload+detect step (`POST /api/scan-video` → engine `POST /scan`)
  that mints a `session_token` (engine UUID4, 2h in-memory, `engine/sessions.py`). Sessions
  are multi-angle: re-scanning with `session_token` + `angle` appends a camera angle
  (`engine/core/multicam.py`); `POST /analyze` takes `angle` (default `primary`).
- **Job pipeline states** — `uploading → scanning → player_selection → analyzing → rendering → completed`,
  plus terminal `failed`. Single source `STATE_FLOW` (`engine/core/jobs.py`), mirrored as a wire
  contract and pinned by contract tests in all three layers (`server/tests/pipelineContract.test.ts`,
  `web-next/lib/__tests__/pipeline.test.ts`, `engine/tests/test_state_machine.py`).
- **Transcript** — a chat message log behind the `Transcript` interface
  (`server/src/lib/transcript.ts`): `playerTranscript` scope = Redis `coachai:conv:*` (2h TTL,
  pipeline chat on `/api/chat/stream`); `dashboardTranscript` scope = Supabase `chat_messages`
  (auth-scoped dashboard chat). Seam only — the two stores are deliberately not merged.
- **Finding** — engine-derived evidence object, one per scored event (stable `{job}:e{n}` id,
  evidence frames, confidence band, severity); low evidence → `needs_review`, never a strong
  claim. Table `findings`; human review = approve/flag (`server/src/lib/findings.ts`).
- **Clip** — coach-curated `[start_ms, end_ms)` bookmark on an analysis's rendered video,
  optional finding link, 120s / 100-per-analysis caps; table `clips` (`server/src/lib/clips.ts`).
- **Org / Member / Role** — an org = one owning coach's scope, keyed by the owner's `auth0_id`.
  Member roles: `owner | admin | head_coach | assistant_coach | coach | analyst | medical`
  (`server/src/lib/orgMembers.ts`, mirrored contractually in `web-next/lib`). Account-level
  `users.role` is separate: `coach | player`, flipping to `player` when the login email
  auto-links a `students` row.
- **Attribution token** — signed `<sub>.<exp>.<hmac>` (HMAC-SHA256 over `sub.exp`, keyed by
  `SERVICE_TOKEN`, TTL 10 min) minted at `GET /api/me/attribution/mint`; browser-direct
  capability routes send it as `x-attribution` (downloads as `?attribution=`). A raw
  `x-auth0-id` is never trusted (`server/src/lib/attribution.ts`).
- **Tier / Quota / Usage** — org tier `free | pro | elite` (`getOrgTier`) bumps queue priority
  (+0/+5/+10) and the org's daily analysis count is capped by `ORG_DAILY_ANALYSIS_LIMIT`
  (default 50); consumption is ledgered in `usage_records`. All three are decided in one
  admission call: `admitAnalysis` (`server/src/lib/analysisAdmission.ts`), base priority 5
  (`/api/analyze`) or 10 (`/api/me/analyze`).
- **Retention sweep** — daily prune of old analyses + child rows (findings, clips,
  player_events, chat) honouring `RETENTION_DAYS` (default 365); scheduling lives in
  `server/src/lib/retention.ts` (24h interval, first run 60s after start), execution in
  `pruneRetention` (`server/src/lib/analyses.ts`).
- **Share token** — 48-hex random token (`coachai:share:*`, 72h TTL) minted by a coach for an
  analysis, redeemed at public `GET /api/share/:token`; revocable, distinguishes 404 (never
  existed) from 410 (expired) (`server/src/lib/shareTokens.ts`, `routes/share.ts`).
- **Job-not-found semantics** — `JOB_NOT_FOUND` means the job is expired or unknown; it answers
  `retryable: false` on every path (404 miss and the 200-poll expired answer alike) — retrying
  cannot fix it, the user re-uploads. Engine registry maps it to 404
  (`engine/core/errors.py` `STATUS_BY_CODE`/`RETRYABLE_BY_CODE`).
