"""Prepared fixes for the review queue (docs/review-queue.md): the fix agent run ahead of review, one clash pair per card.

After a coordination check, `run` takes the clashes that need a fix (the ones ticked, or `deepest`: the deepest open
hard clashes) and resolves each distinct physical pair through Fix together's loop (`plans._resolve_items`: the agent
proposes, the geometry checks, failures go back to the model, the passing options are ranked), a few at a time. Each
pair is its own card: pairs are never merged (`plans.pairs_for(..., merge=False)`) and no item is told about the
others. Every finished item becomes a `prepared` event: `ready` with the options that passed the check in this run,
or `failed` with why. Nothing is kept here; Accept goes through `plans.apply`, which tries the option again.

Saved results. A scene opened unedited from files a saved set was made from can replay the model's recorded replies
instead of asking it again (free: no proposal is charged and nothing waits on the model; the geometry still checks
every option). A saved set holds the model's replies only, never the geometry's results: every replayed reply goes
back through `agent.resolve`, so each option is tried, checked and
ranked on the server exactly as a live one is. A reply is used only for the exact question it answered (sha256 of the
system prompt and the question text; images are not part of it: saved sets are made from model data alone, with no
pictures). A question the file does not hold fails that item with a plain why; it is never asked live behind the
reviewer's back. Saved runs read no hosts (`hosts_model=None`): a service may pass through walls and slabs only, and
every opening is reviewed by its host's team, the same when made and when replayed, so both ask the same questions.

The whole set is used only when its key (`saved_key`) equals the scene's: this module's `VERSION`, the files by name and
sha256, revision 0 (no edit kept), no coordination requirements in force, the default clearance, `plans.PLAN_ROUNDS`,
`agent.OPTIONS`, the proposal model id and thinking level, and the domain prompt's sha256. Any difference is a miss and
every pair is prepared live (one proposal each from the caller's allowance).

`ScriptedModel` is a free, offline, deterministic stand-in for the proposal model (moves the service side up or down
by set amounts), for tests, the generator's `--model scripted` and a local click-through. It is used only when passed
in explicitly: nothing in the environment selects it.
"""
from __future__ import annotations

import copy
import datetime
import hashlib
import json
import os
import re
import tempfile
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

from . import agent, domains, model_client, plans, requirements
from .service import Workspace

VERSION = 1   # bump when what a prepared fix is made of changes (what the agent is asked, how options are verified)
FORMAT = 1    # the saved file's layout
LABEL = "Saved AI proposals for this sample"
MISS = ("The saved AI proposals do not cover this clash as Iris asks about it now, so no fix was prepared: "
        "request another to ask the model live.")
NO_MODEL = ("No AI model is configured on this server, so this clash was not prepared live: only saved proposals "
            "replay.")


# ---------------------------------------------------------------------------------------------------------- picking

def deepest(ws: Workspace, scene_id: str, report_id: str, fixed=(), n: int = plans.MAX_ITEMS) -> list[str]:
    """The clash ids of the deepest open hard clashes: overlapping (distance < 0), not in `fixed`, both elements in
    the open model and physical (`plans.pairs_for`); clashes between different models before clashes within one,
    deepest first; at most `n` distinct pairs. A pair reported by several clashes gives all of their ids (one card)."""
    scene = ws.scene(scene_id)
    matches = ws.match(report_id, scene_id)
    skip = set(fixed or ())

    def across(c) -> bool:
        m = matches.get(c.id, {})
        try:
            return scene.element(m["a"]).source != scene.element(m["b"]).source
        except Exception:   # not in the open model: pairs_for leaves it out
            return False
    hard = [c for c in ws.report(report_id).clashes
            if c.id not in skip and c.distance_m is not None and c.distance_m < 0 and (c.test_type or "hard") == "hard"]
    hard.sort(key=lambda c: (not across(c), c.distance_m))
    items, _ = plans.pairs_for(ws, scene_id, report_id, [c.id for c in hard], merge=False)
    return [cid for it in items[:n] for cid in it.clash_ids]


def pairs(ws: Workspace, scene_id: str, report_id: str, clash_ids: list[str],
          limit: int | None = plans.MAX_ITEMS) -> tuple[list[plans.Item], list[str]]:
    """One item per distinct physical pair (never merged), at most `limit`; and why the other clashes cannot be."""
    items, skipped = plans.pairs_for(ws, scene_id, report_id, clash_ids, merge=False)
    return (items[:limit] if limit else items), skipped


