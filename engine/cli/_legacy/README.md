# _legacy — Quarantined standalone tooling (not wired into any flow)

`frame_selector.py` (standalone JSON-over-stdout frame picker) and its only
dependency `player_tracker.py` (keyframe scoring + box↔skeleton matching)
were moved here on 2026-10-13: nothing imports them (the live pipeline uses
`core/detector.py` + `core/tracking.py`; the CLI analyze path uses
`core/player_detector.py` directly), no route/schedule invokes the script,
and it is not referenced from docs or deploy configs.

Kept (not deleted) because the script is runnable standalone
(`python cli/_legacy/frame_selector.py --help`) and may still serve manual
triage. Delete outright if it stays untouched.
