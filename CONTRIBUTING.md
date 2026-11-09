# Contributing to CoachAI

## Development Setup

### Server (Node.js/TypeScript)

```bash
cd server
npm install
cp .env.example .env
# Edit .env with your values
bun install
bun test
bun run type-check
bun run lint
```

### Engine (Python)

```bash
cd engine
python -m pip install -r requirements.txt
.venv/bin/python -m pytest tests -q
```

### Common

```bash
git checkout -b feature/your-feature
# Make your changes
# Run tests
bun test  # server
# or
pytest tests -q  # engine
# Type-check
bun run type-check  # server
# or
python -m py_compile engine/core/*.py  # engine
```

## Pull Request Process

1. Fill out the [pull request template](/.github/pull_request_template.md)
2. Ensure all checks pass (`bun test`, `bun run lint`, `python -m py_compile`)
3. Address any feedback from maintainers
2. Squash merge or rebase squash merge is preferred

## Code Style

### Server (TypeScript)

- Follow the existing code style in the repository
- Run `bun run lint` before committing
- Ensure all new functions have JSDoc docstrings
- Ensure all new public functions are typed

### Engine (Python)

- Follow PEP 8 style guidelines
- Run `flake8` before committing
- Ensure all new functions have docstrings
- Ensure all new public functions have type hints

## Issue Reporting

Use the [issue template](/github/issue_template.md) to report bugs or request features.

## Recognizing Contributors

Contributors are recognized in the README and release notes.

## Code of Conduct

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).