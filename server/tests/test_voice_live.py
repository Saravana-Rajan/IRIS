"""Live voice (voice_live.py): the browser's microphone buffered by Iris and transcribed by the voice model, against a
fake `model_client.transcribe` (no network). A small app here mounts the relay the way app.py does, so the protocol is
tested on its own."""
import array
import json
import threading

import pytest
from starlette.applications import Starlette
from starlette.routing import WebSocketRoute
from starlette.testclient import TestClient
from starlette.websockets import WebSocket, WebSocketDisconnect

from iris import model_client, voice_live

LOUD = array.array("h", [3000, -3000] * 640).tobytes()  # 80 ms of speech-loud 16 kHz audio
QUIET = b"\x00\x00" * 1280  # 80 ms of silence
MAX_S = 60


async def socket_route(socket: WebSocket):
    if not voice_live.same_origin(socket.headers):
        await socket.close(code=1008)
        return
    await socket.accept()
    first = await socket.receive_json()
    hands_free = first.get("mode") == "hands_free"
    await voice_live.relay(socket, voice_live.MODES["hands_free" if hands_free else "hold"], ["transom", "Clash7"],
                           app.state.max_s)


app = Starlette(routes=[WebSocketRoute("/voice", socket_route)])


@pytest.fixture
def heard(monkeypatch):
    """The clips the voice model was sent (WAV bytes, keywords); it answers "sentence N"."""
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    calls, lock = [], threading.Lock()

    def transcribe(wav, keywords=None, client=None):
        with lock:
            calls.append((wav, keywords))
            n = len(calls)
        return {"transcript": f" sentence {n} ", "duration_ms": model_client.wav_duration_ms(wav)}

    monkeypatch.setattr(model_client, "transcribe", transcribe)
    app.state.max_s = MAX_S
    return calls


def _events(sock):
    """Everything the server says until it closes the socket."""
    out = []
    try:
        while True:
            out.append(sock.receive_json())
    except WebSocketDisconnect:
        return out


def _open(sock, mode):
    sock.send_json({"mode": mode, "report_id": "r-1"})
    assert sock.receive_json() == {"type": "ready", "max_s": app.state.max_s}


def test_hold_to_talk_transcribes_the_whole_clip_once_on_release(heard):
    with TestClient(app).websocket_connect("/voice") as sock:
        _open(sock, "hold")
        for frame in (LOUD, QUIET, LOUD):
            sock.send_bytes(frame)
        sock.send_json({"type": "end"})
        assert _events(sock) == [{"type": "final", "text": "sentence 1"}]
    assert len(heard) == 1
    wav, keywords = heard[0]
    assert wav == model_client.pcm_to_wav(LOUD + QUIET + LOUD) and keywords == ["transom", "Clash7"]


def test_hold_with_no_audio_sends_an_empty_final_without_calling_the_model(heard):
    with TestClient(app).websocket_connect("/voice") as sock:
        _open(sock, "hold")
        sock.send_json({"type": "end"})
        assert _events(sock) == [{"type": "final", "text": ""}]
    assert heard == []


def test_hands_free_sends_each_sentence_when_the_speaker_pauses(heard):
    with TestClient(app).websocket_connect("/voice") as sock:
        _open(sock, "hands_free")
        for frame in [QUIET] * 3 + [LOUD] * 5 + [QUIET] * 10 + [LOUD] * 4:  # a sentence, a pause, half a sentence
            sock.send_bytes(frame)
        sock.send_json({"type": "end"})
        events = _events(sock)
    assert events == [{"type": "speech", "on": True}, {"type": "speech", "on": False},
                      {"type": "final", "text": "sentence 1", "turn": 0},
                      {"type": "speech", "on": True}, {"type": "speech", "on": False},
                      {"type": "final", "text": "sentence 2", "turn": 1}]
    first = heard[0][0]
    assert model_client.wav_duration_ms(first) >= 400 + 700  # the speech, the pause that ended it, and some pre-roll


def test_hands_free_ignores_a_click_too_short_to_be_speech(heard):
    with TestClient(app).websocket_connect("/voice") as sock:
        _open(sock, "hands_free")
        for frame in [LOUD] + [QUIET] * 10:  # 80 ms of noise
            sock.send_bytes(frame)
        sock.send_json({"type": "end"})
        assert _events(sock) == [{"type": "speech", "on": True}, {"type": "speech", "on": False}]
    assert heard == []


def test_the_time_limit_ends_the_session_and_transcribes_what_was_said(heard):
    app.state.max_s = 0.1  # 3,200 bytes: the second frame reaches it
    with TestClient(app).websocket_connect("/voice") as sock:
        _open(sock, "hold")
        sock.send_bytes(LOUD)
        sock.send_bytes(LOUD)
        assert _events(sock) == [{"type": "limit"}, {"type": "final", "text": "sentence 1"}]


