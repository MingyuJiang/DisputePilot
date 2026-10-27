"""T6 — Zero-network proof: socket lockdown during a full e2e run + AST scan
proving no HTTP client code paths exist in the application (method reused
from PAYPAL_API_ENGINEERING_EVIDENCE_INDEX.md §4 reverse-evidence approach).

Controlled exceptions (Phase L2.3 / Phase 4):
- exactly ONE file is allowed to import a network client for local inference —
  ``app/adapters/local_llm/transport.py`` — because the local provider must
  speak HTTP to a loopback Ollama; it enforces a loopback allow-list itself;
- exactly ONE file is allowed to import ``httpx`` for PayPal — 
  ``app/adapters/paypal/client.py`` — and it is inert until a transport is
  supplied; production base URLs are restricted to PayPal *sandbox* hosts by
  ``paypal/config.py``, and every test injects ``httpx.MockTransport``.
Every other module stays under the scan.
"""

from __future__ import annotations

import ast
import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from app.adapters.local_llm.errors import LLMServiceError
from app.adapters.local_llm.transport import OllamaChatTransport
from tests.conftest import MANAGER, SPECIALIST, run_full_chain

APP_DIR = Path(__file__).resolve().parents[1] / "app"

# The one and only permitted network-capable application module for inference.
LLM_TRANSPORT_PATH = (
    APP_DIR / "adapters" / "local_llm" / "transport.py"
).resolve()

# The one and only permitted httpx importer for PayPal (tests inject a Mock).
PAYPAL_CLIENT_PATH = (APP_DIR / "adapters" / "paypal" / "client.py").resolve()

EXEMPT_NETWORK_PATHS = {LLM_TRANSPORT_PATH, PAYPAL_CLIENT_PATH}

FORBIDDEN_MODULES = {
    "requests",
    "httpx",
    "urllib.request",
    "urllib3",
    "http.client",
    "aiohttp",
    "socket",
    "ssl",
    "websocket",
    "paypal",
    "paypalhttp",
    "paramiko",
}

FORBIDDEN_NAMES = {"urlopen", "HTTPConnection", "HTTPSConnection"}


def test_no_forbidden_imports_in_app_code():
    offenders = []
    for path in APP_DIR.rglob("*.py"):
        if path.resolve() in EXEMPT_NETWORK_PATHS:
            continue  # narrow, resolved-path exemptions (see module docstring)
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    root = alias.name.split(".")[0]
                    if root in FORBIDDEN_MODULES or alias.name in FORBIDDEN_MODULES:
                        offenders.append(f"{path.name}: import {alias.name}")
            elif isinstance(node, ast.ImportFrom):
                mod = (node.module or "").split(".")[0]
                if mod in FORBIDDEN_MODULES or (node.module or "") in FORBIDDEN_MODULES:
                    offenders.append(f"{path.name}: from {node.module} import …")
            elif isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
                offenders.append(f"{path.name}: uses {node.id}")
            elif isinstance(node, ast.Attribute) and node.attr in FORBIDDEN_NAMES:
                offenders.append(f"{path.name}: uses .{node.attr}")
    assert not offenders, "forbidden network-capable code paths:\n" + "\n".join(offenders)


def test_loopback_exemption_is_exactly_one_transport_file():
    """The exemption stays narrow: only the resolved transport path is skipped."""
    exempt = [
        path
        for path in APP_DIR.rglob("*.py")
        if path.resolve() == LLM_TRANSPORT_PATH
    ]
    assert len(exempt) == 1
    source = LLM_TRANSPORT_PATH.read_text(encoding="utf-8")
    assert "LOOPBACK_HOSTS" in source
    assert "REDIRECT_STATUSES" in source
    # no other module is named *transport*
    others = [
        p
        for p in APP_DIR.rglob("*transport*.py")
        if p.resolve() != LLM_TRANSPORT_PATH
    ]
    assert others == []


