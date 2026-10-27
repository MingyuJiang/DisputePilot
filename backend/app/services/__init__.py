"""Services — application layer (use-case orchestration, transaction boundaries)."""

from __future__ import annotations

from dataclasses import dataclass

from ..adapters.ai_provider import AIProvider
from ..adapters.case_state import CaseStateStore
from ..adapters.replay_gateway import ReplayExecutionGateway
from ..infrastructure.settings import settings


@dataclass
class ServiceContext:
    """Shared ports + settings handed to every service."""

    state_store: CaseStateStore
    ai_provider: AIProvider
    gateway: ReplayExecutionGateway
    policy_version: str = settings.policy_version
