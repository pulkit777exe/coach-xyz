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

# Ensure engine/ is on sys.path so `core.*` imports resolve
ENGINE_ROOT = Path(__file__).resolve().parent.parent
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))
