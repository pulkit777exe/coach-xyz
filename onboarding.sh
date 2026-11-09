#!/bin/bash
set -e

echo "=== CoachAI Onboarding ===\n"

echo "1. Server (Node.js/TypeScript)"
cd server
echo "   Installing dependencies..."
bun install
echo "   Setting up environment..."
cp .env.example .env
echo "   Running type-check..."
bun run type-check
echo "   Running lint..."
bun run lint
echo "   Running tests..."
bun test

echo ""
echo "2. Engine (Python)"
cd ..
cd engine
echo "   Installing dependencies..."
python -m pip install -r requirements.txt
echo "   Running tests..."
.venv/bin/python -m pytest tests -q

echo ""
echo "=== Onboarding Complete ==="