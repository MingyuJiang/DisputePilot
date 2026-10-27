"""Raw PayPal dispute → internal CaseRecord / CaseStateSnapshot.

Honesty rules:
- Every value is copied from the response or marked UNKNOWN. Nothing is
  inferred (family is a display bucket; reason stays authoritative).
- ``provenance`` is always PAYPAL_API_OBSERVED for a live read.
- Unknown enum members become UNKNOWN/OTHER and are listed in ``warnings``.
- ``messages[]`` is copied verbatim; an absent field is UNOBSERVED
  (``messages_observable=False``, ``message_count=None``), never "no messages".
- ``snapshot_hash`` covers the normalized payload only — it excludes the read
  timestamp, so two identical reads produce the same hash (re-computable).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from ...domain.enums import (
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
from ...domain.models import (
    UNKNOWN,
    AvailableAction,
    CaseRecord,
    CaseStateSnapshot,
    EvidenceRecord,
    EvidenceRequirement,
    Money,
    TransactionReference,
    content_hash,
)

UNKNOWN_CURRENCY = "UNK"

_STATUS_MAP: dict[str, DisputeStatus] = {
    "WAITING_FOR_SELLER_RESPONSE": DisputeStatus.WAITING_FOR_SELLER_RESPONSE,
    "WAITING_FOR_BUYER_RESPONSE": DisputeStatus.WAITING_FOR_BUYER_RESPONSE,
    "UNDER_REVIEW": DisputeStatus.UNDER_REVIEW,
    "RESOLVED": DisputeStatus.RESOLVED,
    # OPEN means "open, further detail not supplied" — never guessed further.
    "OPEN": DisputeStatus.OTHER,
}

_LIFECYCLE_MAP: dict[str, LifecycleStage] = {
    "INQUIRY": LifecycleStage.INQUIRY,
    "CHARGEBACK": LifecycleStage.UNDER_PAYPAL_REVIEW,
    "PRE_ARBITRATION": LifecycleStage.UNDER_PAYPAL_REVIEW,
    "ARBITRATION": LifecycleStage.UNDER_PAYPAL_REVIEW,
    "APPEAL": LifecycleStage.APPEAL,
    "RESOLVED": LifecycleStage.RESOLVED,
}

_FAMILY_BY_REASON: dict[DisputeReason, DisputeFamily] = {
    DisputeReason.MERCHANDISE_OR_SERVICE_NOT_RECEIVED: DisputeFamily.INR,
    DisputeReason.MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: DisputeFamily.SNAD,
    DisputeReason.UNAUTHORISED: DisputeFamily.BILLING,
    DisputeReason.CREDIT_NOT_PROCESSED: DisputeFamily.BILLING,
    DisputeReason.DUPLICATE_TRANSACTION: DisputeFamily.BILLING,
    DisputeReason.INCORRECT_AMOUNT: DisputeFamily.BILLING,
    DisputeReason.PAYMENT_BY_OTHER_MEANS: DisputeFamily.BILLING,
    DisputeReason.CANCELED_RECURRING_BILLING: DisputeFamily.BILLING,
    # Generic bucket only — the reason itself remains OTHER.
    DisputeReason.OTHER: DisputeFamily.BILLING,
}

# Only types that exist verbatim in the frozen enum are mapped; everything
# else becomes OTHER (never invented).
_EVIDENCE_TYPE_MAP: dict[str, EvidenceType] = {
    "PROOF_OF_FULFILLMENT": EvidenceType.PROOF_OF_FULFILLMENT,
    "PROOF_OF_REFUND": EvidenceType.PROOF_OF_REFUND,
}

_SOURCE_MAP: dict[str, EvidenceSource] = {
    "REQUESTED_FROM_SELLER": EvidenceSource.REQUESTED_FROM_SELLER,
    "SUBMITTED_BY_SELLER": EvidenceSource.SUBMITTED_BY_SELLER,
    "SUBMITTED_BY_BUYER": EvidenceSource.SUBMITTED_BY_BUYER,
}


@dataclass
class NormalizedDispute:
    case: CaseRecord
    state: CaseStateSnapshot
    warnings: list[str] = field(default_factory=list)
    remote_status: str = ""
    remote_lifecycle: str = ""
    evidence_count: int = 0
    links: list[dict[str, str]] = field(default_factory=list)
    # Raw ``evidences[]`` entries, verbatim. ``EvidenceRecord`` only carries a
    # lossy summary (the frozen enum cannot hold labels like CREATE and drops
    # notes entirely), so post-write verification matches against these.
    evidences: list[dict[str, Any]] = field(default_factory=list)
    # Raw ``messages[]`` entries, verbatim (id/from/body/created). ``send-message``
    # verification compares the submitted text against these byte for byte.
    # ``message_count`` is None when the field is absent: a missing history is
    # UNOBSERVED, never "zero messages" and never an empty success.
    messages: list[dict[str, Any]] = field(default_factory=list)
    messages_observable: bool = False
    message_count: int | None = None


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def case_id_for(dispute_id: str) -> str:
    """Stable internal id — the dispute id itself when it fits the column."""
    if len(dispute_id) <= 64:
        return dispute_id
    digest = hashlib.sha256(dispute_id.encode("utf-8")).hexdigest()[:8]
    return f"{dispute_id[:48]}-{digest}"


def _money(raw: dict[str, Any], warnings: list[str], prefix: str) -> Money:
    block = raw.get("dispute_amount")
    if not isinstance(block, dict):
        warnings.append(f"{prefix}: dispute_amount missing → amount UNKNOWN")
        return Money(value_minor=0, currency=UNKNOWN_CURRENCY)
    currency = str(block.get("currency_code") or "").upper()
    if len(currency) != 3:
        warnings.append(f"{prefix}: dispute_amount.currency_code missing → UNK")
        currency = UNKNOWN_CURRENCY
    value = block.get("value")
    if value is None:
        warnings.append(f"{prefix}: dispute_amount.value missing → 0 minor units")
        return Money(value_minor=0, currency=currency)
    try:
        return Money.from_decimal_string(str(value), currency)
    except (TypeError, ValueError):
        warnings.append(f"{prefix}: dispute_amount.value unparseable → 0")
        return Money(value_minor=0, currency=currency)


def _reason(raw_value: Any, warnings: list[str], prefix: str) -> DisputeReason:
    text = str(raw_value or "").strip().upper()
    try:
        return DisputeReason(text)
    except ValueError:
        warnings.append(f"{prefix}: unknown reason {text or '<empty>'} → OTHER")
        return DisputeReason.OTHER


def _status(raw_value: Any, warnings: list[str], prefix: str) -> DisputeStatus:
    text = str(raw_value or "").strip().upper()
    if text in _STATUS_MAP:
        return _STATUS_MAP[text]
    warnings.append(f"{prefix}: unknown dispute status {text or '<empty>'} → UNKNOWN")
    return DisputeStatus.UNKNOWN


def _lifecycle(raw_value: Any, warnings: list[str], prefix: str) -> LifecycleStage:
    text = str(raw_value or "").strip().upper()
    if text in _LIFECYCLE_MAP:
        return _LIFECYCLE_MAP[text]
    if text:
        warnings.append(
            f"{prefix}: unknown dispute_life_cycle_stage {text} → UNKNOWN"
        )
    return LifecycleStage.UNKNOWN


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _seller_contacted(raw: dict[str, Any]) -> bool:
    """Only an explicit boolean from the response is accepted.

    PayPal's dispute detail does not normally expose whether the buyer
    contacted the seller (that lives on the buyer-filing form). Absence is
    therefore "not observable" and stays at the model's safe default (False);
    nothing is inferred from evidence or free-text notes.
    """
    value = raw.get("seller_contacted")
    return value if isinstance(value, bool) else False


def _explicit_order_id(raw: dict[str, Any], transaction: dict[str, Any]) -> str:
    """Order id only from an explicit order field — never inferred from
    another transaction identifier."""
    supplementary = raw.get("supplementary_data")
    related_ids = (
        supplementary.get("related_ids") if isinstance(supplementary, dict) else None
    )
    candidates = [
        transaction.get("order_id"),
        raw.get("order_id"),
        related_ids.get("order_id") if isinstance(related_ids, dict) else None,
    ]
    for value in candidates:
        text = _text(value)
        if text:
            return text
    return UNKNOWN


def _transaction_reference(raw: dict[str, Any], dispute_id: str) -> TransactionReference:
    """Map ``disputed_transactions[0]`` onto the frozen reference object.

    PayPal's seller transaction id is the capture-side identifier; an explicit
    ``capture_id`` wins when present. Missing fields stay UNKNOWN.
    """
    transactions = raw.get("disputed_transactions")
    transaction: dict[str, Any] = {}
    if isinstance(transactions, list) and transactions:
        first = transactions[0]
        if isinstance(first, dict):
            transaction = first

    capture_id = (
        _text(transaction.get("capture_id"))
        or _text(transaction.get("seller_transaction_id"))
        or UNKNOWN
    )
    return TransactionReference(
        order_id=_explicit_order_id(raw, transaction),
        capture_id=capture_id,
        buyer_transaction_id=_text(transaction.get("buyer_transaction_id")) or UNKNOWN,
        dispute_id=dispute_id or UNKNOWN,
    )


def _evidence_entries(
    raw: dict[str, Any], case_id: str, read_at: str, warnings: list[str], prefix: str
) -> tuple[list[EvidenceRecord], list[EvidenceRequirement], list[str], int]:
    evidences = raw.get("evidences")
    if evidences is None:
        evidences = []
    if not isinstance(evidences, list):
        warnings.append(f"{prefix}: evidences is not a list → treated as empty")
        evidences = []

    records: list[EvidenceRecord] = []
    requirements: dict[EvidenceType, EvidenceRequirement] = {}
    missing: list[str] = []
    seen_missing: set[str] = set()

    for index, entry in enumerate(evidences, start=1):
        if not isinstance(entry, dict):
            warnings.append(f"{prefix}: evidences[{index}] is not an object → skipped")
            continue

        raw_type = str(entry.get("evidence_type") or "").strip().upper()
        mapped_type = _EVIDENCE_TYPE_MAP.get(raw_type, EvidenceType.OTHER)
        if raw_type and raw_type not in _EVIDENCE_TYPE_MAP:
            warnings.append(
                f"{prefix}: unknown evidence_type {raw_type} → OTHER (label preserved)"
            )
        if not raw_type:
            warnings.append(f"{prefix}: evidences[{index}] has no evidence_type → OTHER")

        raw_source = str(entry.get("source") or "").strip().upper()
        source = _SOURCE_MAP.get(raw_source, EvidenceSource.UNKNOWN)
        if raw_source and raw_source not in _SOURCE_MAP:
            warnings.append(
                f"{prefix}: unknown evidence source {raw_source} → UNKNOWN"
            )

        documents = entry.get("evidence_documents")
        if not isinstance(documents, list):
            documents = []
        doc_types = sorted(
            {
                str(doc.get("type"))
                for doc in documents
                if isinstance(doc, dict) and doc.get("type")
            }
        )
        evidence_id = str(entry.get("evidence_id") or f"{case_id}-EV-{index:03d}")
        first_doc_id = next(
            (
                str(doc.get("document_id"))
                for doc in documents
                if isinstance(doc, dict) and doc.get("document_id")
            ),
            "",
        )
        content = (
            f"PayPal evidence {evidence_id}: evidence_type={raw_type or 'UNKNOWN'}; "
            f"documents={len(documents)}; document_types={','.join(doc_types) or 'NONE'}"
        )
        # The frozen enum cannot carry every PayPal label (e.g. CREATE). Keep
        # the observed label verbatim alongside the document reference so the
        # original classification survives the enum mapping.
        reference_parts = [first_doc_id or evidence_id or UNKNOWN]
        if raw_type:
            reference_parts.append(f"paypal_evidence_type={raw_type}")
        records.append(
            EvidenceRecord(
                evidence_id=f"EV-{case_id}-PP-{index:03d}",
                case_id=case_id,
                evidence_type=mapped_type,
                content=content,
                source_type="PAYPAL_DISPUTE_EVIDENCE",
                provenance=ProvenanceLabel.PAYPAL_API_OBSERVED,
                verification_level=ValidationLevel.UNKNOWN,
                source_reference=";".join(reference_parts),
                observed_at=read_at,
                integrity_hash=content_hash(entry),
            )
        )

        if source == EvidenceSource.REQUESTED_FROM_SELLER:
            requirements[mapped_type] = EvidenceRequirement(
                evidence_type=mapped_type,
                source=source,
                open=not documents,
            )
            if not documents and raw_type and raw_type not in seen_missing:
                missing.append(raw_type)
                seen_missing.add(raw_type)

    return records, list(requirements.values()), missing, len(records)


def _messages(
    raw: dict[str, Any], warnings: list[str], prefix: str
) -> tuple[list[dict[str, Any]], bool, int | None]:
    """Raw ``messages[]`` plus an explicit observability flag.

    An absent (or non-list) ``messages`` field means the message history could
    not be observed. It is reported as ``observable=False`` / ``count=None`` so
    no caller can read "0" as "the dispute has no messages".
    """
    raw_messages = raw.get("messages")
    if raw_messages is None:
        warnings.append(
            f"{prefix}: messages missing → message history UNOBSERVED (not empty)"
        )
        return [], False, None
    if not isinstance(raw_messages, list):
        warnings.append(
            f"{prefix}: messages is not a list → message history UNOBSERVED"
        )
        return [], False, None
    entries = [dict(entry) for entry in raw_messages if isinstance(entry, dict)]
    if len(entries) != len(raw_messages):
        warnings.append(f"{prefix}: messages contains non-object entries → skipped")
    return entries, True, len(entries)


def _available_actions(
    raw: dict[str, Any], warnings: list[str], prefix: str
) -> list[AvailableAction]:
    links = raw.get("links")
    if links is None:
        links = []
    if not isinstance(links, list):
        warnings.append(f"{prefix}: links is not a list → treated as empty")
        return []

    actions: list[AvailableAction] = []
    seen: set[tuple[str, str]] = set()
    for index, link in enumerate(links, start=1):
        if not isinstance(link, dict):
            warnings.append(f"{prefix}: links[{index}] is not an object → skipped")
            continue
        rel = str(link.get("rel") or "").strip()
        if not rel:
            warnings.append(f"{prefix}: links[{index}] has no rel → skipped")
            continue
        # PayPal uses hyphens (provide-evidence); the frozen state vocabulary
        # uses underscores (provide_evidence). Normalize the identifier only.
        rel_norm = rel.replace("-", "_")
        method = str(link.get("method") or "GET").strip().upper()
        key = (rel_norm, method)
        if key in seen:
            continue
        seen.add(key)
        actions.append(
            AvailableAction(
                rel=rel_norm, method=method, basis=CapabilityBasis.LIVE_HATEOAS
            )
        )
    return actions


def normalize_dispute(
    raw: dict[str, Any], *, read_at: str | None = None
) -> NormalizedDispute:
    """Map one raw PayPal dispute object. Raises ``ValueError`` without an id."""
    if not isinstance(raw, dict):
        raise ValueError("dispute payload is not an object")
    dispute_id = str(raw.get("dispute_id") or "").strip()
    if not dispute_id:
        raise ValueError("dispute payload has no dispute_id")

    read_at = read_at or utc_now_iso()
    case_id = case_id_for(dispute_id)
    warnings: list[str] = []

    reason = _reason(raw.get("reason"), warnings, case_id)
    family = _FAMILY_BY_REASON.get(reason, DisputeFamily.BILLING)
    status_raw = str(raw.get("status") or raw.get("dispute_state") or "").strip().upper()
    lifecycle_raw = str(raw.get("dispute_life_cycle_stage") or "").strip().upper()
    dispute_status = _status(status_raw, warnings, case_id)
    lifecycle = _lifecycle(lifecycle_raw, warnings, case_id)
    amount = _money(raw, warnings, case_id)
    seller_contacted = _seller_contacted(raw)

    evidence, requirements, missing, evidence_count = _evidence_entries(
        raw, case_id, read_at, warnings, case_id
    )
    raw_evidences = raw.get("evidences")
    observed_evidences = (
        [dict(entry) for entry in raw_evidences if isinstance(entry, dict)]
        if isinstance(raw_evidences, list)
        else []
    )
    actions = _available_actions(raw, warnings, case_id)
    messages, messages_observable, message_count = _messages(
        raw, warnings, case_id
    )

    live_note = (
        f"PayPal Sandbox read at {read_at}; remote status={status_raw or 'UNKNOWN'}; "
        f"lifecycle={lifecycle_raw or 'UNKNOWN'}"
    )

    case = CaseRecord(
        case_id=case_id,
        scenario_id=UNKNOWN,
        dispute_id=dispute_id,
        family=family,
        reason=reason,
        amount=amount,
        dispute_status=dispute_status,
        lifecycle_stage=lifecycle,
        transaction_reference=_transaction_reference(raw, dispute_id),
        fulfillment_posture=FulfillmentPosture.NONE,
        seller_contacted=seller_contacted,
        evidence=evidence,
        missing_evidence=missing,
        available_actions=actions,
        evidence_requirements=requirements,
        provenance=ProvenanceLabel.PAYPAL_API_OBSERVED,
        verification_level=ValidationLevel.UNKNOWN,
        live_status_note=live_note,
    )
    # Stable hash: normalized payload minus read-time / workflow fields. The
    # per-evidence observed_at is stripped too, otherwise two identical reads
    # at different times would hash differently.
    hash_payload = case.model_dump(
        mode="json",
        exclude={
            "status",
            "created_at",
            "updated_at",
            "case_version",
            "snapshot_hash",
            "live_status_note",
        },
    )
    for item in hash_payload.get("evidence", []):
        item["observed_at"] = None
    case.snapshot_hash = content_hash(hash_payload)

    state = CaseStateSnapshot(
        case_id=case_id,
        dispute_status=dispute_status,
        lifecycle_stage=lifecycle,
        links=actions,
        evidence_requirements=requirements,
        dispute_amount=None if amount.currency == UNKNOWN_CURRENCY else amount,
        seller_contacted=seller_contacted,
        observed_at=read_at,
        basis=CapabilityBasis.LIVE_HATEOAS,
        provenance=ProvenanceLabel.PAYPAL_API_OBSERVED,
        note=live_note,
        state_version=1,
    )

    return NormalizedDispute(
        case=case,
        state=state,
        warnings=warnings,
        remote_status=status_raw,
        remote_lifecycle=lifecycle_raw,
        evidence_count=evidence_count,
        evidences=observed_evidences,
        messages=messages,
        messages_observable=messages_observable,
        message_count=message_count,
        links=[
            {"rel": link.get("rel", ""), "method": str(link.get("method", "")).upper()}
            for link in (raw.get("links") or [])
            if isinstance(link, dict)
        ],
    )


def canonical_snapshot_hash(cases: list[CaseRecord]) -> str:
    """Aggregate source hash for the import report (order-independent)."""
    joined = "|".join(sorted(case.snapshot_hash for case in cases))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()
