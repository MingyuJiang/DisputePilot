"""T13 — read client: list/detail, pagination params, error mapping, no retries."""

from __future__ import annotations

import httpx
import pytest

from app.adapters.paypal.client import PayPalApiClient
from app.adapters.paypal.errors import PayPalError, PayPalErrorKind
from tests.paypal_helpers import SENTINEL_TOKEN, raw_dispute, sandbox_config, token_json


def _client(handler, **overrides) -> PayPalApiClient:
    return PayPalApiClient(sandbox_config(**overrides), transport=httpx.MockTransport(handler))


def test_list_disputes_returns_items_and_sends_page_size():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        seen["query"] = dict(request.url.params)
        seen["auth"] = request.headers.get("authorization", "")
        return httpx.Response(200, json={"items": [raw_dispute()], "links": []})

    client = _client(handler)
    try:
        body = client.list_disputes(page_size=20, dispute_state="OPEN")
    finally:
        client.close()
    assert len(body["items"]) == 1
    assert seen["query"]["page_size"] == "20"
    assert seen["query"]["dispute_state"] == "OPEN"
    assert seen["auth"] == f"Bearer {SENTINEL_TOKEN}"


def test_empty_list_is_not_an_error():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        return httpx.Response(200, json={"items": [], "links": []})

    client = _client(handler)
    try:
        assert client.list_disputes()["items"] == []
    finally:
        client.close()


def test_list_missing_items_is_protocol_error():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        return httpx.Response(200, json={"links": []})

    client = _client(handler)
    try:
        with pytest.raises(PayPalError) as raised:
            client.list_disputes()
    finally:
        client.close()
    assert raised.value.kind == PayPalErrorKind.PROTOCOL


def test_detail_404_maps_to_not_found():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        return httpx.Response(404, json={"name": "INVALID_RESOURCE_ID", "debug_id": "dbg-404"})

    client = _client(handler)
    try:
        with pytest.raises(PayPalError) as raised:
            client.get_dispute("PP-D-404")
    finally:
        client.close()
    assert raised.value.kind == PayPalErrorKind.NOT_FOUND
    assert raised.value.request_id == "dbg-404"


def test_429_surfaces_retry_after_without_retry_by_default():
    calls = {"get": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        calls["get"] += 1
        return httpx.Response(429, headers={"Retry-After": "7"}, json={"name": "RATE_LIMIT"})

    client = _client(handler)
    try:
        with pytest.raises(PayPalError) as raised:
            client.get_dispute("PP-D-429")
    finally:
        client.close()
    assert raised.value.kind == PayPalErrorKind.RATE_LIMITED
    assert raised.value.retry_after == 7.0
    assert calls["get"] == 1


def test_5xx_maps_to_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        return httpx.Response(503, json={"name": "SERVICE_UNAVAILABLE"})

    client = _client(handler)
    try:
        with pytest.raises(PayPalError) as raised:
            client.get_dispute("PP-D-500")
    finally:
        client.close()
    assert raised.value.kind == PayPalErrorKind.UNAVAILABLE
    assert raised.value.http_status == 503


def test_bad_json_maps_to_protocol_without_echoing_body():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        return httpx.Response(200, content=b"<html>not json</html>")

    client = _client(handler)
    try:
        with pytest.raises(PayPalError) as raised:
            client.get_dispute("PP-D-BAD")
    finally:
        client.close()
    assert raised.value.kind == PayPalErrorKind.PROTOCOL
    assert "html" not in str(raised.value)
    assert SENTINEL_TOKEN not in str(raised.value)


def test_opt_in_read_retry_retries_get_only():
    calls = {"get": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        calls["get"] += 1
        if calls["get"] == 1:
            return httpx.Response(500, json={"name": "SERVER_ERROR"})
        return httpx.Response(200, json=raw_dispute())

    client = _client(handler, reads_retry=1)
    try:
        body = client.get_dispute("PP-D-RETRY")
    finally:
        client.close()
    assert body["dispute_id"] == "PP-D-100"
    assert calls["get"] == 2


def test_post_does_not_retry_even_on_5xx():
    calls = {"post": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json=token_json())
        calls["post"] += 1
        return httpx.Response(500, json={"name": "SERVER_ERROR"})

    client = _client(handler, reads_retry=3)
    try:
        with pytest.raises(PayPalError):
            client.post_dispute_action(
                "PP-D-100", "provide-evidence", {"evidence_type": "X"}, request_id="req-1"
            )
    finally:
        client.close()
    assert calls["post"] == 1
