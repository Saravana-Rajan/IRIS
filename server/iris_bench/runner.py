"""Run items against a model, with a reply cache, latency and cost.

    run(items, model, client=None, cache_dir=..., concurrency=8, check=None) -> list[Result]

`model` is a Gemini model id (through Iris's `GeminiModel`), or "fake:<p>" for the offline `FakeModel` (answers
correctly with probability p, otherwise a random schema-valid reply; deterministic per item). Replies are cached as
JSONL in `cache_dir/<model>.jsonl`, keyed by (model, item id, hash of prompt + schema + images): a rerun makes no new
calls. Errors are not cached, so they are retried next run.

Grading: every job but J3 is graded here against `truth["expected"]` (the reference answer jobs.py derived from
geometry): J1 (sort and binary), J2, J4 (set), J5/J6 (bool), J7 (set of valid candidate numbers; detail carries
partial credit: some valid picked and no invalid one), J8 (letter or exact order), J9 (relation word or bool).
J3 needs the geometry checker: pass `check(item, reply) -> (correct, detail)` (e.g. score.make_check, built on
`checker.check_fix` and `jobs.reply_to_fix`); without it its `correct` stays None and `detail["needs_checker"]` is
set. Replies carry `confidence` and `reason` (required by the schema); a reply valid but for those (or with a reason
over 200 characters, cut) is still graded, with `detail["schema_warning"]`. `detail["confidence"]` is copied out.

Gemini settings (Google's Vertex AI guidance, checked Nov 22, 2026; the same rule for every model, nothing tuned):
thinking at Google's default level (thinking_config left out; Flash-Lite, whose default MINIMAL is meant for simple
extraction, gets LOW), or a level named in the model label: "gemini-3.8-flash@high" calls gemini-3.8-flash at HIGH and
is cached, scored and reported as its own model; include_thoughts off; media_resolution HIGH (about 1,089 tokens per
1024 px PNG); response_mime_type application/json with the item's JSON Schema as response_json_schema; no temperature / top_p / penalties (ignored or rejected; T < 1 can loop), no
max_output_tokens. Each image is preceded by an "Image k:" text part and the question comes last. Only transport errors
(429, 5xx, timeouts, dropped connections) are retried, with backoff; a reply that is not JSON (finish reason recorded,
e.g. MAX_TOKENS) is cached as a failed answer and never retried. Every cached row keeps `meta`: model_version,
finish_reason, tokens (input, output, thinking) and the settings. Cost uses BENCH_PRICES (USD per 1M tokens, the rates
billed when the run is made), else iris.model_client prices. `SETTINGS` / `settings_record()` describe the request.

`write_batch_jsonl(items, path)` writes the same requests as Vertex AI batch prediction lines (no network).
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import random
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import jsonschema

from .jobs import META_FIELDS, REASON_MAX, SYSTEM, core_schema, normalize_reply
from .spec import Item, Result

DEFAULT_CACHE = Path(__file__).resolve().parents[1] / ".bench_cache"
Check = Callable[[Item, dict], "tuple[bool | None, dict]"]
CHECK_JOBS = ("J3_fix",)            # graded by the check hook (geometry), never by stored truth
SET_FIELDS = ("fitting", "valid")    # answer fields compared as sets


# ------------------------------------------------------------------------------------------------- the fake model

def random_from_schema(schema: dict, rng: random.Random) -> Any:
    """A random value that satisfies the (simple) JSON Schemas jobs.py writes."""
    if "enum" in schema:
        return rng.choice(schema["enum"])
    t = schema.get("type")
    if isinstance(t, list):
        t = rng.choice([x for x in t if x != "null"] or ["null"])
    if t == "object":
        return {k: random_from_schema(v, rng) for k, v in schema.get("properties", {}).items()}
    if t == "array":
        items = schema.get("items", {})
        lo = schema.get("minItems", 0)
        pool = None
        if "enum" in items:
            pool = list(items["enum"])
        elif items.get("type") == "integer" and "minimum" in items and "maximum" in items:
            pool = list(range(items["minimum"], items["maximum"] + 1))
        if pool is not None:
            hi = min(schema.get("maxItems", len(pool)), len(pool))
            picked = rng.sample(pool, rng.randint(min(lo, hi), hi))
            return picked if lo == hi == len(pool) else sorted(picked, key=str)   # a permutation keeps its order
        hi = schema.get("maxItems", max(lo, 3))
        return [random_from_schema(items, rng) for _ in range(rng.randint(lo, hi))]
    if t == "integer":
        return rng.randint(schema.get("minimum", 0), min(schema.get("maximum", 1000), 1000))
    if t == "number":
        return rng.uniform(schema.get("minimum", 0), schema.get("maximum", 1000))
    if t == "boolean":
        return rng.random() < 0.5
    if t == "string":
        return "x"[: schema.get("maxLength", 1)]
    return None


def _legacy_expected(item: Item) -> dict | None:
    """The reference reply of an item built before truth["expected"] existed."""
    t = item.truth
    if item.job == "J1_sort" and "kind" in t:
        return {"answer": {"real": "a", "not_touching": "b", "by_design": "c"}[t["kind"]]}
    if item.job == "J2_who_moves" and "mover_letter" in t:
        return {"mover_letter": t["mover_letter"]}
    if item.job == "J4_opening" and "fitting" in t:
        return {"fitting": list(t["fitting"])}
    if item.job == "J5_review" and "expected_good" in t:
        return {"good": bool(t["expected_good"])}
    return None


def expected_reply(item: Item) -> dict | None:
    """The reply a perfect model gives (None when the truth does not determine one), confidence and reason included
    when the schema asks for them."""
    t = item.truth
    exp = t.get("expected") if "expected" in t else _legacy_expected(item)
    if not isinstance(exp, dict):
        return None
    out = dict(exp)
    props = item.schema.get("properties", {})
    if "confidence" in props:
        out["confidence"] = 1.0
    if "reason" in props:
        out["reason"] = "The geometry in the pictures gives this answer."
    return out


class FakeModel:
    """Offline stand-in: correct with probability p, otherwise random; seeded by the item so reruns agree."""

    def __init__(self, p: float = 0.7, seed: int = 0):
        self.p = p
        self.seed = seed
        self.calls = 0
        self._lock = threading.Lock()

    def answer(self, item: Item) -> dict:
        with self._lock:
            self.calls += 1
        rng = random.Random(f"fake-{self.seed}-{self.p}-{item.id}")
        good = expected_reply(item)
        if good is not None and rng.random() < self.p:
            out = dict(good)
            conf, why = rng.uniform(0.6, 1.0), "fake: read the answer off the pictures"
        else:
            out = random_from_schema(item.schema, rng)
            conf, why = rng.uniform(0.0, 0.9), "fake: a guess"
        if isinstance(out, dict):
            if "confidence" in out:
                out["confidence"] = round(conf, 3)
            if "reason" in out:
                out["reason"] = why
        return out


# ------------------------------------------------------------------------------------------------- cache

def item_key(model: str, item: Item) -> str:
    h = hashlib.sha256(json.dumps([item.prompt, item.schema, item.images], sort_keys=True).encode()).hexdigest()[:16]
    return f"{model}|{item.id}|{h}"


class Cache:
    """Append-only JSONL of replies; thread-safe."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.rows: dict[str, dict] = {}
        if self.path.exists():
            for line in self.path.read_text().splitlines():
                try:
                    row = json.loads(line)
                    self.rows[row["key"]] = row
                except (ValueError, KeyError):
                    continue

    def get(self, key: str) -> dict | None:
        return self.rows.get(key)

    def put(self, row: dict) -> None:
        with self._lock:
            self.rows[row["key"]] = row
            with self.path.open("a") as f:
                f.write(json.dumps(row) + "\n")


