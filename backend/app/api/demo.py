"""Demo operations — hidden endpoints, outside the frozen contract surface."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header

from ..domain.enums import ActorRole
from ..security.authorization import (
    ACTOR_ID_HEADER_DESCRIPTION,
    ACTOR_ROLE_HEADER_DESCRIPTION,
    require_role,
)
from ..services.demo_reset_service import reset_offline_demo
from .deps import get_container

router = APIRouter(prefix="/api/v1", tags=["demo"], include_in_schema=False)


@router.post("/demo/reset")
def reset_demo(
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    x_actor_role: str | None = Header(default=None, description=ACTOR_ROLE_HEADER_DESCRIPTION),
    actor=Depends(require_role(ActorRole.SYSTEM)),
    container=Depends(get_container),
) -> dict:
    """Restore the offline demo DB from its golden snapshot. SYSTEM only."""
    return reset_offline_demo(container.state_store)
