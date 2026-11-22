"""Settings for everyone: what visitors' requests use, set by the owner (owner.py) and kept across restarts.

- `effort` / `triage_effort`: the Gemini thinking level for the main model (proposals, chat) and for the fast model
  (clash titles, triage).
- `escalation`: whether a clash the main model could not fix (or fixed with a resize or an opening) may be handed to
  the escalation model for a second, longer try: "off", "button" (offered, the default) or "auto" (a failed proposal
  goes on to the second try at once). `escalation_effort`: the second try's thinking level (high by default).
  Docs: docs/escalation.md.
- `built_views`: whether "Show it built" is offered (the image model restyling Iris's view of a fix, checked by the
  escalation model; docs/show-it-built.md) and drawn for every accepted fix's report page. It costs per picture, so it
  is off unless switched on.

None means "the environment's default" (`defaults()`). The owner's own settings, sent with their requests, win over
these for the owner (owner.py); these win over the environment for everyone else.

Stored in a JSON file (`IRIS_SETTINGS_FILE`; on Cloud Run point it at the Cloud Storage mount so it survives restarts
and redeploys). A store that cannot be read or written is logged and the value in memory is used: a setting never fails
a request.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import asdict, dataclass
from pathlib import Path

log = logging.getLogger(__name__)

EFFORTS = ("minimal", "low", "medium", "high")
ESCALATION = ("off", "button", "auto")
RETIRED = ("open_weights",)   # settings there no longer are: ignored when sent, dropped when read


@dataclass
class Settings:
    effort: str | None = None
    triage_effort: str | None = None
    escalation: str | None = None
    escalation_effort: str | None = None
    built_views: bool | None = None


_lock = threading.Lock()
_current: Settings | None = None


def _file() -> Path:
    return Path(os.environ.get("IRIS_SETTINGS_FILE", Path(__file__).resolve().parents[1] / ".iris-settings.json"))


def _clean(raw: object) -> Settings:
    raw = raw if isinstance(raw, dict) else {}
    return Settings(effort=raw.get("effort") if raw.get("effort") in EFFORTS else None,
                    triage_effort=raw.get("triage_effort") if raw.get("triage_effort") in EFFORTS else None,
                    escalation=raw.get("escalation") if raw.get("escalation") in ESCALATION else None,
                    escalation_effort=raw.get("escalation_effort") if raw.get("escalation_effort") in EFFORTS else None,
                    built_views=raw.get("built_views") if isinstance(raw.get("built_views"), bool) else None)


def _load() -> Settings:
    try:
        f = _file()
        return _clean(json.loads(f.read_text())) if f.exists() else Settings()
    except Exception as e:  # the defaults are better than a failed request
        log.warning("settings: could not read the store (%s: %s); using defaults", type(e).__name__, e)
        return Settings()


def _save(s: Settings) -> None:
    try:
        _file().write_text(json.dumps(asdict(s), indent=2))
    except Exception as e:
        log.warning("settings: could not write the store (%s: %s); kept in memory", type(e).__name__, e)


def current() -> Settings:
    global _current
    with _lock:
        if _current is None:
            _current = _load()
        return _current


def update(changes: dict) -> Settings:
    """Change some settings (a key set to None goes back to the default). Raises ValueError on an unknown value.
    `open_weights`, a setting there no longer is, is ignored (older pages still send it)."""
    global _current
    changes = {k: v for k, v in changes.items() if k not in RETIRED}
    for k, v in changes.items():
        if k not in ("effort", "triage_effort", "escalation", "escalation_effort", "built_views"):
            raise ValueError(f"unknown setting {k!r}")
        if k == "built_views" and v is not None and not isinstance(v, bool):
            raise ValueError(f"{k} is true, false or null")
        if k == "escalation" and v is not None and v not in ESCALATION:
            raise ValueError(f"escalation is one of {', '.join(ESCALATION)}, or null")
        if k not in ("escalation", "built_views") and v is not None and v not in EFFORTS:
            raise ValueError(f"{k} is one of {', '.join(EFFORTS)}, or null")
    s = current()
    with _lock:
        _current = Settings(**{**asdict(s), **changes})
        _save(_current)
        return _current


def reset_cache() -> None:
    """Read the store again on next use (tests)."""
    global _current
    with _lock:
        _current = None


def defaults() -> dict:
    """What the environment gives when a setting is not set."""
    mode = os.environ.get("IRIS_ESCALATION", "button")
    return {"effort": os.environ.get("GEMINI_THINKING_LEVEL", "low") or None,
            "triage_effort": os.environ.get("GEMINI_FAST_THINKING_LEVEL") or None,
            "escalation": mode if mode in ESCALATION else "button",
            "escalation_effort": os.environ.get("GEMINI_ESCALATION_THINKING_LEVEL", "high") or None,
            "built_views": os.environ.get("IRIS_BUILT_VIEWS", "0") == "1"}


def effort_for(role: str) -> str | None:
    """The effort set for everyone for a model role ("triage", "escalation" or anything else), else None."""
    s = current()
    return {"triage": s.triage_effort, "escalation": s.escalation_effort}.get(role, s.effort)


def built_views() -> bool:
    """Whether this request gets Show it built: the owner's own choice, else everyone's, else the default (off)."""
    from . import owner
    mine = owner.built_views()
    if mine is not None:
        return mine
    s = current()
    return s.built_views if s.built_views is not None else defaults()["built_views"]


def escalation() -> str:
    """Whether this request may hand a clash to the escalation model for a second try: the owner's own choice, else everyone's, else the
    default ("button")."""
    from . import owner
    mine = owner.escalation()
    if mine is not None:
        return mine
    s = current()
    return s.escalation if s.escalation is not None else defaults()["escalation"]

