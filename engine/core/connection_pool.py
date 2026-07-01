from __future__ import annotations

import httpx
from contextlib import asynccontextmanager
from typing import Optional


class ConnectionPool:
    """
    Reuse HTTP connections for Gemini API calls.

    Default: new connection per request (slow)
    Pooled: reuse connections (fast)
    """

    def __init__(self, max_connections: int = 10):
        self.max_connections = max_connections
        self._client: Optional[httpx.AsyncClient] = None

    async def __aenter__(self):
        self._client = httpx.AsyncClient(
            limits=httpx.Limits(
                max_connections=self.max_connections,
                max_keepalive_connections=20,
                keepalive_expiry=30,
            ),
            timeout=httpx.Timeout(300.0),  # 5 min for large uploads
        )
        return self._client

    async def __aexit__(self, *args):
        if self._client:
            await self._client.aclose()


@asynccontextmanager
async def get_connection_pool(max_connections: int = 10):
    """Context manager for connection pooling."""
    async with ConnectionPool(max_connections) as client:
        yield client