# ------------------------------------------------------------------------------------------------- grading

def _schema_error(value, schema: dict) -> str | None:
    try:
        jsonschema.validate(value, schema)
    except jsonschema.ValidationError as e:
        return e.message
    return None


def _norm(v) -> str:
    return str(v).strip().upper()


def _same(want, got, set_field: bool) -> bool:
    if isinstance(want, bool):
        return isinstance(got, bool) and got == want
    if isinstance(want, list):
        if not isinstance(got, list):
            return False
        if set_field:
            return {_norm(x) for x in got} == {_norm(x) for x in want}
        return [_norm(x) for x in got] == [_norm(x) for x in want]
    return got is not None and _norm(got) == _norm(want)


def j7_partial(picked, valid) -> dict:
    """J7 partial credit: some valid candidate picked and no invalid one."""
    p = {int(x) for x in picked or [] if str(x).strip().lstrip("-").isdigit()}
    v = {int(x) for x in valid}
    return {"picked": sorted(p), "valid": sorted(v), "partial": bool(p & v) and p <= v,
            "picked_valid": len(p & v), "picked_invalid": len(p - v), "missed_valid": len(v - p)}


def _compare(item: Item, reply: dict, exp: dict) -> tuple[bool, dict]:
    r = normalize_reply(item.job, reply)
    ok = all(_same(want, r.get(k), k in SET_FIELDS) for k, want in exp.items())
    detail: dict = {}
    if item.job == "J1_sort" and "answer" in exp:
        detail["answer"] = r.get("kind")
    if item.job == "J7_pick_valid" and "valid" in exp:
        detail.update(j7_partial(r.get("valid"), exp["valid"]))
    return ok, detail


