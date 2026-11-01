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

Measured numbers come only from pose geometry. A rating from the model fills in criteria that
could not be measured, counts for half, and is labelled `source: "judged"`.
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

### Result (schema 3)

`events[]` each have `id` (`<job>:e<n>`), `t`, `type`, `result`, `score` (0-10 or null),
`score_source` (`measured` | `judged`), `coverage`, `feedback`, `confidence`, `measurements[]`
(`{key, label, metric, value, unit, ideal, acceptable, score, weight, source, confidence, note}`),
`metrics[]` (the sport's key numbers at that moment) and `matchup` (the action player and the nearest
opponent, each with role, side, confidence and `metrics[]`, plus separation in torso lengths and the
frames used for the overlay). Also `session_metrics[]` (session average, best and worst per key metric,
plus tempo, action rate, pose coverage and opponent distance), `findings[]`, `consistency[]`,
`summary` (rating, average, success rate, confidence, text, strengths, focus areas, priority drill),
`athlete`, `quality`, `needs_review`, `degraded`, `provenance`.

CSV exports: `events.csv`, `measurements.csv`, `metrics.csv`, `findings.csv`, `session.csv`.

## Sport packs

`engine/sports/<sport>.json`: the action signal, event types and results, scoring criteria
(`metric`, `ideal`, `acceptable`, `weight`, `look_for`, `drill`), role names (`roles.primary`,
`roles.opponent`) and `key_metrics` — the sport-specific performance numbers shown in the video
(`wrist_speed_peak`, `hip_rise`, `shoulder_hip_angle`, `stance_width`, `head_movement`,
`trunk_lean`, …). Key metrics are normalised by the athlete's torso length, so camera distance
does not change the reading.
Metrics: `elbow_angle`, `shoulder_angle` (active arm), `active_knee_angle` (active leg),
`knee_angle`, `hip_angle`, `ankle_angle` (both sides averaged), `trunk_lean_deg`, or an explicit
`left_`/`right_` joint. The bundled ranges are starting points: tune them with your coaches;
`version` is stamped on every result.


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
