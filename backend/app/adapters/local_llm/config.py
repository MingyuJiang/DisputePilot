"""Configuration for the local LLM provider.

Three provider modes exist: ``stub`` (default, fully deterministic, no
network), ``ollama_local`` (real inference against a loopback Ollama) and
``frozen`` (pre-recorded analyses replayed offline, no model). Anything else
is a configuration error and the app refuses to boot the provider.

Environment variables (all optional except the provider switch):

===========================  ===========================================  =================
DP_AI_PROVIDER               stub | ollama_local | frozen                   stub
DP_FROZEN_ANALYSES           frozen fixture path                          data/fixtures/OFFLINE_FROZEN_ANALYSES.json
DP_LLM_BASE_URL              loopback base URL                           http://127.0.0.1:11434
DP_LLM_MODEL                 Ollama model tag                            qwen3.6:35b-a3b-q4_K_M
DP_LLM_MODEL_DIGEST          expected model digest (audit only)          sha256:f5ee307a…
DP_LLM_CONTEXT_LENGTH        num_ctx                                     4096
DP_LLM_TEMPERATURE           sampling temperature                        0.0
DP_LLM_SEED                  sampling seed                               42
DP_LLM_MAX_TOKENS            num_predict (output cap)                    1800
DP_LLM_TIMEOUT_S             single-attempt request timeout              180
DP_LLM_RETRIES               automatic retries (0 = single attempt)      0
DP_LLM_PROMPT_VERSION        prompt version tag recorded in audit        dp-analysis-prompt-v1
DP_LLM_SCHEMA_VERSION        draft schema version tag                    model-analysis-draft-v1
===========================  ===========================================  =================

Retries stay at 0 by default: one analysis = one attempt, so a failure is
visible instead of being masked by a retry loop (V12 spirit).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from .errors import LLM_CONNECTION_ERROR, LLMServiceError
from .transport import assert_loopback_url

PROVIDER_STUB = "stub"
PROVIDER_OLLAMA_LOCAL = "ollama_local"
PROVIDER_FROZEN = "frozen"
SUPPORTED_PROVIDERS = (PROVIDER_STUB, PROVIDER_OLLAMA_LOCAL, PROVIDER_FROZEN)

FROZEN_MODEL_NAME = "frozen-analyses-v1"

DEFAULT_MODEL = "qwen3.6:35b-a3b-q4_K_M"
DEFAULT_MODEL_DIGEST = (
    "sha256:f5ee307a2982106a6eb82b62b2c00b575c9072145a759ae4660378acda8dcf2d"
)


def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return default if value is None or value.strip() == "" else value.strip()


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number, got {raw!r}") from exc


@dataclass(frozen=True)
class LLMConfig:
    provider: str = PROVIDER_STUB
    base_url: str = "http://127.0.0.1:11434"
    model: str = DEFAULT_MODEL
    model_digest: str = DEFAULT_MODEL_DIGEST
    context_length: int = 4096
    temperature: float = 0.0
    seed: int = 42
    max_output_tokens: int = 1800
    timeout_s: float = 180.0
    retries: int = 0
    prompt_version: str = "dp-analysis-prompt-v1"
    schema_version: str = "model-analysis-draft-v1"
    extra: dict = field(default_factory=dict)

    # ------------------------------------------------------------------ factory
    @classmethod
    def from_env(cls) -> "LLMConfig":
        provider = _env_str("DP_AI_PROVIDER", PROVIDER_STUB).lower()
        if provider not in SUPPORTED_PROVIDERS:
            raise ValueError(
                f"DP_AI_PROVIDER must be one of {SUPPORTED_PROVIDERS}, got {provider!r}"
            )
        config = cls(
            provider=provider,
            base_url=_env_str("DP_LLM_BASE_URL", "http://127.0.0.1:11434"),
            model=_env_str("DP_LLM_MODEL", DEFAULT_MODEL),
            model_digest=_env_str("DP_LLM_MODEL_DIGEST", DEFAULT_MODEL_DIGEST),
            context_length=_env_int("DP_LLM_CONTEXT_LENGTH", 4096),
            temperature=_env_float("DP_LLM_TEMPERATURE", 0.0),
            seed=_env_int("DP_LLM_SEED", 42),
            max_output_tokens=_env_int("DP_LLM_MAX_TOKENS", 1800),
            timeout_s=_env_float("DP_LLM_TIMEOUT_S", 180.0),
            retries=_env_int("DP_LLM_RETRIES", 0),
            prompt_version=_env_str("DP_LLM_PROMPT_VERSION", "dp-analysis-prompt-v1"),
            schema_version=_env_str("DP_LLM_SCHEMA_VERSION", "model-analysis-draft-v1"),
        )
        config.validate()
        return config

    # ----------------------------------------------------------------- validate
    def validate(self) -> "LLMConfig":
        if self.provider not in SUPPORTED_PROVIDERS:
            raise ValueError(
                f"provider must be one of {SUPPORTED_PROVIDERS}, got {self.provider!r}"
            )
        if self.provider == PROVIDER_OLLAMA_LOCAL:
            try:
                assert_loopback_url(self.base_url)
            except LLMServiceError as exc:
                raise LLMServiceError(
                    LLM_CONNECTION_ERROR,
                    f"invalid DP_LLM_BASE_URL: {exc}",
                    base_url=self.base_url,
                ) from exc
        if self.context_length < 512:
            raise ValueError("DP_LLM_CONTEXT_LENGTH must be >= 512")
        if self.max_output_tokens < 64:
            raise ValueError("DP_LLM_MAX_TOKENS must be >= 64")
        if self.timeout_s <= 0:
            raise ValueError("DP_LLM_TIMEOUT_S must be > 0")
        if self.retries < 0:
            raise ValueError("DP_LLM_RETRIES must be >= 0")
        if not (0.0 <= self.temperature <= 2.0):
            raise ValueError("DP_LLM_TEMPERATURE must be within [0, 2]")
        return self

    @property
    def is_local_llm(self) -> bool:
        return self.provider == PROVIDER_OLLAMA_LOCAL

    @property
    def is_frozen(self) -> bool:
        return self.provider == PROVIDER_FROZEN
