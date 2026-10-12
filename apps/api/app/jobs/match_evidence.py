"""Evidence comparing a viewed listing with one duplicate candidate.

Evidence explains a suggestion and never excludes a candidate. A field is compared
only when both sides captured it, and a candidate job has the same value when any of
its listings carries the viewed listing's value; a differing candidate value comes
from its earliest-captured listing.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import parse_qsl, urlencode, urlsplit

from app.jobs.schemas import DifferentValues, MatchInsight, MatchInsights, MatchTiming, SameValue
from app.listings.models import Listing

_TRACKING_PARAMS = {
    "_hsenc",
    "_hsmi",
    "fbclid",
    "gclid",
    "gh_src",
    "lever-origin",
    "lever-source",
    "mc_cid",
    "mc_eid",
    "ref",
    "refid",
    "src",
    "trackingid",
    "trk",
}
# LinkedIn profile URLs carry sub-pages ("/company/x/life") and tracking suffixes;
# the first two path segments identify the profile.
_LINKEDIN_PROFILE_ROOTS = {"company", "in", "school", "showcase"}


def normalize_url(url: str | None) -> str | None:
    """Host, path, and identifying query of a URL; scheme, `www.`, fragment,
    trailing slashes, and tracking parameters do not distinguish destinations."""
    if not url:
        return None
    parts = urlsplit(url.strip())
    if not parts.netloc:
        return None
    host = parts.netloc.lower().removeprefix("www.")
    segments = [segment for segment in parts.path.split("/") if segment]
    if host.endswith("linkedin.com") and segments and segments[0] in _LINKEDIN_PROFILE_ROOTS:
        return f"{host}/{'/'.join(segments[:2]).lower()}"
    query = urlencode(
        sorted(
            (key, value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
            if not key.lower().startswith("utm_") and key.lower() not in _TRACKING_PARAMS
        )
    )
    path = "/".join(segments)
    return f"{host}/{path}?{query}" if query else f"{host}/{path}"


def _text_key(value: str) -> str:
    return " ".join(value.split()).casefold()


def _meta_text(listing: Listing, key: str) -> str | None:
    value = listing.meta.get(key)
    if not isinstance(value, str):
        return None
    return value.strip() or None


@dataclass(frozen=True)
class _Check:
    display: Callable[[Listing], str | None]
    same: Callable[[Listing, Listing], bool]


def _text_check(read: Callable[[Listing], str | None]) -> _Check:
    def same(current: Listing, candidate: Listing) -> bool:
        a, b = read(current), read(candidate)
        return a is not None and b is not None and _text_key(a) == _text_key(b)

    return _Check(read, same)


def _url_check(key: str) -> _Check:
    def same(current: Listing, candidate: Listing) -> bool:
        a = normalize_url(_meta_text(current, key))
        return a is not None and a == normalize_url(_meta_text(candidate, key))

    return _Check(lambda listing: _meta_text(listing, key), same)


def _poster_name(listing: Listing) -> str | None:
    return _meta_text(listing, "poster") or _meta_text(listing, "poster_url")


_POSTER_NAME = _text_check(lambda listing: _meta_text(listing, "poster"))


def _same_poster(current: Listing, candidate: Listing) -> bool:
    current_url = normalize_url(_meta_text(current, "poster_url"))
    candidate_url = normalize_url(_meta_text(candidate, "poster_url"))
    if current_url and candidate_url:
        return current_url == candidate_url
    return _POSTER_NAME.same(current, candidate)


_CHECKS: dict[str, _Check] = {
    "apply_url": _url_check("apply_url"),
    "company_url": _url_check("company_url"),
    "poster": _Check(_poster_name, _same_poster),
    "location": _text_check(lambda listing: _meta_text(listing, "location")),
    "workplace": _text_check(lambda listing: _meta_text(listing, "workplace")),
    "salary": _text_check(lambda listing: _meta_text(listing, "salary")),
    "apply_type": _text_check(lambda listing: listing.apply_type or None),
}


def _insight(check: _Check, current: Listing, candidates: Sequence[Listing]) -> MatchInsight | None:
    current_value = check.display(current)
    comparable = [listing for listing in candidates if check.display(listing) is not None]
    if current_value is None or not comparable:
        return None
    if any(check.same(current, listing) for listing in comparable):
        return SameValue(is_same=True)
    candidate_value = check.display(comparable[0])
    assert candidate_value is not None
    return DifferentValues(is_same=False, current=current_value, candidate=candidate_value)


def match_insights(current: Listing | None, candidates: Sequence[Listing]) -> MatchInsights:
    """Field checks for one candidate; `candidates` are its listings by capture time."""
    if current is None:
        return MatchInsights()
    return MatchInsights(
        **{name: _insight(check, current, candidates) for name, check in _CHECKS.items()}
    )


def shares_apply_url(current: Listing | None, candidates: Sequence[Listing]) -> bool:
    """Whether a candidate listing applies at the viewed listing's destination."""
    if current is None:
        return False
    return any(_CHECKS["apply_url"].same(current, listing) for listing in candidates)


def _instant(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def match_timing(current: Listing | None, candidates: Sequence[Listing]) -> MatchTiming | None:
    """When the viewed posting appeared relative to the candidate's last closure. The
    posting date falls back to capture time, its latest possible appearance."""
    if current is None or not candidates:
        return None
    appeared = _instant(current.meta.get("posted_at")) or _instant(current.captured_at)
    if appeared is None:
        return None
    closures = [_instant(listing.closed_at) for listing in candidates]
    if any(closed is None for closed in closures):
        return MatchTiming(overlapping=True)
    last_closed = max(closed for closed in closures if closed is not None)
    if last_closed > appeared:
        return MatchTiming(overlapping=True)
    return MatchTiming(overlapping=False, gap_days=(appeared.date() - last_closed.date()).days)
