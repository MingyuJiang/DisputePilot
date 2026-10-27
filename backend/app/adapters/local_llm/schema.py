"""Two schemas from ``research/local_llm/10_TRUST_BOUNDARY_AND_SCHEMA.md``.

``ModelAnalysisDraft`` — everything a local model is allowed to produce.
It has NO field for safety verdicts, approvals, execution permission or policy
results, so an injected model cannot forge them: there is nowhere to write.
Unknown extra keys emitted by a model are ignored (never mapped), which keeps
an injection attempt from turning into a denial of analysis.

``TrustedValidationResult`` — produced only by deterministic code. The model
never sees this schema.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ...domain.enums import ACTION_WHITELIST, ActionType

FactTypeLiteral = Literal[
    "OBSERVED_FACT", "SUPPORTED_INFERENCE", "UNVERIFIED_CLAIM", "MISSING_EVIDENCE"
]
ConfidenceLiteral = Literal["HIGH", "MEDIUM", "LOW"]
_ACTION_VALUES = tuple(a.value for a in ACTION_WHITELIST)


class CandidateFact(BaseModel):
    """One candidate fact — a claim, never a verified observation."""

    model_config = ConfigDict(extra="ignore")

    fact_id: str = ""
    statement: str
    fact_type: FactTypeLiteral = "OBSERVED_FACT"
    evidence_ids: list[str] = Field(default_factory=list)
    evidence_span: str = ""
    confidence: ConfidenceLiteral = "MEDIUM"
    uncertainty: str = ""

    @field_validator("evidence_ids")
    @classmethod
    def _dedupe_ids(cls, value: list[str]) -> list[str]:
        seen: list[str] = []
        for item in value or []:
            if isinstance(item, str) and item.strip() and item not in seen:
                seen.append(item.strip())
        return seen


class ModelAnalysisDraft(BaseModel):
    """The ONLY output shape accepted from the model."""

    model_config = ConfigDict(extra="ignore")

    factual_summary: str
    candidate_facts: list[CandidateFact] = Field(default_factory=list)
    cited_evidence_ids: list[str] = Field(default_factory=list)
    missing_evidence_candidates: list[str] = Field(default_factory=list)
    suggested_action: str
    rationale: list[str] = Field(default_factory=list)
    uncertainty: str = ""

    @field_validator("suggested_action")
    @classmethod
    def _action_whitelist(cls, value: str) -> str:
        action = (value or "").strip()
        if action not in _ACTION_VALUES:
            raise ValueError(
                f"suggested_action {action!r} is not one of {sorted(_ACTION_VALUES)}"
            )
        return action

    @field_validator("cited_evidence_ids")
    @classmethod
    def _dedupe_cited(cls, value: list[str]) -> list[str]:
        seen: list[str] = []
        for item in value or []:
            if isinstance(item, str) and item.strip() and item not in seen:
                seen.append(item.strip())
        return seen

    @property
    def suggested_action_enum(self) -> ActionType:
        return ActionType(self.suggested_action)


class EvidenceReferenceValidity(BaseModel):
    evidence_id: str
    exists: bool


class SupportedFactStatus(BaseModel):
    fact_id: str
    status: Literal["SUPPORTED", "UNSUPPORTED", "UNCITED"]
    reasons: list[str] = Field(default_factory=list)


class TrustedValidationResult(BaseModel):
    """Deterministic verdict over a draft. Model input never reaches this."""

    draft_valid: bool = True
    evidence_reference_validity: list[EvidenceReferenceValidity] = Field(
        default_factory=list
    )
    supported_fact_status: list[SupportedFactStatus] = Field(default_factory=list)
    safety_flags: list[str] = Field(default_factory=list)
    execution_permission: dict = Field(
        default_factory=lambda: {
            "allowed": False,
            "reason": "REPLAY-only environment; AI analysis cannot authorize execution",
        }
    )