def test_the_limit_flushes_a_hands_free_sentence_in_progress(heard):
    app.state.max_s = 0.4
    with TestClient(app).websocket_connect("/voice") as sock:
        _open(sock, "hands_free")
        for _ in range(5):
            sock.send_bytes(LOUD)
        assert _events(sock) == [{"type": "speech", "on": True}, {"type": "limit"}, {"type": "speech", "on": False},
                                 {"type": "final", "text": "sentence 1", "turn": 0}]


@pytest.mark.parametrize("frame", [b"\0" * 40_000, b"\0" * 2561])
def test_what_is_not_microphone_audio_is_refused(heard, frame):
    with TestClient(app).websocket_connect("/voice") as sock:
        _open(sock, "hold")
        sock.send_bytes(frame)
        assert _events(sock) == [{"type": "error", "detail": "That isn't 16 kHz microphone audio."}]
    assert heard == []


def test_a_failed_transcription_is_said_in_words_naming_the_model(heard, monkeypatch):
    def broken(wav, keywords=None, client=None):
        raise RuntimeError("secret request details")
    monkeypatch.setattr(model_client, "transcribe", broken)
    with TestClient(app).websocket_connect("/voice") as sock:
        _open(sock, "hold")
        sock.send_bytes(LOUD)
        sock.send_json({"type": "end"})
        events = _events(sock)
    label = model_client.model_label(model_client.model_id("voice"))
    assert events == [{"type": "error", "detail": f"Couldn't transcribe with {label} (RuntimeError). Try again."}]
    assert "secret" not in json.dumps(events)


def test_no_model_configured_says_so_and_closes(heard, monkeypatch):
    monkeypatch.setattr(model_client, "configured", lambda: False)
    with TestClient(app).websocket_connect("/voice") as sock:
        sock.send_json({"mode": "hold"})
        events = _events(sock)
    assert len(events) == 1 and events[0]["type"] == "error"
    assert model_client.model_label(model_client.model_id("voice")) in events[0]["detail"]


def test_another_site_cannot_open_the_relay(heard):
    c = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as refused:
        with c.websocket_connect("/voice", headers={"origin": "https://elsewhere.example"}):
            pass
    assert refused.value.code == 1008
    with c.websocket_connect("/voice", headers={"origin": "http://testserver"}) as sock:  # same origin
        _open(sock, "hold")
        sock.send_json({"type": "end"})
        _events(sock)
    assert voice_live.same_origin({"host": "iris.example"})  # no Origin: not a browser


def test_the_web_app_on_another_origin_may_open_the_relay(heard, monkeypatch):
    """The web app on Firebase Hosting talks to the server on Cloud Run: its origin is let in (IRIS_ALLOWED_ORIGINS)."""
    site, run = "https://iris-test.web.app", "iris-1.asia-south1.run.app"
    monkeypatch.delenv("IRIS_ALLOWED_ORIGINS", raising=False)
    assert not voice_live.same_origin({"origin": site, "host": run})
    monkeypatch.setenv("IRIS_ALLOWED_ORIGINS", f"{site},https://iris-test.firebaseapp.com")
    assert voice_live.same_origin({"origin": site, "host": run})
    assert voice_live.same_origin({"origin": f"https://{run}", "host": run})  # the page Cloud Run serves itself
    assert not voice_live.same_origin({"origin": "https://elsewhere.example", "host": run})
    with TestClient(app).websocket_connect("/voice", headers={"origin": site}) as sock:
        _open(sock, "hold")
        sock.send_json({"type": "end"})
        _events(sock)


def test_the_page_leaving_ends_the_session_without_transcribing(heard):
    with TestClient(app).websocket_connect("/voice") as sock:
        _open(sock, "hold")
        sock.send_bytes(LOUD)
    assert heard == []


def test_loudness():
    assert voice_live.rms(QUIET) == 0 and voice_live.rms(LOUD) == pytest.approx(3000)


def test_the_app_route_runs_the_relay_and_a_session_counts_once_against_the_voice_cap(heard, monkeypatch):
    from iris import app as app_module
    from iris.limits import ProposeLimit
    monkeypatch.setattr(app_module, "voice_limit", ProposeLimit(per_client_hour=1, noun="voice messages"))
    c = TestClient(app_module.app)
    with c.websocket_connect("/api/voice/live") as sock:
        sock.send_json({"mode": "hands_free"})
        assert sock.receive_json() == {"type": "ready", "max_s": app_module.VOICE_HANDS_FREE_MAX_S}
        for frame in [LOUD] * 4 + [QUIET] * 10:
            sock.send_bytes(frame)
        sock.send_json({"type": "end"})
        assert _events(sock)[-1] == {"type": "final", "text": "sentence 1", "turn": 0}
    assert "Iris" in heard[0][1]  # the app's vocabulary reaches the model
    with c.websocket_connect("/api/voice/live") as sock:
        sock.send_json({"mode": "hold"})
        events = _events(sock)
    assert len(events) == 1 and events[0]["type"] == "error" and "voice messages" in events[0]["detail"]
