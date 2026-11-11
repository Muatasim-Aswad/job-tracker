"""Opaque job and listing UUIDs. Listing identity is the unique (platform, platform_id) natural key; clients never reconstruct stored IDs. Legacy readable IDs remain addressable."""

import uuid


def new_job_id() -> str:
    return uuid.uuid4().hex


def new_listing_id() -> str:
    return uuid.uuid4().hex
