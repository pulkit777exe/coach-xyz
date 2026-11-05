# Research alignment

This document maps the manuscript *A Sport-Configurable, Evidence-Aware Framework for
Video-Based Technique Assessment in Cricket, Football and Basketball* (design and
evaluation protocol, v1.0) onto the engine. It is the traceability record from
paper → sport pack → measurement → result JSON → evaluation record.

Status values:

- **implemented** — the runtime path exists and is covered by tests.
- **partial** — a related measurement exists, but it is not the full paper construct.
- **not implemented** — the paper lists it as a candidate criterion; the engine abstains.
- **excluded** — the paper explicitly excludes it from the protocol.

The manuscript is a design-and-protocol document. Nothing here is a validated
accuracy claim.

## Evidence model

The result keeps four independent axes; they are never collapsed into one field.

| Axis | Values | Meaning |
|---|---|---|
| `evidence_type` | `measured`, `conditional`, `judged`, `excluded` | role of the criterion in the rubric |
| `source` | `pose`, `object_tracking`, `vlm`, `rule`, `human_reference` | where the evidence came from |
| `state` | `valid`, `low_confidence`, `invalid_view`, `occluded`, `unavailable`, `not_applicable` | whether the evidence can support a claim |
| `validation_status` | `proposed`, `coach_reviewed`, `measurement_tested`, `coach_validated`, `production_approved` | research lifecycle |

A VLM observation can be `source: "vlm"`, `state: "valid"`, `evidence_type: "judged"` while a pose
measurement is `source: "pose"`, `state: "invalid_view"`. The first is usable qualitative evidence;
the second is not a measurement. Only `source ∈ {pose, object_tracking, human_reference}` with
`state = "valid"` is scorable.

The engine also records `criterion_id`, `phase`, `source_frames`, `source_t`, `measurement_type`,
`calibration`, `confidence`, `confidence_kind` and `note` on every row.

## Criterion traceability

Each research pack carries the full paper table in `paper_criteria` and a permanent ID on every
implemented criterion. The result exposes the same mapping in `criteria_registry`.

### Cricket — front-foot off-drive (`CR01`–`CR11`)

| ID | Paper criterion | Engine key | Status | Note |
|---|---|---|---|---|
| CR01 | Preparatory foot movement | — | not implemented | Needs temporal foot landmarks. |
| CR02 | Front-foot displacement | — | not implemented | Physical distance needs ground-plane calibration. |
| CR03 | Head trajectory relative to pelvis | — | not implemented | Head proxy is not yet extracted. |
| CR04 | Support-knee trajectory | `base` (`knee_angle`) | partial | Single-window image-plane knee angle, not a trajectory. |
| CR05 | Trunk inclination | `head_position` (`trunk_lean_deg`) | partial | Image-plane trunk lean, not calibrated 3D inclination. |
| CR06 | Pelvis/shoulder orientation | `hips` (`hip_angle`) | partial | Image-plane hip angle, not 3D rotation. |
| CR07 | Bat trajectory | `arm_extension` (`elbow_angle`) | partial proxy | Lead-elbow extension is a proxy; the bat is not tracked. |
| CR08 | Bat-face orientation | — | not implemented | Needs bat geometry and a calibrated view. |
| CR09 | Bat-ball contact interval | — | not implemented | Needs high-speed bat and ball tracking. |
| CR10 | Post-stroke balance/recovery | — | not implemented | Needs an operational recovery interval. |
| CR11 | Shot selection | — | excluded | Requires delivery reading and tactical context. |

### Football — stationary-ball instep kick (`FB01`–`FB12`)

| ID | Paper criterion | Engine key | Status | Note |
|---|---|---|---|---|
| FB01 | Approach trajectory | — | not implemented | Needs a calibrated ground plane and step count. |
| FB02 | Final-step configuration | — | not implemented | Needs feet/pelvis temporal relationship. |
| FB03 | Support-foot placement | — | not implemented | Needs support foot, ball and ground plane. |
| FB04 | Support-knee trajectory | — | not implemented | Needs side/oblique validation. |
| FB05 | Kicking-hip trajectory | `hip_position` (`hip_angle`) | partial | Single-window image-plane hip angle. |
| FB06 | Kicking-knee extension | `kick_extension` (`active_knee_angle`) | partial | Single-window image-plane knee angle. |
| FB07 | Trunk/pelvis orientation | `lean` (`trunk_lean_deg`) | partial | Image-plane trunk lean, not 3D rotation. |
| FB08 | Segmental timing | — | not implemented | Needs predefined onset/peak definitions. |
| FB09 | Foot orientation/contact geometry | — | not implemented | Needs foot keypoints/segmentation and the ball. |
| FB10 | Foot-ball contact point | — | not implemented | Needs high-speed calibrated object geometry. |
| FB11 | Follow-through/recovery | — | not implemented | Needs a full-body temporal sequence. |
| FB12 | Tactical choice | — | excluded | Requires opponent, goalkeeper and match context. |

