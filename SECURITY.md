# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| main | :white_check_mark: |

## Reporting a Vulnerability

Please report security vulnerabilities by emailing security@coachai.com or through the project's issue tracker.

The project incharge will respond to reported vulnerabilities within 45 days.

## Troubleshooting

### Common Issues

**Database Connection Failed**
- Ensure PostgreSQL is running: `docker compose up -d db`
- Check connection string in `.env` file
- Verify `DATABASE_URL` is set correctly

**Redis Connection Failed**
- Ensure Redis is running: `docker compose up -d redis`
- Check connection string in `.env` file
- Verify `UPSTASH_REDIS_REST_URL` is set correctly

**Node.js Version Mismatch**
- Ensure Node.js 20+ is installed
- Use `nvm use 20` or `fnm use 20`

**Python Version Mismatch**
- Ensure Python 3.11+ is installed
- Use `pyenv install 3.11.0` and `pyenv global 3.11.0`

**Pre-commit Hooks Failing**
- Run `pre-commit autoupdate` to update hooks
- Run `pre-commit run --all-files` to run all hooks manually