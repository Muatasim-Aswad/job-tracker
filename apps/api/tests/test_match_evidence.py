"""Duplicate-candidate evidence: URL normalization, field insights, and timing."""

from typing import Any

import pytest

from app.jobs.match_evidence import match_insights, match_timing, normalize_url, shares_apply_url
from app.jobs.schemas import DifferentValues, SameValue
from app.listings.models import Listing


def _listing(
    meta: dict[str, Any] | None = None,
    *,
    apply_type: str | None = None,
    captured_at: str = "2026-09-01T10:00:00+00:00",
    closed_at: str | None = None,
) -> Listing:
    return Listing(
        id="l",
        job_id="j",
        platform="linkedin",
        platform_id="1",
        apply_type=apply_type,
        meta=meta or {},
        captured_at=captured_at,
        closed_at=closed_at,
    )


@pytest.mark.parametrize(
    ("a", "b"),
    [
        (
            "https://www.example.com/jobs/123/?utm_source=linkedin&trk=x#apply",
            "http://example.com/jobs/123",
        ),
        ("https://jobs.example.com/apply?jobId=7&ref=li", "https://jobs.example.com/apply?jobId=7"),
        (
            "https://www.linkedin.com/company/Example-Labs/life/",
            "https://linkedin.com/company/example-labs?trk=abc",
        ),
        ("https://www.linkedin.com/in/jane-doe/", "https://www.linkedin.com/in/jane-doe"),
    ],
)
def test_normalize_url_ignores_non_identifying_parts(a: str, b: str) -> None:
    assert normalize_url(a) == normalize_url(b)


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("https://jobs.example.com/apply?jobId=7", "https://jobs.example.com/apply?jobId=8"),
        ("https://example.com/jobs/123", "https://example.com/jobs/124"),
    ],
)
def test_normalize_url_keeps_identifying_parts(a: str, b: str) -> None:
    assert normalize_url(a) != normalize_url(b)


@pytest.mark.parametrize("url", [None, "", "not a url"])
def test_normalize_url_rejects_unusable_input(url: str | None) -> None:
    assert normalize_url(url) is None


def test_insights_report_same_and_different_values() -> None:
    current = _listing(
        {"location": "Amsterdam,  Netherlands", "salary": "€60k", "workplace": "Hybrid"},
        apply_type="external",
    )
    candidate = _listing(
        {"location": "amsterdam, netherlands", "salary": "€55k", "workplace": "Hybrid"},
        apply_type="external",
    )

    insights = match_insights(current, [candidate])

    assert insights.location == SameValue(is_same=True)
    assert insights.workplace == SameValue(is_same=True)
    assert insights.apply_type == SameValue(is_same=True)
    assert insights.salary == DifferentValues(is_same=False, current="€60k", candidate="€55k")


def test_insight_is_null_unless_both_sides_captured_the_field() -> None:
    insights = match_insights(_listing({"salary": "€60k"}), [_listing({"location": "Utrecht"})])

    assert insights.salary is None
    assert insights.location is None
    assert match_insights(None, [_listing({"salary": "€60k"})]).salary is None


def test_any_candidate_listing_with_the_value_counts_as_same() -> None:
    current = _listing({"location": "Utrecht"})
    earliest = _listing({"location": "Amsterdam"})
    later = _listing({"location": "Utrecht"})

    assert match_insights(current, [earliest, later]).location == SameValue(is_same=True)
    assert match_insights(current, [earliest]).location == DifferentValues(
        is_same=False, current="Utrecht", candidate="Amsterdam"
    )


def test_poster_prefers_profile_urls_over_names() -> None:
    current = _listing({"poster": "Jane Doe", "poster_url": "https://www.linkedin.com/in/jane"})
    renamed = _listing({"poster": "Jane D.", "poster_url": "https://linkedin.com/in/jane/"})
    named_only = _listing({"poster": "jane doe"})

    assert match_insights(current, [renamed]).poster == SameValue(is_same=True)
    assert match_insights(current, [named_only]).poster == SameValue(is_same=True)


def test_shares_apply_url_compares_normalized_destinations() -> None:
    current = _listing({"apply_url": "https://jobs.example.com/apply?jobId=7&utm_source=li"})

    assert shares_apply_url(
        current, [_listing({"apply_url": "https://jobs.example.com/apply?jobId=7"})]
    )
    assert not shares_apply_url(
        current, [_listing({"apply_url": "https://jobs.example.com/apply?jobId=8"})]
    )
    assert not shares_apply_url(None, [_listing({"apply_url": "https://jobs.example.com/a"})])


def test_timing_counts_days_after_the_last_candidate_closure() -> None:
    current = _listing({"posted_at": "2026-09-15T08:00:00Z"})
    candidates = [
        _listing(closed_at="2026-08-20T12:00:00+00:00"),
        _listing(closed_at="2026-09-01T12:00:00+00:00"),
    ]

    timing = match_timing(current, candidates)

    assert timing is not None
    assert (timing.overlapping, timing.gap_days) == (False, 14)


def test_timing_overlaps_while_a_candidate_listing_is_open_or_closed_later() -> None:
    current = _listing({"posted_at": "2026-09-15T08:00:00Z"})

    still_open = match_timing(current, [_listing(closed_at=None)])
    closed_after = match_timing(current, [_listing(closed_at="2026-09-20T00:00:00+00:00")])

    assert still_open is not None and (still_open.overlapping, still_open.gap_days) == (True, None)
    assert closed_after is not None and closed_after.overlapping


def test_timing_falls_back_to_capture_time_and_needs_both_sides() -> None:
    current = _listing(captured_at="2026-09-10T00:00:00+00:00")
    closed = [_listing(closed_at="2026-09-03T00:00:00+00:00")]

    timing = match_timing(current, closed)

    assert timing is not None and timing.gap_days == 7
    assert match_timing(None, closed) is None
    assert match_timing(current, []) is None