### Basketball — free throw (`BB01`–`BB12`)

| ID | Paper criterion | Engine key | Status | Note |
|---|---|---|---|---|
| BB01 | Initial stance/foot alignment | — | not implemented | Needs both feet and a ground reference. |
| BB02 | Knee-flexion trajectory | `leg_drive` (`knee_angle`) | partial | Single-window image-plane knee angle. |
| BB03 | Hip/trunk movement | `balance` (`trunk_lean_deg`) | partial | Image-plane trunk lean, not pelvis displacement/COM. |
| BB04 | Shooting-elbow extension | `arm_extension` (`elbow_angle`) | partial | Single-window image-plane elbow angle. |
| BB05 | Shoulder movement | `arm_elevation` (`shoulder_angle`) | partial | Image-plane shoulder angle. |
| BB06 | Shoulder-elbow-wrist sequencing | — | not implemented | Needs temporal upper-limb series. |
| BB07 | Wrist/hand configuration | — | not implemented | Needs hand landmarks and ball visibility. |
| BB08 | Ball trajectory | — | not implemented | Needs ball detection/tracking. |
| BB09 | Release height/angle/velocity | — | not implemented | Needs calibration and adequate frame rate. |
| BB10 | Follow-through consistency | — | not implemented | Needs repeated attempts. |
| BB11 | Post-release stability | — | not implemented | Needs full-body temporal pose. |
| BB12 | Psychological focus | — | excluded | Not reliably observable. |

The packs also contain product-only event types (for example layups and catch-and-shoot in
basketball, moving-ball kicks in football, and the broader cricket stroke set). `scope_note` in each
pack states that those are outside the research protocol until separately configured and validated.

## Failure taxonomy

Failure codes are separate from job state. A job can be `completed`/`degraded` with several codes.

| Code | Meaning | Where recorded |
|---|---|---|
| F01_ATHLETE_NOT_FOUND | No target athlete detected | `failures[]`, pipeline error path |
| F02_IDENTITY_SWITCH | Track identity changed | reserved; track diagnostics |
| F03_MISSING_LANDMARK | Required landmark absent | measurement `state` (`occluded`/`unavailable`) |
| F04_INVALID_GEOMETRY | Degenerate vectors / impossible geometry | measurement `state` |
| F05_UNSUITABLE_VIEW | Camera view cannot support the criterion | measurement `state` (`invalid_view`) |
| F06_OBJECT_NOT_DETECTED | Required ball/bat/object absent | reserved; object tracking |
| F07_MISSED_CANDIDATE | Event annotation missed | offline evaluation |
| F08_FALSE_CANDIDATE | Event candidate not in annotation | offline evaluation |
| F09_INCORRECT_VLM_JUDGEMENT | VLM judgement disagrees with reference | offline evaluation |
| F10_UNSUPPORTED_OBSERVATION | Claim not supported by visible evidence | judgement `state` (`uncertain`/`rejected`) |
| F11_VLM_UNAVAILABLE | Model unavailable, timed out or rate-limited | `failures[]`, degraded job |
| F12_INVALID_STRUCTURED_RESPONSE | Response failed schema/parsing | `failures[]`, degraded job |
| F13_INSUFFICIENT_COVERAGE | Measured coverage below threshold | `coverage_detail`, `quality.issues` |
| F14_VIDEO_DECODING_FAILURE | Video could not be decoded | job error, `failures[]` |

`job_status` is derived separately: `queued`, `running`, `completed`, `degraded`, `failed`,
`cancelled`. `result.job_status` is `degraded` when any failure code or degraded component exists.

## Event lifecycle

