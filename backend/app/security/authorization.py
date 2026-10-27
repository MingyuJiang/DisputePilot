"""Security — demo role authorization.

DEMO ONLY: identities come from ``X-Actor-Id`` / ``X-Actor-Role`` request
headers. This is NOT production authentication; it exists to enforce the
role boundary (Specialist cannot approve; only MANAGER decisions count) and
to reserve the seam for a future real authenticator (OAuth2/session) behind
the same ``Authenticator`` protocol.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from fastapi import Depends, Header, HTTPException

from ..domain.enums import ActorRole


@dataclass(frozen=True)
class ActorContext:
    actor_id: str
    actor_role: ActorRole

    @property
    def actor_type(self) -> str:
        return "HUMAN" if self.actor_role in (ActorRole.SPECIALIST, ActorRole.MANAGER) else "SYSTEM"


class Authenticator(Protocol):
    """Future real auth plugs in here (same contract)."""

    def authenticate(self, actor_id: str | None, actor_role: str | None) -> ActorContext: ...


class DemoHeaderAuthenticator:
    """Header-based demo authenticator. No passwords, no tokens, no secrets."""

    def authenticate(self, actor_id: str | None, actor_role: str | None) -> ActorContext:
        if not actor_id:
            raise HTTPException(status_code=401, detail="missing X-Actor-Id (demo identity)")
        try:
            role = ActorRole(actor_role or "")
        except ValueError:
            raise HTTPException(
                status_code=403,
                detail=f"unknown actor role {actor_role!r}; expected one of "
                f"{[r.value for r in ActorRole]}",
            )
        return ActorContext(actor_id=actor_id, actor_role=role)


authenticator = DemoHeaderAuthenticator()

# OpenAPI header documentation (A-3): the demo identity headers must never be
# mistaken for production authentication.
ACTOR_ID_HEADER_DESCRIPTION = (
    "Demo identity header (non-production; NOT authentication). "
    "Production auth is a future port."
)
ACTOR_ROLE_HEADER_DESCRIPTION = (
    "Demo role header (non-production; NOT authentication). "
    "Production auth is a future port. One of SPECIALIST / MANAGER / SYSTEM."
)
IDEMPOTENCY_KEY_HEADER_DESCRIPTION = (
    "Optional idempotency key: repeating a POST with the same key returns the "
    "stored first response instead of re-executing."
)


def get_actor(
    x_actor_id: str | None = Header(default=None, description=ACTOR_ID_HEADER_DESCRIPTION),
    x_actor_role: str | None = Header(default=None, description=ACTOR_ROLE_HEADER_DESCRIPTION),
) -> ActorContext:
    return authenticator.authenticate(x_actor_id, x_actor_role)


def require_role(*roles: ActorRole):
    """Dependency: enforce that the caller holds one of ``roles``."""

    def checker(actor: ActorContext = Depends(get_actor)) -> ActorContext:
        if actor.actor_role not in roles:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"role {actor.actor_role.value} is not permitted here; "
                    f"required: {[r.value for r in roles]}"
                ),
            )
        return actor

    return checker
