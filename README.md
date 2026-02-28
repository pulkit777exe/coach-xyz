# ⚡ CoachAI — Multi-Sport AI Video Analyzer

> Upload any basketball, football, or cricket video → get instant form scores,
> shot-by-shot coaching feedback, and a professionally annotated video.
>
> Powered by **Google Gemini AI** + **MediaPipe** pose detection.

---

## Architecture

```
gemini-bball/
├── engine/        Python engine for video analysis
│   ├── core/      Shared Python engine (Gemini, overlay renderer, validator)
│   ├── cli/       Command-line interface (local or API-backed)
│   ├── main.py    Main entry point
│   └── requirements.txt
├── backend/       FastAPI REST API (legacy)
├── server/        Elysia/Bun backend (new, recommended)
├── web/           Web App (HTML/CSS/JS SPA, legacy)
├── web-next/      Next.js frontend with TypeScript and Tailwind
├── android/       React Native Android app
├── sports/        Per-sport config JSON (basketball, football, cricket)
└── events/        Output event JSON files
```

---

## Quick Start

### For Development (Recommended)

#### 1. Install Python dependencies

```bash
cd engine
pip install -r requirements.txt
cd ..
pip install -r backend/requirements.txt
```

#### 2. Set your Gemini API key

```bash
# .env (already in the project root)
GEMINI_API_KEY=your_key_here
```

#### 3. Start Elysia Backend

```bash
cd server
bun install
cp .env.example .env
# Add GEMINI_API_KEY and API_KEY
bun run dev
```

Backend will be at: http://localhost:8000

#### 4. Start Next.js Frontend

```bash
cd web-next
bun install
cp .env.local.example .env.local
bun run dev
```

Frontend will be at: http://localhost:3000

### For Production

#### Build Frontend

```bash
cd web-next
bun run build
bun run start
```

#### Run Backend

```bash
cd server
bun run start
```

---

## CLI

Runs the full pipeline locally — no server needed.

```bash
# Analyze + render in one command (output → ~/Downloads/)
python cli/main.py analyze video.mp4

# Analysis only (skip render)
python cli/main.py analyze video.mp4 --events-only

# Use a different Gemini model
python cli/main.py analyze video.mp4 --model gemini-1.5-pro

# Connect to a running backend instead of running locally
python cli/main.py analyze video.mp4 --api-url http://localhost:8000
```

---

## Backend API

### Elysia/Bun Backend (Recommended)

Serves the Web App and Android app with modern, performant backend.

```bash
cd server
# Install dependencies
bun install

# Set environment variables
cp .env.example .env
# Add GEMINI_API_KEY and API_KEY

# Start development server
bun run dev

# Start production server
bun run start
```

| Endpoint             | Method | Description                    |
| -------------------- | ------ | ------------------------------ |
| `/health`            | GET    | Health check                   |
| `/api/sports`        | GET    | List supported sports          |
| `/api/analyze`       | POST   | Upload video → start async job |
| `/api/jobs/{id}`     | GET    | Poll job status / results      |
| `/api/download/{id}` | GET    | Stream the rendered `.mp4`     |
| `/api/events/{id}`   | GET    | Get the raw event JSON         |
| `/api/jobs/{id}`     | DELETE | Clean up a job                 |

### FastAPI Backend (Legacy)

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### Example — cURL

```bash
# Upload and get a job ID
curl -F "video=@video.mp4" -F "model=gemini-2.5-flash" -F "render=true" \
     http://localhost:8000/api/analyze

# Poll until done
curl http://localhost:8000/api/jobs/<job_id>

# Download the result
curl -O http://localhost:8000/api/download/<job_id>
```

---

## Web App

### Next.js 14+ Frontend (Recommended)

Modern web interface with TypeScript and Tailwind CSS.

```bash
cd web-next
# Install dependencies
bun install

# Set environment variables
cp .env.local.example .env.local

# Start development server
bun run dev

# Build for production
bun run build

# Start production server
bun run start
```

Frontend will be available at: http://localhost:3000

### Legacy HTML/CSS/JS SPA

Open `web/index.html` directly in a browser **while the backend is running**.

Or serve it with any static file server:

```bash
# Python built-in
python -m http.server 3000 --directory web/

# Then open: http://localhost:3000
```

> **PWA**: In Chrome on Android, tap the browser menu → _"Add to Home Screen"_
> to install CoachAI as a native-feeling app.

---

## Android App (React Native)

### Prerequisites

- Node.js 18+
- Android Studio + Android SDK
- React Native CLI

### Setup

```bash
cd android
npm install

# Start Metro
npm start

# Run on connected device / emulator
npm run android
```

### Configure the server URL

In **Settings → Backend API URL**:

- Android emulator → `http://10.0.2.2:8000`
- Real device on same WiFi → `http://<your-machine-IP>:8000`

---

## Supported Sports

| Sport      | Events detected                              |
| ---------- | -------------------------------------------- |
| Basketball | Jump shots, layups, dunks, free throws, 3-pt |
| Football   | Strikes, headers, volleys, penalties         |
| Cricket    | Drives, pulls, sweeps, cuts, hooks           |

---

## Environment Variables

| Variable         | Required | Description           |
| ---------------- | -------- | --------------------- |
| `GEMINI_API_KEY` | ✅       | Google Gemini API key |

---

## Output

Every analysis produces:

1. **`events/<name>.json`** — Structured event data (timestamps, form scores, feedback, session summary)
2. **`~/Downloads/<name>_analyzed.mp4`** — Original video with AI overlays baked in
