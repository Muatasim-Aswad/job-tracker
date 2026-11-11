from fastapi import APIRouter, Response

from app.modules.job_lifecycle.dependencies import ServiceDep
from app.modules.listings.dependencies import CaptureDep
from app.modules.listings.schemas import (
    FalseMatchCreate,
    LinkJobCreate,
    ListingCreate,
    ListingUpdate,
    ListingUpsertResult,
)

router = APIRouter(tags=["listings"])


@router.post("/listings", response_model=ListingUpsertResult)
def create_listing(*, body: ListingCreate, service: ServiceDep) -> ListingUpsertResult:
    return service.upsert(body)


# Declared before /listings/{listing_id} so "false-match" isn't captured as an id.
@router.post("/listings/false-match", status_code=204)
def create_false_match(*, body: FalseMatchCreate, service: ServiceDep) -> Response:
    """Exclude two jobs from each other's duplicate suggestions.

    Materializes the current listing if it is not tracked yet.
    """
    service.mark_false_match(body.platform, body.platform_id, body.other_job_id)
    return Response(status_code=204)


# Declared before /listings/{listing_id} so "link-job" isn't captured as an id.
@router.post("/listings/link-job", response_model=ListingUpsertResult)
def link_job(*, body: LinkJobCreate, service: ServiceDep) -> ListingUpsertResult:
    """Merge two jobs under the more advanced funnel state.

    Returns the current listing's address under the surviving job.
    """
    return service.merge_with_job(body.platform, body.platform_id, body.other_job_id)


# Declared before /listings/{listing_id} so "lookup" isn't captured as an id.
@router.get("/listings/lookup", response_model=ListingUpsertResult)
def lookup_listing(*, platform: str, platform_id: str, service: CaptureDep) -> ListingUpsertResult:
    """Resolve a listing natural key to its stored job and listing ids."""
    return service.lookup(platform, platform_id)


@router.patch("/listings/{listing_id}", response_model=ListingUpsertResult)
def update_listing(
    *, listing_id: str, body: ListingUpdate, service: ServiceDep
) -> ListingUpsertResult:
    return service.update(listing_id, body)


@router.delete("/listings/{listing_id}", status_code=204)
def delete_listing(*, listing_id: str, service: ServiceDep) -> Response:
    """Delete one listing and dissolve its job if no listings remain."""
    service.delete_listing(listing_id)
    return Response(status_code=204)
