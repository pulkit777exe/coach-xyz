# Coach-XYZ Development Todos

## Current Status
- Platform is production-ready for beta launch
- All critical + data contract bugs fixed
- Loop engineering roadmap (L3.0-L3.7) complete
- 12 commits pushed to remote

## Completed Tasks
- ✅ Fix queue.ts typo (`iorDisUrl` → `iorDisUrl`)
- ✅ Verify all documentation claims against actual code
- ✅ Identify dead code and missing features
- ✅ Document critical bugs
- ✅ Cross-verify ARCHITECTURE.md, SCALING.md
- ✅ Create comprehensive verification report
- ✅ Fix JSON.stringify JavaScript code in engine/main.py
- ✅ Fix missing HSTS header in security config
- ✅ Fix rate limiting race condition with atomic Lua script
- ✅ Wire WORKER_CONCURRENCY env var to BullMQ worker
- ✅ Label dead code files with UNUSED comments
- ✅ Add httpx dependency (was imported but missing)
- ✅ Complete loop engineering roadmap (L3.0-L3.7)
- ✅ Fix Gemini-to-frontend data contract: normalize shots→shot_events
- ✅ Fix renderer form_score scale (/100→/10)
- ✅ Fix Gemini session_summary fields not flattened to top-level
- ✅ Fix timestamp format mismatch (string→number)

## Critical Bugs Fixed
1. **`engine/main.py:108`** - `JSON.stringify` is JavaScript, not Python → Fixed with `json.dumps`
2. **Missing HSTS header** - Added `Strict-Transport-Security` to web-next and server
3. **Rate limiting race condition** - Implemented atomic Lua script for ioredis
4. **`WORKER_CONCURRENCY` env var** - Wired to BullMQ worker concurrency
5. **Gemini data contract** - Added `_normalize_gemini_result()` to transform Gemini output to frontend type

## Dead Code Status
1. **Deduplication** - Called in analyzer.py
2. **Cache invalidation** - `invalidate_cache()` in cache.py never invoked
3. **Dead code deleted** (2026-08-08):
   - engine/core/baseline.py, gemini.py, chunker.py, player_tracker.py, player_detector.py
   - engine/cli/ entire directory
   - All labeled UNUSED files (pipeline.py, connection_pool.py, compress.py, etc.) already deleted in prior cleanup

## Next Steps for Beta Launch
1. ~~Fix critical bugs~~ ✅
2. ~~Rotate compromised secrets~~ (manual step required)
3. ~~Replace `<your-org>` in render.yaml~~ ✅
4. Deploy per deployment plan
5. Generate beta codes

## Scaling Considerations (Future)
- Current architecture supports single-instance deployment
- Multi-instance requires S3 storage implementation
- WORKER_CONCURRENCY env var now wired to code
- Monitoring stack needs implementation

## Documentation Accuracy
- **ARCHITECTURE.md**: Fully synced with code (2026-08-08). All versions, paths, flows verified.
- **CONTEXT.md**: Updated with layer seams, pipeline state machine, service status.
- **SCALING.md**: Mostly aspirational, core features work but scaling features missing

## Recent Commits
- `178722c` fix: add HSTS header and fix rate limiting race condition
- `de790fa` fix: label dead code files and add httpx dependency
- `7adb562` fix: add structured logging for cache hit/miss and analysis completion
- `ffab298` fix: add per-beta-code rate limiting
- `bb75167` fix: align session TTL with job TTL and add scheduled eviction
- `7899c72` fix: add keep-alive ping from server to engine
- `e19f678` fix: add graceful failure for missing video files
- `93415c9` fix: replace <your-org> placeholder in render.yaml
- `cf651ab` docs: rewrite ARCHITECTURE.md with anti-hallucination rules
- `2c37df2` docs: update SCALING.md with accurate current status
