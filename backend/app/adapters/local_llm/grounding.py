"""Deterministic two-level grounding.

Level 1 — Reference validity: every cited id must exist on the case.
Level 2 — Semantic support: the model must supply ``evidence_span`` and that
          span must appear VERBATIM (case/whitespace-normalized) in the cited
          evidence content.

A fact that fails either level becomes ``UNVERIFIED_CLAIM`` and raises a
safety flag; it is never presented as a proven fact. Grounding never mutates
the draft and never authorizes anything.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ...domain.enums import GroundedFactType, ProvenanceLabel
from ...domain.models import CaseRecord, EvidenceRecord, GroundedFact
from .schema import ModelAnalysisDraft, SupportedFactStatus

_WS = re.compile(r"\s+")

# Tokens that only make sense if a model believes it can issue verdicts.
# Finding them does not block anything — it only adds an auditable flag.
INJECTION_TOKENS: tuple[str, ...] = (
    "safety_flags",
    "execution_authorized",
    "execution_permission",
    "validator approved",
    "policy_validation",
    "approval_status",
    "cleared",
)

FLAG_UNKNOWN_EVIDENCE = (
    "UNKNOWN_EVIDENCE_ID_PRESENT — model cited evidence ids that do not exist on this case"
)
FLAG_UNVERIFIED = (
    "UNVERIFIED_CLAIM_PRESENT — at least one model fact lacks verbatim evidence support; "
    "human review required"
)
FLAG_NO_CITATION = "FACT_WITHOUT_EVIDENCE — a model fact cited no evidence id"
FLAG_NO_SPAN = "EVIDENCE_SPAN_MISSING — a model fact cited evidence but gave no verbatim span"
FLAG_SPAN_MISMATCH = "EVIDENCE_SPAN_NOT_FOUND — quoted span is not present in the cited evidence"
FLAG_INJECTED = "MODEL_OUTPUT_CONTAINS_INJECTED_TOKEN — draft text mentions a verdict field/token"


def normalize_text(value: str) -> str:
    """Case- and whitespace-normalized text (nothing else is altered)."""
    return _WS.sub(" ", (value or "").replace("\u00a0", " ")).strip().casefold()


@dataclass
class GroundingOutcome:
    facts: list[GroundedFact] = field(default_factory=list)
    statuses: list[SupportedFactStatus] = field(default_factory=list)
    reference_validity: list[dict] = field(default_factory=list)
    safety_flags: list[str] = field(default_factory=list)
    dropped_fact_count: int = 0
    downgraded_fact_count: int = 0


class GroundingChecker:
    """Maps ``candidate_facts`` to ``GroundedFact`` with deterministic checks."""

    def __init__(self, case: CaseRecord):
        self.case = case
        self._evidence: dict[str, EvidenceRecord] = {
            e.evidence_id: e for e in case.evidence
        }

    # ------------------------------------------------------------------ public
    def evidence_ids(self) -> set[str]:
        return set(self._evidence)

    def unknown_ids(self, ids: list[str]) -> list[str]:
        return [i for i in ids if i not in self._evidence]

    def check(self, draft: ModelAnalysisDraft) -> GroundingOutcome:
        outcome = GroundingOutcome()
        flags: list[str] = []

        cited_known: dict[str, bool] = {}
        for evidence_id in draft.cited_evidence_ids:
            exists = evidence_id in self._evidence
            cited_known[evidence_id] = exists
            outcome.reference_validity.append(
                {"evidence_id": evidence_id, "exists": exists}
            )
        if any(not exists for exists in cited_known.values()):
            flags.append(FLAG_UNKNOWN_EVIDENCE)

        for index, candidate in enumerate(draft.candidate_facts, start=1):
            statement = (candidate.statement or "").strip()
            if not statement:
                outcome.dropped_fact_count += 1
                continue

            known = [i for i in candidate.evidence_ids if i in self._evidence]
            unknown = [i for i in candidate.evidence_ids if i not in self._evidence]
            span = (candidate.evidence_span or "").strip()
            matched: EvidenceRecord | None = None
            reasons: list[str] = []

            if unknown:
                flags.append(FLAG_UNKNOWN_EVIDENCE)
                reasons.append("UNKNOWN_EVIDENCE_ID")
            if not candidate.evidence_ids:
                flags.append(FLAG_NO_CITATION)
                reasons.append("NO_CITATION")
            elif not span:
                flags.append(FLAG_NO_SPAN)
                reasons.append("NO_SPAN")
            else:
                normalized_span = normalize_text(span)
                for evidence_id in known:
                    if normalized_span and normalized_span in normalize_text(
                        self._evidence[evidence_id].content
                    ):
                        matched = self._evidence[evidence_id]
                        break
                if matched is None:
                    flags.append(FLAG_SPAN_MISMATCH)
                    reasons.append("SPAN_NOT_IN_CITED_EVIDENCE")

            if matched is not None and candidate.evidence_ids:
                status = "SUPPORTED"
                fact_type = GroundedFactType(candidate.fact_type)
                provenance = (
                    matched.provenance
                    if fact_type is GroundedFactType.OBSERVED_FACT
                    else ProvenanceLabel.AI_INFERRED
                )
            elif not candidate.evidence_ids:
                status = "UNCITED"
                fact_type = GroundedFactType.UNVERIFIED_CLAIM
                provenance = ProvenanceLabel.AI_INFERRED
            else:
                status = "UNSUPPORTED"
                fact_type = GroundedFactType.UNVERIFIED_CLAIM
                provenance = ProvenanceLabel.AI_INFERRED

            if status != "SUPPORTED":
                outcome.downgraded_fact_count += 1
                if FLAG_UNVERIFIED not in flags:
                    flags.append(FLAG_UNVERIFIED)

            fact_id = (candidate.fact_id or "").strip() or f"F{index}"
            outcome.facts.append(
                GroundedFact(
                    fact_id=fact_id,
                    statement=statement,
                    fact_type=fact_type,
                    evidence_ids=known,
                    provenance=provenance,
                )
            )
            outcome.statuses.append(
                SupportedFactStatus(fact_id=fact_id, status=status, reasons=reasons)
            )

        if self._contains_injection_token(draft):
            flags.append(FLAG_INJECTED)

        outcome.safety_flags = _dedupe(flags)
        return outcome

    # ----------------------------------------------------------------- helpers
    @staticmethod
    def _contains_injection_token(draft: ModelAnalysisDraft) -> bool:
        parts = [draft.factual_summary, draft.uncertainty, *draft.rationale]
        for fact in draft.candidate_facts:
            parts.extend([fact.statement, fact.uncertainty])
        haystack = normalize_text(" ".join(p for p in parts if p))
        return any(token in haystack for token in INJECTION_TOKENS)


def _dedupe(values: list[str]) -> list[str]:
    seen: list[str] = []
    for value in values:
        if value not in seen:
            seen.append(value)
    return seen
