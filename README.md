# CoachAI

An AI-powered video analysis platform for sports coaching.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub repo stars](https://img.shields.io/github/stars/coachai/coachai.svg)](https://github.com/coachai/coachai/stars)
[![GitHub forks](https://img.shields.io/github/forks/coachai/coachai.svg)](https://github.com/coachai/coachai/forks)

## Quick Start

```bash
# Server (Node.js/TypeScript)
cd server && bun install
cp .env.example .env
bun dev

# Engine (Python)
cd engine && python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn main:app
```

## Badges

| Badge | Status |
|------|--------|
| **License** | [MIT](LICENSE) |
| **Tests** | Server: [![Tests](https://github.com/coachai/coachai/actions/workflows/ci.yml/badge.svg)](https://github.com/coachai/coachai/actions/workflows/ci.yml) |
| **Engine Tests** | [![Tests](https://img.shields.io/badge/Engine-pytest- orange.svg)](https://github.com/coachai/engine/actions/workflows/tests.yml) |
| **Security** | [Security Policy](SECURITY.md) |

## OSS Readiness

This project is intended to be an open-source AI coaching tool. See the [Code of Conduct](CODE_OF_CONDUCT.md) for contribution guidelines.

### Supported Versions

| Version | Supported |
| ------- | :--------: |
| main | :white_check_mark: |

## Projects

### Server

- Next.js 16 App Router + React 19 + TS + Tailwind v4
- Elysia API framework + BullMQ orchestration
- Supabase persistence + Resend email

### Engine

- Python FastAPI + MediaPipe + Gemini
- Video analysis pipeline
- Multi-sport scoring configs

### Sports

- Baseball, Basketball, Cricket, Football, Hockey, Tennis
- Per-sport scoring configuration JSON

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and pull request process.

### Code of Conduct

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please see [SECURITY.md](SECURITY.md) for reporting vulnerabilities and supported versions.

## Changelog

Please see [CHANGELOG.md](CHANGELOG.md) for release history.