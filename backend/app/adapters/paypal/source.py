"""PayPal case source — list → normalize → idempotent upsert → audit.

Guarantees:
- One failed read aborts the whole sync before any local write (no partial
  "success", and never a fallback to offline fixtures).
- Upsert is keyed by the stable internal case id (``PP-<dispute_id>``), so a
  second import refreshes the normalized fields (references, observed status,
  evidence) and is reported as skipped, never duplicated.
- The audit payload contains the read time, remote count and per-case
  snapshot hash — never a token, header or raw response body.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, urlparse

from ...domain.enums import ActorType, AuditEventType
from ...domain.models import AuditEvent, CaseRecord, CaseStateSnapshot
from ...infrastructure.repositories import (
    AuditRepository,
    CaseRepository,
    CaseStateRepository,
)
from .client import PayPalApiClient
from .config import PayPalConfig
from .errors import PayPalError, PayPalErrorKind
from .normalize import canonical_snapshot_hash, normalize_dispute


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _next_page_token(links: Any) -> str | None:
    if not isinstance(links, list):
        return None
    for link in links:
        if not isinstance(link, dict) or str(link.get("rel", "")).lower() != "next":
            continue
        href = str(link.get("href") or "")
        tokens = parse_qs(urlparse(href).query).get("next_page_token")
        if tokens:
            return tokens[0]
    return None


@dataclass
class PayPalFetchResult:
    cases: list[CaseRecord] = field(default_factory=list)
    states: list[CaseStateSnapshot] = field(default_factory=list)
    read_at: str = ""
    remote_count: int = 0
    pages: int = 0
    warnings: list[str] = field(default_factory=list)
    source_sha256: str = ""


@dataclass
class PayPalImportReport:
    imported: int
    skipped: int
    read_at: str
    remote_count: int
    source_sha256: str
    details: list[str] = field(default_factory=list)


class PayPalCaseSource:
    def __init__(
        self,
        config: PayPalConfig,
        *,
        client: PayPalApiClient | None = None,
        page_size: int = 50,
        max_pages: int = 10,
    ) -> None:
        self.config = config
        self._client = client
        self._owns_client = client is None
        self.page_size = page_size
        self.max_pages = max_pages

    # ------------------------------------------------------------------ lifecycle
    def close(self) -> None:
        if self._client is not None and self._owns_client:
            self._client.close()
            self._client = None

    def _api(self) -> PayPalApiClient:
        if self._client is None:
            self._client = PayPalApiClient(self.config)
        return self._client

    # ---------------------------------------------------------------------- fetch
    def fetch(self) -> PayPalFetchResult:
        if not self.config.is_configured:
            raise PayPalError(
                PayPalErrorKind.AUTH,
                "PayPal Sandbox credentials are not configured "
                "(DP_PAYPAL_CLIENT_ID / DP_PAYPAL_CLIENT_SECRET)",
                network_attempted=False,
            )

        api = self._api()
        items: list[dict[str, Any]] = []
        warnings: list[str] = []
        token: str | None = None
        pages = 0
        while True:
            body = api.list_disputes(self.page_size, token)
            page_items = body.get("items") or []
            for item in page_items:
                if isinstance(item, dict):
                    items.append(item)
                else:
                    warnings.append("remote list contains a non-object item → skipped")
            pages += 1
            token = _next_page_token(body.get("links"))
            if not token:
                break
            if pages >= self.max_pages:
                warnings.append(
                    f"pagination stopped after {pages} pages; more disputes exist remotely"
                )
                break

        read_at = _now_iso()
        cases: list[CaseRecord] = []
        states: list[CaseStateSnapshot] = []
        for index, item in enumerate(items, start=1):
            dispute_id = str(item.get("dispute_id") or "").strip()
            if not dispute_id:
                warnings.append(f"remote item #{index} has no dispute_id → skipped")
                continue
            detail = item
            if "evidences" not in detail:
                # List entries are summaries; the detail GET is authoritative.
                detail = api.get_dispute(dispute_id)
            try:
                normalized = normalize_dispute(detail, read_at=read_at)
            except ValueError as exc:
                raise PayPalError(
                    PayPalErrorKind.PROTOCOL,
                    f"remote dispute item #{index} could not be normalized: {exc}",
                ) from None
            cases.append(normalized.case)
            states.append(normalized.state)
            warnings.extend(normalized.warnings)

        return PayPalFetchResult(
            cases=cases,
            states=states,
            read_at=read_at,
            remote_count=len(items),
            pages=pages,
            warnings=warnings,
            source_sha256=canonical_snapshot_hash(cases),
        )

    # ----------------------------------------------------------------------- sync
    def sync(self, session, state_store) -> PayPalImportReport:
        """Fetch, then persist. A fetch failure happens before any write."""
        fetched = self.fetch()
        cases_repo = CaseRepository(session)
        states_repo = CaseStateRepository(session)
        audit = AuditRepository(session)

        imported = 0
        skipped = 0
        try:
            for case, state in zip(fetched.cases, fetched.states):
                inserted = cases_repo.upsert_from_import(case)
                if inserted:
                    imported += 1
                else:
                    # Re-import refreshes the normalized fields from the new
                    # read (references, observed status, evidence); the audit
                    # still records inserted=false.
                    cases_repo.refresh_from_import(case)
                    skipped += 1
                state_store.upsert(state)
                states_repo.upsert(
                    state.case_id,
                    state.model_dump_json(),
                    state.compute_state_hash(),
                    state.state_version,
                )
                audit.append(
                    AuditEvent(
                        event_id=f"AUD-PAYPAL-{uuid.uuid4().hex[:12]}",
                        case_id=case.case_id,
                        event_type=AuditEventType.CASE_IMPORTED.value,
                        actor_type=ActorType.SYSTEM,
                        actor_id="paypal-sandbox-adapter",
                        payload={
                            "source": "PAYPAL_SANDBOX",
                            "read_at": fetched.read_at,
                            "dispute_count": len(fetched.cases),
                            "snapshot_hash": case.snapshot_hash,
                            "dispute_id": case.dispute_id,
                            "inserted": inserted,
                        },
                    )
                )
            session.commit()
        except Exception:
            session.rollback()
            raise

        details = [
            "source=PAYPAL_SANDBOX",
            f"read_at={fetched.read_at}",
            f"remote_disputes={fetched.remote_count}",
            f"pages={fetched.pages}",
        ]
        details.extend(fetched.warnings)
        return PayPalImportReport(
            imported=imported,
            skipped=skipped,
            read_at=fetched.read_at,
            remote_count=fetched.remote_count,
            source_sha256=fetched.source_sha256,
            details=details,
        )
