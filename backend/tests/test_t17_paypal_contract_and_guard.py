"""T17 — contract freeze, 409 write protection, exemption scope, secret leaks."""

from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

from app.infrastructure.settings import settings
from tests.conftest import MANAGER, SPECIALIST
from tests.paypal_helpers import SENTINEL_CLIENT_ID, SENTINEL_SECRET

APP_DIR = Path(__file__).resolve().parents[1] / "app"
CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts" / "v1"
FROZEN_OPENAPI = CONTRACTS_DIR / "openapi.v1.yaml"


def _approved_proposal(client, case_id: str = "O4"):
    r = client.post(f"/api/v1/cases/{case_id}/analyses", headers=SPECIALIST)
    assert r.status_code == 200, r.text
    r = client.post(f"/api/v1/cases/{case_id}/proposals/generate", headers=SPECIALIST)
    assert r.status_code == 200, r.text
    proposal = r.json()[0]
    r = client.post(f"/api/v1/proposals/{proposal['proposal_id']}/submit", headers=SPECIALIST)
    assert r.status_code == 200, r.text
    approval_id = r.json()["approval"]["approval_id"]
    r = client.post(
        f"/api/v1/approvals/{approval_id}/decision",
        headers=MANAGER,
        json={"decision": "APPROVED", "reason": "sandbox guard test"},
    )
    assert r.status_code == 200, r.text
    return proposal, approval_id


def test_runtime_openapi_matches_frozen_contract_exactly():
    from app.main import create_app

    runtime = create_app().openapi()
    frozen = yaml.safe_load(FROZEN_OPENAPI.read_text(encoding="utf-8"))

    assert json.dumps(runtime["paths"], sort_keys=True) == json.dumps(
        frozen["paths"], sort_keys=True
    )
    assert json.dumps(runtime["components"]["schemas"], sort_keys=True) == json.dumps(
        frozen["components"]["schemas"], sort_keys=True
    )


def test_execution_result_enum_is_v1_2():
    """v1.2 adds PENDING and nothing else (additive, no value removed)."""
    frozen = yaml.safe_load(FROZEN_OPENAPI.read_text(encoding="utf-8"))
    values = frozen["components"]["schemas"]["ExecutionResult"]["enum"]
    assert values == [
        "REPLAYED",
        "BLOCKED",
        "FAILED",
        "EXECUTED",
        "UNVERIFIED",
        "PENDING",
    ]


def test_frozen_contract_is_v1_3():
    frozen = yaml.safe_load(FROZEN_OPENAPI.read_text(encoding="utf-8"))
    assert frozen["info"]["version"] == "1.3.0"


def test_analysis_mode_enum_is_v1_3():
    """v1.3 adds FROZEN_REPLAY and nothing else (additive)."""
    frozen = yaml.safe_load(FROZEN_OPENAPI.read_text(encoding="utf-8"))
    values = frozen["components"]["schemas"]["AnalysisMode"]["enum"]
    assert values == ["STUB_DETERMINISTIC", "LLM", "FROZEN_REPLAY"]
    # action_family is optional in both directions (backwards compatible).
    for schema in ("ProposalCreate", "ProposalOut"):
        field = frozen["components"]["schemas"][schema]["properties"]["action_family"]
        assert field["enum"] == ["DISPUTE", "PAYMENT"]
        assert field["default"] == "DISPUTE"
        assert "action_family" not in frozen["components"]["schemas"][schema]["required"]


def test_contract_manifest_hashes_match_v1_1_files():
    """MANIFEST.sha256 is the freeze anchor: every listed file must match."""
    manifest = (CONTRACTS_DIR / "MANIFEST.sha256").read_text(encoding="utf-8")
    entries = [line for line in manifest.splitlines() if line.strip()]
    assert entries, "manifest is empty"
    for line in entries:
        digest, name = line.split(" *", 1)
        payload = (CONTRACTS_DIR / name).read_bytes()
        assert hashlib.sha256(payload).hexdigest() == digest, name


def test_sandbox_replay_is_refused_with_409_and_no_record(ready, monkeypatch):
    proposal, approval_id = _approved_proposal(ready)
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")

    response = ready.post(
        f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
    )
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "CONFLICT"
    assert "DP_PAYPAL_WRITES_ENABLED=1" in error["message"]
    assert "DP_PAYPAL_WRITE_ALLOW" in error["message"]
    assert "contract" not in error["message"].lower()

    execution = ready.get(f"/api/v1/proposals/{proposal['proposal_id']}/execution")
    assert execution.status_code == 404


def test_writes_flag_needs_a_matching_allow_entry_before_any_network(ready, monkeypatch):
    """Flag + credentials are not enough: the exact dispute:action pair must be
    allow-listed. Refusal happens before the gateway (and any socket) is built.
    """
    _proposal, approval_id = _approved_proposal(ready)
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", SENTINEL_CLIENT_ID)
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", SENTINEL_SECRET)
    monkeypatch.setenv("DP_PAYPAL_WRITES_ENABLED", "1")
    # Offline case O4 has dispute_id UNKNOWN (sanitized) → no matching entry.
    monkeypatch.setenv("DP_PAYPAL_WRITE_ALLOW", "O4:provide-evidence")

    response = ready.post(
        f"/api/v1/approvals/{approval_id}/replay", headers=MANAGER
    )
    assert response.status_code == 409
    message = response.json()["error"]["message"]
    assert "DP_PAYPAL_WRITE_ALLOW" in message
    assert "no request was issued" in message
    execution = ready.get(f"/api/v1/proposals/{_proposal['proposal_id']}/execution")
    assert execution.status_code == 404


def test_httpx_importer_is_exactly_one_paypal_module():
    importers = []
    for path in (APP_DIR / "adapters" / "paypal").glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import) and any(
                alias.name.split(".")[0] == "httpx" for alias in node.names
            ):
                importers.append(path.name)
            elif isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] == "httpx":
                importers.append(path.name)
    assert importers == ["client.py"]


def test_health_error_note_never_leaks_credentials(app, monkeypatch):
    monkeypatch.setenv("DP_DATA_MODE", "paypal_sandbox")
    monkeypatch.setenv("DP_PAYPAL_CLIENT_ID", SENTINEL_CLIENT_ID)
    monkeypatch.setenv("DP_PAYPAL_CLIENT_SECRET", SENTINEL_SECRET)
    settings.paypal_last_error = "AUTH: credentials rejected by PayPal (http_status=401)"
    settings.paypal_last_read_at = ""
    try:
        with TestClient(app) as client:
            body = client.get("/api/v1/health").json()
    finally:
        settings.paypal_last_error = ""
    serialized = json.dumps(body, sort_keys=True)
    assert body["network_access"] == "PAYPAL_SANDBOX_READ_ONLY"
    assert "last_error=AUTH" in body["note"]
    assert SENTINEL_CLIENT_ID not in serialized
    assert SENTINEL_SECRET not in serialized
