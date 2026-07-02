# Coach-XYZ Scaling Plan

> **Current Status:** Local storage only. S3/R2 integration required for horizontal scaling.

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
1. Engine: Single instance, ~512MB RAM limit (free tier)
2. Worker: `concurrency: 1` (single job at a time, up to 12 min per job)
3. Storage: Local filesystem only (no S3/R2 integration yet)
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

#### 1. Engine: Stateless + Shared Storage
```dockerfile
# Add S3/R2 storage backend
STORAGE_BACKEND=s3
S3_BUCKET=coachai-videos
S3_REGION=auto
S3_ACCESS_KEY_ID=xxx
S3_SECRET_ACCESS_KEY=xxx
```

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
        - name: WORKER_CONCURRENCY
          value: "2"
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
1. Add S3/R2 storage backend to engine
2. Increase `WORKER_CONCURRENCY` to 4
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

### 1. Add S3/R2 Storage Backend

```python
# engine/core/storage.py
import boto3
from botocore.config import Config

class S3Storage:
    def __init__(self):
        self.s3 = boto3.client('s3',
            endpoint_url=os.environ.get('S3_ENDPOINT'),
            aws_access_key_id=os.environ.get('S3_ACCESS_KEY_ID'),
            aws_secret_access_key=os.environ.get('S3_SECRET_ACCESS_KEY'),
            config=Config(signature_version='s3v4')
        )
        self.bucket = os.environ.get('S3_BUCKET')
    
    def upload(self, key: str, data: bytes) -> str:
        self.s3.put_object(Bucket=self.bucket, Key=key, Body=data)
        return f"s3://{self.bucket}/{key}"
    
    def download(self, key: str) -> bytes:
        response = self.s3.get_object(Bucket=self.bucket, Key=key)
        return response['Body'].read()
    
    def get_presigned_url(self, key: str, expires: int = 3600) -> str:
        return self.s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': self.bucket, 'Key': key},
            ExpiresIn=expires
        )
```

### 2. Add Queue-Based Routing

```typescript
// server/src/lib/queue.ts
// Route jobs to specific engine instances based on load
const engineEndpoints = (process.env.ENGINE_URLS ?? '').split(',')
let currentEndpoint = 0

function getNextEngine(): string {
  const endpoint = engineEndpoints[currentEndpoint % engineEndpoints.length]
  currentEndpoint++
  return endpoint
}
```

### 3. Add Job Prioritization

```typescript
// server/src/lib/queue.ts
// Prioritize jobs based on user tier
const priorityConfig = {
  beta: 1,      // High priority
  free: 5,      // Low priority
  paid: 2,      // Medium priority
}

// Add to job options
await analysisQueue.add('analysis', payload, {
  priority: priorityConfig[userTier] ?? 5,
})
```

---

## Monitoring & Observability

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
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<token>
S3_SECRET_ACCESS_KEY=<secret>

# Server
ENGINE_URLS=http://engine1:8001,http://engine2:8001
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
2. **Add Cloudflare R2** for shared storage ($1/mo)
3. **Increase WORKER_CONCURRENCY** to 4
4. **Deploy 2 engine instances** on Render

### For Growth (Next Month):
1. **Add load balancer** (Render / Cloudflare)
2. **Implement auto-scaling** based on queue length
3. **Add monitoring** (Grafana Cloud free tier)

### For Scale (3+ Months):
1. **Migrate to Kubernetes** (EKS/GKE)
2. **Add caching layer** (Redis for analysis results)
3. **Implement job prioritization** (paid users first)
