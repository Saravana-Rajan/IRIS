"""Thin client for Google's Gemini models on Vertex AI, through the official `google-genai` SDK.

Configuration comes from the environment (the repo's .env is read first, real environment variables win):

    GOOGLE_CLOUD_PROJECT     the Google Cloud project that runs Vertex AI (Application Default Credentials sign in)
    GOOGLE_CLOUD_LOCATION    global (default) | a region such as us-central1
    GEMINI_API_KEY           optional, local development: with no project set, the Gemini API is used with this key

    GEMINI_MODEL             the main model: proposals, chat, plans, patterns, report text (reasoning and vision)
    GEMINI_FAST_MODEL        bulk triage, clash titles, part names and voice transcription
    GEMINI_ESCALATION_MODEL  the second, longer try at a clash the main model found no verified fix for
    GEMINI_IMAGE_MODEL       "Show it built": restyles Iris's view of a fix as a presentation render
                             (defaults: `DEFAULT_MODELS`, gemini-3.8-flash for every text role, as deploy/deploy.sh)
    GEMINI_THINKING_LEVEL    minimal | low (default) | medium | high, or empty for the model's default
    GEMINI_FAST_THINKING_LEVEL        the fast model's (empty: the model's default)
    GEMINI_ESCALATION_THINKING_LEVEL  the second try's (high by default)

Every call's tokens are counted (`Usage`) and priced (`PRICES`, `IRIS_MODEL_PRICES`); a second try's and the
picture judges' calls are charged to the day's limit as they land (`on_cost`, spend.py).

Callers speak the chat-style message shapes they always have (`chat` takes `{role, content, tool_calls}` messages
and function tools and returns one assistant message); this module translates to and from Gemini's contents.
"""
from __future__ import annotations

