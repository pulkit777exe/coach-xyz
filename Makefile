.PHONY: start test lint type-check setup help

start:
	@echo "Starting development servers..."
	bun dev

test:
	@echo "Running test suites..."
	@echo "  Server tests..."
	bun test
	@echo "  Engine tests..."
	.venv/bin/python -m pytest tests -q

lint:
	@echo "Running linters..."
	@echo "  Server lint..."
	bun run lint
	@echo "  Engine lint..."
	.venv/bin/python -m flake8 engine/core/

type-check:
	@echo "Running type check..."
	@echo "  Server type-check..."
	bun run type-check
	@echo "  Engine type-check..."
	python -m py_compile engine/core/*.py

setup:
	@echo "Setting up CoachAI..."
	@echo "  Server dependencies..."
	bun install
	@echo "  Environment setup..."
	cp .env.example .env
	@echo "  Engine dependencies..."
	cd engine && python -m pip install -r requirements.txt
	@echo "  Database & Redis..."
	docker compose up -d db redis

help:
	@echo "Available Make targets:"
	@echo "  start    - Start development servers"
	@echo "  test     - Run all test suites"
	@echo "  lint     - Run linters"
	@echo "  type-check - Run type checking"
	@echo "  setup    - Full setup (deps + env + infra)"