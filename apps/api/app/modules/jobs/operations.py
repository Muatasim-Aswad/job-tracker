"""Feature-owned ownership changes; caller retains transaction ownership."""

from app.infra.database import Conn, execute
from app.modules.jobs.errors import IdentityConflict
from app.modules.jobs.repository import JobRepository
from app.shared.errors import NotFoundError
from app.shared.timeutil import utc_now


def alias_merged_id(conn: Conn, old_job_id: str, canonical_job_id: str, merged_at: str) -> None:
    """Flatten prior aliases and retain the newly dissolved identity."""
    execute(
        conn,
        "UPDATE job_id_aliases SET canonical_job_id = ? WHERE canonical_job_id = ?",
        (canonical_job_id, old_job_id),
    )
    execute(
        conn,
        "INSERT INTO job_id_aliases (old_job_id, canonical_job_id, merged_at) VALUES (?, ?, ?)",
        (old_job_id, canonical_job_id, merged_at),
    )


def delete(conn: Conn, job_id: str) -> None:
    execute(conn, "DELETE FROM jobs WHERE id = ?", (job_id,))


def mark_false_match(conn: Conn, job_id: str, other_job_id: str) -> str:
    """Exclude two canonical jobs and return the resolved source identity."""
    jobs = JobRepository(conn)
    resolved = []
    for requested_id in (job_id, other_job_id):
        canonical_id = jobs.resolve_id(requested_id)
        if canonical_id is None:
            raise NotFoundError(f"job {requested_id} not found")

        resolved.append(canonical_id)

    job_id, other_job_id = resolved
    if job_id == other_job_id:
        return job_id

    _add_false_match(conn, job_id, other_job_id)
    _add_false_match(conn, other_job_id, job_id)

    return job_id


def _add_false_match(conn: Conn, job_id: str, other_id: str) -> None:
    """Add an exclusion while preserving the rest of the metadata bag."""
    jobs = JobRepository(conn)
    job = jobs.get(job_id)
    if job is None:
        return

    existing = job.meta.get("false_matches", [])
    if other_id in existing:
        return

    meta = {**job.meta, "false_matches": [*existing, other_id]}
    jobs.set_meta(job_id, meta, utc_now())


def guard_exclusion(conn: Conn, first_id: str, second_id: str) -> None:
    """Recheck both exclusions inside the write transaction, resolving old aliases."""
    jobs = JobRepository(conn)
    for job_id, other_id in ((first_id, second_id), (second_id, first_id)):
        job = jobs.get(job_id)
        assert job is not None
        if any(
            jobs.resolve_id(excluded) == other_id
            for excluded in job.meta.get("false_matches", [])
            if isinstance(excluded, str)
        ):
            raise IdentityConflict(
                "false_match_conflict", {"job_id": first_id, "other_job_id": second_id}
            )


def merge_exclusions(conn: Conn, loser_id: str, survivor_id: str) -> None:
    """Merge exclusions, dropping references to either merged job."""
    jobs = JobRepository(conn)
    loser = jobs.get(loser_id)
    survivor = jobs.get(survivor_id)
    if loser is None or survivor is None:
        return

    dead = {loser_id, survivor_id}
    merged = [x for x in survivor.meta.get("false_matches", []) if x not in dead]
    for fid in loser.meta.get("false_matches", []):
        if fid not in dead and fid not in merged:
            merged.append(fid)

    if merged != survivor.meta.get("false_matches", []):
        meta = {**survivor.meta, "false_matches": merged}
        jobs.set_meta(survivor_id, meta, utc_now())
