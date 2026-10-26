"""Analyse a video from the terminal, with the same pipeline the server uses.

    python -m cli.main video.mp4 --sport basketball --player 1 --out results/
    python -m cli.main video.mp4 --list-players
"""

import argparse
import hashlib
import shutil
import sys
import time
from pathlib import Path

from core import db, events, jobs, people, pipeline, storage


def stage_up(video: Path, label: str = "primary") -> tuple[str, str]:
    key = storage.raw_key("cli", label)
    tmp = video.with_suffix(".cli-copy")
    shutil.copy(video, tmp)
    storage.backend().put(key, str(tmp))
    return key, hashlib.sha256(video.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(prog="coachai", description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("video", type=Path)
    ap.add_argument("--sport", default="", help="basketball, football, cricket, tennis, baseball or hockey")
    ap.add_argument("--player", type=int, help="player number from --list-players (default: the most prominent)")
    ap.add_argument("--list-players", action="store_true")
    ap.add_argument("--out", type=Path, default=Path("results"))
    ap.add_argument("--no-render", action="store_true")
    args = ap.parse_args()
    if not args.video.is_file():
        print(f"not found: {args.video}", file=sys.stderr)
        return 1

    db.conn()
    detector = pipeline.make_detector()
    found = people.scan(str(args.video), detector)
    if args.list_players:
        for p in found:
            b = p["bbox"]
            print(f"player {p['player_index']}: confidence {p['confidence']}, box {b['x_min']},{b['y_min']}-{b['x_max']},{b['y_max']}")
        return 0
    player = next((p for p in found if p["player_index"] == args.player), None) if args.player else None
    if args.player and player is None:
        print(f"no player {args.player}; found {[p['player_index'] for p in found]}", file=sys.stderr)
        return 1

    key, sha = stage_up(args.video)
    job_id = f"cli-{int(time.time())}"
    jobs.create(job_id, {
        "video_key": key, "sha256": sha, "angle": "primary", "sport": args.sport, "render": not args.no_render,
        "player": {k: player[k] for k in ("player_index", "bbox", "frame_timestamp", "signature")} if player else None,
    })
    seen = 0
    while True:
        for e in events.read(job_id, seen):
            seen = e["seq"]
            if e["type"] == "stage.started":
                print(f"- {e['data']['stage']}")
            elif e["type"] in ("job.degraded", "job.failed", "job.completed"):
                print(f"  {e['type']}: {e['data'].get('reason') or e['data'].get('message') or ''}")
        job = jobs.get(job_id)
        if job["state"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(0.5)
    if job["state"] != "completed":
        return 1

    result = jobs.load_result(job_id)
    args.out.mkdir(parents=True, exist_ok=True)
    root = storage.backend().path(f"results/{job_id}")
    shutil.copytree(root, args.out / job_id, dirs_exist_ok=True)
    s = result["summary"]
    print(f"\n{s['events']} events, rating {s['rating']}, average {s['average_score']}/10 -> {args.out / job_id}")
    for e in result["events"]:
        print(f"  {e['t']:6.1f}s  {e['type']:<16} {e['result']:<8} {e['score']}  {e['feedback']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
