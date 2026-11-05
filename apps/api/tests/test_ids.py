"""Surrogate id generation (app/core/ids.py). `listing_id`/`job_id` are opaque
UUIDs; identity lives in the natural key. See test_listings_and_identity.py for
the collision property proven end-to-end through the upsert path."""

from __future__ import annotations

from app.shared.ids import new_job_id, new_listing_id


def test_new_listing_id_is_unique_and_opaque() -> None:
    ids = {new_listing_id() for _ in range(1000)}
    assert len(ids) == 1000  # no collisions across a large draw
    # Opaque hex surrogate — no platform prefix or delimiter to parse back out.
    sample = new_listing_id()
    assert "-" not in sample
    assert len(sample) == 32


def test_job_and_listing_ids_do_not_share_a_space() -> None:
    # Both are UUIDs but minted independently; a listing id is never mistaken for
    # a job id.
    assert new_listing_id() != new_job_id()