def _legacy_grade(item: Item, reply: dict) -> tuple[bool | None, dict]:
    r = normalize_reply(item.job, reply)
    if item.job == "J1_sort":
        return r.get("kind") == item.truth["kind"], {"answer": r.get("kind")}
    if item.job == "J2_who_moves":
        return r["mover_letter"] == item.truth["mover_letter"], {}
    if item.job == "J4_opening":
        return set(r["fitting"]) == set(item.truth["fitting"]), {}
    return None, {"needs_checker": True}


def grade(item: Item, reply: dict | None, check: Check | None = None) -> tuple[bool | None, dict]:
    """(correct, detail) for one reply; None = unparseable, off-schema or needing the checker (J3)."""
    if not isinstance(reply, dict):
        return None, {"error": "no reply"}
    detail: dict = {}
    if isinstance(reply.get("reason"), str) and len(reply["reason"]) > REASON_MAX:
        reply = {**reply, "reason": reply["reason"][:REASON_MAX]}
        detail["reason_truncated"] = True
    err = _schema_error(reply, item.schema)
    if err is not None:
        core = {k: v for k, v in reply.items() if k not in META_FIELDS}
        if _schema_error(core, core_schema(item.schema)) is not None:
            return None, {"schema_error": err}
        detail["schema_warning"] = err      # the answer is fine; confidence/reason are missing or off
    conf = reply.get("confidence")
    if isinstance(conf, (int, float)) and not isinstance(conf, bool):
        detail["confidence"] = conf
    exp = item.truth.get("expected")
    if item.job in CHECK_JOBS or not isinstance(exp, dict):
        if check is not None:
            ok, d = check(item, reply)
            return ok, {**detail, **d}
        if item.job in CHECK_JOBS:
            return None, {**detail, "needs_checker": True}
        ok, d = _legacy_grade(item, reply)
        return ok, {**detail, **d}
    ok, d = _compare(item, reply, exp)
    return ok, {**detail, **d}


# ------------------------------------------------------------------------------------------------- run

def _safe(model: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in model)


# ------------------------------------------------------------------------------------------------- Gemini call

THINKING_DEFAULT = "default"     # Google's default level per model (Flash-Lite: LOW)
MEDIA_RESOLUTION = "MEDIA_RESOLUTION_HIGH"
TIMEOUT_S = 600            # one call at HIGH thinking on a multi-image item can take minutes
TRANSPORT_TRIES = 5        # 429 / 5xx / timeouts only; backoff 2, 4, 8, 16 s (+ jitter)
# USD per 1M tokens (input, output; thinking is output), as billed for runs made in Nov 2026 (global, standard
# PayGo): Gemini 4 Argon / Carbon $2 / $10 until Nov 30 ($4 / $20 from Dec 1), 3.8 Flash introductory $0.75 / $3.75
# (to Dec 31), 3.5 Flash-Lite $0.30 / $2.50. IRIS_BENCH_PRICES (JSON: id prefix -> [in, out]) adds or replaces.
BENCH_PRICES = {"gemini-4-argon": (2.0, 10.0), "gemini-4-carbon": (2.0, 10.0), "gemini-3.8-flash": (0.75, 3.75),
                "gemini-3.5-flash-lite": (0.30, 2.50)}


