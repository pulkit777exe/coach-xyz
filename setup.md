# CoachAI Setup Instructions

## Overview
This document provides instructions for setting up and running the CoachAI system, which includes:
- Python engine for video analysis
- Elysia backend with Bun for API services
- Next.js frontend with TypeScript and Tailwind CSS
- Android app (React Native)

## Prerequisites
- Python 3.8+ and pip
- Node.js 18+ and npm (or Bun)
- React Native development environment (for Android app)
- VSCode (recommended for development)

## Python Engine Setup

### 1. Install Python Dependencies
```bash
cd engine
pip install -r requirements.txt
cd ..
```

### 2. Install Backend Dependencies
```bash
pip install -r backend/requirements.txt
```

### 3. Set Environment Variables
```bash
# Copy and edit the .env file
cp .env.sample .env
# Add your GEMINI_API_KEY
```

## Elysia Backend Setup (Bun)

### 1. Install Dependencies
```bash
cd server
bun install
```

### 2. Set Environment Variables
```bash
cp .env.example .env
# Add your GEMINI_API_KEY and API_KEY
```

### 3. Start Development Server
```bash
bun run dev
```

Backend will be available at: http://localhost:8000

## Next.js Frontend Setup (Bun)

### 1. Install Dependencies
```bash
cd web-next
bun install
```

### 2. Set Environment Variables
```bash
cp .env.local.example .env.local
# Update API_BASE if backend is running on different port
```

### 3. Start Development Server
```bash
bun run dev
```

Frontend will be available at: http://localhost:3000

## Android App Setup

### 1. Install Dependencies
```bash
cd android
npm install
```

### 2. Start Metro
```bash
npm start
```

### 3. Run on Device/Emulator
```bash
npm run android
```

## VSCode Tasks

A `tasks.json` file has been created with all the necessary tasks:

- **Python Engine**: Install dependencies, run CLI analysis
- **Backend**: Install dependencies, start dev/prod server, type check
- **Frontend**: Install dependencies, start dev/prod server, build
- **Android**: Install dependencies, start Metro, run on device

To run a task:
1. Open VSCode
2. Press `Ctrl+Shift+P` (or Cmd+Shift+P on Mac)
3. Type "Tasks: Run Task"
4. Select the desired task

## API Documentation

Backend API documentation is available at: http://localhost:8000/swagger

## Usage

1. **Web Interface**: Open http://localhost:3000 in your browser
2. **Upload Video**: Select a video file (MP4, MOV, AVI, MKV, max 500MB)
3. **Analyze**: Click "Start AI Analysis" to process the video
4. **View Results**: Wait for analysis to complete (30-60 seconds per minute of video)

## Supported Sports
- **Basketball** (🏀): Jump shots, layups, dunks, free throws, 3-pt
- **Football** (⚽): Strikes, headers, volleys, penalties
- **Cricket** (🏏): Drives, pulls, sweeps, cuts, hooks

## Security Measures

- API key authentication for protected routes
- CORS configuration for frontend-backend communication
- File size validation
- Rate limiting (100 requests per minute)
- Error handling and logging

## Architecture

```
coach-xyz/
├── core/          # Shared Python engine (Gemini, overlay renderer, validator)
├── server/        # Elysia/Bun backend for sports video analysis
├── web-next/      # Next.js 14+ frontend with TypeScript and Tailwind
├── web/           # Legacy HTML/CSS/JS SPA
├── android/       # React Native Android app
├── cli/           # Command-line interface
└── sports/        # Per-sport config JSON
```