def live_count(items: list[plans.Item], saved: "Saved | None") -> int:
    """How many of these items would ask the model live (one proposal each): those the saved set does not hold."""
    return sum(1 for it in items if saved is None or it.key not in saved.items)


# ---------------------------------------------------------------------------------------------------------- models

def label_of(model) -> str:
    """A model's name as people read it: its own `label`, else from its id (`model_client.model_label`)."""
    return getattr(model, "label", "") or model_client.model_label(getattr(model, "model", "") or "")


def question_hash(system: str, text: str) -> str:
    """What a recorded reply answered: the system prompt and the question text (images are not part of it)."""
    return hashlib.sha256((system + "\0" + text).encode("utf-8")).hexdigest()


def _pair_of(text: str) -> str | None:
    """The clash pair a fix agent's question is about ("a|b", sorted GlobalIds), from its first two lines."""
    ids = re.findall(r"^Element [AB] \((?:red|green)\): .*GlobalId (\S+)$", text, re.M)
    return "|".join(sorted(ids[:2])) if len(ids) >= 2 else None


class ReplayMiss(LookupError):
    """A question the saved set holds no reply for."""


class Recorder:
    """Wraps a proposal model and records every reply by the question it answered (`question_hash`)."""

    def __init__(self, model):
        self.inner = model
        self.model = getattr(model, "model", "") or ""
        self.label = label_of(model)
        self.thinking_level = getattr(model, "thinking_level", "") or ""
        self.calls: dict[str, dict] = {}
        self.failed: set[str] = set()   # pairs whose question the model failed to answer (not saved)
        self._lock = threading.Lock()

    def complete_json(self, system: str, text: str, images=None, **kw) -> dict:
        try:
            reply = self.inner.complete_json(system, text, images, **kw) if kw else self.inner.complete_json(system, text, images)
        except Exception:
            with self._lock:
                self.failed.add(_pair_of(text) or "")
            raise
        with self._lock:
            self.calls[question_hash(system, text)] = copy.deepcopy(reply)
        return reply


class ReplayModel:
    """Answers each question with the reply recorded for exactly that question, or raises ReplayMiss."""

    def __init__(self, saved: "Saved"):
        self.saved = saved
        self.model = saved.model
        self.label = saved.model_label
        self.thinking_level = saved.key.get("thinking") or ""

    def complete_json(self, system: str, text: str, images=None, **kw) -> dict:
        reply = self.saved.calls.get(question_hash(system, text))
        if reply is None:
            raise ReplayMiss(MISS)
        return copy.deepcopy(reply)


