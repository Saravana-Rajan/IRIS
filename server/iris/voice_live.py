"""Live voice: the browser's microphone to Iris, and the words back, transcribed by the fast Gemini model.

The audio never leaves Iris on a socket: Iris buffers it and sends whole clips to the voice model
(`model_client.transcribe`, GEMINI_FAST_MODEL). Hold to talk transcribes the whole clip once, when the user lets go;
hands-free finds each sentence with a small energy detector (speech, then ~700 ms of quiet) and transcribes it as soon
as the speaker pauses. There are no live partial words: a clip is transcribed once it is complete.

Browser → Iris: one JSON frame `{mode: "hold" | "hands_free", report_id}`, then binary frames of 16 kHz mono 16-bit
little-endian PCM, then `{"type": "end"}` (hold: the user let go).
Iris → browser: `ready {max_s}`, `partial {text}` (not sent by this transcriber), `final {text, turn}` (hold: once, at
the end, no turn; hands-free: each sentence when the speaker pauses, turns counted from 0), `speech {on}` (hands-free),
`limit` (the time ran out), `error {detail}`. The socket then closes.

    IRIS_VOICE_VAD_RMS        the loudness (RMS of 16-bit samples) that counts as speech, 500 by default
    IRIS_VOICE_SILENCE_MS     how long a pause ends a hands-free sentence, 700 by default
"""
from __future__ import annotations

import array
import asyncio
import contextlib
import json
import math
import os
import sys
import time
from urllib.parse import urlsplit

from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState

from . import model_client, origins

RATE = 16_000
RATE_BYTES = 32_000  # 16 kHz x 16-bit mono
MAX_FRAME = 32_768  # the browser sends 80 ms (2,560 bytes); anything this size is not a microphone
END_WAIT_S = 90  # after the end, how long the last clips may take to come back
PRE_ROLL_S = 0.3  # audio kept from before speech starts, so a sentence's first sound is not clipped
MIN_SPEECH_S = 0.2  # a sentence with less loud audio than this is a cough or a click: not transcribed
MODES = {"hold": "hold", "hands_free": "hands_free"}


def _env_number(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name) or default)
    except ValueError:
        return default


def label() -> str:
    """The voice model's name as people read it."""
    return model_client.model_label(model_client.model_id("voice"))


def same_origin(headers) -> bool:
    """A browser on another site may not open the relay (it would spend our model budget), except the web app's own
    pages on another origin (`IRIS_ALLOWED_ORIGINS`, origins.py). Non-browser clients send no Origin; they are held to
    the same caps as everyone."""
    origin = headers.get("origin")
    return not origin or urlsplit(origin).netloc.lower() == (headers.get("host") or "").lower() or origins.allows(origin)


def rms(pcm: bytes) -> float:
    """The loudness of 16-bit little-endian PCM (root mean square of the samples)."""
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) - len(pcm) % 2])
    if sys.byteorder == "big":
        samples.byteswap()
    if not samples:
        return 0.0
    return math.sqrt(sum(s * s for s in samples) / len(samples))


class Segmenter:
    """Hands-free sentences out of a stream of PCM frames, by loudness: a loud frame starts speech, `silence_s` of quiet
    after it ends it. `feed` returns the events it saw: ("start", None) and ("end", the sentence's PCM)."""

    def __init__(self, threshold: float | None = None, silence_s: float | None = None):
        model_client.load_env()
        self.threshold = threshold if threshold is not None else _env_number("IRIS_VOICE_VAD_RMS", 500)
        self.silence_s = silence_s if silence_s is not None else _env_number("IRIS_VOICE_SILENCE_MS", 700) / 1000
        self.speaking = False
        self.segment = bytearray()
        self.pre = bytearray()
        self.quiet_s = 0.0
        self.loud_s = 0.0

    def feed(self, frame: bytes) -> list[tuple[str, bytes | None]]:
        events: list[tuple[str, bytes | None]] = []
        seconds = len(frame) / RATE_BYTES
        loud = rms(frame) >= self.threshold
        if not self.speaking:
            if loud:
                self.speaking, self.quiet_s, self.loud_s = True, 0.0, seconds
                self.segment = bytearray(self.pre) + frame
                self.pre = bytearray()
                events.append(("start", None))
            else:
                self.pre += frame
                keep = int(PRE_ROLL_S * RATE_BYTES) // 2 * 2
                del self.pre[: max(0, len(self.pre) - keep)]
            return events
        self.segment += frame
        if loud:
            self.quiet_s = 0.0
            self.loud_s += seconds
        else:
            self.quiet_s += seconds
            if self.quiet_s >= self.silence_s:
                events.append(self.flush())
        return events

    def flush(self) -> tuple[str, bytes | None]:
        """End the sentence in progress (if any): ("end", its PCM, or None when it was too short to transcribe)."""
        pcm = bytes(self.segment) if self.speaking and self.loud_s >= MIN_SPEECH_S else None
        self.speaking, self.segment, self.quiet_s, self.loud_s = False, bytearray(), 0.0, 0.0
        return ("end", pcm)


