"""Read-only audit of organic events refused by core.enums.target_status. Replay in projection order and accept explicit corrected:<status> overrides. Imports or merged histories can produce findings; the user must decide whether an outcome needs correction. Repair through POST /api/jobs/{id}/corrections or POST /api/jobs/{id}/status/revert.

Run from apps/api/:
  uv run python -m scripts.audit_funnel
  uv run python -m scripts.audit_funnel --source gmail-import
"""

from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.enums import Status, parse_correction, status_set_by, target_status

Job = dict[str, Any]
Event = dict[str, Any]

# A violation: the event, the status in force when it was logged, and why the
# guard would have refused it.
Finding = tuple[Event, str, str]


def _reason(event: str, current: str) -> str:
    """Why `target_status` refused — phrased as the fix, not the rule."""
    target = status_set_by(event)
    if target == Status.GHOSTED.value:
        return f"ghosted from `{current}` (only applied/in_process can be ghosted)"
    if target == Status.SEEN.value:
        return f"seen from `{current}` (only `new` can be seen)"
    return f"`{current}` -> `{target}` (backward or terminal reclassification)"


def findings(events: list[Event]) -> tuple[list[Finding], int]:
    """Replay the log in projection order, flagging every organic event the guard
    would have dropped. Corrections are applied as-is: they are the audited way
    around the guard, so they reset the walk rather than breaking it.

    Returns (contradictions, duplicates). A refused event that re-states the
    status already in force is a duplicate — merging two jobs concatenates their
    logs, so a `seen`/`seen` pair is an artifact of that, not a lost outcome. It
    is counted, not printed. Everything else changes what the job reads as."""
    ordered = sorted(events, key=lambda e: (e["ts"], e["id"]))
    current = Status.NEW.value
    out: list[Finding] = []
    duplicates = 0
    for event in ordered:
        verb = event["event"]
        correction = parse_correction(verb)
        if correction is not None:
            current = correction.value
            continue
        if status_set_by(verb) is None:
            continue  # `created` and flags set no status
        target = target_status(verb, current)
        if target is None:
            if status_set_by(verb) == current:
                duplicates += 1
            else:
                out.append((event, current, _reason(verb, current)))
            continue  # refused, so the walk stays where it was
        current = target
    return out, duplicates


def fetch_all(client: httpx.Client) -> list[Job]:
    summaries: list[Job] = client.get("/api/jobs", params={"limit": 5000}).raise_for_status().json()

    def detail(job: Job) -> Job:
        return dict(client.get(f"/api/jobs/{job['id']}").raise_for_status().json())

    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(detail, summaries))


def report(jobs: list[Job], source: str | None) -> int:
    walked = [(j, *findings(j.get("events", []))) for j in jobs]
    duplicates = sum(n for _j, _f, n in walked)
    broken = [(j, f) for j, f, _n in walked if f]
    if source:
        broken = [
            (j, [x for x in f if (x[0].get("meta") or {}).get("source") == source])
            for j, f in broken
        ]
        broken = [(j, f) for j, f in broken if f]

    print(f"jobs: {len(jobs)}   with impossible events: {len(broken)}")
    print(f"benign duplicate re-fires (merge artifacts): {duplicates}")

    # Which import wrote them. A clean tracker attributes nothing here; a bulk
    # backfill that bypassed the API shows up as one dominant source.
    sources: Counter[str] = Counter()
    for _, fs in broken:
        for event, _current, _why in fs:
            sources[str((event.get("meta") or {}).get("source") or "(none)")] += 1
    if sources:
        print("\nby source:")
        for name, n in sources.most_common():
            print(f"  {n:5d}  {name}")

    for job, fs in broken:
        print(f"\n{job['id']}  {job['company']} — {job['title']}  [now: {job['status']}]")
        for event, _current, why in fs:
            print(f"  event {event['id']:>6}  {event['event']:<12} {event['ts']}  {why}")
            note = (event.get("meta") or {}).get("note")
            if note:
                print(f"{'':16}note: {note}")
    return 1 if broken else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", help="only report events whose meta.source is SOURCE")
    args = parser.parse_args()

    settings = get_settings()
    with httpx.Client(base_url=f"http://localhost:{settings.port}", timeout=30) as client:
        jobs = fetch_all(client)
    return report(jobs, args.source)


if __name__ == "__main__":
    raise SystemExit(main())
