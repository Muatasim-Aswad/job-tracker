"""Read-only report of timestamps that contradict lifecycle order. Snapshot/compare modes check that PATCH /api/events/{id} repairs reduce violations without changing projected statuses.

Run from apps/api/:
  uv run python -m scripts.scan_event_order
  uv run python -m scripts.scan_event_order --snapshot pre.json
  uv run python -m scripts.scan_event_order --compare pre.json
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx

from app.core.config import get_settings

# Rank within the lifecycle. A lower rank must carry a strictly earlier timestamp
# than a higher one. Post-application outcomes share rank 6: they are mutually
# exclusive in practice and we take no position on their relative order.
RANK = {
    "created": 0,
    "seen": 1,
    "to_apply": 2,
    "applied": 3,
    "in_process": 4,
    "offered": 5,
    "rejected": 6,
    "withdrawn": 6,
    "ghosted": 6,
    "closed": 6,
    "skipped": 6,
}

Job = dict[str, Any]
Event = dict[str, Any]


def violations(events: list[Event]) -> list[tuple[Event, Event]]:
    """Every (earlier-ranked, later-ranked) pair whose timestamps disagree with
    the lifecycle. Timestamps are canonical UTC ISO strings, so they compare
    correctly as text."""
    ordered = [e for e in events if e["event"] in RANK]
    return [
        (a, b)
        for a in ordered
        for b in ordered
        if RANK[a["event"]] < RANK[b["event"]] and a["ts"] >= b["ts"]
    ]


def fetch_all(client: httpx.Client) -> list[Job]:
    summaries: list[Job] = client.get("/api/jobs", params={"limit": 5000}).raise_for_status().json()

    def detail(job: Job) -> Job:
        resp = client.get(f"/api/jobs/{job['id']}").raise_for_status()
        return dict(resp.json())

    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(detail, summaries))


def report(jobs: list[Job]) -> None:
    broken = [j for j in jobs if violations(j.get("events", []))]
    print(f"jobs: {len(jobs)}   with violations: {len(broken)}")

    # The split that decides the work: `created` sets no status, so jobs broken
    # only there are inherently safe to repair. The rest can move a status-setting
    # event and need the status diff below.
    created_only = [
        j for j in broken if not violations([e for e in j["events"] if e["event"] != "created"])
    ]
    print(f"  cohort A — `created` only : {len(created_only)}")
    print(f"  cohort B — other          : {len(broken) - len(created_only)}")

    pairs: Counter[str] = Counter()
    for job in broken:
        for a, b in violations(job["events"]):
            pairs[f"{a['event']:<10} >= {b['event']}"] += 1
    print("\nviolated pairs:")
    for pair, n in pairs.most_common():
        print(f"  {n:5d}  {pair}")

    # Prefer an exact posting instant; fall back to the captured relative age.
    evidence: Counter[str] = Counter()
    for job in created_only:
        listings = job.get("listings", [])
        exact = [x for x in listings if (x.get("meta") or {}).get("posted_at")]
        ages = [x for x in listings if (x.get("meta") or {}).get("posted_age")]
        if exact:
            evidence["posted_at (exact)"] += 1
        elif len(ages) == 1:
            evidence["one posted_age (estimated)"] += 1
        elif len(ages) > 1:
            evidence["several posted_age (ambiguous)"] += 1
        else:
            evidence["none (logical shift only)"] += 1
    print("\ncohort A evidence:")
    for kind, n in evidence.most_common():
        print(f"  {n:5d}  {kind}")


def snapshot(jobs: list[Job]) -> dict[str, Any]:
    return {
        "statuses": {j["id"]: j["status"] for j in jobs},
        "violations": sum(len(violations(j.get("events", []))) for j in jobs),
    }


def compare(jobs: list[Job], path: Path) -> int:
    """Verify a correction run: statuses must be untouched and violations must
    have gone down. Returns a process exit code."""
    before = json.loads(path.read_text())
    after = snapshot(jobs)

    changed = {
        jid: (old, after["statuses"].get(jid))
        for jid, old in before["statuses"].items()
        if after["statuses"].get(jid) != old
    }
    print(f"violations: {before['violations']} -> {after['violations']}")
    print(f"status changes: {len(changed)} (expected 0)")
    for jid, (old, new) in list(changed.items())[:20]:
        print(f"  {jid}  {old} -> {new}")

    if changed:
        print("\nFAIL: a correction changed a projected status — investigate before continuing.")
        return 1
    if after["violations"] > before["violations"]:
        print("\nFAIL: violations increased.")
        return 1
    print("\nOK")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path, help="write statuses + counts to FILE")
    parser.add_argument("--compare", type=Path, help="check current state against a snapshot FILE")
    args = parser.parse_args()

    settings = get_settings()
    with httpx.Client(base_url=f"http://localhost:{settings.port}", timeout=30) as client:
        jobs = fetch_all(client)

    if args.compare:
        return compare(jobs, args.compare)
    if args.snapshot:
        args.snapshot.write_text(json.dumps(snapshot(jobs), indent=2))
        print(f"wrote {args.snapshot}")
        return 0
    report(jobs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
