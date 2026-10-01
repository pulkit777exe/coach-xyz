# XFF spoofing direct-to-origin evades per-IP rate limits

Status: needs-triage

## What

`server/src/lib/requestMeta.ts` trusts the right-most `X-Forwarded-For`
entry. Correct behind an appending proxy (Render adds the real client IP
last), but the Render origin URL is directly reachable, and direct callers
control the whole header — so per-IP limits (`scan`, `analyze`, chat,
download, status) are evadable off-proxy. The comment now states this
honestly; the exposure that matters is anonymous Gemini spend, where the
IP quota is the only guard.

## Fix options

- `TRUST_PROXY` flag: when off, prefer the socket peer IP (needs Elysia
  `server.requestIP` threaded through `readRequestMeta` — checked
  2026-09-30, not reliably available in handler context).
- Lock down the origin (Render firewall / IP allowlist) so all traffic
  arrives via the proxy chain.
- Do NOT "fix" by requiring attribution on analyze — that kills the demo
  flow and is a product decision (STOP).

## Context

Survey finding #3, verified 2026-09-30. Related: `ORG_WRITE_RATE_LIMIT`
keys by verified identity, so org writes are unaffected.