class _LoopbackOllamaStub(BaseHTTPRequestHandler):
    """Tiny loopback Ollama double — proves the transport path works for real."""

    protocol_version = "HTTP/1.1"

    def do_POST(self):  # noqa: N802 (http.server API)
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length) or b"{}")
        assert self.path.endswith("/api/chat")
        assert body["model"] == "loopback-test"
        payload = json.dumps(
            {
                "model": body["model"],
                "message": {"role": "assistant", "content": "{}"},
                "done": True,
                "done_reason": "stop",
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):  # silence the test server
        return


def test_loopback_transport_succeeds_against_local_server():
    """Positive case: a real loopback HTTP round-trip is allowed."""
    server = ThreadingHTTPServer(("127.0.0.1", 0), _LoopbackOllamaStub)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        transport = OllamaChatTransport(f"http://127.0.0.1:{server.server_port}")
        response = transport.chat(
            {"model": "loopback-test", "messages": []}, timeout_s=10
        )
        assert response["done_reason"] == "stop"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_external_url_rejected_at_client_layer():
    """Negative case: non-loopback hosts never reach a socket."""
    with pytest.raises(LLMServiceError) as construction:
        OllamaChatTransport("http://example.com:11434")
    assert construction.value.internal_code == "LLM_CONNECTION_ERROR"

    transport = OllamaChatTransport("http://127.0.0.1:11434")
    # even if the attribute is tampered with, chat() re-validates before dialing
    transport.base_url = "http://8.8.8.8:11434"
    with pytest.raises(LLMServiceError) as call:
        transport.chat({"model": "x", "messages": []}, timeout_s=1)
    assert call.value.internal_code == "LLM_CONNECTION_ERROR"

    # userinfo trick: hostname is example.com, not 127.0.0.1
    with pytest.raises(LLMServiceError):
        OllamaChatTransport("http://127.0.0.1@example.com:11434")

    # redirects are refused, never followed
    with pytest.raises(LLMServiceError):
        OllamaChatTransport("https://127.0.0.1:11434")


def test_no_retry_backoff_patterns_in_execution_path():
    """V12 static audit: no sleep/backoff/retry-loop constructs in the path."""
    targets = [
        APP_DIR / "services" / "execution_service.py",
        APP_DIR / "adapters" / "replay_gateway.py",
        APP_DIR / "services" / "approval_service.py",
    ]
    banned = ("time.sleep", "while true", "for attempt in", "max_retries", "backoff")
    for path in targets:
        text = path.read_text(encoding="utf-8").lower()
        for pattern in banned:
            assert pattern not in text, f"{path.name} contains banned pattern {pattern!r}"
    # the V12 checker itself must exist and be wired into the validator
    policies_src = (APP_DIR / "domain" / "policies.py").read_text(encoding="utf-8")
    assert "check_v12_retry_prohibition" in policies_src


def test_full_e2e_under_socket_lockdown(ready):
    """A complete replay chain must succeed with all sockets disabled."""
    real_socket = socket.socket

    class BlockedSocket(socket.socket):
        def __init__(self, *args, **kwargs):
            raise AssertionError("network access attempted during offline replay")

        def connect(self, *args, **kwargs):
            raise AssertionError("network access attempted during offline replay")

        def connect_ex(self, *args, **kwargs):
            raise AssertionError("network access attempted during offline replay")

    socket.socket = BlockedSocket  # type: ignore[misc]
    try:
        _analysis, proposal, approval_id = run_full_chain(ready, case_id="O12")
        replay = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)
        assert replay.status_code == 200, replay.text
        assert replay.json()["result"] == "REPLAYED"
        # duplicate refused, still under lockdown
        dup = ready.post(f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER)
        assert dup.status_code == 409
    finally:
        socket.socket = real_socket  # type: ignore[misc]


def test_health_reports_replay_mode_and_no_network(ready):
    health = ready.get("/api/v1/health").json()
    assert health["execution_mode"] == "REPLAY"
    assert health["network_access"] == "NONE"


def test_openapi_exportable(ready):
    r = ready.get("/openapi.json")
    assert r.status_code == 200
    schema = r.json()
    assert schema["info"]["title"].startswith("DisputePilot")
    paths = schema["paths"]
    for required in [
        "/api/v1/health",
        "/api/v1/cases",
        "/api/v1/cases/{case_id}",
        "/api/v1/cases/{case_id}/evidence",
        "/api/v1/cases/{case_id}/analyses",
        "/api/v1/cases/{case_id}/proposals",
        "/api/v1/proposals/{proposal_id}/submit",
        "/api/v1/approvals",
        "/api/v1/approvals/{approval_id}/decision",
        "/api/v1/approvals/{approval_id}/replay",
        "/api/v1/cases/{case_id}/audit",
    ]:
        assert required in paths, f"missing endpoint {required}"