import base64
import io
import json
import os
import threading
import wave
from pathlib import Path
from typing import Any, Callable, Protocol


ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def load_env(path: Path = ENV_FILE) -> None:
    """Read KEY=value lines from the repo's .env into the environment; real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() and not key.lstrip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip())


# ------------------------------------------------------------------------------------------------- models and prices

# THE defaults for every role, in one place. Owner decision Nov 22, 2026: Gemini 3.8 Flash for every text role (the
# second try at thinking level high), the same ids and levels `deploy/deploy.sh` sets, so a fresh clone matches the
# deploy and the saved review-queue set (`samples/prepared/*.json`, keyed to the proposal model and its thinking level).
# Checked Nov 11, 2026 against Vertex AI's "Model versions and lifecycle" page
# (https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions): gemini-3.8-flash is the newest GA
# Flash (Sep 2, 2026), gemini-4-argon the newest GA flagship (successor to the Pro line, Oct 13, 2026; chosen with
# GEMINI_MODEL or GEMINI_ESCALATION_MODEL), gemini-3.1-flash-image a GA image model (May 28, 2026; gemini-3-pro-image is
# the slower, higher-fidelity one). The env var named beside each wins.
DEFAULT_MODELS = {"proposal": ("GEMINI_MODEL", "gemini-3.8-flash"),
                  "fast": ("GEMINI_FAST_MODEL", "gemini-3.8-flash"),
                  "escalation": ("GEMINI_ESCALATION_MODEL", "gemini-3.8-flash"),
                  "image": ("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image"),
                  "voice": ("GEMINI_FAST_MODEL", "gemini-3.8-flash")}
DEFAULT_THINKING = {"proposal": ("GEMINI_THINKING_LEVEL", "low"),
                    "fast": ("GEMINI_FAST_THINKING_LEVEL", ""),
                    "escalation": ("GEMINI_ESCALATION_THINKING_LEVEL", "high")}

# USD per input and per output token (thinking counts as output), by model id prefix (the longest prefix that matches
# wins). Vertex AI list prices, Nov 2026 (https://cloud.google.com/vertex-ai/generative-ai/pricing): Gemini 4 Argon
# $2 / $10 per million; Gemini 3.8 Flash $1.50 / $7.50 (its introductory $0.75 / $3.75 runs to Dec 31, 2026: the list
# price is kept so the day's limit errs on the safe side). IRIS_MODEL_PRICES adds or replaces prices: a JSON object
# of id prefix → [USD per million input tokens, per million output tokens].
PRICES = {"gemini-4-argon": (2 / 1e6, 10 / 1e6),
          "gemini-4-carbon": (2 / 1e6, 10 / 1e6),
          "gemini-3.8-flash": (1.5 / 1e6, 7.5 / 1e6),
          "gemini-3.5-flash-lite": (0.1 / 1e6, 0.4 / 1e6),
          "gemini-3.5-flash": (0.3 / 1e6, 2.5 / 1e6)}
FIXED_EFFORT = ("judge",)   # roles whose effort is their own, whatever the owner or everyone's settings say
# Names people read, by id prefix (the longest prefix that matches wins); an id none matches is named by its family
# (`model_label`). IRIS_MODEL_LABELS adds or replaces them: a JSON object of id prefix → name.
LABELS = {"gemini-4-argon": "Gemini Pro", "gemini-4-carbon": "Gemini Pro"}
EFFORTS = ("minimal", "low", "medium", "high")


def _env_float(name: str, default: float) -> float:
    """A number from the environment (limits.env_float, here without importing the app's limits)."""
    from .limits import env_float
    return env_float(name, default)


def _env_json(name: str) -> dict:
    """A JSON object from the environment, or {} (unset, empty or not an object)."""
    try:
        value = json.loads(os.environ.get(name) or "{}")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _longest(table: dict, model_id: str):
    return next((table[p] for p in sorted(table, key=len, reverse=True) if model_id.startswith(p)), None)


def model_id(role: str) -> str:
    """The model id a role runs on (`DEFAULT_MODELS`, its env var first)."""
    load_env()
    var, default = DEFAULT_MODELS[role]
    return os.environ.get(var) or default


def thinking_level(role: str) -> str:
    """The thinking level a role runs at when nobody sets one ("" is the model's own default)."""
    load_env()
    var, default = DEFAULT_THINKING.get(role, DEFAULT_THINKING["proposal"])
    value = os.environ.get(var)
    return default if value is None else value.strip().lower()


def model_label(model_id: str) -> str:
    """A model's name as people read it ("Gemini Pro"), from its id (`LABELS`, `IRIS_MODEL_LABELS`, its family)."""
    labels = {**LABELS, **{str(k): str(v) for k, v in _env_json("IRIS_MODEL_LABELS").items()}}
    found = _longest(labels, model_id)
    if found or not model_id:
        return found or model_id
    mid = model_id.lower()
    if not mid.startswith("gemini"):
        return model_id
    for part, name in (("image", "Gemini Image"), ("flash-lite", "Gemini Flash-Lite"), ("flash", "Gemini Flash"),
                       ("live", "Gemini Live"), ("pro", "Gemini Pro")):
        if part in mid:
            return name
    return "Gemini"


def labels() -> dict:
    """The name of the model behind each role, for the page: proposal, escalation, triage, image, voice."""
    return {"proposal": model_label(model_id("proposal")), "escalation": escalation_info()["label"],
            "triage": model_label(model_id("fast")), "image": model_label(model_id("image")),
            "voice": model_label(model_id("voice"))}


def configured() -> bool:
    """Whether a model can be called at all: a Vertex AI project, or a Gemini API key."""
    load_env()
    return bool(os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GEMINI_API_KEY"))


def can_call(model: Any) -> bool:
    """Whether this model can be asked anything: any stand-in that is not a `GeminiModel` (a saved set's replay, a
    scripted or test model), a `GeminiModel` given its client, or one with credentials to make one (`configured`)."""
    if not isinstance(model, GeminiModel):
        return True
    return model._client is not None or configured()


class Usage:
    """Tokens a model's calls used, and what they cost when the model is priced."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.calls = self.input_tokens = self.output_tokens = self.reasoning_tokens = 0

    @staticmethod
    def of(raw: Any) -> tuple[int, int, int]:
        """(input, output, thinking) tokens from a Gemini `usage_metadata` (object or dict). Output includes the
        thinking, which is billed as output."""
        if raw is None:
            return 0, 0, 0
        get = raw.get if isinstance(raw, dict) else (lambda k, d=None: getattr(raw, k, d))
        thoughts = int(get("thoughts_token_count", 0) or 0)
        return (int(get("prompt_token_count", 0) or 0),
                int(get("candidates_token_count", 0) or 0) + thoughts, thoughts)

    def add(self, raw: Any) -> tuple[int, int, int]:
        tokens = self.of(raw)
        with self._lock:
            self.calls += 1
            self.input_tokens += tokens[0]
            self.output_tokens += tokens[1]
            self.reasoning_tokens += tokens[2]
        return tokens

    def snapshot(self) -> tuple[int, int, int, int]:
        with self._lock:
            return self.calls, self.input_tokens, self.output_tokens, self.reasoning_tokens

    def as_dict(self, model_id: str, since: tuple[int, int, int, int] = (0, 0, 0, 0)) -> dict:
        """The usage (since a `snapshot`, for one run on a model other runs share), and what it cost."""
        calls, tin, tout, reasoning = (now - then for now, then in zip(self.snapshot(), since))
        return {"model": model_id, "calls": calls, "input_tokens": tin, "output_tokens": tout,
                "reasoning_tokens": reasoning, "usd": round(cost(model_id, tin, tout), 4)}


def prices() -> dict:
    """`PRICES` with `IRIS_MODEL_PRICES` over them, USD per token."""
    extra = {}
    for prefix, p in _env_json("IRIS_MODEL_PRICES").items():
        try:
            extra[str(prefix)] = (float(p[0]) / 1e6, float(p[1]) / 1e6)
        except (TypeError, ValueError, IndexError):
            continue
    return {**PRICES, **extra}


def cost(model_id: str, input_tokens: int, output_tokens: int) -> float:
    """What a call cost in USD (0 for a model with no price here)."""
    price_in, price_out = _longest(prices(), model_id) or (0.0, 0.0)
    return input_tokens * price_in + output_tokens * price_out


class ChatModel(Protocol):
    def complete_json(self, system: str, text: str, images: list[Path] | None = None) -> dict: ...


class ToolModel(Protocol):
    def chat(self, messages: list[dict], tools: list[dict], *, timeout_s: float | None = None) -> dict: ...


# ------------------------------------------------------------------------------------------------- the SDK client

_clients: dict[tuple, Any] = {}
_clients_lock = threading.Lock()


def make_client():
    """The `google.genai` client for the configured backend (one per project/location/key, shared): Vertex AI when
    GOOGLE_CLOUD_PROJECT is set, else the Gemini API with GEMINI_API_KEY. Raises RuntimeError when neither is."""
    load_env()
    project = os.environ.get("GOOGLE_CLOUD_PROJECT") or None
    location = os.environ.get("GOOGLE_CLOUD_LOCATION") or "global"
    api_key = os.environ.get("GEMINI_API_KEY") or None
    if not project and not api_key:
        raise RuntimeError("No model configured: set GOOGLE_CLOUD_PROJECT (Vertex AI) or GEMINI_API_KEY.")
    key = (project, location) if project else ("api-key", api_key)
    with _clients_lock:
        if key not in _clients:
            from google import genai
            _clients[key] = (genai.Client(vertexai=True, project=project, location=location) if project
                             else genai.Client(api_key=api_key))
        return _clients[key]


def _types():
    from google.genai import types
    return types


def image_part(path: Path) -> dict:
    """An image as an chat-style content part (base64 data URL), for `chat` messages."""
    mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    data = base64.b64encode(path.read_bytes()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{data}"}}


def _image_bytes_part(path: Path):
    mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return _types().Part.from_bytes(data=path.read_bytes(), mime_type=mime)


def _strip_fence(raw: str) -> str:
    """A reply sometimes comes wrapped in a ```json fence."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        raw = raw.rsplit("```", 1)[0]
    return raw


def _parse_json(raw: str) -> dict:
    return json.loads(_strip_fence(raw or ""))


def _data_url_part(url: str):
    """An chat-style data URL image as a Gemini part (None for a URL that is not inline data)."""
    if not url.startswith("data:") or ";base64," not in url:
        return None
    head, data = url[5:].split(";base64,", 1)
    return _types().Part.from_bytes(data=base64.b64decode(data), mime_type=head or "image/png")


def _content_parts(content) -> list:
    """chat-style message content (a string or a list of text / image_url parts) as Gemini parts."""
    types = _types()
    if content is None:
        return []
    if isinstance(content, str):
        return [types.Part.from_text(text=content)] if content else []
    parts = []
    for c in content:
        if not isinstance(c, dict):
            continue
        if c.get("type") == "text" and c.get("text"):
            parts.append(types.Part.from_text(text=c["text"]))
        elif c.get("type") == "image_url":
            part = _data_url_part(((c.get("image_url") or {}).get("url")) or "")
            if part is not None:
                parts.append(part)
    return parts


def to_contents(messages: list[dict]) -> tuple[str, list]:
    """chat-style chat messages as (system instruction, Gemini contents). Assistant tool calls become function
    calls (with the thought signature Gemini gave them, which it needs back), tool results function responses."""
    types = _types()
    system, contents, names = [], [], {}
    for m in messages:
        role = m.get("role")
        if role == "system":
            system.append(m.get("content") if isinstance(m.get("content"), str) else
                          " ".join(c.get("text", "") for c in m.get("content") or [] if isinstance(c, dict)))
        elif role == "assistant":
            parts = _content_parts(m.get("content"))
            for call in m.get("tool_calls") or []:
                fn = call.get("function") or {}
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except (TypeError, ValueError):
                    args = {}
                names[call.get("id")] = fn.get("name", "")
                sig = call.get("thought_signature")
                parts.append(types.Part(function_call=types.FunctionCall(name=fn.get("name", ""), args=args),
                                        thought_signature=base64.b64decode(sig) if sig else None))
            if parts:
                contents.append(types.Content(role="model", parts=parts))
        elif role == "tool":
            raw = m.get("content")
            try:
                result = json.loads(raw) if isinstance(raw, str) else raw
            except ValueError:
                result = raw
            response = result if isinstance(result, dict) else {"result": result}
            part = types.Part.from_function_response(name=names.get(m.get("tool_call_id"), m.get("name", "tool")),
                                                     response=response)
            if contents and contents[-1].role == "user" and all(p.function_response for p in contents[-1].parts):
                contents[-1].parts.append(part)   # parallel calls' results go back in one turn
            else:
                contents.append(types.Content(role="user", parts=[part]))
        else:
            parts = _content_parts(m.get("content"))
            if parts:
                contents.append(types.Content(role="user", parts=parts))
    return "\n\n".join(s for s in system if s), contents


def to_tools(tools: list[dict]) -> list:
    """chat-style function tools as one Gemini tool of function declarations."""
    types = _types()
    decls = []
    for t in tools or []:
        fn = t.get("function") or t
        decls.append(types.FunctionDeclaration(name=fn["name"], description=fn.get("description", ""),
                                               parameters_json_schema=fn.get("parameters") or
                                               {"type": "object", "properties": {}}))
    return [types.Tool(function_declarations=decls)] if decls else []


def to_message(response) -> dict:
    """A Gemini reply as one chat-style assistant message: {role, content, tool_calls?}. Each tool call carries the
    thought signature Gemini attached to it, so the next turn can hand it back (`to_contents`)."""
    text, calls = [], []
    candidates = getattr(response, "candidates", None) or []
    parts = (getattr(candidates[0].content, "parts", None) or []) if candidates and candidates[0].content else []
    for i, p in enumerate(parts):
        if getattr(p, "thought", False):
            continue
        if getattr(p, "function_call", None):
            fc = p.function_call
            call = {"id": fc.id or f"call_{len(calls)}_{i}", "type": "function",
                    "function": {"name": fc.name, "arguments": json.dumps(dict(fc.args or {}))}}
            if getattr(p, "thought_signature", None):
                call["thought_signature"] = base64.b64encode(p.thought_signature).decode()
            calls.append(call)
        elif getattr(p, "text", None):
            text.append(p.text)
    out: dict = {"role": "assistant", "content": "".join(text) or None}
    if calls:
        out["tool_calls"] = calls
    return out


def _response_text(response) -> str:
    """The reply's answer text, without its thoughts."""
    candidates = getattr(response, "candidates", None) or []
    if not candidates or not candidates[0].content:
        return getattr(response, "text", None) or ""
    return "".join(p.text for p in candidates[0].content.parts or [] if getattr(p, "text", None)
                   and not getattr(p, "thought", False))


# ------------------------------------------------------------------------------------------------- the model

class GeminiModel:
    """One Gemini model, with the calls Iris makes: JSON replies (with images and a schema), the same streamed with
    the model's thought summaries, and tool-calling chat turns."""

    def __init__(self, model: str | None = None, timeout_s: float | None = None, thinking_level: str | None = None,
                 *, client: Any = None):
        load_env()
        if timeout_s is None:   # how long one model call may take (IRIS_MODEL_TIMEOUT_S)
            timeout_s = _env_float("IRIS_MODEL_TIMEOUT_S", 120)
        self.timeout_s = timeout_s
        self.model = model or model_id("proposal")
        self.thinking_level = thinking_level if thinking_level is not None else globals()["thinking_level"]("proposal")
        self.role = "default"  # "triage" / "escalation": the owner and settings set their effort separately
        self._client = client
        self.usage = Usage()
        # Hears each call's cost in USD as it lands (the escalation charges the day's limit with it, spend.py).
        self.on_cost: Callable[[float], None] | None = None
        # Gemini streams thought summaries (short notes on what the model is working out), which the UI shows while
        # the agent thinks. GEMINI_INCLUDE_THOUGHTS=0 turns that off (plain calls then).
        self.streams_reasoning = os.environ.get("GEMINI_INCLUDE_THOUGHTS", "1").strip() != "0"

    @property
    def client(self):
        if self._client is None:
            self._client = make_client()
        return self._client

    @client.setter
    def client(self, value) -> None:
        self._client = value

    @property
    def effort(self) -> str | None:
        """The owner's effort for this request (owner.py), else the one set for everyone (settings.py), else this
        model's."""
        from . import owner, settings
        if self.role in FIXED_EFFORT:   # a check measured at its own effort (Show it built's judges): no setting moves it
            return self.thinking_level or None
        return owner.effort(self.role) or settings.effort_for(self.role) or self.thinking_level or None

    def _count(self, raw) -> None:
        """Count a call's usage, and charge what it cost to `on_cost`."""
        tokens_in, tokens_out, _ = self.usage.add(raw)
        usd = cost(self.model, tokens_in, tokens_out)
        if usd and self.on_cost:
            self.on_cost(usd)

    def _config(self, *, system: str | None = None, schema: dict | None = None, json_reply: bool = False,
                tools: list | None = None, thoughts: bool = False, timeout_s: float | None = None):
        types = _types()
        level = self.effort
        thinking = None
        if level in EFFORTS or thoughts:
            thinking = types.ThinkingConfig(include_thoughts=thoughts or None,
                                            thinking_level=level.upper() if level in EFFORTS else None)
        timeout = timeout_s if timeout_s is not None else self.timeout_s
        return types.GenerateContentConfig(
            system_instruction=system or None, temperature=0.2,
            response_mime_type="application/json" if (json_reply or schema) else None,
            response_json_schema=schema or None, tools=tools or None, thinking_config=thinking,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True) if tools else None,
            http_options=types.HttpOptions(timeout=int(timeout * 1000)) if timeout else None)

    def _user(self, text: str, images: list[Path] | None) -> list:
        types = _types()
        return [types.Content(role="user", parts=[types.Part.from_text(text=text)] +
                              [_image_bytes_part(p) for p in images or []])]

    def complete_json(self, system: str, text: str, images: list[Path] | None = None,
                      schema: dict | None = None) -> dict:
        """One JSON object back. `schema` (a JSON Schema) constrains the reply to it; without it, any JSON object."""
        response = self.client.models.generate_content(
            model=self.model, contents=self._user(text, images),
            config=self._config(system=system, schema=schema, json_reply=True))
        self._count(getattr(response, "usage_metadata", None))
        return _parse_json(_response_text(response))

    def complete_json_reasoning(self, system: str, text: str, images: list[Path] | None, schema: dict | None,
                                on_reasoning: Callable[[str], None]) -> dict:
        """`complete_json`, streamed so `on_reasoning` hears each thought summary as the model writes it. Falls back
        to `complete_json` (no summaries) when streaming is switched off or the stream sends no JSON."""
        if not self.streams_reasoning:
            return self.complete_json(system, text, images, schema)
        out, usage = "", None
        stream = self.client.models.generate_content_stream(
            model=self.model, contents=self._user(text, images),
            config=self._config(system=system, schema=schema, json_reply=True, thoughts=True))
        for chunk in stream:
            usage = getattr(chunk, "usage_metadata", None) or usage
            candidates = getattr(chunk, "candidates", None) or []
            if not candidates or not candidates[0].content:
                continue
            for p in candidates[0].content.parts or []:
                if not getattr(p, "text", None):
                    continue
                if getattr(p, "thought", False):
                    note = p.text.strip()
                    if note:
                        on_reasoning(note)
                else:
                    out += p.text
        self._count(usage)   # billed however it ended
        if not out.strip():
            return self.complete_json(system, text, images, schema)
        return _parse_json(out)

    def complete_json_streamed(self, system: str, text: str, images: list[Path] | None, schema: dict | None,
                               on_reasoning: Callable[[str], None]) -> dict:
        """`complete_json` with the model's thoughts streamed to `on_reasoning` as they are written (bulk triage)."""
        return self.complete_json_reasoning(system, text, images, schema, on_reasoning)

    def chat(self, messages: list[dict], tools: list[dict], *, timeout_s: float | None = None) -> dict:
        """One assistant turn with tools: returns the message (content and/or tool_calls), chat-style."""
        system, contents = to_contents(messages)
        response = self.client.models.generate_content(
            model=self.model, contents=contents,
            config=self._config(system=system, tools=to_tools(tools), timeout_s=timeout_s))
        self._count(getattr(response, "usage_metadata", None))
        return to_message(response)


# ------------------------------------------------------------------------------------------------- audio and images

TRANSCRIBE_PROMPT = ("Transcribe this audio clip exactly as spoken, in English. Reply with the words only: no "
                     "timestamps, no speaker names, no notes. If nothing is said, reply with nothing.")


def wav_duration_ms(wav: bytes) -> int | None:
    """A WAV clip's length in milliseconds (None when it is not a WAV file Python can read)."""
    try:
        with wave.open(io.BytesIO(wav)) as w:
            return int(w.getnframes() * 1000 / max(w.getframerate(), 1))
    except (wave.Error, EOFError):
        return None


def pcm_to_wav(pcm: bytes, rate: int = 16_000) -> bytes:
    """Mono 16-bit little-endian PCM as a WAV file."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def transcribe(wav: bytes, keywords: list[str] | None = None, client: Any = None) -> dict:
    """Speech to text on the fast model (Gemini audio input): one clip (WAV) in, its transcript out. `keywords` bias
    recognition toward jargon and names ("transom", "Clash7") without forcing them."""
    types = _types()
    load_env()
    prompt = TRANSCRIBE_PROMPT + (("\nWords and names the speaker may use (spell them like this when you hear them): "
                                   + ", ".join(keywords)) if keywords else "")
    timeout = _env_float("IRIS_VOICE_TIMEOUT_S", 60)
    c = client or make_client()
    response = c.models.generate_content(
        model=model_id("voice"),
        contents=[types.Content(role="user", parts=[types.Part.from_text(text=prompt),
                                                    types.Part.from_bytes(data=wav, mime_type="audio/wav")])],
        config=types.GenerateContentConfig(temperature=0.0, http_options=types.HttpOptions(timeout=int(timeout * 1000)),
                                           thinking_config=types.ThinkingConfig(thinking_level="MINIMAL")))
    return {"transcript": _response_text(response).strip(), "duration_ms": wav_duration_ms(wav)}


def generate_image(prompt: str, images: list[bytes], timeout_s: float | None = None, client: Any = None) -> bytes:
    """One picture from the image model, given a prompt and input pictures (PNG). Raises RuntimeError on no picture."""
    types = _types()
    load_env()
    c = client or make_client()
    parts = [types.Part.from_text(text=prompt)] + [types.Part.from_bytes(data=b, mime_type="image/png") for b in images]
    response = c.models.generate_content(
        model=model_id("image"), contents=[types.Content(role="user", parts=parts)],
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE"],
            http_options=types.HttpOptions(timeout=int(timeout_s * 1000)) if timeout_s else None))
    for cand in getattr(response, "candidates", None) or []:
        for p in (cand.content.parts if cand.content else None) or []:
            data = getattr(getattr(p, "inline_data", None), "data", None)
            if data:
                return data if isinstance(data, bytes) else base64.b64decode(data)
    raise RuntimeError(f"{model_label(model_id('image'))} returned no picture")


# ------------------------------------------------------------------------------------------------- roles

def escalation_info() -> dict:
    """The model a second try runs on, and whether escalations are offered to this request (`settings.escalation`):
    {model, label, mode: off | button | auto, available}."""
    from . import settings
    load_env()
    model = model_id("escalation")
    label = model_label(model)
    if model == model_id("proposal"):   # the same model, thinking longer
        label += " (deep think)"
    return {"model": model, "label": label, "mode": settings.escalation(), "available": configured()}


def escalation_model(timeout_s: float | None = None) -> GeminiModel:
    """The model for a second try at a clash (docs/escalation.md): high thinking unless the owner or the settings say
    otherwise (role "escalation"), every call charged to the day's limit."""
    from . import spend
    load_env()
    if timeout_s is None:
        timeout_s = _env_float("IRIS_ESCALATION_TIMEOUT_S", 240)
    model = GeminiModel(model=model_id("escalation"), timeout_s=timeout_s, thinking_level=thinking_level("escalation"))
    model.role = "escalation"
    model.on_cost = spend.charge
    return model


def triage_model_info() -> dict:
    """Which model titles and triages, without building a client: {model, label, images}."""
    model = model_id("fast")
    return {"model": model, "label": model_label(model), "images": True}


def triage_model(timeout_s: float | None = None) -> tuple[GeminiModel, dict]:
    """The model for bulk triage and clash titles (the fast model), and a description of it for the UI."""
    info = triage_model_info()
    model = GeminiModel(model=info["model"], timeout_s=timeout_s, thinking_level=thinking_level("fast"))
    model.role = "triage"
    return model, info
