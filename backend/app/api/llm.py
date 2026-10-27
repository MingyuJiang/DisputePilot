"""Model-runtime status — hidden operational endpoint.

``GET /api/v1/llm/status`` answers one question for the demo operator: can the
configured AI provider produce an analysis right now?

- ``frozen``     -> always available (fixture replay; no model, no GPU);
- ``stub``       -> always available (deterministic, no model);
- ``ollama_local`` -> exactly ONE short loopback ping (no retries). A failure
  returns ``available=false`` with an explicit detail. It NEVER falls back to
  STUB, because a silent fallback would misrepresent the analysis provenance.

The route is ``include_in_schema=False`` so the frozen v1.3 contract stays
0-diff.
"""

from __future__ import annotations

import os

from fastapi import APIRouter

from ..adapters.frozen_ai import FrozenFixtureUnavailable, FrozenReplayProvider
from ..adapters.local_llm.config import (
    FROZEN_MODEL_NAME,
    PROVIDER_FROZEN,
    PROVIDER_OLLAMA_LOCAL,
    PROVIDER_STUB,
    LLMConfig,
)
from ..adapters.local_llm.errors import LLMServiceError
from ..adapters.local_llm.transport import check_ollama

router = APIRouter(prefix="/api/v1", tags=["llm"], include_in_schema=False)

# One short attempt; the status endpoint must answer quickly even when the
# runtime is down.
STATUS_PING_TIMEOUT_S = 1.0


def _payload(provider: str, available: bool, model: str, detail: str) -> dict:
    return {
        "provider": provider,
        "available": available,
        "model": model,
        "detail": detail,
    }


@router.get("/llm/status")
def llm_status() -> dict:
    try:
        config = LLMConfig.from_env()
    except ValueError as exc:
        return _payload(
            os.environ.get("DP_AI_PROVIDER", "invalid").strip() or "invalid",
            False,
            "",
            f"invalid configuration: {exc}",
        )

    if config.is_frozen:
        try:
            provider = FrozenReplayProvider()
        except FrozenFixtureUnavailable as exc:
            return _payload(
                PROVIDER_FROZEN,
                False,
                FROZEN_MODEL_NAME,
                f"frozen fixture unavailable: {exc}",
            )
        return _payload(
            PROVIDER_FROZEN,
            True,
            provider.model_name,
            "Frozen AI Output / Offline Replay — pre-recorded analyses; "
            "no model call, no network, no GPU",
        )

    if config.provider == PROVIDER_STUB:
        return _payload(
            PROVIDER_STUB,
            True,
            "evidence-planner-v1",
            "deterministic stub planner; no model call and no GPU required",
        )

    # ollama_local: one short ping, no retry, no fallback.
    try:
        check_ollama(config.base_url, timeout_s=STATUS_PING_TIMEOUT_S)
    except LLMServiceError as exc:
        return _payload(
            PROVIDER_OLLAMA_LOCAL,
            False,
            config.model,
            f"{exc.internal_code}: {exc} (no STUB fallback; analyses would "
            "return 503)",
        )
    return _payload(
        PROVIDER_OLLAMA_LOCAL,
        True,
        config.model,
        f"loopback Ollama reachable at {config.base_url} (single short ping)",
    )
