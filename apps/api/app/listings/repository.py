import json
from dataclasses import dataclass, field

from app.core.db import Conn, Row, execute, hydrate_json, query_all, query_one
from app.listings.models import Listing


@dataclass
class ListingSummary:
    """Per-job listing rollup for `GET /jobs` cards (see `summaries_for_jobs`)."""

    platforms: list[str] = field(default_factory=list)
    apply_types: list[str] = field(default_factory=list)
    listing_count: int = 0
    # The natural key + url of the listing a card links to. Prefers a listing
    # that actually has a captured url; falls back to the first one otherwise, so
    # a pure-stub job still exposes its (platform, platform_id) for link rebuild.
    primary_platform: str | None = None
    primary_platform_id: str | None = None
    primary_url: str | None = None
    # The primary listing's captured application destination (`meta.apply_url`).
    primary_apply_url: str | None = None


_COLUMNS = (
    "id, job_id, platform, platform_id, url, title, company, apply_type, "
    "meta, captured_at, closed_at, updated_at"
)


def _to_listing(row: Row) -> Listing:
    return Listing(**hydrate_json(row, empty={}))


class ListingRepository:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn

    def get(self, listing_id: str) -> Listing | None:
        row = query_one(self.conn, f"SELECT {_COLUMNS} FROM listings WHERE id = ?", (listing_id,))
        return _to_listing(row) if row else None

    def get_by_platform(self, platform: str, platform_id: str) -> Listing | None:
        row = query_one(
            self.conn,
            f"SELECT {_COLUMNS} FROM listings WHERE platform = ? AND platform_id = ?",
            (platform, platform_id),
        )
        return _to_listing(row) if row else None

    def list_for_job(self, job_id: str) -> list[Listing]:
        rows = query_all(
            self.conn,
            f"SELECT {_COLUMNS} FROM listings WHERE job_id = ? ORDER BY captured_at",
            (job_id,),
        )
        return [_to_listing(r) for r in rows]

    def insert(
        self,
        listing_id: str,
        job_id: str,
        platform: str,
        platform_id: str,
        *,
        url: str | None,
        title: str | None,
        company: str | None,
        apply_type: str | None,
        meta: dict[str, object] | None,
        captured_at: str | None,
        updated_at: str | None,
    ) -> None:
        # closed_at is omitted (nullable, defaults to NULL); it's only set later
        # when a posting goes "no longer accepting applications".
        execute(
            self.conn,
            "INSERT INTO listings "
            "(id, job_id, platform, platform_id, url, title, company, apply_type, "
            "meta, captured_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                listing_id,
                job_id,
                platform,
                platform_id,
                url,
                title,
                company,
                apply_type,
                json.dumps(meta) if meta else None,
                captured_at,
                updated_at,
            ),
        )

    def update_fields(self, listing_id: str, fields: dict[str, object], updated_at: str) -> None:
        """Update only the provided columns. `meta` is serialized to JSON by the
        caller's dict value here for uniformity."""
        if "meta" in fields and fields["meta"] is not None:
            fields = {**fields, "meta": json.dumps(fields["meta"])}
        sets = [f"{col} = ?" for col in fields]
        params: list[object] = list(fields.values())
        sets.append("updated_at = ?")
        params.extend([updated_at, listing_id])
        execute(self.conn, f"UPDATE listings SET {', '.join(sets)} WHERE id = ?", params)

    def set_job(self, listing_id: str, job_id: str, updated_at: str) -> None:
        execute(
            self.conn,
            "UPDATE listings SET job_id = ?, updated_at = ? WHERE id = ?",
            (job_id, updated_at, listing_id),
        )

    def delete(self, listing_id: str) -> None:
        execute(self.conn, "DELETE FROM listings WHERE id = ?", (listing_id,))

    def delete_for_job(self, job_id: str) -> None:
        execute(self.conn, "DELETE FROM listings WHERE job_id = ?", (job_id,))

    def job_has_listings(self, job_id: str) -> bool:
        row = query_one(self.conn, "SELECT 1 FROM listings WHERE job_id = ? LIMIT 1", (job_id,))
        return row is not None

    def descriptions_for_jobs(self, job_ids: list[str]) -> dict[str, str]:
        """Best JD text per job — the earliest-captured listing that carries a
        non-null `meta.description` — for the duplicate-similarity score.
        Jobs with no captured JD are simply absent. One query (no N+1); `meta` JSON
        is parsed in Python rather than via `json_extract` so it stays portable
        across sqlite/libSQL. Empty input short-circuits — SQLite rejects `IN ()`."""
        if not job_ids:
            return {}
        placeholders = ", ".join("?" for _ in job_ids)
        rows = query_all(
            self.conn,
            f"SELECT job_id, meta FROM listings WHERE job_id IN ({placeholders}) "
            "ORDER BY captured_at",
            tuple(job_ids),
        )
        out: dict[str, str] = {}
        for row in rows:
            if row["job_id"] in out:
                continue  # earliest-captured wins (rows are captured_at-ordered)
            meta = json.loads(row["meta"]) if row["meta"] else {}
            desc = meta.get("description")
            if desc:
                out[row["job_id"]] = desc
        return out

    def summaries_for_jobs(self, job_ids: list[str]) -> dict[str, ListingSummary]:
        """Roll up each job's listings in one query, keyed by job_id, for the
        `GET /jobs` board cards. Returns per job: distinct `platforms`, distinct
        non-null `apply_types`, `listing_count`, and the primary listing's address
        and `meta.apply_url`. Jobs with no listings are
        simply absent (the caller defaults them to empty). Empty input
        short-circuits — SQLite rejects `IN ()`."""
        if not job_ids:
            return {}
        placeholders = ", ".join("?" for _ in job_ids)
        rows = query_all(
            self.conn,
            "SELECT job_id, platform, platform_id, url, apply_type, "
            "json_extract(meta, '$.apply_url') AS apply_url FROM listings "
            f"WHERE job_id IN ({placeholders}) ORDER BY captured_at",
            tuple(job_ids),
        )
        out: dict[str, ListingSummary] = {}
        for row in rows:
            entry = out.setdefault(row["job_id"], ListingSummary())
            entry.listing_count += 1
            if row["platform"] and row["platform"] not in entry.platforms:
                entry.platforms.append(row["platform"])
            if row["apply_type"] and row["apply_type"] not in entry.apply_types:
                entry.apply_types.append(row["apply_type"])
            # First listing seeds the primary; a later one with a real url upgrades
            # it (a captured link beats a stub's reconstructed one).
            if entry.primary_platform_id is None or (entry.primary_url is None and row["url"]):
                entry.primary_platform = row["platform"]
                entry.primary_platform_id = row["platform_id"]
                entry.primary_url = row["url"]
                entry.primary_apply_url = row["apply_url"]
        return out
