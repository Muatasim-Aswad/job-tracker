"""Normalization for the advisory `company_key` / `title_key` lookup fields.

These are *only* used to surface likely-duplicate jobs through GET /jobs; they
never drive automatic linking. Pure functions get isolated table-driven tests.
"""

import re

# Common legal/entity suffixes stripped so "Example Company N.V." and "Example
# Company" match.
_COMPANY_SUFFIXES = {
    "nv",
    "bv",
    "inc",
    "incorporated",
    "llc",
    "ltd",
    "limited",
    "gmbh",
    "corp",
    "corporation",
    "co",
    "plc",
    "sa",
    "ag",
    "group",
    "holding",
    "holdings",
    "the",
}

# Words that qualify a company rather than name it. LinkedIn runs a separate company
# page per national arm and language edition, so one employer arrives under several
# names ("Example Trading Bank N.V." beside the vacancy board's "Example Trading",
# "Example Employer Nederland" beside "Example Employer"), each normalizing to its own
# key and never matching.
# Stripped in trailing position only — the one place they cannot be part of the name,
# so "Bank of Example" and a company named "Nederland" keep theirs. "groep" is the
# Dutch "group"; it sits here rather than with the suffixes so it is stripped only
# where it cannot be the name.
#
# Narrow on purpose: a wrong merge corrupts the duplicate suggestions and the
# applied-count badge, while a missed one leaves both names as they are today. Agency
# words ("people", "partners", "solutions") are excluded for that reason — they are
# routinely the distinguishing part of a name, and would fold "Example People" onto the
# unrelated "Example".
_COMPANY_DESCRIPTORS = {
    "bank",
    "benelux",
    "en",
    "english",
    "europe",
    "groep",
    "nederland",
    "netherlands",
    "uk",
}

_DOTTED = re.compile(r"[.']")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def _collapse(value: str) -> str:
    # Drop dots/apostrophes first so dotted abbreviations fold together
    # ("N.V." -> "nv"), then turn any remaining separators into single spaces.
    without_dots = _DOTTED.sub("", value.lower())
    return _NON_ALNUM.sub(" ", without_dots).strip()


def normalize_company(name: str | None) -> str | None:
    if not name:
        return None
    tokens = [t for t in _collapse(name).split() if t not in _COMPANY_SUFFIXES]
    # After the suffix filter, so a qualifier standing in front of a legal suffix still
    # ends up trailing ("Example Software Benelux B.V." -> "example software"). One token
    # always survives, so no name normalizes away to nothing.
    while len(tokens) > 1 and tokens[-1] in _COMPANY_DESCRIPTORS:
        tokens.pop()
    return " ".join(tokens) or None


def normalize_title(title: str | None) -> str | None:
    if not title:
        return None
    return _collapse(title) or None
