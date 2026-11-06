# Setup Instructions

## Prerequisites

- Node.js 22+ (for web) and Bun 1.x (for server)
- Python 3.11+ (for engine)
- PostgreSQL database (Neon or Supabase)
- `.env` file with required variables

No Redis/Upstash is required: jobs, share tokens, AI-report records and rate
limits are Postgres-backed or in-process (see `docs/DURABLE_STATE.md`).

## Environment Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/coachai/coachai.git
   cd coachai
   ```

2. Install dependencies:
   ```bash
   # Server (Bun)
   cd server && bun install
   
   # Web (Node)
   cd web-next && npm ci

   # Engine (Python)
   cd engine && python -m pip install -r requirements.txt
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your values:
   # - ENGINE_URL
   # - SERVICE_TOKEN
   # - DATABASE_URL
   # - RESEND_API_KEY (for email)
   # - Other vars as needed
   ```

4. Start the infrastructure:
   ```bash
   # Start PostgreSQL only (no Redis in the stack)
   docker compose up -d database
   
   # Or use the provided setup script
   ./scripts/setup.sh
   ```

5. Start the development servers:
   ```bash
   # From repository root
   npm run dev
   
   # Or start each separately:
   cd server && bun dev    # server on port 8000
   cd engine && .venv/bin/python -m uvicorn main:app  # engine on default port
   ```

## Verification

Run the test suites to verify everything works:

```bash
# Server tests
cd server && bun test

# Engine tests
cd engine && .venv/bin/python -m pytest tests -q
```

## Development Workflow

1. Create a branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Run tests: `bun test` / `pytest tests -q`
4. Type-check: `bun run type-check` / `python -m py_compile engine/core/*.py`
5. Commit with a descriptive message
6. Push and create a PR using the template

## Available Scripts

### Server (`server/package.json`)
- `bun dev` - Start development server
- `bun run type-check` - Type-check with tsc
- `bun run lint` - Lint with eslint
- `bun test` - Run test suite

### Engine (`engine/pyproject.toml` / `engine/requirements.txt`)
- `python -m pytest tests -q` - Run test suite
- Other engine-specific scripts as defined

## Project Structure

```
coachai/
├── server/          # Node.js/TypeScript backend
│   ├── src/         # Source code
│   ├── package.json # Dependencies and scripts
│   └── ...
├── engine/          # Python backend
│   ├── core/        # Core engine logic
│   ├── tests/       # Test suite
│   ├── pyproject.toml
│   └── ...
├── .github/         # GitHub Actions and templates
├── LICENSE          # MIT License
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── README.md        # Project overview
```