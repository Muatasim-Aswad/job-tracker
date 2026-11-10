"""Own coordinated writes within the caller's existing transaction."""

from app.infra.database import Conn
from app.modules.application_workflows import operations as application_workflows_operations
from app.modules.documents import operations as documents_operations
from app.modules.events import operations as events_operations
from app.modules.form_fill import context as form_fill_operations
from app.modules.jobs import operations as jobs_operations
from app.modules.jobs.errors import IdentityConflict
from app.modules.jobs.models import Job
from app.modules.jobs.repository import JobRepository
from app.modules.jobs.schemas import JobMergeResult
from app.modules.listings import operations as listings_operations
from app.modules.listings.repository import ListingRepository
from app.modules.listings.schemas import ListingCreate, ListingUpdate, ListingUpsertResult
from app.modules.listings.service import ListingService
from app.modules.notifications import service as notifications
from app.modules.staleness import service as staleness
from app.shared.enums import MERGE_IMPORTANCE
from app.shared.errors import NotFoundError
from app.shared.timeutil import utc_now


def _pick_survivor(a: Job, b: Job) -> tuple[Job, Job]:
    """Choose the more advanced job, then the oldest stable identity on a tie."""
    ra = MERGE_IMPORTANCE.get(a.status, 0)
    rb = MERGE_IMPORTANCE.get(b.status, 0)
    if ra != rb:
        return (a, b) if ra > rb else (b, a)

    if a.created_at != b.created_at:
        return (a, b) if a.created_at < b.created_at else (b, a)

    return (a, b) if a.id < b.id else (b, a)


