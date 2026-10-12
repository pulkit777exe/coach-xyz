# Coach-XYZ Scaling Plan

> **Current Status:** Dual storage (local disk by default, S3-compatible backend
> available via `STORAGE_BACKEND=s3`). Single engine + single worker by default;
> scale by adding engine instances and raising `WORKER_CONCURRENCY`.

## Current Architecture (Single Instance)

```
┌─────────────┐      ┌──────────────┐      ┌─────────────┐
│   Frontend  │────▶│    Server    │────▶│   Engine    |
│  (Next.js)  │      │ (BullMQ +    │      │ (FastAPI +  │
│             │      │  Worker)     │      │  MediaPipe) │
└─────────────┘      └──────────────┘      └─────────────┘
                           │                    │
                           ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │    Redis    │     │   Storage   │
                    │  (Upstash)  │     │  (Local)    │
                    └─────────────┘     └─────────────┘
```

**Bottlenecks:**
1. Engine: Single instance, ~512MB RAM limit (free tier); single uvicorn worker
2. Worker: `WORKER_CONCURRENCY: 1` by default (single job at a time, 12 min engine timeout + 13 min stuck-job recovery)
3. Storage: Local disk by default; S3-compatible backend exists (`engine/core/storage.py`) but needs a bucket for multi-instance setups
4. Redis: Free tier limits (10K commands/day)

**Current Capacity (Free Tier):**
- **Max concurrent jobs:** 1 (global bottleneck)
- **Job duration:** 2-12 minutes (depending on video length)
- **Theoretical throughput:** ~5-30 jobs/hour (single engine instance)
- **User experience:** Users must wait in queue; first-come-first-served

---

## Scaling Options

### Option 1: Horizontal Scaling (Recommended for Beta)

Scale the **Engine** and **Server** independently:

```
                    ┌─────────────────────────────────────┐
                    │           Load Balancer             │
                    │        (Render / Cloudflare)        │
                    └─────────────────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
             ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
             │   Engine 1  │ │   Engine 2  │ │   Engine 3  │
             │  (2 CPU/4GB)│ │  (2 CPU/4GB)│ │  (2 CPU/4GB)│
             └─────────────┘ └─────────────┘ └─────────────┘
                    │                │                │
                    └────────────────┼────────────────┘
                                     ▼
                            ┌─────────────┐
                            │    Redis    │
                            │  (Upstash)  │
                            └─────────────┘
```

**Changes Required:**

#### 1. Engine: Shared Storage (already implemented — just configure it)
```bash
# Engine env (see engine/.env.sample)
STORAGE_BACKEND=s3
S3_BUCKET=coachai-videos
S3_REGION=auto
S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
```
Layout is bucket-ready today: immutable `raw/{session}/{angle}/{uuid}.mp4`
sources plus one `results/{job}.mp4` per analysis, with presigned
browser-direct uploads (`POST /upload-intent` → `POST /scan-from-key`).

#### 2. Server: Multiple Workers
```yaml
# docker-compose.scale.yml
services:
  server:
    deploy:
      replicas: 3
    environment:
      WORKER_CONCURRENCY: 4  # Per instance
```

#### 3. Redis: Upgrade Plan
- Free: 10K commands/day (~100 jobs)
- Pay-as-you-go: $0.2/10K commands (~$2/1000 jobs)

---

### Option 2: Kubernetes (Recommended for Production)

Full orchestration with auto-scaling:

```yaml
# k8s/engine-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: coachai-engine
spec:
  replicas: 3
  selector:
    matchLabels:
      app: coachai-engine
  template:
    spec:
      containers:
      - name: engine
        image: coachai/engine:latest
        resources:
          requests:
            cpu: "1"
            memory: "2Gi"
          limits:
            cpu: "2"
            memory: "4Gi"
        env:
        - name: SENTRY_DSN
          value: "..."
      # NOTE: WORKER_CONCURRENCY lives on the server (BullMQ), not the engine.
      # Set it there (default 1) alongside ENGINE_URL pointing at the pool.
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: coachai-engine-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: coachai-engine
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

---

### Option 3: Serverless (Lowest Cost for Beta)

Use serverless functions for bursty workloads:

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Frontend  │────▶│    Server    │────▶│  Cloud Functions │
│  (Vercel)   │     │ (Railway)    │     │ (Cloud Run /     │
│             │     │              │     │  Lambda)         │
└─────────────┘     └──────────────┘     └─────────────────┘
                           │                    │
                           ▼                    ▼
                    ┌─────────────┐     ┌─────────────┐
                    │    Redis    │     │  Cloudflare  │
                    │  (Upstash)  │     │     R2       │
                    └─────────────┘     └─────────────┘
```

**Benefits:**
- Auto-scale to zero (cost savings)
- Pay per request
- No infrastructure management

---

## Implementation Phases

### Phase 1: Beta (10-50 users)
**Goal:** Handle 10-50 concurrent users

| Service | Config | Cost |
|---------|--------|------|
| Engine | 1 instance, 2 CPU/4GB | $7/mo (Render Starter) |
| Server | 1 instance, 1 CPU/1GB | $7/mo (Render Starter) |
| Redis | Upstash Pay-as-you-go | ~$5/mo |
| Storage | Cloudflare R2 | ~$1/mo |
| **Total** | | **~$20/mo** |

**Changes:**
1. Point `STORAGE_BACKEND=s3` at a shared bucket (backend exists; local disk is fine for one instance)
2. Increase `WORKER_CONCURRENCY` (server) past 1
3. Upgrade Redis to pay-as-you-go

---

### Phase 2: Growth (50-500 users)
**Goal:** Handle 50-500 concurrent users