class ScriptedModel:
    """A deterministic, free, offline stand-in for the proposal model. It reads which side of the clash is a service
    (a duct, pipe, cable carrier or other distribution element) from the question's element lines and proposes plain
    moves of that side: up 0.40, down 0.40 and up 0.60 m in the first round, up 0.80, down 0.80 and up 1.00 m in the
    second. When the question says the other element has an opening on the service's line, the first round also
    offsets the service's middle piece through it, by the middle of the range the question gives. Some pass the check
    and some fail, so both paths run. Used only when passed in explicitly."""

    model = "scripted"
    label = "Scripted test model"
    thinking_level = ""
    ROUNDS = ([0.40, -0.40, 0.60], [0.80, -0.80, 1.00])
    SERVICE = re.compile(r"^Ifc(Flow|Duct|Pipe|Cable|Distribution|AirTerminal|Valve|Damper|Fan|Pump)")
    LINE = re.compile(r"^Element ([AB]) \((?:red|green)\): (\w+) '(.*)', level ", re.M)
    SEGMENT = re.compile(r"^Element ([AB]) is a straight segment .*\(([\d.]+) m long, .*profile \d+ wide x (\d+) deep")
    OCCUPIES = re.compile(r"^The other element occupies ([\d.]+)-([\d.]+) m along it")
    OPENING = re.compile(r"offsetting ([AB])'s middle piece by ([+-][\d.]+) to ([+-][\d.]+) m passes it through")

    def _offset(self, text: str, move: str, name: str) -> dict | None:
        """An offset of `move`'s middle piece through the other element's opening, when the question offers one."""
        seen: dict[str, dict] = {}
        side = None
        for line in text.splitlines():
            if m := self.SEGMENT.match(line):
                side = m[1]
                seen[side] = {"length": float(m[2]), "depth": int(m[3]) / 1000}
            elif (m := self.OCCUPIES.match(line)) and side:
                seen[side].update(lo=float(m[1]), hi=float(m[2]))
            elif m := self.OPENING.search(line):
                seen.setdefault(m[1], {})["dz"] = round((float(m[2]) + float(m[3])) / 2, 3)
        s = seen.get(move, {})
        if not {"length", "depth", "lo", "hi", "dz"} <= set(s):
            return None
        reach = 1.5 * s["depth"] + 0.05   # a bend and half a riser either side, and a little straight
        split = [round(max(0.05, s["lo"] - reach), 3), round(min(s["length"] - 0.05, s["hi"] + reach), 3)]
        if split[1] <= split[0]:
            return None
        return {"title": f"Offset {name} {s['dz'] * 1000:+.0f} mm through the opening", "kind": "offset", "move": move,
                "split_m": split, "dz_m": s["dz"], "rationale": "Passes through the opening the other element has.",
                "also_needs": "four bends"}

    def __init__(self):
        self.calls = 0
        self._lock = threading.Lock()

    def complete_json(self, system: str, text: str, images=None, **kw) -> dict:
        with self._lock:
            self.calls += 1
        sides = {label: (cls, name) for label, cls, name in self.LINE.findall(text)}
        if set(sides) != {"A", "B"}:
            return {"understanding": "", "candidates": [], "advice": "The scripted model could not read the clash."}
        service = [s for s in ("A", "B") if self.SERVICE.match(sides[s][0])]
        move = "B" if service == ["B"] else "A"
        other = "B" if move == "A" else "A"
        cls, name = sides[move]
        round_no = 2 if "Already tried:" in text else 1
        candidates = []
        for dz in self.ROUNDS[round_no - 1]:
            words = f"{'Raise' if dz > 0 else 'Lower'} {name or cls} {abs(dz) * 1000:.0f} mm"
            candidates.append({"title": words, "kind": "move", "move": move, "delta_m": [0.0, 0.0, dz],
                               "rationale": f"Takes the {cls} {'over' if dz > 0 else 'under'} "
                                            f"'{sides[other][1] or sides[other][0]}'.",
                               "also_needs": "re-hang the run's supports"})
        offset = self._offset(text, move, name or cls) if round_no == 1 else None
        if offset:
            candidates.append(offset)
        return {"understanding": f"'{name or cls}' ({cls}) runs into '{sides[other][1] or sides[other][0]}' "
                                 f"({sides[other][0]}); the scripted model moves the "
                                 f"{'service' if service else 'element A'} clear.",
                "candidates": candidates,
                "advice": "A scripted test model proposed these; a designer reviews any move before it is built."}


# ---------------------------------------------------------------------------------------------------------- saved sets

def saved_dir(ws: Workspace) -> Path:
    """Where saved sets are read from: `IRIS_PREPARED_DIR`, else the samples folder's `prepared/`."""
    env = os.environ.get("IRIS_PREPARED_DIR")
    return Path(env) if env else Path(ws.samples) / "prepared"


_hashes: dict[tuple[str, int, int], str] = {}
_hashes_lock = threading.Lock()


def file_sha256(path: Path) -> str:
    """A file's sha256, remembered by (path, size, modified time)."""
    st = path.stat()
    key = (str(path.resolve()), st.st_size, st.st_mtime_ns)
    with _hashes_lock:
        hit = _hashes.get(key)
    if hit:
        return hit
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    with _hashes_lock:
        _hashes[key] = h.hexdigest()
    return _hashes[key]


def saved_key(ws: Workspace, scene_id: str) -> dict | None:
    """What a saved set must have been made on to be used here, or None when this scene cannot use one: an edit kept
    (revision 0 only), coordination requirements in force, or a file that cannot be read (hashed: the files the scene
    was opened from, `Workspace.original_paths`: a sample's on disk, an upload's in the scene's folder)."""
    scene = ws.scene(scene_id)
    if scene.revision != 0 or requirements.current_id() is not None:
        return None
    try:
        files = [[p.name, file_sha256(p)] for p in ws.original_paths(scene_id)]
        prompt = hashlib.sha256((agent.PACKS / f"{domains.of(ws, scene_id)}.md").read_bytes()).hexdigest()
    except OSError:
        return None
    return {"version": VERSION, "files": files, "requirements": None, "clearance_m": requirements.DEFAULT_CLEARANCE_M,
            "rounds": plans.PLAN_ROUNDS, "want": agent.OPTIONS, "model": model_client.model_id("proposal"),
            "thinking": model_client.thinking_level("proposal"), "prompt": prompt, "hosts": None}