class JobLifecycle:
    def __init__(self, conn: Conn) -> None:
        self.conn = conn
        self.capture = ListingService(conn)
        self.listings = ListingRepository(conn)
        self.jobs = JobRepository(conn)
        self.automatic_closure = self.capture.automatic_closure

    def upsert(self, data: ListingCreate) -> ListingUpsertResult:
        return self.capture.upsert(data, relink=self.link_listing_to_job)

    def update(self, listing_id: str, data: ListingUpdate) -> ListingUpsertResult:
        return self.capture.update(listing_id, data, relink=self.link_listing_to_job)

    def link_listing_to_job(self, listing_id_: str, job_id: str) -> None:
        listing = self.listings.get(listing_id_)
        if listing is None:
            raise NotFoundError(f"listing {listing_id_} not found")

        requested_job_id = job_id
        job_id = self.jobs.resolve_id(job_id) or ""
        if not job_id:
            raise NotFoundError(f"job {requested_job_id} not found")

        source_job_id = listing.job_id
        if source_job_id == job_id:
            return

        source_will_dissolve = len(self.listings.list_for_job(source_job_id)) == 1
        jobs_operations.guard_exclusion(self.conn, source_job_id, job_id)
        application_workflows_operations.guard_relink(
            self.conn, source_job_id, job_id, listing_id_, source_will_dissolve=source_will_dissolve
        )
        receiver = self.jobs.get(job_id)
        assert receiver is not None
        receiver_before = receiver.status
        receiver_was_automatic = self.automatic_closure.projected_automatically(job_id)
        listings_operations.set_job(self.conn, listing_id_, job_id, utc_now())
        # Listing-attributed history moves even when the donor keeps other listings.
        events_operations.move_by_listing(self.conn, listing_id_, source_job_id, job_id)
        form_fill_operations.move_listing_job_context(self.conn, listing_id_, job_id)
        if not self.listings.job_has_listings(source_job_id):
            # Preserve unattributed history and receipts before dissolving the empty donor.
            events_operations.move_all(self.conn, source_job_id, job_id)
            documents_operations.move_all(self.conn, source_job_id, job_id)
            form_fill_operations.move_job_context(self.conn, source_job_id, job_id)
            notifications.move_job(self.conn, source_job_id, job_id)
            jobs_operations.alias_merged_id(self.conn, source_job_id, job_id, utc_now())
            jobs_operations.delete(self.conn, source_job_id)
        else:
            # Removing attributed history can expose an older donor status.
            events_operations.reproject(self.conn, source_job_id)
            self.automatic_closure.reconcile(source_job_id, allow_close=True)
        # Combined history may change the receiver's winning status event.

        events_operations.reproject(self.conn, job_id)
        self.automatic_closure.reconcile(job_id, allow_close=True)
        if not receiver_was_automatic:
            events_operations.preserve_combined_status(
                self.conn, job_id, receiver_before, source="relink"
            )

        application_workflows_operations.discard_ineligible(self.conn, job_id)
        if self.jobs.get(source_job_id) is not None:
            application_workflows_operations.discard_ineligible(self.conn, source_job_id)
        staleness.reconcile(self.conn, [source_job_id, job_id])

    def mark_false_match(self, platform: str, platform_id: str, other_job_id: str) -> None:
        """Mutually exclude two jobs from duplicate suggestions.

        Materializes an untracked current listing. Stale exclusions are harmless
        because match reads filter them to live jobs.
        """
        requested_job_id = other_job_id
        other_job_id = self.jobs.resolve_id(other_job_id) or ""
        if not other_job_id:
            raise NotFoundError(f"job {requested_job_id} not found")

        job_id, _ = self.capture.ensure_listing(platform, platform_id, via="false_match")
        jobs_operations.mark_false_match(self.conn, job_id, other_job_id)

    def mark_jobs_false_match(self, job_id: str, other_job_id: str) -> str:
        return jobs_operations.mark_false_match(self.conn, job_id, other_job_id)

    def merge_with_job(
        self, platform: str, platform_id: str, other_job_id: str
    ) -> ListingUpsertResult:
        """Merge both complete jobs and return the current listing's new address."""
        requested_job_id = other_job_id
        other_job_id = self.jobs.resolve_id(other_job_id) or ""
        other = self.jobs.get(other_job_id) if other_job_id else None
        if other is None:
            raise NotFoundError(f"job {requested_job_id} not found")

        current_job_id, _ = self.capture.ensure_listing(platform, platform_id, via="link")
        merged = self.merge_jobs(current_job_id, other_job_id)
        result = self.capture.lookup(platform, platform_id)

        return result.model_copy(update={"merged_from": merged.merged_from})

    def merge_jobs(self, job_id: str, other_job_id: str) -> JobMergeResult:
        """Merge stored jobs, resolving aliases and retaining the standard survivor rules."""
        jobs: list[Job] = []
        for requested_id in (job_id, other_job_id):
            canonical_id = self.jobs.resolve_id(requested_id)
            job = self.jobs.get(canonical_id) if canonical_id is not None else None
            if job is None:
                raise NotFoundError(f"job {requested_id} not found")

            jobs.append(job)

        current, other = jobs
        if current.id == other.id:
            return JobMergeResult(job_id=current.id)

        survivor, loser = _pick_survivor(current, other)
        self._merge_jobs(loser.id, survivor.id)

        return JobMergeResult(job_id=survivor.id, merged_from=[loser.id])

    def _merge_jobs(self, loser_id: str, survivor_id: str) -> None:
        """Move all dependent records to the survivor, then delete the empty job."""
        jobs_operations.guard_exclusion(self.conn, loser_id, survivor_id)
        application_workflows_operations.guard_merge(self.conn, loser_id, survivor_id)
        now = utc_now()
        survivor = self.jobs.get(survivor_id)
        assert survivor is not None
        before = survivor.status
        before_was_automatic = self.automatic_closure.projected_automatically(survivor_id)
        for listing in self.listings.list_for_job(loser_id):
            listings_operations.set_job(self.conn, listing.id, survivor_id, now)

        events_operations.move_all(self.conn, loser_id, survivor_id)
        documents_operations.move_all(self.conn, loser_id, survivor_id)
        form_fill_operations.move_job_context(self.conn, loser_id, survivor_id)
        jobs_operations.merge_exclusions(self.conn, loser_id, survivor_id)
        jobs_operations.alias_merged_id(self.conn, loser_id, survivor_id, now)
        notifications.move_job(self.conn, loser_id, survivor_id)
        jobs_operations.delete(self.conn, loser_id)
        events_operations.reproject(self.conn, survivor_id)
        self.automatic_closure.reconcile(survivor_id, allow_close=True)
        if not before_was_automatic:
            events_operations.preserve_combined_status(
                self.conn, survivor_id, before, source="merge"
            )

        application_workflows_operations.discard_ineligible(self.conn, survivor_id)
        staleness.reconcile(self.conn, [survivor_id])

    def delete_listing(self, listing_id_: str) -> None:
        """Retain job history unless its last addressable listing is deleted."""
        listing = self.listings.get(listing_id_)
        if listing is None:
            raise NotFoundError(f"listing {listing_id_} not found")

        job_id = listing.job_id
        events_operations.clear_listing(self.conn, listing_id_)
        form_fill_operations.clear_listing_context(self.conn, listing_id_)
        listings_operations.delete(self.conn, listing_id_)
        if not self.listings.job_has_listings(job_id):
            application_workflows_operations.delete_for_job(self.conn, job_id)
            events_operations.delete_for_job(self.conn, job_id)
            documents_operations.delete_for_job(self.conn, job_id)
            form_fill_operations.clear_job_context(self.conn, job_id)
            notifications.detach_job(self.conn, job_id)
            jobs_operations.delete(self.conn, job_id)
        else:
            self.automatic_closure.reconcile(job_id, allow_close=True)
            staleness.reconcile(self.conn, [job_id])

    def delete_job(self, job_id: str) -> None:
        """Deliberately delete a canonical job; remove children before their parent."""
        requested_job_id = job_id
        job_id = self.jobs.resolve_id(job_id) or ""
        if not job_id:
            raise NotFoundError(f"job {requested_job_id} not found")

        if job_id != requested_job_id:
            raise IdentityConflict(
                "job_merged", {"requested_job_id": requested_job_id, "canonical_job_id": job_id}
            )

        for listing in self.listings.list_for_job(job_id):
            form_fill_operations.clear_listing_context(self.conn, listing.id)

        form_fill_operations.clear_job_context(self.conn, job_id)
        application_workflows_operations.delete_for_job(self.conn, job_id)
        events_operations.delete_for_job(self.conn, job_id)
        documents_operations.delete_for_job(self.conn, job_id)
        listings_operations.delete_for_job(self.conn, job_id)
        notifications.detach_job(self.conn, job_id)
        jobs_operations.delete(self.conn, job_id)