def split_model(label: str) -> tuple[str, str]:
    """"gemini-3.8-flash@high" -> ("gemini-3.8-flash", "high"); no suffix -> (label, "default")."""
    base, _, level = str(label).partition("@")
    return base, (level.strip().lower() or THINKING_DEFAULT)


def model_label(model: str, thinking: str | None = None) -> str:
    """The label results are cached and reported under: the model id, plus "@<level>" unless thinking is default."""
    base, level = split_model(model)
    level = (thinking or level or THINKING_DEFAULT).strip().lower()
    return base if level == THINKING_DEFAULT else f"{base}@{level}"


def thinking_for(label: str) -> str | None:
    """The thinking_level sent for a model label: None (left out: Google's default), LOW for Flash-Lite by default,
    else the label's level upper-cased."""
    base, level = split_model(label)
    if level == THINKING_DEFAULT:
        return "LOW" if "flash-lite" in base else None
    return level.upper()


SETTINGS = {"api": "google-genai generate_content (Vertex AI, location from GOOGLE_CLOUD_LOCATION, default global)",
            "system_instruction": "jobs.SYSTEM (same for every model)",
            "thinking": "google-default (thinking_config omitted; Flash-Lite LOW); '@<level>' labels set a level",
            "include_thoughts": False, "media_resolution": MEDIA_RESOLUTION,
            "response_mime_type": "application/json", "response_json_schema": "the item's JSON Schema",
            "temperature": "omitted", "top_p_top_k_penalties": "omitted", "max_output_tokens": "omitted",
            "image_order": "'Image k:' text part before each image, question text last",
            "retries": f"transport errors only (429/5xx/timeout), up to {TRANSPORT_TRIES} tries",
            "timeout_s": TIMEOUT_S}


def _bench_prices() -> dict:
    out = dict(BENCH_PRICES)
    try:
        for k, v in json.loads(os.environ.get("IRIS_BENCH_PRICES") or "{}").items():
            out[str(k)] = (float(v[0]), float(v[1]))
    except (ValueError, TypeError, IndexError, AttributeError):
        pass
    return out


def bench_cost(model: str, tokens_in: int, tokens_out: int) -> float | None:
    """USD for one call at BENCH_PRICES (longest id prefix), else iris.model_client's price; None when unpriced."""
    model = split_model(model)[0]
    prices = _bench_prices()
    hit = max((k for k in prices if model.startswith(k)), key=len, default=None)
    if hit is not None:
        pin, pout = prices[hit]
        return (tokens_in * pin + tokens_out * pout) / 1e6
    try:
        from iris.model_client import _longest, prices as mc_prices
        p = _longest(mc_prices(), model)
        if p:
            return tokens_in * p[0] + tokens_out * p[1]
    except Exception:
        pass
    return None


def settings_record(label: str) -> dict:
    """What a run under model label `label` sent, for the run manifest."""
    try:
        from importlib.metadata import version
        sdk = version("google-genai")
    except Exception:
        sdk = None
    model, level = split_model(label)
    prices = _bench_prices()
    hit = max((k for k in prices if model.startswith(k)), key=len, default=None)
    sent = thinking_for(label)
    return {**SETTINGS, "thinking": "google-default" if sent is None else f"thinking_level={sent}",
            "thinking_level_sent": sent, "model": model, "label": label, "google_genai": sdk,
            "location": os.environ.get("GOOGLE_CLOUD_LOCATION") or "global",
            "price_usd_per_1m": list(prices[hit]) if hit else None}


def _mime(p: Path) -> str:
    return "image/png" if p.suffix.lower() == ".png" else "image/jpeg"


def gemini_request(item: Item, label: str = ""):
    """(contents, config) for one item: "Image k:" before each image, the question last; the bench SETTINGS, with
    the thinking level of model label `label` (thinking_for)."""
    from google.genai import types
    level = thinking_for(label)
    parts = []
    for k, p in enumerate(item.images, 1):
        parts.append(types.Part.from_text(text=f"Image {k}:"))
        parts.append(types.Part.from_bytes(data=Path(p).read_bytes(), mime_type=_mime(Path(p))))
    parts.append(types.Part.from_text(text=item.prompt))
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM, response_mime_type="application/json", response_json_schema=item.schema,
        media_resolution=MEDIA_RESOLUTION,
        thinking_config=types.ThinkingConfig(thinking_level=level, include_thoughts=False) if level else None,
        http_options=types.HttpOptions(timeout=int(TIMEOUT_S * 1000)))
    return [types.Content(role="user", parts=parts)], config