| Service | Config | Cost |
|---------|--------|------|
| Engine | 3 instances, 2 CPU/4GB each | $21/mo |
| Server | 2 instances, 1 CPU/1GB each | $14/mo |
| Redis | Upstash Pro | ~$20/mo |
| Storage | Cloudflare R2 | ~$5/mo |
| **Total** | | **~$60/mo** |

**Changes:**
1. Add load balancer (Render / Cloudflare)
2. Horizontal auto-scaling for engine
3. Multiple BullMQ workers

---

### Phase 3: Scale (500+ users)
**Goal:** Handle 500+ concurrent users

| Service | Config | Cost |
|---------|--------|------|
| Engine | Kubernetes (3-10 pods) | ~$100/mo |
| Server | Kubernetes (2-5 pods) | ~$50/mo |
| Redis | Upstash Enterprise | ~$50/mo |
| Storage | Cloudflare R2 | ~$20/mo |
| **Total** | | **~$220/mo** |

**Changes:**
1. Migrate to Kubernetes
2. Add monitoring (Grafana/Prometheus)
3. Implement caching layer

---

## Code Changes for Scaling

### 1. S3/R2 Storage Backend — ✅ implemented (`engine/core/storage.py`)

Local vs S3 switches on `STORAGE_BACKEND`; S3 uses lazily-imported boto3 with
presigned uploads/downloads. The sample below is kept for reference only:

```python
# engine/core/storage.py (current shape, simplified)
class S3Storage:
    def presigned_upload(self, key: str, ...) -> str: ...    # POST /upload-intent
    def presigned_download(self, key: str, ...) -> str: ...  # GET /download/:jobId → 302
```

### 2. Add Queue-Based Routing — ❌ proposal (not implemented)

The server talks to a single engine via `ENGINE_URL`. Multi-engine routing
would look like:

```typescript
// server/src/lib/queue.ts (proposal)
// Route jobs to specific engine instances based on load
const engineEndpoints = (process.env.ENGINE_URLS ?? '').split(',')
let currentEndpoint = 0

function getNextEngine(): string {
  const endpoint = engineEndpoints[currentEndpoint % engineEndpoints.length]
  currentEndpoint++
  return endpoint
}
```

### 3. Job Prioritization — ✅ partially implemented

BullMQ honors `priority` (higher = sooner). Signed-in player-hub jobs enqueue
at base 10 over anonymous base 0, plus a subscription tier bump
(`+10` elite / `+5` pro). Per-org quotas (`ORG_DAILY_ANALYSIS_LIMIT`, default
50/day) are the fairness backstop; per-org queue aging is still open.

---

## Monitoring & Observability — ❌ proposal (not implemented)

No Prometheus `/metrics` endpoint exists today; logging is structured JSON +
Sentry on all three layers, correlated by job/request id. The sketches below
are proposals for when the workload justifies them.

### Key Metrics to Track
```yaml
# prometheus/prometheus.yml
scrape_configs:
  - job_name: 'coachai-engine'
    static_configs:
      - targets: ['engine:8001']
    metrics_path: /metrics
    
  - job_name: 'coachai-server'
    static_configs:
      - targets: ['server:8000']
    metrics_path: /metrics
```

### Alerting Rules
```yaml
# prometheus/alerts.yml
groups:
  - name: coachai
    rules:
      - alert: HighJobQueueLength
        expr: bullmq_queue_length > 100
        for: 5m
        labels:
          severity: warning
          
      - alert: EngineHighMemory
        expr: engine_memory_usage_bytes > 3.5e9
        for: 5m
        labels:
          severity: critical
          
      - alert: JobFailureRate
        expr: rate(bullmq_jobs_failed_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
```

---

## Quick Start: Beta Scaling

### 1. Upgrade Redis to Pay-as-you-go
```bash
# Upstash Console
# Redis → Settings → Billing → Pay-as-you-go
```

### 2. Add Cloudflare R2
```bash
# Cloudflare Dashboard
# R2 → Create bucket → coachai-videos
# R2 → Manage R2 API Tokens → Create Token
```

### 3. Update Environment Variables
```bash
# Engine
STORAGE_BACKEND=s3
S3_BUCKET=coachai-videos
S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
AWS_ACCESS_KEY_ID=<token>
AWS_SECRET_ACCESS_KEY=<secret>

# Server
ENGINE_URL=http://engine1:8001   # single engine today; a pool needs the §"Queue-Based Routing" proposal
WORKER_CONCURRENCY=4
```

### 4. Deploy with Docker Compose
```bash
docker compose -f docker-compose.prod.yml up -d --scale engine=2 --scale server=2
```

---

## Cost Comparison

| Scale  | Users | Concurrent Jobs | Monthly Cost |
|------- |-------|-----------------|--------------|
| Beta   | 10-50 | 2-5             | $20          |
| Growth | 50-500 | 5-20 | $60                    |
| Scale  | 500+ | 20-100 | $220                   |
| Enterprise | 1000+ | 100+        | $500+        |

---

## Recommendations

### For Beta (Now):
1. **Upgrade Redis** to pay-as-you-go ($5/mo)
2. **Point `STORAGE_BACKEND=s3`** at a Cloudflare R2 bucket ($1/mo) once a second engine instance is needed — single-instance deploys are fine on local disk
3. **Increase WORKER_CONCURRENCY** (server) past 1 once the engine keeps up
4. **Deploy 2 engine instances** on Render (requires the queue-routing proposal above, else both servers would each need their own engine)

### For Growth (Next Month):
1. **Add load balancer** (Render / Cloudflare)
2. **Implement auto-scaling** based on queue length
3. **Add monitoring** (Grafana Cloud free tier)

### For Scale (3+ Months):
1. **Migrate to Kubernetes** (EKS/GKE)
2. **Add caching layer** (Redis for analysis results)
3. **Implement job prioritization** (paid users first)
