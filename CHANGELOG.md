# Contributing

## Development Workflow

1. Create a branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Run tests: `bun test` (server) or `pytest tests -q` (engine)
4. Type-check: `bun run type-check` (server) or `python -m py_compile engine/core/*.py`
5. Commit with a descriptive message
6. Push and create a PR using the pull request template

## Code Style

- Follow the existing code style in the repository
- Run `bun run lint` (server) or `flake8` (engine) before committing
- Ensure all new functions have docstrings
- Ensure all new public functions are typed

## Pull Request Process

1. Fill out the pull request template
2. Ensure all checks pass (`bun test`, `bun run lint`, `python -m py_compile`)
2. Address any feedback from the maintainers
3. Squash merge or rebase squash merge is preferred

## Reporting Issues

Use the issue template to report bugs or request features.

## Recognizing Contributors

Contributors are recognized in the README and release notes.
```</think>
<tool_call>
<function=write>
<parameter=content>
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## Unreleased

### Added
- Angle-validity rules per criterion (engine)
- `badRequest` helper across route files (server)
- Cache version bump (ENGINE/PIPELINE/PROMPT v2)

### Changed
- Consolidated `logEvent` shared helper (server)
- Angle-validity classifier (geometry)
- Pre-commit configuration

### Fixed
- Hard-coded secrets remediation
- Duplicate code reduction

## 2024-10-29 - Initial Open-Source Release
- MIT License added
- Code of Conduct added
- Security policy added
- Documentation added