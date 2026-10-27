"""Case state store — the runtime dispute state used by validators and replay.

The store is backed by ``data/fixtures/replay_case_states.json`` (a FIXTURE
capability snapshot) and mirrored into the local SQLite ``case_states`` table.
A SYSTEM-only update hook exists to simulate a PayPal-side state change for
stale-approval tests; every change bumps ``state_version`` and is audited.

Nothing here talks to PayPal. ``basis`` is FIXTURE_SNAPSHOT for every state;
LIVE_HATEOAS is reserved for the future adapter.
"""

from __future__ import annotations

import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from ..domain.enums import CapabilityBasis
from ..domain.models import CaseStateSnapshot


class CaseStateStore:
    def __init__(self, fixtures_path: Path):
        self._fixtures_path = fixtures_path
        self._states: dict[str, CaseStateSnapshot] = {}
        self._meta: dict[str, Any] = {}
        self._load_fixtures()

    def _load_fixtures(self) -> None:
        with open(self._fixtures_path, encoding="utf-8") as fh:
            payload = json.load(fh)
        self._meta = payload.get("_meta", {})
        for case_id, raw in payload.get("states", {}).items():
            raw = dict(raw)
            raw.setdefault("basis", CapabilityBasis.FIXTURE_SNAPSHOT)
            self._states[case_id] = CaseStateSnapshot.model_validate(raw)

    @property
    def meta(self) -> dict[str, Any]:
        return dict(self._meta)

    def get(self, case_id: str) -> CaseStateSnapshot | None:
        state = self._states.get(case_id)
        if state is None:
            return None
        # return a copy so callers cannot mutate the store in place
        return state.model_copy(deep=True)

    def all(self) -> dict[str, CaseStateSnapshot]:
        return {cid: self.get(cid) for cid in self._states}

    def upsert(self, state: CaseStateSnapshot) -> None:
        """Install a freshly observed state (sandbox import). Stores a copy."""
        self._states[state.case_id] = state.model_copy(deep=True)

    def restore(self, states: Iterable[CaseStateSnapshot]) -> int:
        """Rehydrate the in-memory store from persisted rows after a restart.

        The SQLite ``case_states`` table is the durable copy; without this the
        store falls back to the bundled fixtures on every boot and imported
        PayPal cases lose their state (analyses/proposals then 404).
        """
        restored = 0
        for state in states:
            self._states[state.case_id] = state.model_copy(deep=True)
            restored += 1
        return restored

    def apply_update(self, case_id: str, changes: dict[str, Any], note: str = "") -> CaseStateSnapshot:
        """SYSTEM-only hook: simulate a PayPal-side state change (test/demo).

        Bumps state_version so approvals bound to the previous hash become
        stale. Returns the new state. Values are validated through the model
        (enum coercion), never injected raw.
        """
        state = self._states.get(case_id)
        if state is None:
            raise KeyError(case_id)
        merged = state.model_dump(mode="python")
        merged.update(changes)
        new_state = CaseStateSnapshot.model_validate(merged)
        new_state.state_version = state.state_version + 1
        if note:
            new_state.note = (state.note + " | " + note).strip(" |")
        self._states[case_id] = new_state
        return self.get(case_id)