def _transient(e: Exception) -> bool:
    code = getattr(e, "code", None) or getattr(e, "status_code", None)
    if isinstance(code, int):
        return code == 429 or code >= 500
    name = type(e).__name__.lower()
    msg = str(e).lower()
    return any(w in name for w in ("timeout", "connect", "remoteprotocol", "readerror", "network")) or \
        any(w in msg for w in ("timed out", "timeout", "connection reset", "unavailable", "resource_exhausted",
                               "deadline", "server disconnected"))


def _usage(um) -> dict:
    get = (um.get if isinstance(um, dict) else (lambda k, d=None: getattr(um, k, d))) if um is not None else \
        (lambda k, d=None: d)
    tin = int(get("prompt_token_count", 0) or 0)
    cand = int(get("candidates_token_count", 0) or 0)
    thoughts = int(get("thoughts_token_count", 0) or 0)
    return {"input_tokens": tin, "output_tokens": cand + thoughts, "thinking_tokens": thoughts,
            "answer_tokens": cand, "cached_tokens": int(get("cached_content_token_count", 0) or 0)}


def _call_gemini(model: str, client, item: Item) -> tuple[dict | None, float, dict]:
    """(reply or None when the model's text is not JSON, USD, meta) for one item under model label `model`
    ("id" or "id@level"); raises after TRANSPORT_TRIES transport failures (not cached, so the next run tries again)."""
    if client is None:
        from iris.model_client import make_client
        client = make_client()
    label, model = model, split_model(model)[0]
    contents, config = gemini_request(item, label)
    rng = random.Random(item.id)
    for attempt in range(TRANSPORT_TRIES):
        try:
            resp = client.models.generate_content(model=model, contents=contents, config=config)
            break
        except Exception as e:
            if attempt == TRANSPORT_TRIES - 1 or not _transient(e):
                raise
            time.sleep(2 ** (attempt + 1) + rng.uniform(0, 1))
    cands = getattr(resp, "candidates", None) or []
    finish = getattr(cands[0], "finish_reason", None) if cands else None
    finish = getattr(finish, "name", None) or (str(finish) if finish is not None else None)
    use = _usage(getattr(resp, "usage_metadata", None))
    usd = bench_cost(model, use["input_tokens"], use["output_tokens"]) or 0.0
    meta = {"model_version": getattr(resp, "model_version", None), "finish_reason": finish, "usage": use,
            "attempts": attempt + 1, "thinking_level": thinking_for(label) or "google-default",
            "media_resolution": MEDIA_RESOLUTION}
    try:
        text = resp.text
    except Exception:
        text = None
    reply = None
    if text:
        try:
            reply = json.loads(text)
        except ValueError:
            s = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            try:
                reply = json.loads(s)
            except ValueError:
                reply = None
    if not isinstance(reply, dict):
        meta["unparseable"] = (text or "")[:300]
        meta["failure"] = "max_tokens" if finish and "MAX_TOKENS" in finish else "unparseable"
        reply = None
    return reply, usd, meta


