"""Shared fixtures for engine tests."""

import sys
from pathlib import Path

# Ensure engine/ is on sys.path so `core.*` imports resolve
ENGINE_ROOT = Path(__file__).resolve().parent.parent
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))
