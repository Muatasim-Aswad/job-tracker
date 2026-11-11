"""Natural-key capture and listing observations; callers supply coordinated relinking."""

from collections.abc import Callable
from datetime import UTC, datetime

from app.infra.database import Conn
from app.modules.events.repository import EventRepository
from app.modules.jobs.models import Job
from app.modules.jobs.repository import JobRepository
from app.modules.listings.automatic_closure import AutomaticClosure
from app.modules.listings.models import Listing
from app.modules.listings.repository import ListingRepository
from app.modules.listings.schemas import ListingCreate, ListingUpdate, ListingUpsertResult
from app.shared.enums import ApplyType, ListingAvailability
from app.shared.enums import Event as EventType
from app.shared.errors import NotFoundError
from app.shared.hashing import stable_hash
from app.shared.ids import new_job_id, new_listing_id
from app.shared.text import normalize_company, normalize_title
from app.shared.timeutil import utc_now


def _observed(value: object) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return bool(value)
    return value is not None


def _date_rank(precision: object) -> int:
    if precision == "exact":
        return 2
    if precision == "estimated":
        return 1
    return 0


def _merge_capture_meta(
    existing: dict[str, object], *captures: dict[str, object]
) -> dict[str, object]:
    """Merge observed facts; missing values are not evidence of removal."""
    meta = dict(existing)
    date_keys = ("posted_at", "posted_precision", "posted_age")
    for capture in captures:
        updates = {key: value for key, value in capture.items() if _observed(value)}
        has_date = _observed(updates.get("posted_at"))
        preserve_date = _observed(meta.get("posted_at")) and (
            not has_date
            or _date_rank(meta.get("posted_precision"))
            > _date_rank(updates.get("posted_precision"))
        )
        if preserve_date:
            for key in date_keys:
                updates.pop(key, None)
        elif has_date:
            # A replacement date owns its precision and raw age as one group.
            for key in date_keys:
                meta.pop(key, None)
        for key, value in updates.items():
            if isinstance(value, dict):
                old = meta.get(key)
                merged = _merge_capture_meta(old if isinstance(old, dict) else {}, value)
                if merged:
                    meta[key] = merged
            else:
                meta[key] = value
    return meta


