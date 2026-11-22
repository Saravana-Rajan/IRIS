"""model_client: Gemini through google-genai, with the SDK client mocked (no network)."""
import base64
import json
from types import SimpleNamespace as NS

import pytest

from iris import model_client
from iris.model_client import GeminiModel


def _part(text=None, thought=False, function_call=None, thought_signature=None, inline_data=None):
    return NS(text=text, thought=thought, function_call=function_call, thought_signature=thought_signature,
              inline_data=inline_data)


def _response(*parts, usage=None):
    return NS(candidates=[NS(content=NS(parts=list(parts)))],
              usage_metadata=usage or NS(prompt_token_count=1000, candidates_token_count=200, thoughts_token_count=300))


class FakeModels:
    def __init__(self, reply=None, stream=None):
        self.reply, self.stream, self.calls = reply, stream, []

    def generate_content(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config})
        return self.reply

    def generate_content_stream(self, *, model, contents, config):
        self.calls.append({"model": model, "contents": contents, "config": config, "stream": True})
        return iter(self.stream)


def _model(models, **kw):
    return GeminiModel(model="gemini-4-argon", timeout_s=30, client=NS(models=models), **kw)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for var in ("GEMINI_MODEL", "GEMINI_FAST_MODEL", "GEMINI_ESCALATION_MODEL", "GEMINI_IMAGE_MODEL",
                "GEMINI_THINKING_LEVEL", "IRIS_MODEL_PRICES", "IRIS_MODEL_LABELS", "GEMINI_INCLUDE_THOUGHTS"):
        monkeypatch.delenv(var, raising=False)


def test_complete_json_sends_system_images_schema_and_thinking(tmp_path):
    png = tmp_path / "a.png"
    png.write_bytes(b"\x89PNG fake")
    models = FakeModels(_response(_part('```json\n{"ok": true}\n```')))
    m = _model(models, thinking_level="medium")
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}}
    assert m.complete_json("sys", "text", [png], schema) == {"ok": True}
    call = models.calls[0]
    cfg = call["config"]
    assert call["model"] == "gemini-4-argon"
    assert cfg.system_instruction == "sys" and cfg.response_mime_type == "application/json"
    assert cfg.response_json_schema == schema
    assert cfg.thinking_config.thinking_level.value == "MEDIUM"
    assert cfg.http_options.timeout == 30_000
    parts = call["contents"][0].parts
    assert parts[0].text == "text" and parts[1].inline_data.data == b"\x89PNG fake"
    assert parts[1].inline_data.mime_type == "image/png"


def test_usage_and_cost_count_thinking_as_output():
    models = FakeModels(_response(_part("{}")))
    m = _model(models)
    seen = []
    m.on_cost = seen.append
    m.complete_json("s", "t")
    assert m.usage.snapshot() == (1, 1000, 500, 300)
    assert seen == [pytest.approx(1000 * 2 / 1e6 + 500 * 10 / 1e6)]
    assert m.usage.as_dict("gemini-4-argon")["usd"] == round(0.002 + 0.005, 4)


def test_prices_and_labels_can_be_overridden(monkeypatch):
    assert model_client.cost("unknown-model", 1000, 1000) == 0
    monkeypatch.setenv("IRIS_MODEL_PRICES", json.dumps({"my-model": [1, 2]}))
    assert model_client.cost("my-model-v2", 1_000_000, 1_000_000) == pytest.approx(3)
    assert model_client.model_label("gemini-4-argon") == "Gemini Pro"
    assert model_client.model_label("gemini-3.8-flash") == "Gemini Flash"
    assert model_client.model_label("gemini-3.5-flash-lite") == "Gemini Flash-Lite"
    assert model_client.model_label("gemini-3.1-flash-image") == "Gemini Image"
    monkeypatch.setenv("IRIS_MODEL_LABELS", json.dumps({"gemini-3.8": "Fast one"}))
    assert model_client.model_label("gemini-3.8-flash") == "Fast one"


def test_model_ids_come_from_env(monkeypatch):
    assert model_client.model_id("proposal") == model_client.DEFAULT_MODELS["proposal"][1]
    monkeypatch.setenv("GEMINI_FAST_MODEL", "gemini-x-flash")
    assert model_client.model_id("fast") == model_client.model_id("voice") == "gemini-x-flash"
    model, info = model_client.triage_model()
    assert model.model == "gemini-x-flash" and model.role == "triage" and info["label"] == "Gemini Flash"


