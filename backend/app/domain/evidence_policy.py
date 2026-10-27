"""Unified evidence policy (RC-1 / review P1-01).

Why this module exists
----------------------
The batch assistant refused to prepare an evidence submission when the analysis
had *declared the material missing*, but the single-case path did not: a
proposal could be drafted, submitted, approved and replayed for the same case.
The rule existed in one service and nowhere else.

This module is that rule, once. Every path that can create, submit, approve or
execute an evidence action consults it:

    batch triage        → decide()            (autopilot_service)
    single-case submit  → ValidationService.validate()
    approval decision   → ApprovalService.decide() (re-validates)
    execution           → ExecutionService._revalidate()

Two different questions are kept apart on purpose:

    1. **Type match** — does an open requirement of this evidence type exist?
       That is V5's job and it stays exactly as it was.
    2. **Material exists** — did the analysis declare this material missing?
       That is this module's job. A requirement being open does not mean the
       merchant actually has the proof.

Only ``PROVIDE_EVIDENCE`` is affected. A clarification message (O7) depends on
no evidence material and is never blocked by this rule.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

from .enums import ActionType, GroundedFactType

#: Stable machine-readable code returned to clients and written to the audit
#: payload. Never reword it — the UI and tests key off it.
EVIDENCE_MATERIAL_MISSING = "EVIDENCE_MATERIAL_MISSING"

EVIDENCE_ACTION = ActionType.PROVIDE_EVIDENCE.value


@dataclass(frozen=True)
class EvidenceVerdict:
    """Outcome of the material check for one proposal."""

    blocked: bool
    code: str | None = None
    #: The analysis statements that declare the material missing (verbatim).
    missing: tuple[str, ...] = field(default_factory=tuple)
    #: Evidence type the action claims to submit, when the payload names one.
    requested_type: str | None = None
    #: One sentence a merchant can act on. Empty when not blocked.
    merchant_message: str = ""
    #: What the merchant has to supply before the action can be prepared.
    required_material: tuple[str, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict[str, Any]:
        return {
            "blocked": self.blocked,
            "code": self.code,
            "missing": list(self.missing),
            "requested_type": self.requested_type,
            "merchant_message": self.merchant_message,
            "required_material": list(self.required_material),
        }


def _fact_type(fact: Any) -> str:
    value = fact.get("fact_type") if isinstance(fact, Mapping) else getattr(fact, "fact_type", None)
    return getattr(value, "value", value) or ""


def _statement(fact: Any) -> str:
    return (fact.get("statement") if isinstance(fact, Mapping) else getattr(fact, "statement", "")) or ""


def missing_material_statements(facts: Iterable[Any] | None) -> tuple[str, ...]:
    """Every MISSING_EVIDENCE statement, deduplicated, order preserved."""
    seen: list[str] = []
    for fact in facts or ():
        if _fact_type(fact) != GroundedFactType.MISSING_EVIDENCE.value:
            continue
        text = _statement(fact).strip()
        if text and text not in seen:
            seen.append(text)
    return tuple(seen)


def _required_material_from_state(state: Any, requested_type: str | None) -> tuple[str, ...]:
    """Open requirements for the requested type, as merchant-facing labels."""
    if state is None:
        return ()
    requirements = getattr(state, "evidence_requirements", None) or []
    labels: list[str] = []
    for requirement in requirements:
        if not getattr(requirement, "open", False):
            continue
        etype = getattr(requirement, "evidence_type", None)
        value = getattr(etype, "value", etype)
        if requested_type and value != requested_type:
            continue
        text = str(value or "").replace("_", " ").strip().lower()
        if text and text not in labels:
            labels.append(text)
    return tuple(labels)


def evaluate_evidence(
    *,
    action_type: str | None,
    action_payload: Mapping[str, Any] | None,
    grounded_facts: Sequence[Any] | None,
    state: Any = None,
) -> EvidenceVerdict:
    """Decide whether an evidence action has the material it claims to submit.

    ``grounded_facts`` may be ``GroundedFact`` objects or their JSON dicts; both
    shapes are produced by the codebase.
    """
    if action_type != EVIDENCE_ACTION:
        return EvidenceVerdict(blocked=False)

    payload = action_payload or {}
    requested_type = payload.get("evidence_type")
    requested_type = getattr(requested_type, "value", requested_type)
    missing = missing_material_statements(grounded_facts)
    if not missing:
        return EvidenceVerdict(blocked=False, requested_type=requested_type)

    required = _required_material_from_state(state, requested_type)
    label = requested_type or "the required evidence"
    message = (
        f"This case cannot submit {label}: the analysis recorded that the "
        "material does not exist yet. Add the missing proof first."
    )
    return EvidenceVerdict(
        blocked=True,
        code=EVIDENCE_MATERIAL_MISSING,
        missing=missing,
        requested_type=requested_type,
        merchant_message=message,
        required_material=required,
    )
