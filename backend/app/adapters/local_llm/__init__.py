"""Local LLM adapter (Phase L2.3).

Layering (trust boundary — see research/local_llm/10_TRUST_BOUNDARY_AND_SCHEMA.md):

- ``transport``  — the ONLY module allowed to speak HTTP; loopback-only.
- ``schema``     — ``ModelAnalysisDraft``: the only shape a model may emit.
- ``prompt``     — system instructions vs. untrusted party text separation.
- ``grounding``  — deterministic two-level grounding (reference + verbatim span).
- ``provider``   — ``LocalLLMProvider``: orchestrates model -> draft -> trusted
  ``AIAnalysis``; safety fields are produced by code, never by the model.

Nothing in this package imports PayPal code, reads credentials, or reaches a
non-loopback host.
"""

from __future__ import annotations

from .config import LLMConfig
from .errors import LLMServiceError
from .provider import LocalLLMProvider

__all__ = ["LLMConfig", "LLMServiceError", "LocalLLMProvider"]
