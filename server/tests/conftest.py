import pytest

from iris import settings


#: Settings a developer's .env (read by `iris.model_client.load_env` on import) may hold. Tests start without them, so
#: they see the code's own defaults and can never reach a real model or project by accident.
_DEVELOPER_ENV = ("GEMINI_MODEL", "GEMINI_FAST_MODEL", "GEMINI_ESCALATION_MODEL", "GEMINI_IMAGE_MODEL",
                  "GEMINI_THINKING_LEVEL", "GEMINI_FAST_THINKING_LEVEL", "GEMINI_ESCALATION_THINKING_LEVEL",
                  "GEMINI_INCLUDE_THOUGHTS", "GEMINI_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION",
                  "GOOGLE_GENAI_USE_VERTEXAI", "IRIS_OWNER_TOKEN", "IRIS_ALLOWED_ORIGINS")


def _forget_developer_env() -> None:
    """At collection too: test modules read labels and ids at import time."""
    import os
    from pathlib import Path
    from iris import model_client
    for key in _DEVELOPER_ENV:
        os.environ.pop(key, None)
    model_client.load_env.__defaults__ = (Path("/nonexistent/iris-tests.env"),)


_forget_developer_env()


@pytest.fixture(autouse=True)
def no_developer_env(tmp_path, monkeypatch):
    from iris import model_client
    for key in _DEVELOPER_ENV:
        monkeypatch.delenv(key, raising=False)
    # `load_env` runs again on every model lookup; point its default file at an empty one so the .env stays out.
    monkeypatch.setattr(model_client.load_env, "__defaults__", (tmp_path / "no.env",))


@pytest.fixture(autouse=True)
def settings_store(tmp_path, monkeypatch):
    """Each test gets its own store for the settings for everyone (settings.py), never the developer's file."""
    monkeypatch.setenv("IRIS_SETTINGS_FILE", str(tmp_path / "settings.json"))
    settings.reset_cache()
    yield tmp_path / "settings.json"
    settings.reset_cache()
