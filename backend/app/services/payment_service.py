"""Payment (capture) cases — import, capture observation, server-side draft
enrichment for capture refunds.

Why this service exists
-----------------------
A refund lives on PayPal's Payments v2 API, not on the dispute API: the money
facts (original amount, amount already refunded, remaining refundable) belong
to a *capture*. The backend models that as a first-class case:

    case_id  = CAP-<capture_id>
    family   = BILLING      reason = OTHER      status = IMPORTED
    amount   = capture.amount
    transaction_reference.capture_id = <capture_id>
    provenance = PAYPAL_API_OBSERVED

The case is NOT a dispute: it has no dispute id, no reason from the buyer and no
dispute lifecycle. Importing it never creates, resolves or closes a dispute.

Server-authoritative enrichment
-------------------------------
When a refund draft is created the server re-reads the capture and writes the
balance block (``capture_snapshot``) into ``action_payload`` itself, then hashes
it. A client may echo that block but never define it: any disagreement is a 422,
so an approval can only ever be bound to a balance the server observed.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, ContextManager

from ..domain.enums import (
    ActionType,
    ActorType,
    AuditEventType,
    CapabilityBasis,
    CaseWorkflowStatus,
    DisputeFamily,
    DisputeReason,
    DisputeStatus,
    LifecycleStage,
    PAYMENT_ACTION_VALUES,
    ProvenanceLabel,
)
from ..domain.errors import (
    ConflictError,
    DomainError,
    NotFoundError,
    ValidationFailedError,
)
from ..domain.models import (
    UNKNOWN,
    AuditEvent,
    AvailableAction,
    CaseRecord,
    CaseStateSnapshot,
    Money,
    TransactionReference,
)
from ..infrastructure.repositories import (
    AuditRepository,
    CaseRepository,
    CaseStateRepository,
)
from ..adapters.paypal.config import EXECUTION_MODE_LIVE, PayPalConfig
from ..adapters.paypal.errors import PayPalError, PayPalErrorKind
from ..adapters.paypal.offline_captures import (
    SYNTHETIC_SOURCE,
    OfflineCaptureFixture,
    OfflineCaptureFixtureError,
    is_offline_demo_capture,
)
from ..adapters.paypal.payments import (
    CaptureParseError,
    CaptureSnapshot,
    capture_id_of_case,
    capture_snapshot,
    from_minor,
    payment_case_id,
    to_minor,
)

PAYMENTS_REQUIRE_SANDBOX = (
    "payment capture import requires DP_DATA_MODE=paypal_sandbox with PayPal "
    "Sandbox credentials; no request was issued"
)

# Provenance of one capture read, as recorded in the import audit payload.
CAPTURE_SOURCE_PAYPAL = "PAYPAL_PAYMENTS_CAPTURE"
CAPTURE_SOURCE_OFFLINE_FIXTURE = "OFFLINE_DEMO_FIXTURE"

# Public ``source`` vocabulary of the read-only capture-status endpoint.
CAPTURE_STATUS_SOURCE_PAYPAL = "PAYPAL_API"
CAPTURE_STATUS_SOURCE_SYNTHETIC = "SYNTHETIC_OFFLINE_FIXTURE"

PAYMENT_CASE_NOTE = (
    "Payment capture case — a refund is a payments-side money movement and "
    "never resolves or closes a dispute"
)


class PaymentReadError(ConflictError):
    """A capture read failed while preparing an action (maps to PayPal's status).

    Never a fallback value: without an observed capture no refund can be
    drafted, so the caller gets an explicit upstream error instead.
    """

    code = "DOMAIN_ERROR"
    http_status = 503

    def __init__(self, error) -> None:
        super().__init__(f"PayPal capture read failed: {error}")
        self.http_status = error.api_status
        self.details = error.to_public()


class CaptureStatusUnavailable(DomainError):
    """The offline capture fixture cannot be read (explicit 503)."""

    code = "DOMAIN_ERROR"
    http_status = 503


class CaptureStatusNotFound(NotFoundError):
    """The capture is unknown to the configured source (explicit 404)."""

    code = "NOT_FOUND"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class PaymentImportResult:
    case_id: str
    capture_id: str
    capture_status: str
    snapshot: CaptureSnapshot
    inserted: bool
    read_at: str


class PaymentCaseService:
    def __init__(
        self,
        session,
        case_service,
        planning_service=None,
        *,
        client_factory: Callable[[PayPalConfig], Any] | None = None,
    ) -> None:
        self.session = session
        self.case_service = case_service
        self.planning = planning_service
        self._client_factory = client_factory
        self.cases = CaseRepository(session)
        self.states = CaseStateRepository(session)
        self.audit = AuditRepository(session)

    # ------------------------------------------------------------------ config
    def _client_context(self) -> ContextManager[Any]:
        config = PayPalConfig.from_env()
        if not config.is_sandbox_mode or not config.is_configured:
            raise ConflictError(PAYMENTS_REQUIRE_SANDBOX)
        factory = self._client_factory
        if factory is None:  # imported lazily: no HTTP client at import time
            from ..adapters.paypal.client import PayPalApiClient

            factory = PayPalApiClient
        return _ClosingClient(factory(config))

    # ------------------------------------------------------------------ import
    def import_capture(self, capture_id: str, actor_id: str = "system") -> PaymentImportResult:
        capture_id = str(capture_id or "").strip()
        if not capture_id:
            raise ValidationFailedError("capture_id is empty")
        if len(payment_case_id(capture_id)) > 64:
            raise ValidationFailedError(
                "capture_id is too long to form a stable payment case id"
            )

        read_at = _now_iso()
        raw, source = self._read_capture(capture_id)
        snapshot = self._snapshot(raw, capture_id)

        case = self._build_case(snapshot, read_at)
        inserted = self.cases.upsert_from_import(case)
        if not inserted:
            # Re-import refreshes the observed money facts; workflow status and
            # creation time are preserved (never rewound).
            self.cases.refresh_from_import(case)

        state = self._build_state(snapshot, read_at)
        previous = self._previous_state(case.case_id)
        state.state_version = self._next_version(previous, state)
        self.case_service.state_store.upsert(state)
        self.states.upsert(
            case.case_id,
            state.model_dump_json(),
            state.compute_state_hash(),
            state.state_version,
        )
        self.audit.append(
            AuditEvent(
                event_id=f"AUD-PAYMENTS-{uuid.uuid4().hex[:12]}",
                case_id=case.case_id,
                event_type=AuditEventType.CASE_IMPORTED.value,
                actor_type=ActorType.SYSTEM,
                actor_id=actor_id,
                payload={
                    "source": source,
                    "capture_id": snapshot.capture_id,
                    "capture_status": snapshot.status,
                    "original_amount": snapshot.original_amount,
                    "total_refunded": snapshot.total_refunded,
                    "refundable_remaining": snapshot.refundable_remaining,
                    "currency_code": snapshot.currency,
                    "read_at": read_at,
                    "inserted": inserted,
                    "raw_sha256": snapshot.raw_sha256,
                },
            )
        )
        self.session.commit()
        return PaymentImportResult(
            case_id=case.case_id,
            capture_id=snapshot.capture_id,
            capture_status=snapshot.status,
            snapshot=snapshot,
            inserted=inserted,
            read_at=read_at,
        )

    # -------------------------------------------------------------- observation
    def observe_capture(self, capture_id: str) -> CaptureSnapshot:
        """One authoritative capture read (used by the refund validator)."""
        raw, _source = self._read_capture(capture_id)
        return self._snapshot(raw, capture_id)

    def capture_status(
        self, capture_id: str
    ) -> tuple[CaptureSnapshot, str]:
        """Read-only capture status + explicit source, zero network in REPLAY.

        Unlike :meth:`_read_capture` (which may fall through to a sandbox read
        for non-demo ids), this path is strictly mode-scoped:

        - offline_replay -> ONLY ``OFFLINE_DEMO_CAPTURES.json``; a miss is 404,
          an unreadable fixture is 503, and no HTTP client is constructed;
        - paypal_sandbox -> ONE ``GET /v2/payments/captures/{id}`` (read only).
        """
        capture_id = str(capture_id or "").strip()
        if not capture_id:
            raise ValidationFailedError("capture_id is empty")

        config = PayPalConfig.from_env()
        if not config.is_sandbox_mode:
            try:
                fixture = OfflineCaptureFixture.load(config.offline_captures_path)
            except OfflineCaptureFixtureError as exc:
                raise CaptureStatusUnavailable(str(exc)) from None
            capture = fixture.get(capture_id)
            if capture is None:
                raise CaptureStatusNotFound(
                    f"capture {capture_id!r} is not in the offline capture "
                    f"fixture {config.offline_captures_path!r}; no PayPal request "
                    "was issued"
                )
            if fixture.source != SYNTHETIC_SOURCE:
                raise CaptureStatusUnavailable(
                    "offline capture fixture is not marked "
                    f"{SYNTHETIC_SOURCE}; refusing to report it as a capture"
                )
            return (
                self._snapshot(capture, capture_id),
                CAPTURE_STATUS_SOURCE_SYNTHETIC,
            )

        try:
            with self._client_context() as client:
                raw = client.get_capture(capture_id)
        except PayPalError as exc:
            raise PaymentReadError(exc) from None
        return self._snapshot(raw, capture_id), CAPTURE_STATUS_SOURCE_PAYPAL

    def _read_capture(self, capture_id: str) -> tuple[Any, str]:
        """Capture body + provenance: the offline fixture or a PayPal sandbox GET.

        In REPLAY mode a demo capture resolves from
        ``OFFLINE_DEMO_CAPTURES.json`` and NO HTTP client is constructed. A
        missing fixture entry is an explicit error — never a silent fallback to
        the network (the demo capture does not exist at PayPal).
        """
        config = PayPalConfig.from_env()
        fixture_hit = self._offline_capture(capture_id, config)
        if fixture_hit is not None:
            return fixture_hit, CAPTURE_SOURCE_OFFLINE_FIXTURE
        with self._client_context() as client:
            return client.get_capture(capture_id), CAPTURE_SOURCE_PAYPAL

    @staticmethod
    def _offline_capture(
        capture_id: str, config: PayPalConfig
    ) -> dict[str, Any] | None:
        """Synthetic capture for REPLAY mode; ``None`` means "use PayPal".

        LIVE mode never consults the fixture. In REPLAY mode a demo id is
        served locally or fails explicitly (404 unknown id / 503 unreadable
        fixture); other ids keep the previous behaviour (sandbox read when
        configured, otherwise the sandbox-required guard).
        """
        if config.execution_mode == EXECUTION_MODE_LIVE:
            return None

        try:
            fixture = OfflineCaptureFixture.load(config.offline_captures_path)
        except OfflineCaptureFixtureError as exc:
            if is_offline_demo_capture(capture_id):
                raise PayPalError(
                    PayPalErrorKind.UNAVAILABLE,
                    str(exc),
                    network_attempted=False,
                ) from None
            return None

        capture = fixture.get(capture_id)
        if capture is not None:
            if fixture.source != SYNTHETIC_SOURCE:
                raise PayPalError(
                    PayPalErrorKind.PROTOCOL,
                    "offline capture fixture is not marked "
                    f"{SYNTHETIC_SOURCE}; refusing to treat it as a demo capture",
                    network_attempted=False,
                )
            return capture

        if is_offline_demo_capture(capture_id):
            raise PayPalError(
                PayPalErrorKind.NOT_FOUND,
                f"offline demo capture {capture_id!r} is not in "
                f"{config.offline_captures_path!r}; no PayPal request was issued",
                network_attempted=False,
            )
        return None

    # ------------------------------------------------------------- refund draft
    def create_refund_draft(
        self,
        *,
        case_id: str,
        analysis_id: str,
        action_type: str,
        action_payload: dict[str, Any] | None,
        rationale: list[str] | None = None,
        required_evidence: list[str] | None = None,
        expected_preconditions: list[str] | None = None,
        evidence_ids: list[str] | None = None,
        actor_id: str = "client",
    ):
        if action_type not in PAYMENT_ACTION_VALUES:
            raise ValidationFailedError(
                f"action {action_type!r} is not a payment action "
                f"({sorted(PAYMENT_ACTION_VALUES)})"
            )
        if self.planning is None:  # pragma: no cover - wired by the API layer
            raise ConflictError("payment drafts require the planning service")

        case = self.case_service.get_case(case_id)
        capture_id = capture_id_of_case(case)
        if not capture_id:
            raise ValidationFailedError(
                f"case {case_id!r} has no capture reference; import the capture first"
            )

        payload: dict[str, Any] = dict(action_payload or {})

        snapshot = self._observe_for_draft(capture_id)
        self._assert_client_snapshot(payload.get("capture_snapshot"), snapshot)
        payload["capture_snapshot"] = snapshot.to_payload()

        if action_type == ActionType.PARTIAL_REFUND.value:
            payload["amount"] = self._canonical_amount(
                payload.get("amount"), snapshot
            )
        else:
            # A full refund refunds the remaining balance: the request body is
            # exactly {} and the payload must not pretend otherwise. A stray
            # amount is refused by V15 at submission, not silently dropped.
            amount = payload.get("amount")
            if isinstance(amount, str) and amount.strip():
                try:
                    to_minor(amount)
                except CaptureParseError as exc:
                    raise ValidationFailedError(
                        f"full-refund amount is malformed: {exc}"
                    ) from None
        if not str(payload.get("currency_code") or "").strip():
            payload["currency_code"] = snapshot.currency

        return self.planning.create_draft(
            case_id=case_id,
            analysis_id=analysis_id,
            action_type=action_type,
            action_payload=payload,
            rationale=rationale,
            required_evidence=required_evidence,
            expected_preconditions=expected_preconditions,
            evidence_ids=evidence_ids,
            actor_id=actor_id,
        )

    # ------------------------------------------------------------------ helpers
    def _observe_for_draft(self, capture_id: str) -> CaptureSnapshot:
        """Read the capture for a draft; an upstream failure is an explicit 503."""
        try:
            return self.observe_capture(capture_id)
        except PayPalError as exc:
            raise PaymentReadError(exc) from None

    @staticmethod
    def _snapshot(raw: Any, capture_id: str) -> CaptureSnapshot:
        try:
            snapshot = capture_snapshot(raw)
        except CaptureParseError as exc:
            raise ValidationFailedError(
                f"capture {capture_id!r} could not be read: {exc}"
            ) from None
        if snapshot.capture_id != capture_id:
            raise ValidationFailedError(
                f"capture response id {snapshot.capture_id!r} != requested "
                f"{capture_id!r}"
            )
        return snapshot

    @staticmethod
    def _assert_client_snapshot(declared: Any, snapshot: CaptureSnapshot) -> None:
        """A client echo is allowed; a different balance is a hard 422."""
        if declared is None:
            return
        server = snapshot.to_payload()
        if not isinstance(declared, dict) or _normalise_snapshot_block(
            declared
        ) != _normalise_snapshot_block(server):
            raise ValidationFailedError(
                "client-supplied capture_snapshot does not match the server's "
                "capture read; only the server may define the refund balance "
                f"(server: {server})"
            )

    @staticmethod
    def _canonical_amount(amount: Any, snapshot: CaptureSnapshot) -> str:
        """Validate the decimal, never round it; return the exact 2-dp string."""
        if amount in (None, ""):
            raise ValidationFailedError("partial-refund requires an explicit amount")
        try:
            minor = to_minor(amount)
        except CaptureParseError as exc:
            raise ValidationFailedError(f"refund amount is unusable: {exc}") from None
        if minor <= 0:
            raise ValidationFailedError("refund amount must be greater than 0.00")
        return from_minor(minor)

    @staticmethod
    def _build_case(snapshot: CaptureSnapshot, read_at: str) -> CaseRecord:
        note = (
            f"PayPal Payments capture read at {read_at}; "
            f"capture status={snapshot.status}; "
            f"original={snapshot.original_amount} {snapshot.currency}; "
            f"total_refunded={snapshot.total_refunded}; "
            f"refundable_remaining={snapshot.refundable_remaining}"
        )
        return CaseRecord(
            case_id=payment_case_id(snapshot.capture_id),
            scenario_id=UNKNOWN,
            dispute_id=UNKNOWN,
            family=DisputeFamily.BILLING,
            reason=DisputeReason.OTHER,
            status=CaseWorkflowStatus.IMPORTED,
            amount=Money(
                value_minor=snapshot.original_minor, currency=snapshot.currency
            ),
            transaction_reference=TransactionReference(capture_id=snapshot.capture_id),
            provenance=ProvenanceLabel.PAYPAL_API_OBSERVED,
            live_status_note=note,
            capture_status=snapshot.status,
        )

    @staticmethod
    def _build_state(snapshot: CaptureSnapshot, read_at: str) -> CaseStateSnapshot:
        links = []
        if snapshot.is_refundable_status:
            links.append(
                AvailableAction(
                    rel="refund",
                    method="POST",
                    basis=CapabilityBasis.LIVE_HATEOAS,
                )
            )
        return CaseStateSnapshot(
            case_id=payment_case_id(snapshot.capture_id),
            dispute_status=DisputeStatus.UNKNOWN,
            lifecycle_stage=LifecycleStage.UNKNOWN,
            links=links,
            dispute_amount=Money(
                value_minor=snapshot.original_minor, currency=snapshot.currency
            ),
            allowed_refund_amount=Money(
                value_minor=max(snapshot.remaining_minor, 0),
                currency=snapshot.currency,
            ),
            observed_at=read_at,
            basis=CapabilityBasis.LIVE_HATEOAS,
            provenance=ProvenanceLabel.PAYPAL_API_OBSERVED,
            note=PAYMENT_CASE_NOTE,
            state_version=1,
        )

    def _previous_state(self, case_id: str):
        try:
            return self.case_service.get_state(case_id)
        except NotFoundError:
            return None

    @staticmethod
    def _next_version(previous: CaseStateSnapshot | None, state: CaseStateSnapshot) -> int:
        """Keep the version when nothing material changed, so re-importing the
        same capture does not invalidate approvals bound to it."""
        if previous is None:
            return 1
        if _material(previous) == _material(state):
            return previous.state_version
        return previous.state_version + 1

    # --------------------------------------------------------------------- read
    def get_capture_snapshot(self, case_id: str) -> CaptureSnapshot:
        case = self.case_service.get_case(case_id)
        capture_id = capture_id_of_case(case)
        if not capture_id:
            raise NotFoundError(f"case {case_id!r} has no capture reference")
        return self.observe_capture(capture_id)


def _normalise_snapshot_block(block: dict[str, Any]) -> dict[str, Any]:
    """Compare amounts by value, identifiers as trimmed upper-case strings."""
    out: dict[str, Any] = {}
    for key in ("capture_id", "status", "currency_code"):
        out[key] = str(block.get(key) or "").strip().upper()
    for key in ("original_amount", "total_refunded", "refundable_remaining"):
        try:
            out[key] = to_minor(block.get(key))
        except CaptureParseError:
            out[key] = str(block.get(key))
    return out


def _material(state: CaseStateSnapshot) -> tuple:
    return (
        state.dispute_amount.value_minor if state.dispute_amount else None,
        state.dispute_amount.currency if state.dispute_amount else None,
        state.allowed_refund_amount.value_minor if state.allowed_refund_amount else None,
        tuple(sorted((link.rel, link.method) for link in state.links)),
    )


class _ClosingClient:
    """Context manager that always closes the client it owns."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def __enter__(self) -> Any:
        return self._client

    def __exit__(self, *_exc) -> None:
        close = getattr(self._client, "close", None)
        if callable(close):
            close()