async def _transcribe(pcm: bytes, keywords: list[str]) -> str:
    """One clip's words, from the voice model (in a thread: the call blocks)."""
    wav = model_client.pcm_to_wav(pcm, RATE)
    result = await asyncio.to_thread(model_client.transcribe, wav, keywords or None)
    return (result.get("transcript") or "").strip()


def _failed(e: Exception) -> dict:
    """A failed transcription, in words: the kind of failure, never its details (they could carry the request)."""
    return {"type": "error", "detail": f"Couldn't transcribe with {label()} ({type(e).__name__}). Try again."}


async def relay(client: WebSocket, mode: str, keywords: list[str], max_s: float) -> None:
    """Run one voice session on an accepted browser socket until either side ends it, then close the browser side."""
    if not model_client.configured():
        await _say(client, {"type": "error", "detail": f"Voice needs {label()}, and no model is configured on this "
                                                       "server (GOOGLE_CLOUD_PROJECT or GEMINI_API_KEY)."})
        await _close(client)
        return
    hands_free = mode in ("hands_free", MODES["hands_free"])
    await _say(client, {"type": "ready", "max_s": max_s})
    session = _Session(client, keywords, hands_free)
    try:
        ended = await session.listen(max_s)
        if ended:
            await session.finish()
    finally:
        session.cancel()
    await _close(client)


class _Session:
    def __init__(self, client: WebSocket, keywords: list[str], hands_free: bool):
        self.client, self.keywords, self.hands_free = client, keywords, hands_free
        self.audio = bytearray()  # hold: the whole clip
        self.segmenter = Segmenter() if hands_free else None
        self.turn = 0
        self.last: asyncio.Task | None = None  # hands-free: the latest sentence's transcription (each waits for the last)
        self.tasks: list[asyncio.Task] = []
        self.failed = False

    async def listen(self, max_s: float) -> bool:
        """Take audio until the end, the limit or a bad frame. True: transcribe what is left; False: the page is gone
        (or sent something that is not audio, which has been said)."""
        received, deadline = 0, time.monotonic() + max_s + 5
        while True:
            try:
                msg = await asyncio.wait_for(self.client.receive(), max(0.1, deadline - time.monotonic()))
            except asyncio.TimeoutError:
                await _say(self.client, {"type": "limit"})
                return True
            if msg["type"] == "websocket.disconnect":
                return False
            data, text = msg.get("bytes"), msg.get("text")
            if data:
                if len(data) > MAX_FRAME or len(data) % 2:
                    await _say(self.client, {"type": "error", "detail": "That isn't 16 kHz microphone audio."})
                    return False
                received += len(data)
                await self.take(data)
                if received >= max_s * RATE_BYTES:
                    await _say(self.client, {"type": "limit"})
                    return True
                continue
            try:
                kind = json.loads(text or "{}").get("type")
            except (json.JSONDecodeError, AttributeError):
                kind = None
            if kind == "limit":
                await _say(self.client, {"type": "limit"})
            if kind in ("end", "limit"):
                return True

    async def take(self, frame: bytes) -> None:
        if not self.hands_free:
            self.audio += frame
            return
        for kind, pcm in self.segmenter.feed(frame):
            await self.event(kind, pcm)

    async def event(self, kind: str, pcm: bytes | None) -> None:
        if kind == "start":
            await _say(self.client, {"type": "speech", "on": True})
            return
        await _say(self.client, {"type": "speech", "on": False})
        if pcm:
            self.last = asyncio.create_task(self.sentence(pcm, self.last))
            self.tasks.append(self.last)

    async def sentence(self, pcm: bytes, before: asyncio.Task | None) -> None:
        """Transcribe one hands-free sentence while the mic stays open; say it after the one before it."""
        try:
            text: str | None = await _transcribe(pcm, self.keywords)
            error = None
        except Exception as e:
            text, error = None, e
        if before is not None:
            with contextlib.suppress(Exception):
                await before
        if error is not None:
            if not self.failed:  # one failure said once is enough
                self.failed = True
                await _say(self.client, _failed(error))
        elif text:
            await _say(self.client, {"type": "final", "text": text, "turn": self.turn})
            self.turn += 1

    async def finish(self) -> None:
        """The end or the limit: hold transcribes the clip; hands-free the sentence in progress, then waits for all."""
        if not self.hands_free:
            try:
                text = await asyncio.wait_for(_transcribe(bytes(self.audio), self.keywords), END_WAIT_S) \
                    if self.audio else ""
            except Exception as e:
                await _say(self.client, _failed(e))
                return
            await _say(self.client, {"type": "final", "text": text})
            return
        if self.segmenter.speaking:
            await self.event(*self.segmenter.flush())
        if self.tasks:
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(asyncio.gather(*self.tasks, return_exceptions=True), END_WAIT_S)

    def cancel(self) -> None:
        for t in self.tasks:
            t.cancel()


async def _say(client: WebSocket, event: dict) -> None:
    with contextlib.suppress(Exception):
        if client.application_state == WebSocketState.CONNECTED and client.client_state == WebSocketState.CONNECTED:
            await client.send_json(event)


async def _close(client: WebSocket) -> None:
    with contextlib.suppress(Exception, WebSocketDisconnect):
        if client.application_state == WebSocketState.CONNECTED:
            await client.close(1000)
