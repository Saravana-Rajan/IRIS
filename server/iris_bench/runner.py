"""Run items against a model, with a reply cache, latency and cost.

    run(items, model, client=None, cache_dir=..., concurrency=8, check=None) -> list[Result]

`model` is a Gemini model id (through Iris's `GeminiModel`), or "fake:<p>" for the offline `FakeModel` (answers
correctly with probability p, otherwise a random schema-valid reply; deterministic per item). Replies are cached as
JSONL in `cache_dir/<model>.jsonl`, keyed by (model, item id, hash of prompt + schema + images): a rerun makes no new
calls. Errors are not cached, so they are retried next run.

Grading: J1, J2 and J4 are graded here by exact comparison with the truth. J3 and J5 need the geometry checker:
pass `check(item, reply) -> (correct, detail)` (e.g. built on `checker.check_fix` and `jobs.reply_to_fix`);
without it their `correct` stays None and `detail["needs_checker"]` is set.

`write_batch_jsonl(items, path)` writes the same requests as Vertex AI batch prediction lines (no network).
"""
from __future__ import annotations

import base64
import hashlib
import json
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

import jsonschema

from .jobs import SYSTEM, normalize_reply
from .spec import Item, Result

DEFAULT_CACHE = Path(__file__).resolve().parents[1] / ".bench_cache"
Check = Callable[[Item, dict], "tuple[bool | None, dict]"]


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
        if "enum" in items:
            return sorted(rng.sample(items["enum"], rng.randint(0, len(items["enum"]))))
        return [random_from_schema(items, rng) for _ in range(rng.randint(0, 3))]
    if t == "integer":
        return rng.randint(schema.get("minimum", 0), min(schema.get("maximum", 1000), 1000))
    if t == "number":
        return rng.uniform(schema.get("minimum", 0), schema.get("maximum", 1000))
    if t == "boolean":
        return rng.random() < 0.5
    if t == "string":
        return "x"
    return None


def expected_reply(item: Item) -> dict | None:
    """The reply a perfect model gives (None when the truth does not determine one)."""
    t = item.truth
    if item.job == "J1_sort":
        return {"answer": {"real": "a", "not_touching": "b", "by_design": "c"}[t["kind"]]}
    if item.job == "J2_who_moves":
        return {"mover_letter": t["mover_letter"]}
    if item.job == "J3_fix":
        return t.get("expected")
    if item.job == "J4_opening":
        return {"fitting": list(t["fitting"])}
    if item.job == "J5_review":
        return {"good": bool(t.get("expected_good"))}
    return None


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
            return dict(good)
        return random_from_schema(item.schema, rng)


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

def grade(item: Item, reply: dict | None, check: Check | None = None) -> tuple[bool | None, dict]:
    """(correct, detail) for one reply; None = unparseable, off-schema or needing the checker."""
    if not isinstance(reply, dict):
        return None, {"error": "no reply"}
    try:
        jsonschema.validate(reply, item.schema)
    except jsonschema.ValidationError as e:
        return None, {"schema_error": e.message}
    if check is not None:
        return check(item, reply)
    r = normalize_reply(item.job, reply)
    if item.job == "J1_sort":
        return r.get("kind") == item.truth["kind"], {"answer": r.get("kind")}
    if item.job == "J2_who_moves":
        return r["mover_letter"] == item.truth["mover_letter"], {}
    if item.job == "J4_opening":
        return set(r["fitting"]) == set(item.truth["fitting"]), {}
    return None, {"needs_checker": True}


# ------------------------------------------------------------------------------------------------- run

def _safe(model: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in model)


def _call_gemini(model: str, client, item: Item) -> tuple[dict, float]:
    from iris.model_client import GeminiModel
    m = GeminiModel(model, client=client)
    reply = m.complete_json(SYSTEM, item.prompt, [Path(p) for p in item.images], item.schema)
    return reply, m.usage.as_dict(model)["usd"]


def run(items: list[Item], model: str, client=None, cache_dir: Path = DEFAULT_CACHE, concurrency: int = 8,
        check: Check | None = None, fake: FakeModel | None = None) -> list[Result]:
    """Results for `items` on `model`, in item order. Cached replies are reused (no call)."""
    cache = Cache(Path(cache_dir) / f"{_safe(model)}.jsonl")
    if model.startswith("fake"):
        fake = fake or FakeModel(float(model.split(":", 1)[1]) if ":" in model else 0.7)

    def one(item: Item) -> Result:
        key = item_key(model, item)
        row = cache.get(key)
        cached = row is not None
        if not cached:
            t0 = time.perf_counter()
            try:
                if fake is not None:
                    reply, usd = fake.answer(item), 0.0
                else:
                    reply, usd = _call_gemini(model, client, item)
            except Exception as e:   # one failed call never sinks the run; it is retried next run
                return Result(item.id, model, None, None, {"error": f"{type(e).__name__}: {e}"},
                              time.perf_counter() - t0, 0.0)
            row = {"key": key, "model": model, "item_id": item.id, "reply": reply,
                   "latency_s": round(time.perf_counter() - t0, 4), "cost_usd": usd}
            cache.put(row)
        correct, detail = grade(item, row["reply"], check)
        return Result(item.id, model, row["reply"], correct, {**detail, "cached": cached, "mode": item.mode,
                                                              "job": item.job},
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
    for k in ("minimum", "maximum", "required"):
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


def write_batch_jsonl(items: list[Item], path: Path, system: str = SYSTEM) -> int:
    """Write one Vertex AI batch prediction request line per item (images inline, base64; JSON reply with the
    item's schema). The item id rides in `request.labels.item_id` (lower-cased, label-safe). Returns lines written."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w") as f:
        for item in items:
            parts = []
            for p in item.images:
                mime = "image/png" if Path(p).suffix.lower() == ".png" else "image/jpeg"
                parts.append({"inlineData": {"mimeType": mime,
                                             "data": base64.b64encode(Path(p).read_bytes()).decode()}})
            parts.append({"text": item.prompt})
            req = {"request": {"systemInstruction": {"parts": [{"text": system}]},
                               "contents": [{"role": "user", "parts": parts}],
                               "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json",
                                                    "responseSchema": to_vertex_schema(item.schema)},
                               "labels": {"item_id": _label(item.id)}}}
            f.write(json.dumps(req) + "\n")
            n += 1
    return n
