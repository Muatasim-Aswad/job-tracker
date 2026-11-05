"""Lexical Jaccard overlap for duplicate suggestions, shared with scripts.merge_duplicates. HTML, short words, and stop words are discarded; synonyms and morphological variants are not unified, so rewritten reposts may score lower."""

import re

# Stop words longer than three characters survive the length filter and inflate overlap.
_STOP = {
    "the",
    "and",
    "for",
    "are",
    "not",
    "but",
    "was",
    "you",
    "all",
    "our",
    "its",
    "has",
    "had",
    "can",
    "been",
    "have",
    "will",
    "with",
    "this",
    "that",
    "they",
    "from",
    "your",
    "their",
    "more",
    "also",
    "some",
    "into",
    "than",
    "then",
    "when",
    "who",
    "what",
    "how",
    "each",
    "both",
    "very",
    "just",
    "over",
    "such",
    "like",
    "may",
    "any",
    "one",
    "two",
    "new",
    "get",
    "use",
    "per",
    "via",
    "etc",
    "i.e",
    "e.g",
    "n/a",
    "n.a",
    "tbd",
    "able",
    "well",
    "make",
    "take",
    "give",
    "come",
    "about",
    "these",
    "those",
    "which",
    "there",
    "where",
    "other",
    "after",
    "would",
    "could",
    "should",
    "being",
    "doing",
    "team",
    "work",
    "role",
    "join",
    "help",
    "want",
    "need",
    "good",
    "great",
    "strong",
    "high",
    "key",
    "top",
    "part",
    "wide",
    "long",
    "full",
    "open",
    "big",
    "own",
    "way",
}


def tokenize(text: str | None) -> set[str]:
    """Content-word set for a JD: strip HTML tags, lowercase, keep alphanumeric
    words longer than three chars that aren't stop words. Empty/None → empty set."""
    if not text:
        return set()
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    return {w for w in text.split() if len(w) > 3 and w not in _STOP}


def jaccard(a: set[str], b: set[str]) -> float:
    """|A intersect B| / |A union B|. Two empty sets are trivially identical (1.0);
    one empty against a non-empty set shares nothing (0.0)."""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)
