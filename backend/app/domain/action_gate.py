"""Deterministic action gate — HATEOAS is the only runtime permission.

A model (or a replayed historical analysis) may *suggest* an action, but the
observed state decides whether it can be proposed. The gate is deliberately
small and total:

- ``wait`` always passes (restraint needs no write link);
- a whitelisted action passes only when its POST rel is present;
- everything else degrades to ``wait``.

The raw suggestion is never discarded — callers keep it next to the effective
action so the downgrade stays auditable.
"""

from __future__ import annotations

from dataclasses import dataclass

from .enums import ACTION_REL, ACTION_WHITELIST, ActionType
from .models import CaseStateSnapshot


@dataclass(frozen=True)
class ActionGateResult:
    """Raw model suggestion + the action that may actually be proposed."""

    raw_action: str
    effective_action: str
    reason: str | None = None

    @property
    def downgraded(self) -> bool:
        return self.effective_action != self.raw_action


def gate_action(state: CaseStateSnapshot, requested: str) -> ActionGateResult:
    """Apply the whitelist + HATEOAS gate to one requested action."""
    raw = str(requested or "").strip()
    if raw == ActionType.WAIT.value:
        return ActionGateResult(raw, ActionType.WAIT.value, None)

    try:
        action = ActionType(raw)
    except ValueError:
        return ActionGateResult(
            raw,
            ActionType.WAIT.value,
            f"action {raw!r} is not in the action whitelist",
        )
    if action not in ACTION_WHITELIST:
        return ActionGateResult(
            raw,
            ActionType.WAIT.value,
            f"action {raw!r} is not whitelisted for dispute planning",
        )

    rel = ACTION_REL[action]
    if state.has_post_link(rel):
        return ActionGateResult(raw, raw, None)
    return ActionGateResult(
        raw,
        ActionType.WAIT.value,
        f"no POST rel '{rel}' in observed state",
    )


def link_backed_actions(
    state: CaseStateSnapshot, *, exclude: str | None = None
) -> list[str]:
    """Whitelisted actions the state actually offers, plus ``wait``.

    ``wait`` is always listed because restraint never needs a write link.
    The effective action is excluded so ``alternatives`` stays a real
    alternative list.
    """
    actions: list[str] = []
    for candidate in ACTION_WHITELIST:
        if candidate is ActionType.WAIT:
            # Restraint is always available; the spec lists it even when WAIT
            # is already the effective action.
            actions.append(candidate.value)
            continue
        if candidate.value == exclude:
            continue
        if state.has_post_link(ACTION_REL[candidate]):
            actions.append(candidate.value)
    return actions
