"""Isolated unit tests for the pure normalization functions, plus the
cross-language golden fixture that pins the shared TypeScript port to this authority.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.text import normalize_company, normalize_title


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Example Company N.V.", "example company"),
        ("Example Company", "example company"),
        ("Example Trading Bank N.V.", "example trading"),
        ("Example Retail, Inc.", "example retail"),
        ("The Example Staffing Group", "example staffing"),
        ("  Example   Co  ", "example"),
        (None, None),
        ("", None),
        # Trailing qualifiers: one, stacked, and one behind a legal suffix.
        ("Example Employer Nederland", "example employer"),
        ("Example Advisory Netherlands - English", "example advisory"),
        ("Example Software Benelux B.V.", "example software"),
        # Only trailing position is a qualifier — mid-name the word identifies.
        ("Bank of Example", "bank of example"),
        # A qualifier that is the whole name survives: never normalize to nothing.
        ("Nederland", "nederland"),
        # Guards the agency-word exclusion: this must never fold onto "example".
        ("Example People", "example people"),
    ],
)
def test_normalize_company(raw: str | None, expected: str | None) -> None:
    assert normalize_company(raw) == expected


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Backend Engineer", "backend engineer"),
        ("Senior  Backend / Engineer", "senior backend engineer"),
        ("DevOps (Remote)", "devops remote"),
        (None, None),
        ("", None),
    ],
)
def test_normalize_title(raw: str | None, expected: str | None) -> None:
    assert normalize_title(raw) == expected


# The TypeScript mirror replays this fixture to prevent blocklist-key drift.
# Cases cover suffixes, qualifier loops, never-empty guards, dotted abbreviations,
# apostrophes, punctuation, non-ASCII text, and empty input.
GOLDEN_PATH = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "shared"
    / "src"
    / "text"
    / "text.golden.json"
)

GOLDEN_INPUTS: list[str | None] = [
    "Example Company N.V.",
    "Example Trading Bank N.V.",
    "Example Employer Nederland",
    "Example Advisory Netherlands - English",
    "Example Software Benelux B.V.",
    "Bank of Example",
    "Nederland",
    "Example People",
    "Example Retail, Inc.",
    "The Example Staffing Group",
    "  Example   Co  ",
    "Example.com B.V.",
    "Example&Partner",
    "O'Example Media",
    "Café Corp",
    "Ελληνικά",
    "Backend Engineer (Remote)",
    "Senior  Backend / Engineer",
    "DevOps (Remote)",
    "",
    None,
]


def _build_golden() -> dict[str, object]:
    return {
        "cases": [
            {"input": raw, "company": normalize_company(raw), "title": normalize_title(raw)}
            for raw in GOLDEN_INPUTS
        ]
    }


def test_text_golden_matches_snapshot() -> None:
    golden = _build_golden()
    serialized = json.dumps(golden, indent=2, ensure_ascii=False) + "\n"
    current = GOLDEN_PATH.read_text() if GOLDEN_PATH.exists() else None
    if current != serialized:
        GOLDEN_PATH.write_text(serialized)
    assert current == serialized, (
        "text.golden.json was stale and has been regenerated from the Python "
        "normalizers — review and commit it, and confirm the TS port still matches."
    )
