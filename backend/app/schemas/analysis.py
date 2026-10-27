"""AI Analysis API schemas.

Constrained by the S7 ``Plan`` schema and M1–M5 output-format requirements
(see RESOURCE_INTEGRATION_REPORT §6): malformed structure is an automatic
benchmark failure, so these fields mirror the Plan contract exactly.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from ..domain.enums import AnalysisMode, GroundedFactType, ProvenanceLabel


class GroundedFactOut(BaseModel):
    fact_id: str
    statement: str
    fact_type: GroundedFactType
    evidence_ids: list[str]
    provenance: ProvenanceLabel


class AnalysisOut(BaseModel):
    analysis_id: str
    case_id: str
    case_snapshot_hash: str
    factual_summary: str
    grounded_facts: list[GroundedFactOut]
    missing_evidence: list[str]
    contradictions: list[str]
    recommendation: str
    safety_flags: list[str]
    model_provider: str
    model_name: str
    analysis_mode: AnalysisMode
    created_at: str
    # Plan-schema structural mirror (S7 benchmark gate):
    plan: dict = Field(default_factory=dict)


class AnalysisCreate(BaseModel):
    """POST body is intentionally empty: the case is the only input."""

    note: str = ""
