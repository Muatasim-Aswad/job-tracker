"""Recompute advisory company/title keys from stored names without changing names or updated_at. Re-key blocked companies from their labels and drop collisions already covered by a block.

Run from apps/api/:
  uv run python -m scripts.backfill_company_keys            # dry run
  uv run python -m scripts.backfill_company_keys --execute  # apply
"""

from __future__ import annotations

import argparse

from app.core.config import get_settings
from app.core.db import Conn, connect, execute, query_all
from app.core.text import normalize_company, normalize_title


def _plan_jobs(conn: Conn) -> list[tuple[str, str | None, str | None, str | None, str | None]]:
    """(job_id, old_company_key, new_company_key, old_title_key, new_title_key) for
    every job whose stored keys no longer match what the normalizers produce."""
    out: list[tuple[str, str | None, str | None, str | None, str | None]] = []
    for row in query_all(conn, "SELECT id, company, title, company_key, title_key FROM jobs"):
        new_ck = normalize_company(row["company"])
        new_tk = normalize_title(row["title"])
        if new_ck != row["company_key"] or new_tk != row["title_key"]:
            out.append((row["id"], row["company_key"], new_ck, row["title_key"], new_tk))
    return out


def _plan_blocks(conn: Conn) -> list[tuple[str, str, str, bool]]:
    """(old_key, platform, new_key, collides) per blocked company needing a rewrite,
    where `collides` means the new key is already blocked on that platform."""
    rows = query_all(conn, "SELECT company_key, platform, label FROM blocked_companies")
    existing = {(r["company_key"], r["platform"]) for r in rows}
    out: list[tuple[str, str, str, bool]] = []
    for row in rows:
        # Fall back to the key itself when a block predates labels; re-normalizing an
        # already-normalized key is safe, the transform being idempotent.
        new_key = normalize_company(row["label"] or row["company_key"])
        if new_key and new_key != row["company_key"]:
            collides = (new_key, row["platform"]) in existing
            out.append((row["company_key"], row["platform"], new_key, collides))
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="apply (default: dry run)")
    args = parser.parse_args()
    dry_run = not args.execute

    conn = connect(get_settings())
    jobs = _plan_jobs(conn)
    blocks = _plan_blocks(conn)

    print(f"=== Key backfill - {'DRY RUN' if dry_run else 'EXECUTE'} ===\n")
    print(f"jobs needing new keys : {len(jobs)}")
    print(f"blocks needing rekey  : {len(blocks)}\n")

    for job_id, old_ck, new_ck, old_tk, new_tk in jobs:
        if old_ck != new_ck:
            print(f"  {job_id[:8]} company {old_ck!r} -> {new_ck!r}")
        if old_tk != new_tk:
            print(f"  {job_id[:8]} title   {old_tk!r} -> {new_tk!r}")
    for old_key, platform, new_key, collides in blocks:
        verb = "DROP (already blocked)" if collides else f"-> {new_key!r}"
        print(f"  block {old_key!r} [{platform}] {verb}")

    if dry_run:
        print("\n--- DRY RUN: no changes made. Run with --execute to apply. ---")
        return

    for job_id, _old_ck, new_ck, _old_tk, new_tk in jobs:
        execute(
            conn,
            "UPDATE jobs SET company_key = ?, title_key = ? WHERE id = ?",
            (new_ck, new_tk, job_id),
        )
    for old_key, platform, new_key, collides in blocks:
        if collides:
            execute(
                conn,
                "DELETE FROM blocked_companies WHERE company_key = ? AND platform = ?",
                (old_key, platform),
            )
        else:
            execute(
                conn,
                "UPDATE blocked_companies SET company_key = ? WHERE company_key = ? AND platform = ?",
                (new_key, old_key, platform),
            )
    conn.commit()
    # Under local-first sync, a commit is only local — the app's background pusher
    # isn't running here, so a one-shot script must push or the backfill never leaves
    # this machine. Absent in the other two connection modes, where commit suffices.
    push = getattr(conn, "push", None)
    if callable(push):
        push()
    print(f"\nApplied: {len(jobs)} jobs, {len(blocks)} blocks.")


if __name__ == "__main__":
    main()
