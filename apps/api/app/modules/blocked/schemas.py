from pydantic import BaseModel

# The wildcard applies a block across platforms.
ALL_PLATFORMS = "*"


class BlockedCompanyCreate(BaseModel):
    """Raw company name and optional platform scope for a normalized block."""

    company: str
    platform: str = ALL_PLATFORMS