def run(items: list[Item], model: str, client=None, cache_dir: Path = DEFAULT_CACHE, concurrency: int = 8,
        check: Check | None = None, fake: FakeModel | None = None, max_usd: float | None = None) -> list[Result]:
    """Results for `items` on `model` (a model label: "id" or "id@level"), in item order. Cached replies are reused
    (no call). `max_usd` caps the NEW spend of this call: once it is reached no further call starts (items left get
    detail.error "budget"; in-flight calls can overshoot by at most `concurrency` calls)."""
    cache = Cache(Path(cache_dir) / f"{_safe(model)}.jsonl")
    if model.startswith("fake"):
        fake = fake or FakeModel(float(model.split(":", 1)[1]) if ":" in model else 0.7)
    spent = [0.0]
    lock = threading.Lock()

    def one(item: Item) -> Result:
        key = item_key(model, item)
        row = cache.get(key)
        cached = row is not None
        if not cached and max_usd is not None:
            with lock:
                over = spent[0] >= max_usd
            if over:
                return Result(item.id, model, None, None, {"error": "budget", "mode": item.mode, "job": item.job,
                                                           "cached": False}, 0.0, 0.0)
        if not cached:
            t0 = time.perf_counter()
            meta: dict = {}
            try:
                if fake is not None:
                    reply, usd = fake.answer(item), 0.0
                else:
                    reply, usd, *more = _call_gemini(model, client, item)
                    meta = more[0] if more else {}
            except Exception as e:   # one failed call never sinks the run; it is retried next run
                return Result(item.id, model, None, None, {"error": f"{type(e).__name__}: {str(e)[:500]}",
                                                           "mode": item.mode, "job": item.job, "cached": False},
                              time.perf_counter() - t0, 0.0)
            with lock:
                spent[0] += usd or 0.0
            row = {"key": key, "model": model, "item_id": item.id, "reply": reply,
                   "latency_s": round(time.perf_counter() - t0, 4), "cost_usd": usd}
            if meta:
                row["meta"] = meta
            cache.put(row)
        correct, detail = grade(item, row["reply"], check)
        meta = row.get("meta") or {}
        if row["reply"] is None and meta.get("failure"):   # the model answered, but not with JSON: a failed answer
            detail = {**detail, "error": "unparseable", "failure": meta["failure"],
                      "finish_reason": meta.get("finish_reason")}
        extra = {k: meta[k] for k in ("model_version", "finish_reason", "usage") if k in meta}
        return Result(item.id, model, row["reply"], correct, {**detail, **extra, "cached": cached, "mode": item.mode,
                                                              "job": item.job,
                                                              "question": item.meta.get("question")},
                      row["latency_s"], row["cost_usd"])

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
        return list(pool.map(one, items))


# ------------------------------------------------------------------------------------------------- Vertex batch

def to_vertex_schema(schema: dict) -> dict:
    """A jobs.py JSON Schema in Vertex `responseSchema` form (OpenAPI subset: upper-case types, `nullable`, no
    `additionalProperties`, string-only enums)."""
    out: dict = {}
    t = schema.get("type")
    if isinstance(t, list):
        non_null = [x for x in t if x != "null"]
        if "null" in t:
            out["nullable"] = True
        t = non_null[0] if non_null else "null"
    if t:
        out["type"] = t.upper()
    if "enum" in schema:
        out["enum"] = [v for v in schema["enum"] if v is not None]
        if None in schema["enum"]:
            out["nullable"] = True
    for k in ("minimum", "maximum", "required", "maxLength", "minItems", "maxItems"):
        if k in schema:
            out[k] = schema[k]
    if "properties" in schema:
        out["properties"] = {k: to_vertex_schema(v) for k, v in schema["properties"].items()}
        out["propertyOrdering"] = list(schema["properties"])
    if "items" in schema:
        out["items"] = to_vertex_schema(schema["items"])
    return out


def _label(item_id: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "-" for c in item_id.lower())[:63]


def write_batch_jsonl(items: list[Item], path: Path, system: str = SYSTEM, model: str = "") -> int:
    """Write one Vertex AI batch prediction request line per item, with the online run's settings: "Image k:" before
    each image (inline, base64), the question last, media resolution HIGH, thinking as for model label `model`
    (thinking_for: left out = Google's default), no temperature, a JSON reply with the item's JSON Schema
    (responseJsonSchema). The item id rides in `request.labels.item_id` (lower-cased, label-safe). Returns lines
    written."""
    level = thinking_for(model)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w") as f:
        for item in items:
            parts = []
            for k, p in enumerate(item.images, 1):
                parts.append({"text": f"Image {k}:"})
                parts.append({"inlineData": {"mimeType": _mime(Path(p)),
                                             "data": base64.b64encode(Path(p).read_bytes()).decode()}})
            parts.append({"text": item.prompt})
            gen = {"responseMimeType": "application/json", "responseJsonSchema": item.schema,
                   "mediaResolution": MEDIA_RESOLUTION}
            if level:
                gen["thinkingConfig"] = {"thinkingLevel": level}
            req = {"request": {"systemInstruction": {"parts": [{"text": system}]},
                               "contents": [{"role": "user", "parts": parts}], "generationConfig": gen,
                               "labels": {"item_id": _label(item.id)}}}
            f.write(json.dumps(req) + "\n")
            n += 1
    return n