def test_reasoning_stream_passes_thoughts_then_parses_the_json():
    chunks = [NS(candidates=[NS(content=NS(parts=[_part("Weighing the opening. ", thought=True)]))], usage_metadata=None),
              NS(candidates=[NS(content=NS(parts=[_part('{"candidates": ')]))], usage_metadata=None),
              NS(candidates=[NS(content=NS(parts=[_part("[]}")]))],
                 usage_metadata=NS(prompt_token_count=10, candidates_token_count=5, thoughts_token_count=2))]
    models = FakeModels(stream=chunks)
    m = _model(models, thinking_level="low")
    notes = []
    assert m.complete_json_reasoning("sys", "text", None, None, notes.append) == {"candidates": []}
    assert notes == ["Weighing the opening."]
    assert models.calls[0]["config"].thinking_config.include_thoughts is True
    assert m.usage.snapshot() == (1, 10, 7, 2)


def test_reasoning_falls_back_when_switched_off_or_empty(monkeypatch):
    models = FakeModels(_response(_part('{"ok": 1}')), stream=[])
    m = _model(models)
    assert m.complete_json_reasoning("s", "t", None, None, lambda n: None) == {"ok": 1}   # empty stream → plain call
    monkeypatch.setenv("GEMINI_INCLUDE_THOUGHTS", "0")
    assert _model(FakeModels(_response(_part("{}")))).streams_reasoning is False


def test_chat_translates_messages_tools_and_thought_signatures():
    fc = NS(id=None, name="move", args={"dz": 0.4})
    models = FakeModels(_response(_part("Moving it."), _part(function_call=fc, thought_signature=b"sig")))
    m = _model(models)
    tools = [{"type": "function", "function": {"name": "move", "description": "Move it",
                                               "parameters": {"type": "object", "properties": {"dz": {"type": "number"}}}}}]
    history = [{"role": "system", "content": "be brief"},
               {"role": "user", "content": [{"type": "text", "text": "fix it"},
                                            {"type": "image_url", "image_url": {"url": "data:image/png;base64,"
                                                                                + base64.b64encode(b"img").decode()}}]}]
    reply = m.chat(history, tools, timeout_s=5)
    assert reply["content"] == "Moving it."
    call = reply["tool_calls"][0]
    assert call["function"]["name"] == "move" and json.loads(call["function"]["arguments"]) == {"dz": 0.4}
    cfg = models.calls[0]["config"]
    assert cfg.system_instruction == "be brief" and cfg.http_options.timeout == 5000
    assert cfg.tools[0].function_declarations[0].name == "move"
    assert models.calls[0]["contents"][0].parts[1].inline_data.data == b"img"

    # The next turn hands the call back with its signature, and the tool result as a function response.
    history += [reply, {"role": "tool", "tool_call_id": call["id"], "content": json.dumps({"ok": True})}]
    system, contents = model_client.to_contents(history)
    assert system == "be brief"
    model_turn = contents[1]
    assert model_turn.role == "model" and model_turn.parts[1].thought_signature == b"sig"
    assert contents[2].parts[0].function_response.name == "move"
    assert contents[2].parts[0].function_response.response == {"ok": True}


def test_transcribe_sends_audio_and_vocabulary():
    models = FakeModels(_response(_part(" Raise the duct by 400. ")))
    wav = model_client.pcm_to_wav(b"\x00\x00" * 16_000)
    out = model_client.transcribe(wav, ["transom"], client=NS(models=models))
    assert out == {"transcript": "Raise the duct by 400.", "duration_ms": 1000}
    parts = models.calls[0]["contents"][0].parts
    assert "transom" in parts[0].text and parts[1].inline_data.mime_type == "audio/wav"
    assert models.calls[0]["model"] == model_client.model_id("voice")


def test_generate_image_returns_the_picture_or_raises():
    pic = _part(inline_data=NS(data=b"PNGDATA", mime_type="image/png"))
    models = FakeModels(_response(_part("here"), pic))
    assert model_client.generate_image("restyle", [b"a", b"b"], client=NS(models=models)) == b"PNGDATA"
    assert models.calls[0]["config"].response_modalities == ["IMAGE"]
    with pytest.raises(RuntimeError):
        model_client.generate_image("restyle", [], client=NS(models=FakeModels(_response(_part("no")))))


def test_client_backend_choice(monkeypatch):
    made = []

    class FakeClient:
        def __init__(self, **kw):
            made.append(kw)

    import google.genai
    monkeypatch.setattr(google.genai, "Client", FakeClient)
    monkeypatch.setattr(model_client, "_clients", {})
    monkeypatch.setattr(model_client, "load_env", lambda *a, **k: None)
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert model_client.configured() is False
    with pytest.raises(RuntimeError):
        model_client.make_client()
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    model_client.make_client()
    assert made[-1] == {"api_key": "k"}
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "proj")
    monkeypatch.delenv("GOOGLE_CLOUD_LOCATION", raising=False)
    model_client.make_client()
    assert made[-1] == {"vertexai": True, "project": "proj", "location": "global"}