Events carry `event_state` ∈ `confirmed`, `uncertain`, `rejected`, `candidate` and a boolean
`confirmed`. Motion peaks are `candidate` until a validated event rule or the VLM confirms them.
The rules fallback deliberately leaves every event `candidate`; it does not promote a motion peak
to a confirmed sports action. `event_detection` reports the four counts separately.

Phase boundaries are declared in `pack.phases` but are not yet localized in the runtime. The
evaluation protocol treats event detection and technique assessment as separate tasks.

## Provenance manifest

`result.provenance.manifest` and the exported `manifest.json` contain:

- application: engine/pipeline version and Git commit;
- sport pack: action ID, version, checksum and path;
- models: pose family/variant/path/SHA-256, VLM provider/configured models/model used;
- prompt: version, per-run hash and prompt-source hash;
- video: SHA-256, duration, FPS, codec, audio flag;
- camera: declared angle and `angle_source` (`declared` | `detected` | `default`);
- preprocessing: analysis/proxy FPS, proxy limit, smoothing;
- judgement: source, timestamp, model;
- environment: Python, platform, package versions;
- `pack_changed_after_judge` when the sport pack was replaced after the VLM call.

`evaluation.protocol.validate_manifest()` rejects a result missing these fields.
`evaluation.protocol.evaluation_version()` hashes the commit, pack, prompt, video, pose model, VLM
model and preprocessing; changing any of them creates a new evaluation version.

## Experimental score gating

The manuscript treats a composite score as secondary and says no score may be emitted when
coverage is insufficient. The engine therefore:

- keeps criterion-level measurements as the primary output;
- reports `summary.composite` with `status: "experimental_unvalidated"`, `validated: false`,
  `excluded_from_research: true`;
- emits `value: null` when measured coverage is below `MIN_MEASURED_COVERAGE` (0.65);
- marks `summary.rating_status` as `experimental_unvalidated`;
- provides `evaluation.protocol.research_view(result)` to strip the rating, composite and
  event/form scores from a research export.

The product UI must label the rating as experimental and must not make performance-accuracy claims.
Criterion-level feedback remains visible.

## Evaluation modes (offline only)

`engine/evaluation/protocol.py` implements the ablation variants without changing
`pipeline.run()`:

| Variant | Implementation |
|---|---|
| B0 | Per-criterion mode of the training annotations (`majority_baseline`). |
| B1 | Valid measured evidence only. Numeric values become ordinal ratings only through a caller-supplied validated `rating_fn`; otherwise abstain. |
| B2 | VLM qualitative ratings only. |
| B3 | Measured evidence first, VLM judgement as fallback. |
| B4 | Measured evidence only, with candidate events kept as candidates. |

Every variant receives the same `AnnotatedWindow` list. `event_detection_metrics()` is reported
separately, so a VLM-only baseline is not given manually selected clips for event detection.

## Compliance tests

`engine/tests/test_research_compliance.py` enforces:

| Test | Expected behaviour |
|---|---|
| Invalid camera view | No technique measurement is scored. |
| Missing landmark | Criterion is `occluded`/`low_confidence`, not a low score. |
| VLM unavailable | Valid measurements remain available. |
| Unsupported observation | Claim is `uncertain`/`rejected`; VLM rating never writes `score`. |
| Criterion not applicable | Excluded from the coverage denominator. |
| Insufficient coverage | No aggregate score. |
| Unconfirmed candidate | Not reported as a confirmed event. |
| Performance rating | Removed from research output; experimental in product. |
| Missing provenance | Evaluation result rejected. |
| Model version changed | New evaluation version created. |
| Paper IDs | Every pack exposes CR/FB/BB IDs and every implemented criterion maps to one. |

## Remaining gaps

These are deliberate, tracked gaps rather than hidden claims:

1. Phase boundaries are declared but not localized in the runtime; the evaluation harness treats
   event detection and technique assessment separately.
2. Ball, bat and object tracking are not implemented; criteria requiring them are `not implemented`.
3. The camera gate is applied when a concrete view (`side`/`front`) is declared. `"primary"` means
   the view was not declared; the gate is not applied and `view_verified` is false only for explicit
   mismatches. Research runs must declare a view.
4. VLM unsupported-observation detection is limited to confidence/state handling; claim-to-evidence
   citation validation is not yet implemented.
5. The composite and the per-criterion ideal ranges remain provisional product heuristics. They are
   excluded from research output.
6. The engine ships six broad sport packs; only cricket, football and basketball carry the paper
   metadata and bounded action scope.
