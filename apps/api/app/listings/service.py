"""Listing upsert, relinking, and the shared job-linking primitive.

`link_listing_to_job` is the *only* place link logic lives; both POST /listings
and PATCH /listings/{id} route through it. Listing upsert, keyed by
(platform, platform_id), and job linking stay fully independent: re-opening a
listing refreshes its scraped fields and never touches job identity.
"""

from app.core.db import Conn
from app.core.enums import (
    MERGE_IMPORTANCE,
    Status,
    correction_event,
    parse_correction,
    status_set_by,
    target_status,
)
from app.core.enums import Event as EventType
from app.core.errors import NotFoundError
from app.core.hashing import stable_hash
from app.core.ids import new_job_id, new_listing_id
from app.core.text import normalize_company, normalize_title
from app.core.timeutil import utc_now
from app.documents.repository import DocumentRepository
from app.events.automation import is_effective_status_event
from app.events.projection import reproject_status
from app.events.repository import EventRepository
from app.jobs.models import Job
from app.jobs.repository import JobRepository
from app.listings.automatic_closure import AutomaticClosure
from app.listings.repository import ListingRepository
from app.listings.schemas import ListingCreate, ListingUpdate, ListingUpsertResult


def _pick_survivor(a: Job, b: Job) -> tuple[Job, Job]:
    """Choose the more advanced job, then the oldest stable identity on a tie."""
    ra = MERGE_IMPORTANCE.get(a.status, 0)
    rb = MERGE_IMPORTANCE.get(b.status, 0)
    if ra != rb:
        return (a, b) if ra > rb else (b, a)
    if a.created_at != b.created_at:
        return (a, b) if a.created_at < b.created_at else (b, a)
    return (a, b) if a.id < b.id else (b, a)


