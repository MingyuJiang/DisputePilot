"""T12 — OAuth: caching, refresh skew, error mapping, token secrecy."""

from __future__ import annotations

import httpx
import pytest

from app.adapters.paypal.errors import PayPalError, PayPalErrorKind
from app.adapters.paypal.oauth import OAuthToken, PayPalOAuth
from tests.paypal_helpers import (
    SENTINEL_CLIENT_ID,
    SENTINEL_SECRET,
    SENTINEL_TOKEN,
    sandbox_config,
    token_json,
)


def _oauth(handler, *, clock=None):
    http = httpx.Client(
        base_url="https://api-m.sandbox.paypal.com",
        transport=httpx.MockTransport(handler),
    )
    return PayPalOAuth(sandbox_config(), http, clock=clock or (lambda: 1000.0)), http


def test_token_fetch_and_cache_hit_makes_one_request():
    calls = {"token": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/oauth2/token"
        body = request.content.decode()
        assert "grant_type=client_credentials" in body
        calls["token"] += 1
        return httpx.Response(200, json=token_json())

    oauth, http = _oauth(handler)
    try:
        assert oauth.access_token() == SENTINEL_TOKEN
        assert oauth.access_token() == SENTINEL_TOKEN
    finally:
        http.close()
    assert calls["token"] == 1
    assert oauth.last_scope.startswith("https://uri.paypal.com/services/disputes")


def test_token_refreshes_after_expiry_skew():
    now = {"t": 1000.0}
    calls = {"token": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["token"] += 1
        return httpx.Response(200, json=token_json(expires_in=300))

    oauth, http = _oauth(handler, clock=lambda: now["t"])
    try:
        oauth.access_token()
        now["t"] = 1280.0  # 20 s before expiry (inside the 60 s skew)
        oauth.access_token()
        now["t"] = 1400.0  # well past expiry
        oauth.access_token()
    finally:
        http.close()
    assert calls["token"] == 2


def test_401_maps_to_auth_and_does_not_leak_credentials():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid_client", "debug_id": "dbg-1"})

    oauth, http = _oauth(handler)
    try:
        with pytest.raises(PayPalError) as raised:
            oauth.access_token()
    finally:
        http.close()
    error = raised.value
    assert error.kind == PayPalErrorKind.AUTH
    assert error.http_status == 401
    public = str(error.to_public()) + str(error)
    assert SENTINEL_CLIENT_ID not in public
    assert SENTINEL_SECRET not in public


def test_bad_json_maps_to_protocol():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>nope</html>")

    oauth, http = _oauth(handler)
    try:
        with pytest.raises(PayPalError) as raised:
            oauth.access_token()
    finally:
        http.close()
    assert raised.value.kind == PayPalErrorKind.PROTOCOL


def test_missing_access_token_maps_to_protocol():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"token_type": "Bearer", "expires_in": 100})

    oauth, http = _oauth(handler)
    try:
        with pytest.raises(PayPalError) as raised:
            oauth.access_token()
    finally:
        http.close()
    assert raised.value.kind == PayPalErrorKind.PROTOCOL


def test_timeout_maps_to_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("boom", request=request)

    oauth, http = _oauth(handler)
    try:
        with pytest.raises(PayPalError) as raised:
            oauth.access_token()
    finally:
        http.close()
    assert raised.value.kind == PayPalErrorKind.UNAVAILABLE
    assert raised.value.timed_out is True


def test_token_repr_never_contains_the_value():
    token = OAuthToken(access_token=SENTINEL_TOKEN)
    assert SENTINEL_TOKEN not in repr(token)
