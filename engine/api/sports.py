"""api/sports.py — Sport vocabulary served straight from the sport packs."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/sports/{sport}/positions")
def sport_positions_endpoint(sport: str):
    """Canonical position vocabulary for a sport (roster forms).

    Served from the sport pack so the roster UI never drifts from the
    analysis vocabulary. Unknown sports yield an empty list.
    """
    from core.sport_config import sport_positions

    return {"sport": sport.lower(), "positions": sport_positions(sport)}
