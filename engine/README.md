# CoachAI engine

Finds the players who matter at each action, measures their movement with pose estimation, has a coach
model judge the moments that matter, and hands back a result, CSVs, an annotated video and an overlay.
It runs on any Gemini API key, and without one: the measurements and rule-based coaching still
come out, the job is just marked `degraded: ["llm"]`.

```
POST /scan ──► players + crops            (coach picks one)
POST /jobs ──► 202 queued ──► events ──► result.json, CSVs, analysis.mp4, track.json
                              │
                              ├─ SSE   GET /jobs/{id}/events        (replayable with Last-Event-ID)
                              └─ webhook POST callback_url          (signed, ordered, retried)
```

## How a job runs

| stage | does | model call |
|---|---|---|
| prepare | probe the video, hash it | – |
| track | find the action athlete at ~12 fps (internal only; the video shows no continuous tracking overlay). With no player selected, the dominant athlete is used | – |
| candidates | peaks of the sport's signal (wrist rising, wrist speed, ankle speed) become candidate moments | – |
| judge | one call: low-res video with the athlete boxed and moments numbered; the model says which are real, their type, result and per-criterion ratings. If the sport was not supplied, the model's answer selects the sport pack | 1 |
| result | measure criteria from pose at each moment, score them against the sport pack, pair the action player with the nearest opponent (different shirt colour first), derive sport key metrics for both, build findings, write exports | – |
| render | skeletons for the two players only around each event, running HUD, per-event metrics panel, measured angles coloured by target, session KPI card, thumbnails | – |

Measured numbers come only from pose geometry. A VLM rating is qualitative evidence: it keeps
`source: "vlm"`, `state` and `evidence_type: "judged"`, never writes a numeric `score`, and never
counts toward measurement coverage. Motion peaks from the rules fallback stay `event_state:
"candidate"`; they are not confirmed sports actions.
Tracking and verdicts are cached by content (video hash + athlete + sport + models), so a retry or a
second job on the same clip skips straight past them.

## Events

Every event has `seq` (ordering), `type`, `ts`, and `data`. Streams are job ids.

| type | when | webhook |
|---|---|---|
| `job.queued` / `job.started` | accepted / picked up (`attempt`) | yes |
| `stage.started` / `stage.completed` | per stage (`stage`, `ms`) | yes |
| `stage.progress` | `progress` 0-100, about once a second | SSE only |
| `candidates.found` | `count` | SSE only |
| `job.degraded` | `component` = `llm` or `render`, `reason` | yes |
| `result.ready` | `summary`, `needs_review`, `quality`; fetch `GET /jobs/{id}/result` | yes |
| `artifact.ready` | `name`, `kind`, `key` (`result.json`, `*.csv`, `track.json`, `analysis.mp4`, `thumbs/event_N.jpg`) | yes |
| `job.completed` | `duration_ms`, `degraded`, `summary` (terminal) | yes |
| `job.failed` | `code`, `message`, `retryable` (terminal) | yes |
| `job.cancelled` | terminal | yes |

`result.ready` arrives before the video is rendered, so a UI can show findings immediately.
A render failure never fails the job: it completes with `degraded: ["render"]`.

Scan progress uses `GET /scan-progress/{session}?angle=` with `scan.progress` / `scan.completed` / `scan.failed`.

### Webhooks

