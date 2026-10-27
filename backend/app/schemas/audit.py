"""Audit API schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from ..domain.enums import ActorType


class AuditEventOut(BaseModel):
    event_id: str
    case_id: str
    event_type: str
    actor_type: ActorType
    actor_id: str
    payload: dict[str, Any]
    created_at: str


class AuditTimelineOut(BaseModel):
    case_id: str
    events: list[AuditEventOut]
    append_only: bool = True
