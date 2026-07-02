# Coach-XYZ Architecture

## Current Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PRODUCTION ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐             │
│  │  Client  │───▶│  Server  │───▶│  Engine  │───▶│  Gemini  │             │
│  │ (React)  │    │ (Elysia) │    │ (FastAPI)│    │   API    │             │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘             │
│       │               │               │               │                    │
│       │               ▼               ▼               │                    │
│       │          ┌──────────┐    ┌──────────┐         │                    │
│       │          │  Redis   │    │  Local   │         │                    │
│       │          │ (Upstash)│    │ Storage  │         │                    │
│       │          └──────────┘    └──────────┘         │                    │
│       │               │               │               │                    │
│       ▼               ▼               ▼               ▼                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Analysis Pipeline                           │   │
│  │  download → preprocess → extract → detect → gemini → render        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implemented Features

### 1. Video Analysis Pipeline (`engine/core/analyzer.py`)

The core analysis runs as a synchronous function `run_analysis()` with limited parallelism:

```
┌─────────────────────────────────────────────────────────────────┐
│                    ANALYSIS FLOW (Actual)                       │
├─────────────────────────────────────────────────────────────────┤
│  1. Download video to temp file                                 │
│  2. Check Redis cache → return if hit                           │
│  3. Check deduplication → wait if in-progress                   │
│  4. Preprocess video (FFmpeg: normalize + trim)                 │
│  5. Extract keyframes (every 3s, up to 30 frames)              │
│  6. [PARALLEL] Detect players + Compute motion scores           │
│  7. Call Gemini API with best frames                            │
│  8. Cache result in Redis                                       │
│  9. Render annotated video                                      │
│  10. Upload result and complete                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key implementation details:**
- Frame caching: Decoded frames stored during extraction, reused for detection + motion scoring
- Parallelism: `asyncio.gather()` runs detection and motion scoring concurrently via `asyncio.to_thread()`
- Memory optimization: Frames stored as metadata only (frame_index, timestamp), raw numpy cached separately

### 2. Redis Caching (`engine/core/cache.py`)

```python
# Cache key format
CACHE_PREFIX = "coachai:analysis:"
key = f"{CACHE_PREFIX}{video_hash}:p{player_index or 'all'}"

# TTL: 24 hours
CACHE_TTL = 3600 * 24
```

**Functions:**
- `compute_video_hash(video_path)` - Fast hash using file size + first/last 1MB
- `get_cached_analysis(video_hash, player_index)` - Check cache
- `set_cached_analysis(video_hash, result, player_index)` - Store result
- `warm_cache_for_video(video_hash, video_path)` - Pre-warm cache on upload
- `increment_access_count(video_hash)` - Track popular videos
- `get_popular_videos(limit)` - Get most accessed videos

**Cache strategy:** Single cache key per video+player combination. No per-stage caching (pipeline.py exists but is not integrated).

### 3. Request Deduplication (`engine/core/dedup.py`)

```python
# Global singleton
deduplicator = RequestDeduplicator()

# Usage in analyzer.py
dedup_key = f"{video_hash}:{player_index}"
if dedup_key in deduplicator.pending:
    # Wait for existing analysis instead of creating duplicate
    await deduplicator.get_or_create(dedup_key, lambda: asyncio.sleep(0))
```

**Behavior:**
- 5-minute TTL for pending requests
- Second request awaits first's future instead of creating duplicate job
- Handles `CancelledError` and `TimeoutError` gracefully

### 4. SSE Streaming (`engine/main.py`)

```python
# Endpoints
POST /analyze-async          # Start analysis, return job_id immediately
GET  /analyze-progress/{job_id}  # SSE stream for live updates
GET  /status/{job_id}        # Polling endpoint
```

**Implementation:**
- Background execution via `ThreadPoolExecutor(max_workers=2)`
- SSE updates every 1 second
- Proper headers: `Cache-Control: no-cache`, `X-Accel-Buffering: no`

### 5. Video Compression (`engine/core/compress.py`)

```python
# Compression settings
- Target: 720p, 24fps, H.264 CRF 28
- Strips audio (not needed for analysis)
- Hardware acceleration: NVENC if available (detected once, cached)
```

**Optimizations:**
- NVENC detection cached at module level (avoids subprocess per call)
- Falls back to libx264 if hardware unavailable
- Skips compression if already small

### 6. Frame Quality Gate (`engine/core/quality.py`)

- Sharpness filtering (Laplacian variance)
- Brightness filtering (mean intensity)
- Rejects blurry/dark frames before Gemini analysis

### 7. Output Validation (`engine/core/analysis_validator.py`)

- Validates Gemini response structure
- Retry logic for malformed responses
- Ensures required fields exist (form_score, top_tips, etc.)

---

## Dead Code (Exists But Not Integrated)

### `engine/core/pipeline.py`
- `AnalysisPipeline` class with per-stage Redis caching
- **Status:** File exists, compiles, but never imported by `analyzer.py`
- **Reason:** `run_analysis()` implements its own simpler caching

### `engine/core/connection_pool.py`
- `ConnectionPool` class for HTTP connection reuse
- **Status:** File exists, compiles, but never imported anywhere
- **Reason:** Gemini client uses its own connection management

---

## Performance Characteristics

### Actual Flow Timing (Estimated)

```
┌─────────────────────────────────────────────────────────────────┐
│                    ACTUAL TIMING (Estimated)                     │
├─────────────────────────────────────────────────────────────────┤
│  Download video:         5-30s    (depends on storage)          │
│  Cache check:            <1s      (Redis GET)                   │
│  Preprocess (FFmpeg):    5-15s    (normalize + trim)            │
│  Extract keyframes:      2-5s     (up to 30 frames)            │
│  Detect + Motion:        10-20s   (PARALLEL)                    │
│  Gemini API call:        30-90s   (upload + analysis)           │
│  Render video:           40-90s   (annotated output)            │
│  ────────────────────────────────────────────────────────────   │
│  Total (first time):     90-240s  (1.5-4 minutes)              │
│  Total (cache hit):      1-3s                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Parallelism Achieved