Set `callback_url` on `POST /jobs`. Each delivery is a POST of
`{job_id, seq, type, ts, data}` with `x-engine-timestamp` and
`x-engine-signature: sha256=HMAC_SHA256(SERVICE_TOKEN, timestamp + "." + rawBody)`.
Delivery is at-least-once and in order per job: a failed delivery is retried with backoff
(up to 12 times) before later events of that job are sent. Deduplicate on `(job_id, seq)` and
return 2xx quickly.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
export function verify(raw: string, ts: string, sig: string, secret: string) {
  const want = "sha256=" + createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  return Math.abs(Date.now() / 1000 - Number(ts)) < 300 && sig.length === want.length &&
         timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
```

## API

All routes except `/health` need `x-service-token` when `SERVICE_TOKEN` is set. Errors are
`{code, message, layer: "engine", retryable}`.

| route | |
|---|---|
| `POST /scan` (multipart `video`, `session_token?`, `angle?`) | stores the upload, returns `session_token`, `players[{player_index, confidence, crop_base64}]`, `media` |
| `POST /upload-intent`, `POST /scan-from-key` | direct-to-bucket upload (S3), then scan |
| `POST /jobs` | `{job_id?, session_token, angle?, player_index?, sport?, render?, callback_url?, meta?}` or `{video_key}`. Idempotent on `job_id`. 202 |
| `GET /jobs/{id}` | state, stage, progress, error, degraded, `meta` |
| `GET /jobs/{id}/events?after=` | SSE; `Last-Event-ID` resumes; closes after the terminal event |
| `GET /jobs/{id}/result` | the result (below) |
| `GET /jobs/{id}/files/{name}` | `analysis.mp4` (Range supported), `thumbs/event_N.jpg`, CSVs, `track.json` |
| `POST /jobs/{id}/cancel`, `/retry`; `DELETE /jobs/{id}` | |
| `POST /chat`, `/chat/stream`, `/report` | grounded in the measured result; 503 + `Retry-After` when the model has no quota |
| `GET /health`, `/health/deep`, `/sports/{sport}/positions` | |

Compatibility for a server not yet moved to events: `POST /analyze` (blocks until done),
`GET /status/{id}` (old shape), `GET /download/{id}`.

### Result (schema 5)

`events[]` each have `id` (`<job>:e<n>`), `t`, `type`, `result`, `event_state`
(`confirmed` | `uncertain` | `rejected` | `candidate`), `confirmed`, `score` (0-10 or null; only
valid measured criteria), `score_source`, `coverage`, `coverage_detail`, `feedback`, `confidence`,
`measurements[]` and `metrics[]`. Every measurement row carries four independent evidence axes:
`{criterion_id, source, state, evidence_type, validation_status, value, unit, score, weight,
measurement_type, calibration, confidence, source_frames, source_t, note}`. `source` is
`pose` / `object_tracking` / `vlm` / `rule` / `human_reference`; `state` is
`valid` / `low_confidence` / `invalid_view` / `occluded` / `unavailable` / `not_applicable`.
A judgement is not a measurement, and an unavailable criterion is not a zero.

Also `criteria_registry[]` (paper ID → engine key → implementation status), `event_detection`
(confirmed/uncertain/rejected/candidate counts), `failures[]` (F01–F14 with stage and retryability),
`aggregation` (`disabled_until_validated`), `fallback_policy`, `research_mode` (`false` unless the
job asked for it), `summary` (criterion-level text plus the experimental composite), `athlete`,
`quality`, `needs_review`, `degraded` and `provenance`.

`provenance.manifest` records the Git commit, sport-pack checksum, pose/VLM model identifiers,
prompt hash, video SHA-256 and metadata, camera angle source and research mode, the pack's declared
phase IDs, preprocessing parameters and environment. The same manifest is exported as `manifest.json`.

`summary.composite` is **experimental and unvalidated**. It is `null` unless valid measured
coverage reaches `MIN_MEASURED_COVERAGE` (0.65), and it is marked
`status: "experimental_unvalidated"`, `validated: false`, `excluded_from_research: true`.
Criterion-level evidence is the primary output.

CSV exports: `events.csv`, `measurements.csv`, `metrics.csv`, `findings.csv`, `session.csv`,
plus `manifest.json`.

## Sport packs

`engine/sports/<sport>.json`: the action signal, event types and results, scoring criteria
(`metric`, `ideal`, `acceptable`, `weight`, `look_for`, `drill`), role names (`roles.primary`,
`roles.opponent`) and `key_metrics` — the sport-specific performance numbers shown in the video
(`wrist_speed_peak`, `hip_rise`, `shoulder_hip_angle`, `stance_width`, `head_movement`,
`trunk_lean`, …). Key metrics are normalised by the athlete's torso length, so camera distance
does not change the reading.

The three research packs (`cricket`, `football`, `basketball`) also carry the manuscript metadata:
`action_id`, `pack_version`, `phases`, `objects`, `scope_note` and `paper_criteria` (the full
CR01–CR11 / FB01–FB12 / BB01–BB12 tables). Each implemented criterion has a permanent
`criterion_id`, `evidence_type`, `validation_status`, `measurement_type`, `calibration`,
`allowed_views` and `phase_scope`. A criterion whose `allowed_views` does not include the declared
camera view is `invalid_view`, not a poor score. `criteria_registry` in the result shows which
paper criteria are implemented, partial or not implemented.

Metrics: `elbow_angle`, `shoulder_angle` (active arm), `active_knee_angle` (active leg),
`knee_angle`, `hip_angle`, `ankle_angle` (both sides averaged), `trunk_lean_deg`, or an explicit
`left_`/`right_` joint. The bundled ranges are starting points: tune them with your coaches;
`version` and the pack checksum are stamped on every result. `allowed_views` is the camera gate;
`"primary"` means the view was not declared and the gate is not applied.

Pass `research: true` (job param) or set `ENGINE_RESEARCH_MODE=1` to run the engine fail-closed:
only a declared camera view can qualify a camera-gated criterion — an undeclared view reports the
criterion as `unavailable`, never measures from an assumed angle, and the manifest records
`camera.research_mode: true`. The composite stays excluded from research output either way.


## Running

```
pip install -r requirements.txt && cp .env.example .env
uvicorn main:app --port 8001          # first start downloads the pose model if missing
python -m cli.main clip.mp4 --sport basketball --list-players
python -m pytest tests
```

Docker: `docker build -t coachai-engine . && docker run -p 8001:8001 -v engine-data:/app/data --env-file .env coachai-engine`.
Run one process: the queue, SQLite and webhook sender live in it. Use `ENGINE_WORKERS` for
concurrency (each analysis needs roughly 300-500 MB); put `/app/data` on a persistent disk.
Jobs left unfinished by a restart are re-queued on boot.

## Development

- **Lint/format (Ruff):** config lives in `engine/pyproject.toml` (`[tool.ruff]`, Python 3.11 target). From `engine/`:
  - `ruff check .`
  - `ruff format --check .` (or `ruff format .` to apply)
- **Tests:** `./.venv/bin/python -m pytest tests -q` (or `python -m pytest tests` in an active venv). Current baseline: 76 tests pass.
- **Type checking:** mypy/pyright are not yet configured.
- **Dev dependencies:** lint/test/type-check tools are not declared in `requirements.txt`; install/manage them separately (do not add to runtime requirements without discussion).
