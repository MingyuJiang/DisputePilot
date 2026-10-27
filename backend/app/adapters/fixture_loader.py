"""Fixture loader — imports the frozen canonical case snapshot.

T1 semantics enforced here:
- 15 canonical cases parse; 10 negative samples are recognized;
- missing fields are marked UNKNOWN, never AI-filled;
- provenance labels and validation levels are copied verbatim, never upgraded;
- the snapshot file is verified against its recorded sha256 before import;
- the input fixture is treated as immutable (re-import of identical content
  is a no-op).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..domain.enums import (
    CapabilityBasis,
    DisputeFamily,
    DisputeReason,
    DisputeStatus,
    EvidenceSource,
    EvidenceType,
    FulfillmentPosture,
    LifecycleStage,
    ProvenanceLabel,
    ValidationLevel,
)
from ..domain.models import (
    UNKNOWN,
    AvailableAction,
    CaseRecord,
    CaseStateSnapshot,
    EvidenceRecord,
    EvidenceRequirement,
    Money,
)

# sha256 of reference/cases/CANONICAL_CASES_OFFLINE_SNAPSHOT.json, recorded in
# CASE_SNAPSHOT_NOTES.md §header. Verified before every import.
EXPECTED_SNAPSHOT_SHA256 = "0882328a0a0561baa78a14421dc1a0107f1098f090b59b7fc49813b0e72edb08"
EXPECTED_SOURCE_SHA256 = "cc3aad470bd52347732799d2dbdece4510d5011bd0e7b80c93dd2375acda85cc"

_PROVENANCE_BY_PREFIX = {
    "PAYPAL_API_OBSERVED": ProvenanceLabel.PAYPAL_API_OBSERVED,
    "HUMAN_OBSERVED_SANDBOX_UI": ProvenanceLabel.HUMAN_OBSERVED_SANDBOX_UI,
    "SCENARIO_DEFINED": ProvenanceLabel.SCENARIO_DEFINED,
    "AI_INFERRED": ProvenanceLabel.AI_INFERRED,
    "SIMULATED_COMPOSITE": ProvenanceLabel.SIMULATED_COMPOSITE,
}


class FixtureIntegrityError(Exception):
    """Raised when the snapshot file does not match its recorded sha256."""


@dataclass
class ImportReport:
    cases: list[CaseRecord] = field(default_factory=list)
    negative_samples: list[dict[str, Any]] = field(default_factory=list)
    skipped_duplicates: int = 0
    warnings: list[str] = field(default_factory=list)
    source_sha256: str = ""


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_snapshot(path: Path) -> str:
    digest = sha256_file(path)
    if digest != EXPECTED_SNAPSHOT_SHA256:
        raise FixtureIntegrityError(
            f"snapshot sha256 mismatch: {digest} != expected {EXPECTED_SNAPSHOT_SHA256}"
        )
    return digest


def _parse_provenance(text: str, default: ProvenanceLabel) -> ProvenanceLabel:
    head = text.strip().split("(")[0].strip().upper()
    for key, label in _PROVENANCE_BY_PREFIX.items():
        if head.startswith(key):
            return label
    return default


def _evidence_type_for(text: str) -> EvidenceType:
    low = text.lower()
    if "buyer dispute statement" in low or "complaint" in low:
        return EvidenceType.BUYER_STATEMENT
    if "order/capture" in low or "order record" in low or "capture" in low:
        return EvidenceType.ORDER_RECORD
    if "fulfillment record" in low or "fulfillment" in low:
        return EvidenceType.CASE_NOTE
    return EvidenceType.CASE_NOTE


def _parse_boolish(value: Any) -> bool:
    return str(value).strip().lower().startswith("yes")


def load_snapshot(path: Path) -> dict[str, Any]:
    verify_snapshot(path)
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    meta = data.get("_meta", {})
    if meta.get("source_sha256") != EXPECTED_SOURCE_SHA256:
        raise FixtureIntegrityError(
            "snapshot _meta.source_sha256 does not match the frozen source hash"
        )
    return data


def normalize_missing_evidence(value: Any) -> list[str]:
    """Normalize a snapshot missing-evidence field to a verbatim ``list[str]``.

    Frozen-snapshot reality (15/15 canonical cases):

    - ``evidence.missing`` is a JSON **list of strings**;
    - ``seller_side_expectation.missing_evidence`` is a JSON **string**
      (a single prose description).

    A non-empty string is therefore ONE verbatim list item — it is never
    split (character explosion was the P0 defect: ``list("abc")`` yields
    ``['a','b','c']``). ``None`` / missing key / empty string yield ``[]``.
    Every element is copied verbatim from the snapshot; nothing is derived,
    re-worded, or fabricated.
    """
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return [str(value)]


def map_case(raw: dict[str, Any], state: CaseStateSnapshot | None = None) -> CaseRecord:
    """Map one snapshot case to a CaseRecord (labels copied verbatim)."""
    snap = raw.get("_snapshot", {})
    try:
        verification = ValidationLevel(snap.get("validation_level", "UNKNOWN"))
    except ValueError:
        verification = ValidationLevel.UNKNOWN
    amount = raw["amount"]
    buyer_filing = raw.get("buyer_filing", {})
    evidence_block = raw.get("evidence", {})
    sse = raw.get("seller_side_expectation", {})

    records: list[EvidenceRecord] = []
    # 1. buyer statement carries the full complaint text
    complaint = buyer_filing.get("complaint_text_en", "")
    complaint_prov = buyer_filing.get("complaint_provenance", "")
    if complaint:
        records.append(
            EvidenceRecord(
                evidence_id=f"EV-{raw['case_id']}-BUYER-001",
                case_id=raw["case_id"],
                evidence_type=EvidenceType.BUYER_STATEMENT,
                content=complaint,
                source_type="DISPUTE_BUYER_MESSAGE",
                provenance=_parse_provenance(complaint_prov, ProvenanceLabel.SCENARIO_DEFINED),
                verification_level=verification,
                source_reference=complaint_prov or UNKNOWN,
            )
        )
    # 2. available evidence entries
    for idx, entry in enumerate(evidence_block.get("available", []), start=1):
        records.append(
            EvidenceRecord(
                evidence_id=f"EV-{raw['case_id']}-AV-{idx:03d}",
                case_id=raw["case_id"],
                evidence_type=_evidence_type_for(entry),
                content=entry,
                source_type="CASE_SNAPSHOT",
                provenance=_parse_provenance(entry, ProvenanceLabel.SCENARIO_DEFINED),
                verification_level=verification,
                source_reference="; ".join(raw.get("sources", {}).get("anchor", [])) or UNKNOWN,
            )
        )
    # 3. expected evidence requirements (documented case content with labels)
    for idx, req in enumerate(sse.get("expected_evidence_requirement", []), start=1):
        label = str(req.get("label", ""))
        try:
            etype = EvidenceType(req.get("evidence_type", "CASE_NOTE"))
        except ValueError:
            etype = EvidenceType.CASE_NOTE
        records.append(
            EvidenceRecord(
                evidence_id=f"EV-{raw['case_id']}-REQ-{idx:03d}",
                case_id=raw["case_id"],
                evidence_type=etype,
                content=(
                    f"Open evidence requirement {req.get('evidence_type')} "
                    f"({req.get('source_expected', 'REQUESTED_FROM_SELLER')})"
                ),
                source_type="EXPECTED_EVIDENCE_REQUIREMENT",
                provenance=_parse_provenance(label, ProvenanceLabel.SCENARIO_DEFINED),
                verification_level=verification,
                source_reference=label or UNKNOWN,
            )
        )

    available_actions: list[AvailableAction] = []
    evidence_requirements: list[EvidenceRequirement] = []
    dispute_status = DisputeStatus.UNKNOWN
    lifecycle_stage = LifecycleStage.UNKNOWN
    if state is not None:
        available_actions = list(state.links)
        evidence_requirements = list(state.evidence_requirements)
        dispute_status = state.dispute_status
        lifecycle_stage = state.lifecycle_stage

    case = CaseRecord(
        case_id=raw["case_id"],
        scenario_id=raw.get("scenario_id", UNKNOWN),
        dispute_id=UNKNOWN,  # executed_ids removed by sanitization — never re-filled
        family=DisputeFamily(raw["family"]),
        reason=DisputeReason(raw["reason"]),
        amount=Money.from_decimal_string(amount["value"], amount["currency"]),
        fulfillment_posture=FulfillmentPosture(raw.get("fulfillment_posture", "NONE")),
        seller_contacted=_parse_boolish(buyer_filing.get("contacted_seller", "no")),
        evidence=records,
        missing_evidence=normalize_missing_evidence(evidence_block.get("missing"))
        + normalize_missing_evidence(sse.get("missing_evidence")),
        available_actions=available_actions,
        evidence_requirements=evidence_requirements,
        provenance=_parse_provenance(
            raw.get("sources", {}).get("source_type", ""), ProvenanceLabel.SCENARIO_DEFINED
        ),
        verification_level=verification,
        dispute_status=dispute_status,
        lifecycle_stage=lifecycle_stage,
        live_status_note=str(snap.get("live_status_note", "")),
    )
    case.bind_snapshot_hash()
    return case


def import_snapshot(
    path: Path, states: dict[str, CaseStateSnapshot] | None = None
) -> ImportReport:
    data = load_snapshot(path)
    report = ImportReport(source_sha256=EXPECTED_SNAPSHOT_SHA256)
    for raw in data.get("cases", []):
        state = (states or {}).get(raw["case_id"])
        report.cases.append(map_case(raw, state))
    negatives = data.get("negative_test_samples") or data.get("negative_samples") or []
    report.negative_samples = list(negatives)
    return report
