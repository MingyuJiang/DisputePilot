"""Shared builders for the PayPal adapter tests (no network, no real ids)."""

from __future__ import annotations

import json
from typing import Any

import httpx

from app.adapters.paypal.config import DATA_MODE_SANDBOX, PayPalConfig
from app.domain.enums import ActorRole, ApprovalDecision
from app.domain.models import ActionProposal, Approval, CaseRecord, CaseStateSnapshot

SENTINEL_CLIENT_ID = "SENTINEL-CLIENT-ID-DO-NOT-LEAK"
SENTINEL_SECRET = "SENTINEL-CLIENT-SECRET-DO-NOT-LEAK"
SENTINEL_TOKEN = "SENTINEL-ACCESS-TOKEN-DO-NOT-LEAK"
SENTINEL_REQUEST_ID = "SENTINEL-REQUEST-ID-DO-NOT-LEAK"


def multipart_input_json(raw: bytes, content_type: str) -> dict[str, Any]:
    """Extract the ``input`` part from a multipart/form-data body (tests only)."""
    marker = "boundary="
    if marker not in content_type:
        raise AssertionError(f"not multipart/form-data: {content_type!r}")
    boundary = content_type.split(marker, 1)[1].split(";", 1)[0].strip().strip('"')
    for part in raw.split(b"--" + boundary.encode()):
        if b'name="input"' not in part:
            continue
        _headers, _, body = part.partition(b"\r\n\r\n")
        return json.loads(body.strip(b"\r\n-"))
    raise AssertionError("multipart body has no input part")


def sandbox_config(**overrides: Any) -> PayPalConfig:
    defaults: dict[str, Any] = dict(
        data_mode=DATA_MODE_SANDBOX,
        base_url="https://api-m.sandbox.paypal.com",
        client_id=SENTINEL_CLIENT_ID,
        client_secret=SENTINEL_SECRET,
        timeout_s=5.0,
        reads_retry=0,
        writes_enabled=True,
        write_allow=("PP-D-100:provide-evidence",),
    )
    defaults.update(overrides)
    return PayPalConfig(**defaults)


def token_json(expires_in: int = 3600, token: str = SENTINEL_TOKEN) -> dict[str, Any]:
    return {
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": expires_in,
        "scope": "https://uri.paypal.com/services/disputes/read",
    }


