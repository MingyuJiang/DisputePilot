"""Offline demo captures — a SYNTHETIC fixture, never a PayPal response.

The OFFLINE_REPLAY demo drafts a refund against ``DEMO-CAP-9001`` / capture
``DEMO-CAP-9001``, which does not exist at PayPal. A sandbox GET for such an id
is both pointless and a network call, and the offline demo must issue none.

Resolution rule (enforced by the service, not here):

- REPLAY mode + capture present in the fixture -> parse the fixture locally;
- REPLAY mode + unknown demo id -> explicit NOT_FOUND (404);
- REPLAY mode + unreadable fixture -> explicit UNAVAILABLE (503);
- LIVE mode -> this module is not consulted at all.

The file is read on demand (no cache, no HTTP client). ``_meta.source`` marks
the data as synthetic so nothing downstream can mistake it for an observation.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SYNTHETIC_SOURCE = "SYNTHETIC_OFFLINE_FIXTURE"
DEMO_CAPTURE_PREFIX = "DEMO-"


class OfflineCaptureFixtureError(Exception):
    """The fixture file is missing, unreadable or malformed (explicit 503)."""


def is_offline_demo_capture(capture_id: str) -> bool:
    """Demo ids are offline-only by construction (never asked of PayPal)."""
    return str(capture_id or "").strip().upper().startswith(DEMO_CAPTURE_PREFIX)


class OfflineCaptureFixture:
    """The parsed ``captures{}`` map plus its ``_meta`` block."""

    def __init__(self, path: str, meta: dict[str, Any], captures: dict[str, dict]) -> None:
        self.path = path
        self.meta = meta
        self.captures = captures

    @property
    def source(self) -> str:
        return str(self.meta.get("source") or "")

    @classmethod
    def load(cls, path: str | Path) -> "OfflineCaptureFixture":
        try:
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
        except OSError as exc:
            raise OfflineCaptureFixtureError(
                f"offline demo capture fixture {str(path)!r} is unreadable "
                f"({type(exc).__name__})"
            ) from None
        except ValueError:
            raise OfflineCaptureFixtureError(
                f"offline demo capture fixture {str(path)!r} is not valid JSON"
            ) from None

        if not isinstance(raw, dict) or not isinstance(raw.get("captures"), dict):
            raise OfflineCaptureFixtureError(
                f"offline demo capture fixture {str(path)!r} has no captures object"
            )
        meta = raw.get("_meta") if isinstance(raw.get("_meta"), dict) else {}
        captures = {
            str(key).strip(): value
            for key, value in raw["captures"].items()
            if isinstance(value, dict)
        }
        return cls(str(path), meta, captures)

    def get(self, capture_id: str) -> dict[str, Any] | None:
        return self.captures.get(str(capture_id or "").strip())