class ListingService:
    def __init__(self, conn: Conn) -> None:
        self.listings = ListingRepository(conn)
        self.jobs = JobRepository(conn)
        self.events = EventRepository(conn)
        self.documents = DocumentRepository(conn)
        self.automatic_closure = AutomaticClosure(self.listings, self.jobs, self.events)

    # --- job identity -----------------------------------------------------

    def _create_job(self, title: str | None, company: str | None, via: str) -> str:
        """Create a job and record the capture or event that created it."""
        now = utc_now()
        job = Job(
            id=new_job_id(),
            title=title,
            company=company,
            company_key=normalize_company(company),
            title_key=normalize_title(title),
            status="new",
            hidden=False,
            starred=False,
            created_at=now,
            updated_at=now,
        )
        self.jobs.insert(job)
        meta: dict[str, object] = {"via": via}
        self.events.insert(
            job.id,
            EventType.CREATED.value,
            now,
            listing_id=None,
            meta=meta,
            meta_hash=stable_hash(meta),
        )
        return job.id

    def _fill_stub_job(self, job_id: str, title: str | None, company: str | None) -> None:
        """Fill each missing identity field without overwriting established values."""
        job = self.jobs.get(job_id)
        if job is None:
            return
        new_title = title if (job.title is None and title) else job.title
        new_company = company if (job.company is None and company) else job.company
        if new_title == job.title and new_company == job.company:
            return  # nothing still-NULL to fill
        self.jobs.set_identity(
            job_id,
            new_title,
            new_company,
            normalize_company(new_company),
            normalize_title(new_title),
            utc_now(),
        )

    # --- the shared linking cascade --------------------------------------

    def link_listing_to_job(self, listing_id_: str, job_id: str) -> None:
        listing = self.listings.get(listing_id_)
        if listing is None:
            raise NotFoundError(f"listing {listing_id_} not found")
        if self.jobs.get(job_id) is None:
            raise NotFoundError(f"job {job_id} not found")
        source_job_id = listing.job_id
        if source_job_id == job_id:
            return
        receiver = self.jobs.get(job_id)
        assert receiver is not None
        receiver_before = receiver.status
        receiver_was_automatic = self.automatic_closure.projected_automatically(job_id)
        self.listings.set_job(listing_id_, job_id, utc_now())
        # Move events known to have come from this listing, even if the source job
        # keeps other listings.
        self.events.move_by_listing(listing_id_, source_job_id, job_id)
        if not self.listings.job_has_listings(source_job_id):
            # The source job is empty, so dissolve it while preserving its remaining
            # unattributed events and documents rather than losing them.
            self.events.move_all(source_job_id, job_id)
            self.documents.move_all(source_job_id, job_id)
            self.jobs.delete(source_job_id)
        else:
            # Removing a listing's events may expose an older status setter on a
            # donor that still owns other listings.
            reproject_status(source_job_id, self.events, self.jobs)
            self.automatic_closure.reconcile(source_job_id, allow_close=True)
        # Both the listing-specific move and the dissolve cascade can introduce a
        # newer status setter, by timestamp then event id, on the receiver.
        reproject_status(job_id, self.events, self.jobs)
        self.automatic_closure.reconcile(job_id, allow_close=True)
        if not receiver_was_automatic:
            self._restore_if_combination_regressed(job_id, receiver_before, source="relink")

    # --- false-match (mutual "not the same job") --------------------------

    def mark_false_match(self, platform: str, platform_id: str, other_job_id: str) -> None:
        """Mutually exclude two jobs from duplicate suggestions.

        Materializes an untracked current listing. Stale exclusions are harmless
        because match reads filter them to live jobs.
        """
        if self.jobs.get(other_job_id) is None:
            raise NotFoundError(f"job {other_job_id} not found")
        job_id, _ = self.ensure_listing(platform, platform_id, via="false_match")
        if job_id == other_job_id:
            return  # a listing can't be "not the same job" as its own job
        self._add_false_match(job_id, other_job_id)
        self._add_false_match(other_job_id, job_id)

    def _add_false_match(self, job_id: str, other_id: str) -> None:
        """Add an exclusion while preserving the rest of the metadata bag."""
        job = self.jobs.get(job_id)
        if job is None:
            return
        existing = job.meta.get("false_matches", [])
        if other_id in existing:
            return
        meta = {**job.meta, "false_matches": [*existing, other_id]}
        self.jobs.set_meta(job_id, meta, utc_now())

    # --- merge (mutual "same job" — fuse two jobs into one) ----------------

    def merge_with_job(
        self, platform: str, platform_id: str, other_job_id: str
    ) -> ListingUpsertResult:
        """Merge both complete jobs and return the current listing's new address."""
        other = self.jobs.get(other_job_id)
        if other is None:
            raise NotFoundError(f"job {other_job_id} not found")
        current_job_id, _ = self.ensure_listing(platform, platform_id, via="link")
        if current_job_id != other_job_id:
            current = self.jobs.get(current_job_id)
            assert current is not None
            survivor, loser = _pick_survivor(current, other)
            self._merge_jobs(loser.id, survivor.id)
        return self.lookup(platform, platform_id)

    def _merge_jobs(self, loser_id: str, survivor_id: str) -> None:
        """Move all dependent records to the survivor, then delete the empty job."""
        now = utc_now()
        survivor = self.jobs.get(survivor_id)
        assert survivor is not None
        before = survivor.status
        before_was_automatic = self.automatic_closure.projected_automatically(survivor_id)
        for listing in self.listings.list_for_job(loser_id):
            self.listings.set_job(listing.id, survivor_id, now)
        self.events.move_all(loser_id, survivor_id)
        self.documents.move_all(loser_id, survivor_id)
        self._merge_false_matches(loser_id, survivor_id)
        self.jobs.delete(loser_id)
        reproject_status(survivor_id, self.events, self.jobs)
        self.automatic_closure.reconcile(survivor_id, allow_close=True)
        if not before_was_automatic:
            self._restore_if_combination_regressed(survivor_id, before, source="merge")

    def _restore_if_combination_regressed(
        self, survivor_id: str, before: str, *, source: str
    ) -> None:
        """Preserve the receiver when combined event order implies an illegal regression.

        Deliberate corrections remain authoritative. Other restorations are logged
        as corrections so future projections remain stable and the conflict stays
        visible and revertible.
        """
        survivor = self.jobs.get(survivor_id)
        assert survivor is not None
        after = survivor.status
        winner = self._winning_status_event(survivor_id)
        if after == before or winner is None or parse_correction(winner) is not None:
            return
        if target_status(winner, before) is None:
            meta: dict[str, object] = {
                "source": source,
                "reason": f"{source} would have walked status back to {after}",
            }
            self.events.insert(
                survivor_id,
                correction_event(Status(before)),
                utc_now(),
                listing_id=None,
                meta=meta,
                meta_hash=stable_hash(meta),
            )
            reproject_status(survivor_id, self.events, self.jobs)

    def _winning_status_event(self, job_id: str) -> str | None:
        """Return the latest `(ts, id)` status-setting event."""
        setters = [
            e.event
            for e in self.events.list_for_job(job_id)
            if status_set_by(e.event) and is_effective_status_event(e)
        ]
        return setters[-1] if setters else None

    def _merge_false_matches(self, loser_id: str, survivor_id: str) -> None:
        """Merge exclusions, dropping references to either merged job."""
        loser = self.jobs.get(loser_id)
        survivor = self.jobs.get(survivor_id)
        if loser is None or survivor is None:
            return
        dead = {loser_id, survivor_id}
        merged = [x for x in survivor.meta.get("false_matches", []) if x not in dead]
        for fid in loser.meta.get("false_matches", []):
            if fid not in dead and fid not in merged:
                merged.append(fid)
        if merged != survivor.meta.get("false_matches", []):
            meta = {**survivor.meta, "false_matches": merged}
            self.jobs.set_meta(survivor_id, meta, utc_now())

    # --- reads ------------------------------------------------------------

    def lookup(self, platform: str, platform_id: str) -> ListingUpsertResult:
        """Resolve a listing's natural key to its (job_id, listing_id) — the stable
        address a dashboard deep-link uses to open the right job. Raises when the
        posting hasn't been captured yet, since there's nothing to open. Unlike
        `ensure_listing`, this never materializes a stub: a pure read."""
        listing = self.listings.get_by_platform(platform, platform_id)
        if listing is None:
            raise NotFoundError(f"no listing for {platform}:{platform_id}")
        return ListingUpsertResult(job_id=listing.job_id, listing_id=listing.id)

    # --- write paths ------------------------------------------------------

    def upsert(self, data: ListingCreate) -> ListingUpsertResult:
        existing = self.listings.get_by_platform(data.platform, data.platform_id)
        newly_closed = data.closed_at is not None and (
            existing is None or existing.closed_at is None
        )
        now = utc_now()
        if existing:
            self.listings.update_fields(
                existing.id,
                self._scraped_fields(
                    data, captured_at=existing.captured_at or now, existing_meta=existing.meta
                ),
                now,
            )
            self._fill_stub_job(existing.job_id, data.title, data.company)
            if data.job_id:
                self.link_listing_to_job(existing.id, data.job_id)
            lid = existing.id
        else:
            job_id = data.job_id or self._create_job(data.title, data.company, via=data.via)
            lid = new_listing_id()
            self.listings.insert(
                lid,
                job_id,
                data.platform,
                data.platform_id,
                url=data.url,
                title=data.title,
                company=data.company,
                apply_type=data.apply_type.value if data.apply_type else None,
                meta={**data.meta, **data.meta_patch} or None,
                captured_at=now,
                updated_at=now,
            )
        # closed_at is natural-keyed rather than a surrogate PATCH: the extension
        # reports "no longer accepting" by (platform, platform_id) like every other
        # write. Applied uniformly to both branches.
        if data.closed_at is not None:
            self.listings.update_fields(lid, {"closed_at": data.closed_at}, now)
        final = self.listings.get(lid)
        assert final is not None
        if data.closed_at is not None:
            self.automatic_closure.adopt_legacy(final.job_id, data.closed_at)
        self.automatic_closure.reconcile(final.job_id, allow_close=newly_closed)
        return ListingUpsertResult(job_id=final.job_id, listing_id=lid)

    def delete(self, listing_id_: str) -> None:
        """Delete a single posting. Its events keep the job as history, losing only
        the listing provenance (listing_id → NULL). If it was the job's *last*
        listing, the now-empty job dissolves too, mirroring the link cascade —
        an orphan job with no addressable listing is meaningless. Never touches
        another job's rows. Dashboard-only; see JobService.delete for
        delete-vs-`closed`."""
        listing = self.listings.get(listing_id_)
        if listing is None:
            raise NotFoundError(f"listing {listing_id_} not found")
        job_id = listing.job_id
        self.events.clear_listing(listing_id_)
        self.listings.delete(listing_id_)
        if not self.listings.job_has_listings(job_id):
            self.events.delete_for_job(job_id)
            self.documents.delete_for_job(job_id)
            self.jobs.delete(job_id)
        else:
            self.automatic_closure.reconcile(job_id, allow_close=True)

    def update(self, listing_id_: str, data: ListingUpdate) -> ListingUpsertResult:
        existing = self.listings.get(listing_id_)
        if existing is None:
            raise NotFoundError(f"listing {listing_id_} not found")
        now = utc_now()
        fields = self._provided_fields(data)
        newly_closed = (
            "closed_at" in fields and fields["closed_at"] is not None and existing.closed_at is None
        )
        if fields:
            self.listings.update_fields(listing_id_, fields, now)
        if data.job_id is not None:
            self.link_listing_to_job(listing_id_, data.job_id)
        final = self.listings.get(listing_id_)
        assert final is not None
        if newly_closed:
            self.automatic_closure.adopt_legacy(final.job_id, str(fields["closed_at"]))
        self.automatic_closure.reconcile(final.job_id, allow_close=newly_closed)
        return ListingUpsertResult(job_id=final.job_id, listing_id=listing_id_)

    def ensure_listing(
        self, platform: str, platform_id: str, *, via: str = "capture"
    ) -> tuple[str, str]:
        """Resolve (platform, platform_id) to (job_id, listing_id), creating a
        stub job + stub listing if the posting hasn't been captured yet.
        `via` records what triggered a first-contact birth on the `created` event."""
        existing = self.listings.get_by_platform(platform, platform_id)
        if existing:
            return existing.job_id, existing.id
        job_id = self._create_job(None, None, via=via)
        lid = new_listing_id()
        self.listings.insert(
            lid,
            job_id,
            platform,
            platform_id,
            url=None,
            title=None,
            company=None,
            apply_type=None,
            meta=None,
            captured_at=None,
            updated_at=utc_now(),
        )
        return job_id, lid

    # --- field helpers ----------------------------------------------------

    @staticmethod
    def _scraped_fields(
        data: ListingCreate, captured_at: str, existing_meta: dict[str, object]
    ) -> dict[str, object]:
        # Only overwrite columns the caller actually provided, so a partial
        # recapture never wipes existing scraped values.
        fields: dict[str, object] = {"captured_at": captured_at}
        for col in ("url", "title", "company"):
            value = getattr(data, col)
            if value is not None:
                fields[col] = value
        if data.apply_type is not None:
            fields["apply_type"] = data.apply_type.value
        if data.meta:
            fields["meta"] = data.meta
        if data.meta_patch:
            base_meta = data.meta if data.meta else existing_meta
            fields["meta"] = {**base_meta, **data.meta_patch}
        return fields

    @staticmethod
    def _provided_fields(data: ListingUpdate) -> dict[str, object]:
        fields: dict[str, object] = {}
        for col in ("url", "title", "company"):
            value = getattr(data, col)
            if value is not None:
                fields[col] = value
        if "closed_at" in data.model_fields_set:
            fields["closed_at"] = data.closed_at
        if data.apply_type is not None:
            fields["apply_type"] = data.apply_type.value
        if data.meta is not None:
            fields["meta"] = data.meta
        return fields