class ListingService:
    def __init__(self, conn: Conn) -> None:
        self.listings = ListingRepository(conn)
        self.jobs = JobRepository(conn)
        self.events = EventRepository(conn)
        self.automatic_closure = AutomaticClosure(self.listings, self.jobs, self.events)

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

    def lookup(self, platform: str, platform_id: str) -> ListingUpsertResult:
        """Resolve a listing's natural key to its (job_id, listing_id) — the stable
        address a dashboard deep-link uses to open the right job. Raises when the
        posting hasn't been captured yet, since there's nothing to open. Unlike
        `ensure_listing`, this never materializes a stub: a pure read."""
        listing = self.listings.get_by_platform(platform, platform_id)
        if listing is None:
            raise NotFoundError(f"no listing for {platform}:{platform_id}")
        return ListingUpsertResult(job_id=listing.job_id, listing_id=listing.id)

    def upsert(
        self, data: ListingCreate, *, relink: Callable[[str, str], None]
    ) -> ListingUpsertResult:
        existing = self.listings.get_by_platform(data.platform, data.platform_id)
        title = data.title if _observed(data.title) else None
        company = data.company if _observed(data.company) else None
        now = utc_now()
        availability_fields = self._availability_fields(data, existing, now)
        if existing:
            self.listings.update_fields(
                existing.id,
                self._scraped_fields(
                    data,
                    captured_at=existing.captured_at or now,
                    last_detail_captured_at=now if data.capture_kind == "detail" else None,
                    existing_meta=existing.meta,
                    existing_apply_type=existing.apply_type,
                ),
                now,
            )
            self._fill_stub_job(existing.job_id, title, company)
            if data.job_id:
                relink(existing.id, data.job_id)
            lid = existing.id
        else:
            if data.job_id is not None:
                job_id = self.jobs.resolve_id(data.job_id)
                if job_id is None:
                    raise NotFoundError(f"job {data.job_id} not found")
            else:
                job_id = self._create_job(title, company, via=data.via)
            lid = new_listing_id()
            self.listings.insert(
                lid,
                job_id,
                data.platform,
                data.platform_id,
                url=data.url if _observed(data.url) else None,
                title=title,
                company=company,
                apply_type=data.apply_type.value if data.apply_type else None,
                meta=_merge_capture_meta({}, data.meta, data.meta_patch) or None,
                captured_at=now,
                updated_at=now,
                last_detail_captured_at=now if data.capture_kind == "detail" else None,
            )
        if availability_fields:
            self.listings.update_fields(lid, availability_fields, now)
        final = self.listings.get(lid)
        assert final is not None
        newly_closed = final.closed_at is not None and (
            existing is None or existing.closed_at is None
        )
        if newly_closed and final.closed_at is not None:
            self.automatic_closure.adopt_legacy(final.job_id, final.closed_at)
        self.automatic_closure.reconcile(final.job_id, allow_close=newly_closed)
        return ListingUpsertResult(job_id=final.job_id, listing_id=lid)

    def update(
        self, listing_id_: str, data: ListingUpdate, *, relink: Callable[[str, str], None]
    ) -> ListingUpsertResult:
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
            relink(listing_id_, data.job_id)
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

    @staticmethod
    def _availability_fields(
        data: ListingCreate, existing: Listing | None, now: str
    ) -> dict[str, object]:
        fields: dict[str, object] = {}
        if data.closed_at is not None:
            fields["closed_at"] = (existing.closed_at if existing else None) or data.closed_at
        if data.availability in (None, ListingAvailability.UNKNOWN):
            return fields
        observed_at = data.availability_observed_at or datetime.fromisoformat(now)
        if (
            existing
            and existing.availability_observed_at
            and observed_at < datetime.fromisoformat(existing.availability_observed_at)
        ):
            return {}
        fields.update(
            availability=data.availability.value,
            availability_message=data.availability_message,
            availability_observed_at=observed_at.astimezone(UTC).isoformat(),
        )
        if data.availability == ListingAvailability.OPEN:
            fields["closed_at"] = None
        elif data.availability == ListingAvailability.CLOSED:
            fields["closed_at"] = (
                (existing.closed_at if existing else None)
                or data.closed_at
                or observed_at.astimezone(UTC).isoformat()
            )
        # An informational notice alone cannot undo a previously observed closure.
        return fields

    @staticmethod
    def _scraped_fields(
        data: ListingCreate,
        captured_at: str,
        last_detail_captured_at: str | None,
        existing_meta: dict[str, object],
        existing_apply_type: str | None,
    ) -> dict[str, object]:
        # Only overwrite columns the caller actually provided, so a partial
        # recapture never wipes existing scraped values.
        fields: dict[str, object] = {"captured_at": captured_at}
        if last_detail_captured_at is not None:
            fields["last_detail_captured_at"] = last_detail_captured_at
        for col in ("url", "title", "company"):
            value = getattr(data, col)
            if _observed(value):
                fields[col] = value
        if data.apply_type is not None and not (
            data.apply_type == ApplyType.UNKNOWN
            and existing_apply_type in (ApplyType.EASY_APPLY, ApplyType.EXTERNAL)
        ):
            fields["apply_type"] = data.apply_type.value
        if data.meta or data.meta_patch:
            fields["meta"] = _merge_capture_meta(existing_meta, data.meta, data.meta_patch)
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
            fields["availability"] = (
                ListingAvailability.CLOSED.value
                if data.closed_at is not None
                else ListingAvailability.UNKNOWN.value
            )
            fields["availability_message"] = None
            fields["availability_observed_at"] = utc_now()
        if data.apply_type is not None:
            fields["apply_type"] = data.apply_type.value
        if data.meta is not None:
            fields["meta"] = data.meta
        return fields
