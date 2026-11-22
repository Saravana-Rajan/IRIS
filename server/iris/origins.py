"""Other origins whose pages may call this server from a browser: `IRIS_ALLOWED_ORIGINS`.

Iris serves its web app and API from one origin, and then this list is empty. When the web app is hosted elsewhere
(Firebase Hosting, built with `VITE_API_BASE` set to this server's URL), its pages call the API across origins. For
exactly the origins listed here:

- `app.py` answers CORS, with credentials, so the page can read the API's answers and send the owner cookie;
- `owner.py` sets that cookie `SameSite=None; Secure; Partitioned`, so it travels on those cross-site calls;
- `voice_live.same_origin` accepts the live voice socket from those pages.

The value is a comma-separated list of `scheme://host[:port]` origins (no path, no `*`); it is read on each call so a
test can set it. A malformed entry raises: a typo must not open the API to every site, nor silently close it.
"""
from __future__ import annotations

import os
import re
from functools import lru_cache

ENV = "IRIS_ALLOWED_ORIGINS"
_ORIGIN = re.compile(r"https?://[a-z0-9.-]+(?::\d{1,5})?")


@lru_cache(maxsize=8)
def _parse(raw: str) -> tuple[str, ...]:
    out: list[str] = []
    for item in raw.split(","):
        origin = item.strip().rstrip("/").lower()
        if not origin:
            continue
        if not _ORIGIN.fullmatch(origin):
            raise ValueError(f"{ENV}: {item.strip()!r} is not an origin like https://iris.web.app (no path, no '*')")
        if origin not in out:
            out.append(origin)
    return tuple(out)


def allowed() -> tuple[str, ...]:
    """The configured origins, lower case, without a trailing slash; empty when none are."""
    return _parse(os.environ.get(ENV, ""))


def allows(origin: str | None) -> bool:
    """Whether a request's `Origin` header names one of the configured origins."""
    return bool(origin) and origin.strip().rstrip("/").lower() in allowed()