def raw_dispute(
    dispute_id: str = "PP-D-100",
    *,
    status: str = "WAITING_FOR_SELLER_RESPONSE",
    lifecycle: str = "INQUIRY",
    reason: str = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    amount: dict[str, Any] | None = None,
    evidences: list[dict[str, Any]] | None = None,
    links: list[dict[str, Any]] | None = None,
    messages: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if evidences is None:
        evidences = [
            {
                "evidence_id": "EV-1",
                "evidence_type": "PROOF_OF_FULFILLMENT",
                "source": "REQUESTED_FROM_SELLER",
                "evidence_documents": [],
            }
        ]
    if links is None:
        links = [
            {
                "rel": "provide-evidence",
                "href": f"/v1/customer/disputes/{dispute_id}/provide-evidence",
                "method": "POST",
            },
            {"rel": "self", "href": f"/v1/customer/disputes/{dispute_id}", "method": "GET"},
        ]
    payload = {
        "dispute_id": dispute_id,
        "status": status,
        "dispute_life_cycle_stage": lifecycle,
        "reason": reason,
        "dispute_amount": amount or {"currency_code": "USD", "value": "129.99"},
        "evidences": evidences,
        "links": links,
    }
    # ``messages`` is only present when the caller supplies it: an absent field
    # means "not observable", which is different from "the dispute has none".
    if messages is not None:
        payload["messages"] = messages
    return payload


def send_message_links(dispute_id: str = "PP-D-100") -> list[dict[str, Any]]:
    """Links a real INQUIRY detail carries, including ``send_message``."""
    return [
        {
            "rel": "send-message",
            "href": f"/v1/customer/disputes/{dispute_id}/send-message",
            "method": "POST",
        },
        {
            "rel": "provide-evidence",
            "href": f"/v1/customer/disputes/{dispute_id}/provide-evidence",
            "method": "POST",
        },
        {"rel": "self", "href": f"/v1/customer/disputes/{dispute_id}", "method": "GET"},
    ]


def make_proposal(
    case: CaseRecord,
    *,
    action: str = "provide-evidence",
    payload: dict[str, Any] | None = None,
) -> ActionProposal:
    return ActionProposal(
        proposal_id="PROP-SANDBOX-1",
        case_id=case.case_id,
        analysis_id="AN-SANDBOX-1",
        action_type=action,
        action_payload=payload
        or {"evidence_type": "PROOF_OF_FULFILLMENT", "notes": "Sandbox adapter test"},
        snapshot_hash=case.snapshot_hash,
        policy_version="policy-v1.0",
    )


def make_approval(proposal: ActionProposal) -> Approval:
    return Approval(
        approval_id="APR-SANDBOX-1",
        proposal_id=proposal.proposal_id,
        action_payload_hash=proposal.payload_hash or "hash",
        case_snapshot_hash=proposal.snapshot_hash,
        policy_version="policy-v1.0",
        decision=ApprovalDecision.APPROVED,
        reason="sandbox adapter unit test",
        actor_id="manager-test",
        actor_role=ActorRole.MANAGER,
    )


class MockPayPal:
    """Stateful PayPal double driven by ``httpx.MockTransport``.

    Modes for the write endpoint: ``ok`` / ``timeout`` / ``500`` / ``401`` /
    ``403`` / ``429``. ``apply_change_on_post`` flips the read-back payload
    as a real acceptance would, and ``readback`` controls *what* the read-back
    looks like:

    - ``ECHO_SUBMITTED`` (default): append the payload that was actually POSTed
      (type + notes + documents), stamped ``SUBMITTED_BY_SELLER``.
    - ``MISMATCH_NOTES``: append it with altered notes (count grows, no match).
    - ``REPLACE_REQUESTED``: submitted entry replaces the REQUESTED_FROM_SELLER
      placeholders, exactly as the real sandbox did (count may go down).
    - ``STATUS_ONLY``: status changes, evidences stay untouched.

    ``send-message`` is handled on its own path (``message_post_calls``) and the
    posted text is echoed into ``messages[]`` according to ``message_readback``:
    ``echo`` (byte-exact SELLER message), ``mismatch`` (body altered),
    ``buyer`` (same body, wrong origin), ``absent`` (field disappears).
    """

    def __init__(
        self,
        *,
        pre: dict[str, Any] | None = None,
        post_status: str = "ok",
        apply_change_on_post: bool = True,
        readback: str = "echo_submitted",
        token_status: int = 200,
        get_after_post_status: int = 200,
        messages: list[dict[str, Any]] | None = None,
        messages_observable: bool = True,
        message_readback: str = "echo",
    ) -> None:
        self.pre = pre or raw_dispute()
        self.post_status = post_status
        self.apply_change_on_post = apply_change_on_post
        self.readback = readback
        self.token_status = token_status
        self.get_after_post_status = get_after_post_status
        self.messages = messages
        self.messages_observable = messages_observable
        self.message_readback = message_readback
        self.token_calls = 0
        self.get_calls = 0
        self.post_calls = 0
        self.list_calls = 0
        self.message_post_calls = 0
        self.posted = False
        self.posted_message = ""
        self.last_post_body: dict[str, Any] | None = None
        self.last_post_raw: bytes | None = None
        self.last_post_content_type: str | None = None
        self.last_post_path: str | None = None
        self.last_post_idempotency: str | None = None
        self.last_message_body: dict[str, Any] | None = None
        self.last_message_raw: bytes | None = None
        self.last_message_content_type: str | None = None
        self.last_message_path: str | None = None
        self.last_message_idempotency: str | None = None

    # -- payload helpers
    def _submitted_evidences(self) -> list[dict[str, Any]]:
        body = (self.last_post_body or {}).get("evidences") or []
        submitted: list[dict[str, Any]] = []
        for index, entry in enumerate(body, start=1):
            if not isinstance(entry, dict):
                continue
            item: dict[str, Any] = {
                "evidence_id": f"EV-SUBMITTED-{index}",
                "evidence_type": entry.get("evidence_type"),
                "source": "SUBMITTED_BY_SELLER",
                "evidence_documents": entry.get("evidence_documents", []),
            }
            if "notes" in entry:
                item["notes"] = entry["notes"]
                if self.readback == "mismatch_notes":
                    item["notes"] = f"{entry['notes']} [altered elsewhere]"
            submitted.append(item)
        return submitted

    def _detail(self) -> dict[str, Any]:
        payload = dict(self.pre)
        if not self.messages_observable:
            payload.pop("messages", None)
        else:
            initial = (
                self.messages
                if self.messages is not None
                else [
                    dict(entry)
                    for entry in (self.pre.get("messages") or [])
                    if isinstance(entry, dict)
                ]
            )
            payload["messages"] = [dict(entry) for entry in initial]
        if not (self.posted and self.apply_change_on_post):
            return payload
        evidences = [
            dict(entry)
            for entry in payload.get("evidences", [])
            if isinstance(entry, dict)
        ]
        if self.readback == "status_only":
            pass
        elif self.readback == "replace_requested":
            kept = [
                entry
                for entry in evidences
                if str(entry.get("source") or "").strip().upper()
                != "REQUESTED_FROM_SELLER"
            ]
            evidences = kept + self._submitted_evidences()
        else:
            evidences = evidences + self._submitted_evidences()
        payload["evidences"] = evidences
        payload["status"] = "UNDER_REVIEW"
        if self.message_post_calls and self.messages_observable:
            if self.message_readback == "absent":
                payload.pop("messages", None)
            else:
                entries = [
                    dict(entry)
                    for entry in (payload.get("messages") or [])
                    if isinstance(entry, dict)
                ]
                body = self.posted_message
                origin = "SELLER"
                if self.message_readback == "mismatch":
                    body = f"{body} [altered elsewhere]"
                elif self.message_readback == "buyer":
                    origin = "BUYER"
                entries.append(
                    {
                        "id": f"MSG-SUBMITTED-{len(entries) + 1}",
                        "from": origin,
                        "body": body,
                        "created": "2026-10-20T00:00:00Z",
                    }
                )
                payload["messages"] = entries
        return payload

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/v1/oauth2/token":
            self.token_calls += 1
            if self.token_status != 200:
                return httpx.Response(
                    self.token_status,
                    json={"error": "invalid_client", "debug_id": SENTINEL_REQUEST_ID},
                    headers={"paypal-debug-id": SENTINEL_REQUEST_ID},
                )
            return httpx.Response(200, json=token_json())

        if path == "/v1/customer/disputes":
            self.list_calls += 1
            return httpx.Response(200, json={"items": [self._detail()], "links": []})

        if request.method == "GET" and path.startswith("/v1/customer/disputes/"):
            self.get_calls += 1
            if self.posted and self.get_after_post_status != 200:
                return httpx.Response(
                    self.get_after_post_status,
                    json={"name": "ERROR", "debug_id": SENTINEL_REQUEST_ID},
                )
            return httpx.Response(
                200,
                json=self._detail(),
                headers={"paypal-debug-id": SENTINEL_REQUEST_ID},
            )

        if request.method == "POST" and path.endswith("/send-message"):
            self.message_post_calls += 1
            self.last_message_raw = request.content or b""
            self.last_message_content_type = request.headers.get("content-type", "")
            self.last_message_path = path
            self.last_message_idempotency = request.headers.get("paypal-request-id")
            self.last_message_body = json.loads(self.last_message_raw or b"{}")
            self.posted_message = str(self.last_message_body.get("message") or "")
            if self.post_status == "timeout":
                if self.apply_change_on_post:
                    self.posted = True
                raise httpx.ReadTimeout("simulated timeout", request=request)
            if self.post_status == "ok":
                self.posted = True
                return httpx.Response(
                    200,
                    json={"links": []},
                    headers={"paypal-debug-id": SENTINEL_REQUEST_ID},
                )
            return httpx.Response(
                int(self.post_status),
                json={"name": "ERROR", "debug_id": SENTINEL_REQUEST_ID},
                headers={"retry-after": "3"} if self.post_status == "429" else {},
            )

        if request.method == "POST" and path.endswith("/provide-evidence"):
            self.post_calls += 1
            self.last_post_raw = request.content or b""
            self.last_post_content_type = request.headers.get("content-type", "")
            self.last_post_path = path
            if "multipart/form-data" in self.last_post_content_type:
                self.last_post_body = multipart_input_json(
                    self.last_post_raw, self.last_post_content_type
                )
            else:  # keep the old JSON double working for negative tests
                self.last_post_body = json.loads(self.last_post_raw or b"{}")
            self.last_post_idempotency = request.headers.get("paypal-request-id")
            if self.post_status == "timeout":
                if self.apply_change_on_post:
                    self.posted = True
                raise httpx.ReadTimeout("simulated timeout", request=request)
            if self.post_status == "ok":
                self.posted = True
                return httpx.Response(204, headers={"paypal-debug-id": SENTINEL_REQUEST_ID})
            return httpx.Response(
                int(self.post_status),
                json={"name": "ERROR", "debug_id": SENTINEL_REQUEST_ID},
                headers={"retry-after": "3"} if self.post_status == "429" else {},
            )

        return httpx.Response(404, json={"name": "NOT_FOUND"})


# ---------------------------------------------------------------------------
# Payments v2 (capture / refund) doubles — still no network, no real ids.
# ---------------------------------------------------------------------------
CAPTURE_ID = "3C08092UY9754847"
MERCHANT_ID = "MERCHANT-SANDBOX-1"


def raw_capture(
    capture_id: str = CAPTURE_ID,
    *,
    status: str = "COMPLETED",
    value: str = "100.00",
    currency: str = "USD",
    total_refunded: str | None = None,
    payee_merchant_id: str | None = None,
    refunds: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """One ``GET /v2/payments/captures/{id}`` body (shapes as observed)."""
    payload: dict[str, Any] = {
        "id": capture_id,
        "status": status,
        "amount": {"value": value, "currency_code": currency},
        "final_capture": True,
        "create_time": "2026-10-20T00:00:00Z",
        "update_time": "2026-10-20T00:00:00Z",
        "links": [
            {
                "rel": "self",
                "href": f"/v2/payments/captures/{capture_id}",
                "method": "GET",
            },
            {
                "rel": "refund",
                "href": f"/v2/payments/captures/{capture_id}/refund",
                "method": "POST",
            },
            {"rel": "up", "href": "/v2/payments/captures", "method": "GET"},
        ],
    }
    if total_refunded is not None:
        payload["seller_receivable_breakdown"] = {
            "gross_amount": {"value": value, "currency_code": currency},
            "paypal_fee": {"value": "3.20", "currency_code": currency},
            "net_amount": {"value": "96.80", "currency_code": currency},
            "total_refunded_amount": {
                "value": total_refunded,
                "currency_code": currency,
            },
        }
    if payee_merchant_id:
        payload["payee"] = {
            "merchant_id": payee_merchant_id,
            "email_address": "merchant@example.test",
        }
    if refunds is not None:
        payload["refunds"] = refunds
    return payload


def raw_refund(
    refund_id: str = "REF-1",
    *,
    status: str = "COMPLETED",
    value: str = "4.00",
    currency: str = "USD",
    capture_id: str = CAPTURE_ID,
    include_capture: bool = True,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": refund_id,
        "status": status,
        "amount": {"value": value, "currency_code": currency},
        "create_time": "2026-10-20T00:00:00Z",
        "update_time": "2026-10-20T00:00:00Z",
    }
    if include_capture:
        payload["supplementary_data"] = {"related_ids": {"capture_id": capture_id}}
    return payload


def _money_minor(value: str) -> int:
    whole, _, frac = str(value).partition(".")
    return int(whole) * 100 + int((frac or "0").ljust(2, "0")[:2])


def _money_str(minor: int) -> str:
    return f"{minor // 100}.{minor % 100:02d}"


class MockPayments:
    """Stateful Payments v2 double: capture GET, refund POST, refund GET.

    ``post_status``:
      ``ok``       → 201 with a refund body (default)
      ``timeout``  → the request is processed, then ``httpx.ReadTimeout``
      ``<int>``    → that HTTP status, nothing applied

    ``apply_refund_on_post`` mutates the capture (status + total_refunded) the
    way a real refund does. ``expose_refunds_after_post`` makes the capture
    response carry a ``refunds[]`` hint (used to recover an id after a timeout).
    ``refund_status`` is what ``GET /v2/payments/refunds/{id}`` reports.
    """

    def __init__(
        self,
        *,
        capture: dict[str, Any] | None = None,
        refund_status: str = "COMPLETED",
        post_status: Any = "ok",
        apply_refund_on_post: bool = True,
        refund_get_status: int = 200,
        capture_get_status: int = 200,
        expose_refunds_after_post: bool = False,
        refund_amount_override: str | None = None,
        refund_currency_override: str | None = None,
        refund_capture_override: str | None = None,
        token_status: int = 200,
    ) -> None:
        self.capture = capture or raw_capture()
        self.refund_status = refund_status
        self.post_status = post_status
        self.apply_refund_on_post = apply_refund_on_post
        self.refund_get_status = refund_get_status
        self.capture_get_status = capture_get_status
        self.expose_refunds_after_post = expose_refunds_after_post
        self.refund_amount_override = refund_amount_override
        self.refund_currency_override = refund_currency_override
        self.refund_capture_override = refund_capture_override
        self.token_status = token_status

        self.token_calls = 0
        self.capture_get_calls = 0
        self.refund_get_calls = 0
        self.refund_post_calls = 0

        self.last_post_path: str | None = None
        self.last_post_raw: bytes | None = None
        self.last_post_body: dict[str, Any] | None = None
        self.last_post_request_id: str | None = None
        self.last_post_headers: dict[str, str] = {}

        self.refund: dict[str, Any] | None = None
        self.refunds: list[dict[str, Any]] = []

    # -- state helpers ------------------------------------------------------
    def set_capture(self, capture: dict[str, Any]) -> None:
        """Replace the observed capture (simulates a PayPal-side change)."""
        self.capture = capture

    def _refunded_minor(self) -> int:
        breakdown = self.capture.get("seller_receivable_breakdown") or {}
        block = (breakdown or {}).get("total_refunded_amount") or {}
        return _money_minor(block.get("value", "0.00"))

    def _capture_body(self) -> dict[str, Any]:
        payload = dict(self.capture)
        if self.expose_refunds_after_post and self.refund is not None:
            payload["refunds"] = [dict(entry) for entry in self.refunds]
        return payload

    def _apply_refund(self, amount_value: str, currency: str, refund_id: str) -> None:
        original = _money_minor(self.capture["amount"]["value"])
        refunded = self._refunded_minor() + _money_minor(amount_value)
        status = "REFUNDED" if refunded >= original else "PARTIALLY_REFUNDED"
        updated = dict(self.capture)
        updated["status"] = status
        updated["seller_receivable_breakdown"] = {
            "gross_amount": dict(self.capture["amount"]),
            "total_refunded_amount": {
                "value": _money_str(refunded),
                "currency_code": currency,
            },
        }
        self.capture = updated
        entry = {
            "id": refund_id,
            "status": self.refund_status,
            "amount": {"value": amount_value, "currency_code": currency},
        }
        self.refunds = [entry]

    # -- transport ----------------------------------------------------------
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def _handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path

        if path == "/v1/oauth2/token":
            self.token_calls += 1
            if self.token_status != 200:
                return httpx.Response(
                    self.token_status,
                    json={"error": "invalid_client", "debug_id": SENTINEL_REQUEST_ID},
                )
            return httpx.Response(200, json=token_json())

        if request.method == "GET" and path.startswith("/v2/payments/captures/"):
            self.capture_get_calls += 1
            if self.capture_get_status != 200:
                return httpx.Response(
                    self.capture_get_status,
                    json={"name": "INVALID_RESOURCE_ID", "debug_id": SENTINEL_REQUEST_ID},
                )
            requested = path.rsplit("/", 1)[-1]
            if requested != self.capture.get("id"):
                return httpx.Response(
                    404, json={"name": "INVALID_RESOURCE_ID"}
                )
            return httpx.Response(200, json=self._capture_body())

        if request.method == "POST" and path.endswith("/refund"):
            self.refund_post_calls += 1
            self.last_post_path = path
            self.last_post_raw = request.content or b""
            self.last_post_headers = {
                k.lower(): v for k, v in request.headers.items()
            }
            self.last_post_request_id = request.headers.get("paypal-request-id")
            self.last_post_body = json.loads(self.last_post_raw or b"{}")

            capture_id = path.split("/")[4]
            body = self.last_post_body or {}
            amount_block = body.get("amount") or {}
            if amount_block:
                amount_value = str(amount_block.get("value"))
                currency = str(amount_block.get("currency_code"))
            else:
                # Full refund: PayPal refunds the remaining balance.
                original = _money_minor(self.capture["amount"]["value"])
                amount_value = _money_str(original - self._refunded_minor())
                currency = self.capture["amount"]["currency_code"]

            refund_id = f"REF-{self.refund_post_calls}0A1B2C3D4"
            if self.post_status == "ok" or self.post_status == "timeout":
                if self.apply_refund_on_post:
                    self._apply_refund(amount_value, currency, refund_id)
                self.refund = raw_refund(
                    refund_id,
                    status=self.refund_status,
                    value=self.refund_amount_override or amount_value,
                    currency=self.refund_currency_override or currency,
                    capture_id=self.refund_capture_override or capture_id,
                )
            if self.post_status == "timeout":
                raise httpx.ReadTimeout("simulated timeout", request=request)
            if self.post_status == "ok":
                return httpx.Response(
                    201,
                    json=self.refund,
                    headers={"paypal-debug-id": SENTINEL_REQUEST_ID},
                )
            return httpx.Response(
                int(self.post_status),
                json={"name": "ERROR", "debug_id": SENTINEL_REQUEST_ID},
            )

        if request.method == "GET" and path.startswith("/v2/payments/refunds/"):
            self.refund_get_calls += 1
            if self.refund_get_status != 200:
                return httpx.Response(
                    self.refund_get_status,
                    json={"name": "ERROR", "debug_id": SENTINEL_REQUEST_ID},
                )
            requested = path.rsplit("/", 1)[-1]
            if self.refund is None or requested != self.refund.get("id"):
                return httpx.Response(404, json={"name": "INVALID_RESOURCE_ID"})
            return httpx.Response(200, json=self.refund)

        return httpx.Response(404, json={"name": "NOT_FOUND"})