| Stage 1 | Stage 2 | Benefit |
|---------|---------|---------|
| Detect players | Motion scoring | ~50% faster scanning |

**Not parallelized:**
- Gemini upload + detection (sequential)
- Rendering (after Gemini completes)

---

## Caching Strategy

| Key Format | TTL | What's Cached |
|------------|-----|---------------|
| `coachai:analysis:{hash}:p{player}` | 24h | Full analysis result |
| `coachai:analysis:{hash}:metadata` | 24h | Video metadata |
| `coachai:analysis:{hash}:metadata:count` | 24h | Access count |

**Cache Invalidation:**
- TTL-based only (24h)
- No LRU eviction implemented
- No manual invalidation API

---

## Infrastructure

### Free Tier Deployment

| Service | Platform | Limitations |
|---------|----------|-------------|
| Frontend | Vercel | Static export, serverless functions |
| API Server | Render | 512MB RAM, spins down after 15min |
| Engine | Render | 512MB RAM, spins down after 15min |
| Redis | Upstash | Serverless, pay-per-request |
| Database | Supabase | PostgreSQL, free tier |

### Memory Optimization (512MB RAM)

- Single uvicorn worker
- Frame storage: metadata only (not raw numpy)
- MediaPipe: `model_complexity=0`, `num_poses=4`
- Session TTL: 1 hour, max 10 sessions
- Bounded executor: `max_workers=2`

### Cold Start Optimization

- Heavy imports lazy-loaded (cv2, mediapipe, tensorflow)
- boto3 removed (not needed for local storage)
- Keep-alive ping every 10 minutes

---

## Implementation Status

| Feature | Status | Location |
|---------|--------|----------|
| Video analysis pipeline | ✅ Implemented | `analyzer.py:run_analysis()` |
| Redis caching | ✅ Implemented | `cache.py` + `analyzer.py:552-559` |
| Request deduplication | ✅ Implemented | `dedup.py` + `analyzer.py:561-580` |
| SSE streaming | ✅ Implemented | `main.py:435-529` |
| Video compression | ✅ Implemented | `compress.py` |
| Frame quality gate | ✅ Implemented | `quality.py` |
| Output validation | ✅ Implemented | `analysis_validator.py` |
| Per-stage pipeline caching | ❌ Dead code | `pipeline.py` (not imported) |
| Connection pooling | ❌ Dead code | `connection_pool.py` (not imported) |
| LRU cache eviction | ❌ Not implemented | — |
| Manual cache invalidation | ❌ Not implemented | — |

---

## Known Issues

1. **Pipeline dead code:** `pipeline.py` and `connection_pool.py` exist but are never used
2. **No per-stage caching:** Only final analysis result is cached, not intermediate stages
3. **Sequential Gemini + detection:** Could be parallelized but isn't
4. **No LRU eviction:** Cache grows unbounded until TTL expiry
5. **Fabricated performance numbers:** Previous version claimed 60-120s; actual is 90-240s

---

## Future Improvements

### Phase 1: Integration (1-2 days)
- [ ] Integrate `pipeline.py` for per-stage caching
- [ ] Integrate `connection_pool.py` for HTTP reuse
- [ ] Parallelize Gemini upload + detection

### Phase 2: Optimization (3-5 days)
- [ ] Add LRU eviction (max 10GB)
- [ ] Implement manual cache invalidation
- [ ] Add stage-level progress tracking

### Phase 3: Scale (1 week+)
- [ ] Multi-worker support (requires external Redis)
- [ ] Video chunking for large files
- [ ] Edge computing for scan phase
