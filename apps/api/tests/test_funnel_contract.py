"""Keep the TypeScript funnel mirror aligned with the server's enforced rules.

The server generates a committed JSON contract; the shared package tests its mirror
against that file. Any server rule change regenerates the contract and fails this
test until the TypeScript implementation is reviewed and updated.
"""

import json
from pathlib import Path

from app.shared.enums import Status, active_rank, is_terminal, status_for_event, target_status

# The shared package asserts its tables against this generated contract.
CONTRACT_PATH = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "shared"
    / "src"
    / "funnel"
    / "funnel.contract.json"
)

# Canonical order: active funnel, then terminal outcomes.
STATUS_CANON = [s.value for s in Status]


def _enforced_adjacency() -> dict[str, list[str]]:
    """Return every status reachable by one organic event from each status."""
    setting_events = [s for s in STATUS_CANON if status_for_event(s) is not None]
    adjacency: dict[str, list[str]] = {}
    for current in STATUS_CANON:
        reachable = {
            target
            for event in setting_events
            if (target := target_status(event, current)) is not None and target != current
        }
        adjacency[current] = [s for s in STATUS_CANON if s in reachable]
    return adjacency


def _build_contract() -> dict[str, object]:
    return {
        "statuses": STATUS_CANON,
        "active": [s for s in STATUS_CANON if active_rank(s) is not None],
        "terminal": [s for s in STATUS_CANON if is_terminal(s)],
        "forwardMoves": _enforced_adjacency(),
    }


def test_funnel_contract_matches_snapshot() -> None:
    contract = _build_contract()
    serialized = json.dumps(contract, indent=2) + "\n"
    current = CONTRACT_PATH.read_text() if CONTRACT_PATH.exists() else None
    if current != serialized:
        # Leave the generated diff ready for review, but fail on drift.
        CONTRACT_PATH.write_text(serialized)
    assert current == serialized, (
        "funnel.contract.json was stale and has been regenerated from the server "
        "rules — review and commit it, and confirm the TS funnel mirror still matches."
    )
