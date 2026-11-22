import json

import pytest
from fastapi.testclient import TestClient

from iris import app as app_module
from iris import model_client, owner, settings
from iris.model_client import GeminiModel

TOKEN = "t" * 40


def test_the_store_keeps_settings_across_a_restart(settings_store):
    settings.update({"built_views": True, "effort": "medium"})
    assert json.loads(settings_store.read_text())["effort"] == "medium"
    settings.reset_cache()  # a new process reads the file again
    assert settings.current() == settings.Settings(built_views=True, effort="medium", triage_effort=None)
    settings.update({"effort": None})  # back to the environment's default
    settings.reset_cache()
    assert settings.current().effort is None and settings.current().built_views is True


def test_unknown_values_are_refused():
    for bad in ({"effort": "extreme"}, {"built_views": "yes"}, {"caps": False}):
        with pytest.raises(ValueError):
            settings.update(bad)


def test_the_retired_open_weights_setting_is_ignored(settings_store):
    """Older pages still send it: it changes nothing and fails nothing, and a store that kept it reads cleanly."""
    assert settings.update({"open_weights": True, "effort": "high"}) == settings.Settings(effort="high")
    assert "open_weights" not in json.loads(settings_store.read_text())
    settings_store.write_text(json.dumps({"open_weights": True, "triage_effort": "low"}))
    settings.reset_cache()
    assert settings.current() == settings.Settings(triage_effort="low")
    assert "open_weights" not in owner.settings(json.dumps({"open_weights": True, "effort": "low"}))


def test_a_broken_store_falls_back_to_the_defaults(settings_store):
    settings_store.write_text("not json")
    assert settings.current() == settings.Settings()


def test_effort_is_the_owners_then_everyones_then_the_environments():
    model = GeminiModel("gemini-4-argon", thinking_level="low", client=object())
    assert model.effort == "low"
    settings.update({"effort": "medium", "triage_effort": "high"})
    assert model.effort == "medium"  # a visitor gets the setting for everyone
    tokens = owner.enter(True, json.dumps({"effort": "minimal"}))
    try:
        assert model.effort == "minimal"  # the owner's own wins for the owner
        model.role = "triage"
        assert model.effort == "high"  # the owner set no triage effort: everyone's
    finally:
        owner.leave(tokens)


def test_thinking_level_defaults_come_from_the_environment(monkeypatch):
    for name in ("GEMINI_THINKING_LEVEL", "GEMINI_FAST_THINKING_LEVEL", "GEMINI_ESCALATION_THINKING_LEVEL"):
        monkeypatch.delenv(name, raising=False)
    d = settings.defaults()
    assert (d["effort"], d["triage_effort"], d["escalation_effort"]) == ("low", None, "high")
    assert "open_weights" not in d
    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "medium")
    monkeypatch.setenv("GEMINI_FAST_THINKING_LEVEL", "minimal")
    monkeypatch.setenv("GEMINI_ESCALATION_THINKING_LEVEL", "medium")
    d = settings.defaults()
    assert (d["effort"], d["triage_effort"], d["escalation_effort"]) == ("medium", "minimal", "medium")


def test_triage_always_runs_on_the_fast_model(monkeypatch):
    monkeypatch.setattr(model_client, "load_env", lambda: None)
    monkeypatch.setenv("GEMINI_FAST_MODEL", "gemini-3.8-flash")
    model, info = model_client.triage_model()
    assert info == {"model": "gemini-3.8-flash", "label": "Gemini Flash", "images": True}
    assert model.model == "gemini-3.8-flash" and model.role == "triage"


def test_only_the_owner_reads_and_changes_the_settings_for_everyone(monkeypatch):
    monkeypatch.setattr(model_client, "load_env", lambda: None)
    monkeypatch.setenv("IRIS_OWNER_TOKEN", TOKEN)
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    c = TestClient(app_module.app, base_url="https://testserver")
    assert c.get("/api/settings").status_code == 403
    assert c.put("/api/settings", json={"triage_effort": "low"}).status_code == 403
    assert settings.current().triage_effort is None
    c.post("/api/owner/unlock", json={"token": TOKEN})
    r = c.put("/api/settings", json={"open_weights": True, "triage_effort": "low"})   # the retired key is ignored
    assert r.status_code == 200
    body = r.json()
    assert body["everyone"] == {"effort": None, "triage_effort": "low", "escalation": None,
                                "escalation_effort": None, "built_views": None} and body["configured"] is True
    assert "open_weights" not in body["defaults"] and "host" not in body
    assert c.put("/api/settings", json={"effort": "extreme"}).status_code == 400
    assert c.get("/api/settings").json()["everyone"]["triage_effort"] == "low"


def test_models_says_which_model_this_request_would_use(monkeypatch):
    monkeypatch.setattr(model_client, "load_env", lambda: None)
    monkeypatch.setenv("GEMINI_FAST_MODEL", "gemini-3.8-flash")
    c = TestClient(app_module.app, base_url="https://testserver")
    body = c.get("/api/models").json()
    assert body["triage"] == {"model": "gemini-3.8-flash", "label": "Gemini Flash", "images": True}
    assert body["labels"]["triage"] == "Gemini Flash"
    assert "open_weights" not in json.dumps(body)
