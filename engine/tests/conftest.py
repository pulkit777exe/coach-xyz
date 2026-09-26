"""Shared fixtures for engine tests."""

import os
import sys
from pathlib import Path

# Tests must never talk to the live Sentry project (engine/.env carries a
# real DSN): pin the env var to empty BEFORE any test imports main.py, whose
# sentry_sdk.init reads it — load_dotenv does not override existing keys, so
# this sticks. An empty/absent DSN disables the client: no test-generated
# events in production monitoring, and no 2s flush delay at interpreter exit.
os.environ["SENTRY_DSN"] = ""

# Same trap, one more key: engine/.env carries a real SERVICE_TOKEN, and
# main.py's service_token_middleware 403s every non-/health request when that
# var is set. Route tests exercise handler behavior, not the identity boundary,
# so pin it empty here; test_service_auth.py opts back in with its own
# monkeypatch to cover the boundary itself. Without this, the suite passes in
# CI (no .env) and fails locally.
os.environ["SERVICE_TOKEN"] = ""

# Ensure engine/ is on sys.path so `core.*` imports resolve
ENGINE_ROOT = Path(__file__).resolve().parent.parent
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))