@dataclass
class Saved:
    """A saved set (`samples/prepared/*.json`): the model's recorded replies for one sample, and what it covers."""
    path: Path
    key: dict
    label: str
    model: str                 # the model id that made the replies
    model_label: str           # as people read it ("Gemini Pro")
    made: str                  # ISO date
    calls: dict[str, dict]     # question_hash → the reply
    items: dict[str, dict] = field(default_factory=dict)   # "a|b" → {clash_key, clash_ids, options}

    def info(self) -> dict:
        """For the page: the file's label, the model's name, the date, and the sentence to show."""
        return {"label": self.label, "model": self.model_label, "made": self.made,
                "title": f"{self.label} ({self.model_label}, {self.made})"}


_files: dict[tuple[str, int, int], dict | None] = {}
_files_lock = threading.Lock()


def _read(path: Path) -> dict | None:
    """A saved file, parsed once per (path, size, modified time); None when it is not one."""
    try:
        st = path.stat()
    except OSError:
        return None
    key = (str(path), st.st_size, st.st_mtime_ns)
    with _files_lock:
        if key in _files:
            return _files[key]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        data = data if isinstance(data, dict) and data.get("format") == FORMAT else None
    except (OSError, ValueError):
        data = None
    with _files_lock:
        _files[key] = data
    return data


def load_saved(ws: Workspace, scene_id: str) -> Saved | None:
    """The first saved set in `saved_dir` whose key equals this scene's `saved_key` exactly, or None."""
    key = saved_key(ws, scene_id)
    folder = saved_dir(ws)
    if key is None or not folder.is_dir():
        return None
    for path in sorted(folder.glob("*.json")):
        data = _read(path)
        if data is not None and data.get("key") == key:
            return Saved(path, data["key"], data.get("label") or LABEL, data.get("model") or key["model"],
                         data.get("model_label") or model_client.model_label(data.get("model") or ""),
                         data.get("made") or "", data.get("calls") or {}, data.get("items") or {})
    return None


# ---------------------------------------------------------------------------------------------------------- the run

def _plain(error: str) -> str:
    """An item's error as a sentence: a replay miss without its exception's name."""
    prefix = f"{ReplayMiss.__name__}: "
    return error[len(prefix):] if error.startswith(prefix) else error


def run(ws: Workspace, scene_id: str, report_id: str, clash_ids: list[str], emit: Callable[[dict], None],
        saved: Saved | None = None, *, live_model=None, live_hosts=plans._WS_HOSTS,
        limit: int | None = plans.MAX_ITEMS) -> dict:
    """Prepare a fix for each distinct pair these clashes stand for (at most `limit`): the pairs `saved` holds first,
    replayed (`ReplayModel`, no host reading, no model client), then the rest live (`live_model`, else `ws.model`;
    `live_hosts`, else `ws.hosts_model`; with no model to ask, `model_client.can_call`, each fails with `NO_MODEL`).
    Streams `prepare_start`, the loop's `item` events, a `prepared` event per item as it finishes and
    `done` (docs/review-queue.md). Returns {ready, failed, total, seconds, skipped, live, saved, items}."""
    started = time.perf_counter()
    items, skipped = pairs(ws, scene_id, report_id, clash_ids, limit)
    held = set(saved.items) if saved is not None else set()
    replay = [it for it in items if it.key in held]
    live = [it for it in items if it.key not in held]
    source = {**{it.key: "live" for it in live}, **{it.key: "saved" for it in replay}}
    model = ws.model if live and live_model is None else live_model
    names = {**{it.key: label_of(model) for it in live}, **{it.key: saved.model_label for it in replay}}
    emit({"type": "prepare_start", "total": len(items),
          "items": [{"key": it.key, "clash_ids": it.clash_ids, "element_a": it.element_a, "element_b": it.element_b,
                     "label": it.label, "distance_m": it.distance_m, "saved": it.key in held} for it in items],
          "skipped": skipped, "saved": saved.info() if saved is not None and replay else None})
    by_key = {it.key: it for it in items}
    lock = threading.Lock()
    tally = {"done": 0, "ready": 0, "failed": 0}

    def relay(e: dict) -> None:
        if e.get("type") != "item" or e.get("status") != "done" or e.get("key") not in by_key:
            with lock:   # never between an item's last event and its card
                emit(e)
            return
        it = by_key[e["key"]]
        options = [o for o in [it.option, *it.alternatives] if o]   # each verified in this run by agent.resolve
        status = "ready" if options else "failed"
        event = {"type": "prepared", "key": it.key, "clash_ids": it.clash_ids, "element_a": it.element_a,
                 "element_b": it.element_b, "label": it.label, "distance_m": it.distance_m, "status": status,
                 "source": source[it.key], "options": options, "understanding": it.understanding,
                 "tried": it.tried, "model": names[it.key], "recommended": it.recommended}
        if status == "failed":
            event["why"] = _plain(it.error) or "No idea passed the geometry check."
        with lock:   # in order: the item's last event, then its card, numbered as they finish
            tally["done"] += 1
            tally[status] += 1
            emit({**e, "title": _plain(e.get("title") or "")} if status == "failed" else e)
            emit({**event, "done": tally["done"], "total": len(items)})

    if replay:
        plans._resolve_items(ws, scene_id, report_id, replay, "", relay, model=ReplayModel(saved), hosts_model=None,
                             label=saved.model_label)
    if live and not model_client.can_call(model):   # no credentials: nothing to ask, each fails plainly
        for it in live:
            it.error = NO_MODEL
            relay({"type": "item", "key": it.key, "status": "done", "ok": False, "title": NO_MODEL})
    elif live:
        plans._resolve_items(ws, scene_id, report_id, live, "", relay, model=model, hosts_model=live_hosts,
                             label=getattr(model, "label", "") or "")
    seconds = round(time.perf_counter() - started, 1)
    emit({"type": "done", "ready": tally["ready"], "failed": tally["failed"], "total": len(items), "seconds": seconds})
    return {"ready": tally["ready"], "failed": tally["failed"], "total": len(items), "seconds": seconds,
            "skipped": skipped, "live": len(live), "saved": len(replay), "items": [asdict(it) for it in items]}


