"""JD-similarity primitives behind the repost popover's "N% match".
Ported from scripts/merge_duplicates.py; see app/core/similarity.py."""

from app.shared.similarity import jaccard, tokenize


def test_tokenize_strips_html_and_short_and_stop_words() -> None:
    toks = tokenize("<p>The senior Backend Engineer builds APIs.</p>")
    # HTML gone; stop words ("the") and short words (len<=3, e.g. "the") dropped;
    # remaining content words lowercased.
    assert "senior" in toks
    assert "backend" in toks
    assert "engineer" in toks
    assert "builds" in toks
    assert "the" not in toks  # stop word
    assert "<p>" not in toks and "p" not in toks  # tag stripped, single char gone


def test_tokenize_empty_inputs() -> None:
    assert tokenize(None) == set()
    assert tokenize("") == set()
    assert tokenize("<br/>") == set()


def test_jaccard_identical_is_one() -> None:
    text = "Design and build distributed backend microservices in Python and Go."
    assert jaccard(tokenize(text), tokenize(text)) == 1.0


def test_jaccard_disjoint_is_zero() -> None:
    a = tokenize("Kubernetes Terraform observability distributed backend")
    b = tokenize("Copywriting branding storytelling audience engagement")
    assert jaccard(a, b) == 0.0


def test_jaccard_partial_overlap_exact_fraction() -> None:
    a = {"alpha", "bravo", "charlie"}
    b = {"bravo", "charlie", "delta"}
    # intersection {bravo, charlie}=2, union {alpha,bravo,charlie,delta}=4
    assert jaccard(a, b) == 0.5


def test_jaccard_empty_edge_cases() -> None:
    assert jaccard(set(), set()) == 1.0  # both empty → trivially identical
    assert jaccard({"x"}, set()) == 0.0  # one empty → nothing shared