# ---------------------------------------------------------------------------------------------------------- making one

def _clash_key(ws: Workspace, report_id: str, clash_id: str) -> str:
    """The first clash of an item as it is found again on the same files: its kind and its pair."""
    c = ws.report(report_id).clash(clash_id)
    return f"{c.test_type or 'hard'}|{c.test}|" + "|".join(sorted([c.a.global_id or "", c.b.global_id or ""]))


def generate(ws: Workspace, scene_id: str, report_id: str, clash_ids: list[str], model, label: str = LABEL,
             out: Path | None = None, emit: Callable[[dict], None] | None = None,
             limit: int | None = None) -> dict:
    """Make a saved set: prepare these clashes live on `model` through a `Recorder` (no host reading, as a replay
    asks), then write every reply and the items it covers to `out` (atomically). The key names the model that made the
    replies (its id and thinking level), so a set is used only where that model is the configured one. Raises
    ValueError when the scene cannot have one (`saved_key`). Returns what was written and what it cost."""
    key = saved_key(ws, scene_id)
    if key is None:
        raise ValueError("This scene cannot have saved proposals: open the files unedited, with no requirements in force.")
    out = Path(out) if out is not None else saved_dir(ws) / "saved.json"
    rec = Recorder(model)
    key = {**key, "model": rec.model, "thinking": rec.thinking_level}
    usage_from = model.usage.snapshot() if isinstance(getattr(model, "usage", None), model_client.Usage) else None
    summary = run(ws, scene_id, report_id, clash_ids, emit or (lambda e: None), None, live_model=rec, live_hosts=None,
                  limit=limit)
    items = {}
    for it in summary["items"]:
        if it["key"] in rec.failed:   # the model failed on it: nothing to replay
            continue
        items[it["key"]] = {"clash_key": _clash_key(ws, report_id, it["clash_ids"][0]), "clash_ids": it["clash_ids"],
                            "label": it["label"],
                            "options": len([o for o in [it["option"], *it["alternatives"]] if o])}
    data = {"format": FORMAT, "key": key, "label": label, "model": rec.model, "model_label": rec.label,
            "made": datetime.date.today().isoformat(), "calls": rec.calls, "items": items}
    out.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=out.parent, prefix=f".{out.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1, sort_keys=True)
        os.chmod(tmp, 0o644)   # mkstemp makes it 0600; the server's image may run as another user
        os.replace(tmp, out)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    usage = model.usage.as_dict(rec.model, usage_from) if usage_from is not None else None
    return {"path": str(out), "items": len(items), "ready": summary["ready"], "failed": summary["failed"],
            "total": summary["total"], "calls": len(rec.calls), "skipped_failed": sorted(k for k in rec.failed if k),
            "seconds": summary["seconds"], "usage": usage, "model": rec.model, "model_label": rec.label}
