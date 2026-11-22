"""Agentic mode: the model may look again before it answers.

The model sees the scene. Iris knows the geometry. The geometry independently verifies the answer. In "agentic" mode
the model gets the same prompt and the same pictures as in "pictures" mode, in a chat with purely visual tools. It can
ask for more pictures of the same labelled parts, then answers. The answer key is never touched by a tool and never
shown; the reply is graded exactly like a pictures reply (runner.grade, with the same `check` hook for J3).

    run_agentic(items, model, scene_dirs, max_steps=4, cache_dir=..., client=None, fake=None, check=None,
                concurrency=4, renders_dir=None) -> list[Result]
    agentic_item(item) -> Item       the "agentic" copy of a pictures item (mode "agentic", id suffix "-agentic")
    tool_specs(item, scope) -> list  the chat tools offered for one item: get_view, zoom, answer
    FakeAgent(p)                     offline deterministic agent (model "fake:<p>"): sometimes looks, then answers

Tools (chat-style function tools; iris.model_client turns them into Gemini function declarations):
    get_view(camera | azimuth_deg + elevation_deg [, state])
        A new picture of the SAME parts with the SAME letters and colours, drawn by iris_bench.render from scene.json.
        camera: "A" | "B" | "C" (the seeded cameras of the first pictures; B shows nearby parts in grey) | "top" (plan,
        orthographic, north up) | "section" (level, orthographic, from the east), or any azimuth / elevation. Items
        that show a proposed move (J5/J6: "before" | "after") or proposed solutions (J7: "before" | "solution_<n>") also
        take `state`, which redraws that proposal (only the move already shown; never its verdict). Renders are cached
        on disk: <renders_dir>/<seed>-<scene hash>/ag<hash of focus, camera, state, style>_<view>.png (+ .json).
        A render whose letters disagree with the item's pictures is never shown (the model gets "unavailable").
    zoom(image_index, x0, y0, x1, y1)
        A crop of a picture already shown (numbered from 1 in the order shown), normalised 0..1 coordinates (origin
        top-left), at least ZOOM_MIN_FRAC of a side, scaled so its longer side is 1024 px (Pillow, Lanczos).
    answer(<the item's reply fields>)
        Ends the episode. Its parameters are the item's reply schema. A plain JSON text reply also ends it.

No tool measures, names a kind, or reveals ids, coordinates or distances: every text a tool sends back passes `leaks`
(the integrity scan's patterns) or is replaced by "unavailable". Rendered file names never reach the model.

Loop: turn 1 .. max_steps - 1 offer get_view, zoom and answer (at most MAX_CALLS_PER_TURN looks a turn); the last turn
offers only `answer` ("forced"). So an episode never takes more than max_steps model turns. A reply that is neither an
answer call nor JSON gets one nudge per turn. Function-call arguments are coerced back to the schema's integers (JSON
transport turns 3 into 3.0) and the tool's "none" back to null where the schema allows null; text replies are graded
as sent, exactly as in pictures mode.

Result: mode "agentic", `detail` = runner's grading detail + {cached, mode, job, question, base_item, trajectory, steps,
tool_calls, views_requested, zooms, extra_images, forced_final, answered_via, max_steps, usage}; latency includes the
renders; cost is the model's. Episodes are cached in cache_dir/<model>.agentic.jsonl, keyed by (model, item id, hash of
prompt + schema + images, max_steps); errors are not cached.

CLI wiring (cli.py is not changed here): `build --modes pictures,...,agentic` adds `agentic_item(i)` for every pictures
item to items.jsonl (frozen in the manifest like any other); `run` sends the agentic items to
`run_agentic(items, model, _scenes_dir(out), max_steps=..., cache_dir=out / "cache", check=check)` and the rest to
`runner.run`, then writes both into results.jsonl.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import random
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field, fields, replace
from pathlib import Path
from typing import Any, Callable, Mapping

from .jobs import SYSTEM
from .runner import DEFAULT_CACHE, Cache, Check, FakeModel, grade, item_key
from .spec import Camera, Item, Result, View

MODE = "agentic"
DEFAULT_MAX_STEPS = 4
MAX_CALLS_PER_TURN = 3
NAMED_CAMERAS = ("A", "B", "C", "top", "section")
SEEDED_CAMERAS = ("A", "B", "C")
PRESETS = {"top": Camera("top", 0.0, 90.0, 1.0, "orthographic"),
           "section": Camera("section", 0.0, 0.0, 1.0, "orthographic")}
ZOOM_MAX_SIDE = 1024
ZOOM_MIN_FRAC = 0.05
VIEW_TOOLS = ("get_view", "zoom")
NONE_WORD = "none"

AGENT_SYSTEM = SYSTEM + (
    " You may look again before you answer. The tool get_view draws the same labelled parts, with the same letters "
    "and colours, from another viewpoint: A, B or C (the cameras of the first pictures; B also shows nearby parts in "
    "grey), top (a plan looking straight down, north up), section (a level side view from the east), or any azimuth "
    "and elevation you choose. The tool zoom enlarges a region of any picture shown so far; pictures are numbered "
    "from 1 in the order shown. You have at most {looks} turn(s) of looking. When you are ready, call answer with the "
    "reply fields, or reply with the JSON object only.")
FORCE_NOTE = "No more looking. Answer now: call answer with the reply fields, or reply with the JSON object only."
NUDGE_NOTE = "Call get_view or zoom to look again, or answer: call answer, or reply with the JSON object only."

# The integrity scan's patterns (integrity.scan_prompt): kinds, element/opening ids, measurements, coordinates.
_LEAK_RES = (re.compile(r"\b(beam|column|slab|duct|pipe|tray|bracket)s?\b", re.I),
             re.compile(r"\b[eo]\d+\b"),
             re.compile(r"\b\d+(?:\.\d+)?\s*(?:mm|cm|m)\b|\bmm\b", re.I),
             re.compile(r"\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)"),
             re.compile(r"\b[xyz]\s*=\s*-?\d", re.I))


def leaks(text: str) -> list[str]:
    """Forbidden tokens in a text a tool would send the model (empty = clean)."""
    hits: list[str] = []
    for rx in _LEAK_RES:
        hits += [m.group(0) for m in rx.finditer(text or "")]
    return list(dict.fromkeys(hits))


# ------------------------------------------------------------------------------------------------- items

def _base_id(item: Item) -> str:
    suffix = f"-{item.mode}"
    return item.id[: -len(suffix)] if item.id.endswith(suffix) else item.id


def agentic_item(item: Item) -> Item:
    """The agentic copy of a pictures item: same prompt, pictures, schema and truth; mode "agentic", id
    "<seed>-<job>-<n>-agentic". An agentic item is returned as is; any other mode is refused (ValueError)."""
    if item.mode == MODE:
        return item
    if item.mode != "pictures":
        raise ValueError(f"agentic items are built from pictures items, not {item.mode!r} ({item.id})")
    return replace(item, id=f"{_base_id(item)}-{MODE}", mode=MODE, images=list(item.images),
                   meta={**item.meta, "base_item": item.id}, categories=list(item.categories))


# ------------------------------------------------------------------------------------------------- what may be drawn

@dataclass
class Scope:
    """What the tools may draw for one item: the parts its pictures frame, lettered as they show them."""
    scene_dir: Path
    seed: int
    scene_hash: str
    focus: list[str]                                   # element ids, in the order the renderer letters them
    style: str | None
    labels: dict[str, str]                             # id -> letter, as the item's pictures show them
    states: dict[str, dict | None] = field(default_factory=lambda: {"before": None})   # state -> proposal shown
    base_fix: dict | None = None                       # the proposal "before" pictures are framed with (J5-J7)
    mixed_letters: bool = False                        # the item's own pictures letter some part two ways

    @property
    def state_names(self) -> list[str]:
        return list(self.states)


_index_lock = threading.Lock()
_index_cache: dict[str, dict[str, View]] = {}
_VIEW_FIELDS = tuple(f.name for f in fields(View))


def _view(d: dict) -> View | None:
    try:
        return View(**{k: d[k] for k in _VIEW_FIELDS if k in d})
    except TypeError:
        return None


def _views_index(scene_dir: Path) -> dict[str, View]:
    """Every rendered view listed for a scene (views.json and render/views.json), by resolved image path and by file
    name."""
    files = (Path(scene_dir) / "views.json", Path(scene_dir) / "render" / "views.json")
    key = str(Path(scene_dir).resolve()) + "|" + ",".join(str(p.stat().st_mtime_ns) if p.exists() else "-"
                                                         for p in files)
    with _index_lock:
        if key in _index_cache:
            return _index_cache[key]
    out: dict[str, View] = {}
    for p in files:
        try:
            rows = json.loads(p.read_text()) if p.exists() else []
        except ValueError:
            rows = []
        for row in rows if isinstance(rows, list) else []:
            v = _view(row) if isinstance(row, dict) else None
            if v is None:
                continue
            out.setdefault(str((Path(scene_dir) / v.image).resolve()), v)
            out.setdefault(Path(v.image).name, v)
    with _index_lock:
        _index_cache[key] = out
    return out


def _shown_fixes(item: Item) -> dict[str, dict]:
    """The proposals the item's pictures already show (J5/J6: the move; J7: the numbered solutions), to redraw them
    from another camera. Only these keys of the truth are read; verdicts never are."""
    t = item.truth or {}
    if item.job in ("J5_review", "J6_new_clash") and isinstance(t.get("fix"), dict):
        return {"after": dict(t["fix"])}
    if item.job == "J7_pick_valid" and isinstance(t.get("candidates"), list):
        return {f"solution_{c['number']}": dict(c["fix"]) for c in t["candidates"]
                if isinstance(c, dict) and isinstance(c.get("fix"), dict) and "number" in c}
    return {}


def scope_for(item: Item, scene_dir: Path) -> Scope:
    """The focus (and its letters) the item's pictures were rendered with, from the scene's views.json files; falls
    back to the truth's pair / elements (the letter check then guards the order)."""
    from .spec import Scene
    scene_dir = Path(scene_dir)
    raw = (scene_dir / "scene.json").read_bytes()
    scene = Scene.from_dict(json.loads(raw))
    idx = _views_index(scene_dir)
    shown: list[View] = []
    for img in item.images:
        p = Path(img) if Path(img).is_absolute() else scene_dir / img
        v = idx.get(str(p.resolve())) or idx.get(p.name)
        if v is not None:
            shown.append(v)
    with_focus = [v for v in shown if v.focus]
    if with_focus:
        focus = list(max(with_focus, key=lambda v: len(v.focus)).focus)
    else:
        t = item.truth or {}
        focus = list(t.get("pair") or t.get("elements") or [])
    labels: dict[str, str] = {}
    same = [v for v in shown if list(v.focus) == focus] or shown   # the pictures a new view reproduces
    for v in same:
        for k, letter in v.labels.items():
            labels.setdefault(k, letter)
    if not labels:   # no views found: the item's own letters (letter -> id), for the consistency check only
        labels = {i: letter for letter, i in (item.truth or {}).get("letters", {}).items()}
    fixes = _shown_fixes(item)
    ids = {e.id for e in scene.elements}
    fixes = {k: f for k, f in fixes.items() if f.get("element") in ids}
    mixed = any(letters_consistent(v, labels) is False for v in shown)   # the item's own pictures disagree
    return Scope(scene_dir=scene_dir, seed=item.seed, scene_hash=hashlib.sha1(raw).hexdigest()[:8],
                 focus=[e for e in focus if e in ids], style=scene.challenge.get("style"), labels=labels,
                 states={"before": None, **fixes}, base_fix=next(iter(fixes.values()), None), mixed_letters=mixed)


# ------------------------------------------------------------------------------------------------- tools

def tool_specs(item: Item, scope: Scope | None = None, *, looks: bool = True) -> list[dict]:
    """The chat tools for one item: get_view and zoom (when `looks`), and answer (the item's reply schema)."""
    out: list[dict] = []
    if looks:
        props: dict = {
            "camera": {"type": "string", "enum": list(NAMED_CAMERAS),
                       "description": "A, B or C: the cameras of the first pictures (B also shows nearby parts in "
                                      "grey); top: plan looking straight down, north up; section: level side view "
                                      "from the east. Leave out to use azimuth_deg and elevation_deg."},
            "azimuth_deg": {"type": "number", "minimum": -360, "maximum": 360,
                            "description": "Where the camera stands, in degrees from east (0) towards north (90); "
                                           "-90 stands on the south side looking north."},
            "elevation_deg": {"type": "number", "minimum": -90, "maximum": 90,
                              "description": "Degrees above the horizon; 90 looks straight down."}}
        if scope is not None and len(scope.states) > 1:
            states = scope.state_names
            props["state"] = {"type": "string", "enum": states,
                              "description": "before: the parts as they are now; " +
                                             ("after: with the proposed move applied, as in the after pictures."
                                              if "after" in states else
                                              "solution_<n>: with proposed solution n applied.")}
        out.append({"type": "function", "function": {
            "name": "get_view",
            "description": "Draw the same labelled parts again, with the same letters and colours, from another "
                           "viewpoint. Give camera, or azimuth_deg and elevation_deg. Returns a new picture.",
            "parameters": {"type": "object", "properties": props}}})
        coord = {"type": "number", "minimum": 0, "maximum": 1}
        out.append({"type": "function", "function": {
            "name": "zoom",
            "description": "Enlarge a region of a picture already shown. Coordinates are fractions of the picture "
                           "(0 to 1, from the top-left corner). Returns the region as a new picture.",
            "parameters": {"type": "object",
                           "properties": {"image_index": {"type": "integer", "minimum": 1,
                                                          "description": "Picture number, from 1 in the order shown."},
                                          "x0": coord, "y0": coord, "x1": coord, "y1": coord},
                           "required": ["image_index", "x0", "y0", "x1", "y1"]}}})
    out.append({"type": "function", "function": {
        "name": "answer",
        "description": "Give your final answer: the reply fields the question asks for. Ends the task.",
        "parameters": answer_params(item.schema)}})
    return out


def answer_params(schema: dict) -> dict:
    """The item's reply schema as function parameters: a null choice in an enum becomes the word "none" (function
    declarations take string enums); `coerce_args` maps it back."""
    def walk(s):
        if isinstance(s, dict):
            s = {k: walk(v) for k, v in s.items()}
            if isinstance(s.get("enum"), list) and None in s["enum"]:
                s["enum"] = [v for v in s["enum"] if v is not None] + [NONE_WORD]
                t = s.get("type")
                if isinstance(t, list):
                    s["type"] = next((x for x in t if x != "null"), "string")
                s["description"] = (s.get("description", "") + f" Use \"{NONE_WORD}\" for null.").strip()
            return s
        if isinstance(s, list):
            return [walk(v) for v in s]
        return s
    return walk(copy.deepcopy(schema))


def coerce_args(value: Any, schema: dict) -> Any:
    """Function-call arguments back into the schema's own types: whole floats where it wants integers, "none" to null
    where it allows null."""
    if not isinstance(schema, dict):
        return value
    t = schema.get("type")
    types = t if isinstance(t, list) else [t]
    allows_null = "null" in types or None in (schema.get("enum") or [])
    if isinstance(value, str) and allows_null and value.strip().lower() in (NONE_WORD, "null", ""):
        return None
    if isinstance(value, float) and "integer" in types and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        props = schema.get("properties") or {}
        return {k: coerce_args(v, props.get(k, {})) for k, v in value.items()}
    if isinstance(value, list):
        return [coerce_args(v, schema.get("items") or {}) for v in value]
    return value


def camera_for(args: dict) -> Camera | str:
    """The camera a get_view call asks for: a seeded name ("A"/"B"/"C"), a preset Camera, or a free one (whole
    degrees). Raises ValueError for a call that names none."""
    name = args.get("camera")
    if name not in (None, ""):
        name = str(name).strip()
        if name.upper() in SEEDED_CAMERAS:
            return name.upper()
        if name.lower() in PRESETS:
            return PRESETS[name.lower()]
        raise ValueError(f"unknown camera {name!r}: use one of {', '.join(NAMED_CAMERAS)}")
    az, el = args.get("azimuth_deg"), args.get("elevation_deg")
    if az is None and el is None:
        raise ValueError("give camera, or azimuth_deg and elevation_deg")
    try:
        az = int(round(float(az if az is not None else 45.0))) % 360
        el = int(round(max(-90.0, min(90.0, float(el if el is not None else 30.0)))))
    except (TypeError, ValueError):
        raise ValueError("azimuth_deg and elevation_deg must be numbers") from None
    return Camera(f"az{az}_el{el}", float(az), float(el), 1.0, "perspective")


def _cam_text(cam: Camera | str) -> str:
    if isinstance(cam, str):
        return f"camera {cam}"
    if cam.name in PRESETS:
        return {"top": "the top (plan, north up)", "section": "a level section view from the east"}[cam.name]
    return f"azimuth {cam.azimuth_deg:g} deg, elevation {cam.elevation_deg:g} deg"


_locks_lock = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def _lock(key: str) -> threading.Lock:
    with _locks_lock:
        return _locks.setdefault(key, threading.Lock())


def letters_consistent(view: View, labels: dict[str, str]) -> bool:
    """True when a new view letters every part it shares with the item's pictures the same way, and uses no letter
    the pictures give to another part."""
    owner = {letter: i for i, letter in labels.items()}
    for i, letter in view.labels.items():
        if i in labels and labels[i] != letter:
            return False
        if letter in owner and owner[letter] != i:
            return False
    return True


def render_view(scope: Scope, camera: Camera | str, state: str, renders_dir: Path) -> tuple[Path, View, bool]:
    """One picture of the scope's parts from `camera` in `state` (cached on disk). Returns (png path, view, cached)."""
    from . import render
    if state not in scope.states:
        raise ValueError(f"unknown state {state!r}")
    fix = scope.states[state]
    draw_fix = fix if fix is not None else scope.base_fix   # "before" of a proposal: framed like its pictures
    cam_name = camera if isinstance(camera, str) else camera.name
    view_name = (f"after_{cam_name}" if fix is not None else f"before_{cam_name}") if draw_fix is not None else cam_name
    key = {"focus": scope.focus, "camera": camera if isinstance(camera, str) else asdict(camera),
           "state": state, "fix": draw_fix, "style": scope.style, "v": 1}
    tag = "ag" + hashlib.sha1(json.dumps(key, sort_keys=True).encode()).hexdigest()[:12]
    out_dir = Path(renders_dir) / f"{scope.seed}-{scope.scene_hash}"
    png, meta = out_dir / f"{tag}_{view_name}.png", out_dir / f"{tag}.json"
    with _lock(str(meta)):
        if png.exists() and meta.exists():
            view = _view(json.loads(meta.read_text()))
            if view is not None:
                return png, view, True
        kw: dict = {"views": [view_name], "out_dir": out_dir, "tag": tag}
        if draw_fix is not None:
            kw["fix"] = draw_fix
        if scope.style:
            kw["style"] = scope.style
        if not isinstance(camera, str):
            kw["cameras"] = [camera]
        views = render.render_scene(scope.scene_dir, list(scope.focus), **kw)
        view = next((v for v in views if v.name == view_name), views[0])
        path = (scope.scene_dir / view.image).resolve()
        out_dir.mkdir(parents=True, exist_ok=True)
        if path != png.resolve() and path.exists():   # a renderer that names files its own way
            png.write_bytes(path.read_bytes())
        meta.write_text(json.dumps(asdict(view)))
        return png, view, False


def crop_box(w: int, h: int, x0: float, y0: float, x1: float, y1: float,
             min_frac: float = ZOOM_MIN_FRAC) -> tuple[int, int, int, int]:
    """Pixel box (left, top, right, bottom) of a normalised region: clamped to 0..1, corners in either order, each
    side at least `min_frac` of the picture (widened about its centre, kept inside)."""
    def clamp(v) -> float:
        v = float(v)
        return 0.0 if math.isnan(v) else min(1.0, max(0.0, v))

    def widen(a: float, b: float) -> tuple[float, float]:
        if b - a >= min_frac:
            return a, b
        mid = (a + b) / 2
        a, b = mid - min_frac / 2, mid + min_frac / 2
        if a < 0:
            a, b = 0.0, min_frac
        if b > 1:
            a, b = 1.0 - min_frac, 1.0
        return a, b

    xa, xb = widen(*sorted((clamp(x0), clamp(x1))))
    ya, yb = widen(*sorted((clamp(y0), clamp(y1))))
    left, top = int(math.floor(xa * w + 1e-9)), int(math.floor(ya * h + 1e-9))
    right, bottom = int(math.ceil(xb * w - 1e-9)), int(math.ceil(yb * h - 1e-9))
    left, top = min(left, w - 1), min(top, h - 1)
    return left, top, max(left + 1, min(right, w)), max(top + 1, min(bottom, h))


def zoom_image(src: Path, box: tuple[int, int, int, int], out: Path, max_side: int = ZOOM_MAX_SIDE) -> tuple[int, int]:
    """Crop `box` out of `src` and scale it so its longer side is `max_side` (Lanczos); writes PNG `out`."""
    from PIL import Image
    with Image.open(src) as im:
        crop = im.convert("RGB").crop(box)
    cw, ch = crop.size
    s = max_side / max(cw, ch)
    size = (max(1, round(cw * s)), max(1, round(ch * s)))
    out.parent.mkdir(parents=True, exist_ok=True)
    crop.resize(size, Image.Resampling.LANCZOS).save(out, format="PNG")
    return size


# ------------------------------------------------------------------------------------------------- the episode

def _image_part(path: Path) -> dict:
    from iris.model_client import image_part
    return image_part(Path(path))


def _parse_text(text: str | None) -> dict | None:
    """A JSON object from a text reply (fenced or not; the first {...} span as a last resort), else None."""
    if not text or not text.strip():
        return None
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        raw = raw.rsplit("```", 1)[0]
    for cand in (raw, raw[raw.find("{"): raw.rfind("}") + 1] if "{" in raw and "}" in raw else ""):
        try:
            v = json.loads(cand)
        except ValueError:
            continue
        if isinstance(v, dict):
            return v
    return None


def _args(call: dict) -> dict:
    fn = call.get("function") or {}
    raw = fn.get("arguments")
    if isinstance(raw, dict):
        return raw
    try:
        v = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return v if isinstance(v, dict) else {}


def _answer_from_args(args: dict, schema: dict) -> dict:
    """The reply in an answer call: its arguments, or one JSON string argument holding the object."""
    props = set((schema or {}).get("properties") or {})
    if len(args) == 1 and not (set(args) & props):
        only = next(iter(args.values()))
        if isinstance(only, dict):
            args = only
        elif isinstance(only, str):
            parsed = _parse_text(only)
            if parsed is not None:
                args = parsed
    return coerce_args(args, schema)


def _clean_payload(payload: dict, traj_entry: dict) -> str:
    text = json.dumps(payload)
    hits = leaks(text)
    if hits:   # never send it; the run records that the guard fired
        traj_entry["integrity_block"] = hits
        return json.dumps({"error": "unavailable"})
    return text


ChatFn = Callable[[list[dict], list[dict]], dict]


def run_episode(item: Item, scope: Scope, chat: ChatFn, max_steps: int, renders_dir: Path) -> dict:
    """One agentic episode: the chat, the tools it calls, and the reply. Returns {reply, answered_via, steps,
    trajectory, tool_calls, views_requested, zooms, extra_images, forced_final, model_s, tools_s}."""
    max_steps = max(1, int(max_steps))
    pictures: list[Path] = [Path(p) for p in item.images]
    user = [{"type": "text", "text": item.prompt}]
    for i, p in enumerate(pictures, 1):
        user += [{"type": "text", "text": f"Picture {i}:"}, _image_part(p)]
    messages: list[dict] = [{"role": "system", "content": AGENT_SYSTEM.format(looks=max_steps - 1)},
                            {"role": "user", "content": user}]
    all_tools = tool_specs(item, scope, looks=True)
    answer_only = tool_specs(item, scope, looks=False)
    traj: list[dict] = []
    reply, via, forced = None, None, False
    n_calls = n_zooms = 0
    views_requested: list[str] = []
    model_s = tools_s = 0.0
    steps = 0
    for step in range(1, max_steps + 1):
        final = step == max_steps
        if final and step > 1:
            forced = True
            messages.append({"role": "user", "content": FORCE_NOTE})
        t0 = time.perf_counter()
        msg = chat(messages, answer_only if final else all_tools) or {}
        model_s += time.perf_counter() - t0
        steps = step
        calls = [c for c in (msg.get("tool_calls") or []) if isinstance(c, dict)]
        said = msg.get("content") if isinstance(msg.get("content"), str) else None
        entry: dict = {"step": step, "offered": "answer" if final else "all", "calls": []}
        if said:
            entry["said"] = said[:400]
        traj.append(entry)
        out_msg = {"role": "assistant", "content": msg.get("content")}
        if calls:
            out_msg["tool_calls"] = calls
        messages.append(out_msg)

        ans = next((c for c in calls if (c.get("function") or {}).get("name") == "answer"), None)
        if ans is not None:
            reply, via = _answer_from_args(_args(ans), item.schema), "tool"
            entry["calls"].append({"tool": "answer", "args": _args(ans)})
            break
        if not calls:
            parsed = _parse_text(said)
            if parsed is not None:
                reply, via = parsed, "text"
                entry["answer_text"] = True
                break
            if not final:
                messages.append({"role": "user", "content": NUDGE_NOTE})
                entry["nudged"] = True
            continue

        new_parts: list[dict] = []
        for k, call in enumerate(calls):
            name = (call.get("function") or {}).get("name", "")
            args = _args(call)
            rec: dict = {"tool": name, "args": args}
            t1 = time.perf_counter()
            if final or name not in VIEW_TOOLS:
                payload = {"error": "Only answer is available now." if final else f"Unknown tool {name!r}."}
            elif k >= MAX_CALLS_PER_TURN:
                payload = {"error": f"At most {MAX_CALLS_PER_TURN} looks per turn; this one was skipped."}
            else:
                try:
                    if name == "get_view":
                        cam = camera_for(args)
                        state = str(args.get("state") or "before")
                        if state not in scope.states:
                            raise ValueError(f"state must be one of {', '.join(scope.state_names)}")
                        png, view, cached = render_view(scope, cam, state, renders_dir)
                        ok = letters_consistent(view, scope.labels)
                        rec.update({"camera": cam if isinstance(cam, str) else asdict(cam), "state": state,
                                    "cached_render": cached, "letters_consistent": ok, "image": str(png)})
                        views_requested.append((cam if isinstance(cam, str) else cam.name) +
                                               ("" if state == "before" else f"@{state}"))
                        if not ok:
                            raise ValueError("that view is unavailable")
                        shows = f"the same parts from {_cam_text(cam)}" + \
                                ("" if state == "before" else f", {state.replace('_', ' ')} applied")
                    else:
                        idx = int(args.get("image_index", 0))
                        if not 1 <= idx <= len(pictures):
                            raise ValueError(f"image_index must be 1 to {len(pictures)}")
                        from PIL import Image
                        src = pictures[idx - 1]
                        with Image.open(src) as im:
                            w, h = im.size
                        box = crop_box(w, h, *(args.get(c, d) for c, d in
                                               (("x0", 0.0), ("y0", 0.0), ("x1", 1.0), ("y1", 1.0))))
                        zkey = hashlib.sha1(src.read_bytes() + json.dumps(box).encode()).hexdigest()[:16]
                        png = Path(renders_dir) / "zoom" / f"z{zkey}.png"
                        with _lock(str(png)):
                            if not png.exists():
                                zoom_image(src, box, png)
                        n_zooms += 1
                        rec.update({"of_picture": idx, "box_px": list(box), "image": str(png)})
                        shows = (f"picture {idx} enlarged, region x {box[0] / w:.2f} to {box[2] / w:.2f}, "
                                 f"y {box[1] / h:.2f} to {box[3] / h:.2f} of it")
                    pictures.append(png)
                    n_calls += 1
                    rec["picture"] = len(pictures)
                    payload = {"picture": len(pictures), "shows": shows}
                    new_parts += [{"type": "text", "text": f"Picture {len(pictures)}: {shows}."}, _image_part(png)]
                except (ValueError, TypeError) as e:
                    payload = {"error": str(e)}
                except Exception as e:   # a render failure is the tool's problem, not the model's answer
                    payload = {"error": "that view is unavailable"}
                    rec["tool_error"] = f"{type(e).__name__}: {str(e)[:300]}"
            if "error" in payload:
                rec["error"] = payload["error"]
            rec["seconds"] = round(time.perf_counter() - t1, 3)
            tools_s += rec["seconds"]
            content = _clean_payload(payload, rec)
            messages.append({"role": "tool", "tool_call_id": call.get("id"), "name": name, "content": content})
            entry["calls"].append(rec)
        if new_parts:
            messages.append({"role": "user", "content": new_parts})
    return {"reply": reply, "answered_via": via, "steps": steps, "trajectory": traj, "tool_calls": n_calls,
            "views_requested": views_requested, "zooms": n_zooms, "extra_images": len(pictures) - len(item.images),
            "forced_final": forced, "model_s": round(model_s, 3), "tools_s": round(tools_s, 3),
            "focus_size": len(scope.focus), "mixed_letters": scope.mixed_letters}


# ------------------------------------------------------------------------------------------------- the fake agent

class FakeAgent:
    """Offline agent, deterministic per item: with probability `look` it asks for one or two views (picking from the
    tool's own camera / state enums, sometimes a free azimuth), with probability `zoom` it also zooms picture 1, then
    answers like runner.FakeModel(p) by the answer tool (or, with probability `text`, as JSON text). `stubborn` keeps
    asking for views for as long as get_view is offered (then answers)."""

    def __init__(self, p: float = 0.7, seed: int = 0, look: float = 0.6, zoom: float = 0.3, text: float = 0.2,
                 stubborn: bool = False, answerer: FakeModel | None = None):
        self.p, self.seed, self.look, self.zoom, self.text, self.stubborn = p, seed, look, zoom, text, stubborn
        self.answerer = answerer or FakeModel(p, seed)
        self.turns = 0
        self._lock = threading.Lock()

    def session(self, item: Item) -> ChatFn:
        rng = random.Random(f"fake-agent-{self.seed}-{self.p}-{item.id}")
        n_views = (1 if rng.random() < 0.7 else 2) if rng.random() < self.look else 0
        zoom = rng.random() < self.zoom
        as_text = rng.random() < self.text
        state = {"views": 0, "zoomed": False, "k": 0}

        def call(name: str, args: dict) -> dict:
            state["k"] += 1
            return {"id": f"fake_{state['k']}", "type": "function",
                    "function": {"name": name, "arguments": json.dumps(args)}}

        def chat(messages: list[dict], tools: list[dict]) -> dict:
            with self._lock:
                self.turns += 1
            offered = {(t.get("function") or t)["name"]: (t.get("function") or t) for t in tools}
            if "get_view" in offered and (self.stubborn or state["views"] < n_views):
                props = offered["get_view"]["parameters"]["properties"]
                state["views"] += 1
                if rng.random() < 0.25:
                    args = {"azimuth_deg": rng.choice([-90, 0, 90, 180, 30]), "elevation_deg": rng.choice([10, 45, 80])}
                else:
                    args = {"camera": rng.choice(props["camera"]["enum"])}
                if "state" in props:
                    args["state"] = rng.choice(props["state"]["enum"])
                calls = [call("get_view", args)]
                if zoom and not state["zoomed"] and "zoom" in offered:
                    state["zoomed"] = True
                    calls.append(call("zoom", {"image_index": 1, "x0": 0.25, "y0": 0.25, "x1": 0.75, "y1": 0.75}))
                return {"role": "assistant", "content": None, "tool_calls": calls}
            reply = self.answerer.answer(item)
            if as_text:
                return {"role": "assistant", "content": json.dumps(reply)}
            return {"role": "assistant", "content": None, "tool_calls": [call("answer", reply)]}
        return chat


# ------------------------------------------------------------------------------------------------- run

def _scene_dir(scene_dirs, seed: int) -> Path | None:
    if isinstance(scene_dirs, Mapping):
        d = scene_dirs.get(seed, scene_dirs.get(str(seed)))
        return Path(d) if d is not None else None
    root = Path(scene_dirs)
    if (root / str(seed) / "scene.json").exists():
        return root / str(seed)
    if (root / "scene.json").exists():
        return root
    return None


def _safe(model: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in model)


def episode_key(model: str, item: Item, max_steps: int) -> str:
    return f"{item_key(model, item)}|agentic|steps{max_steps}"


def run_agentic(items: list[Item], model: str, scene_dirs: Mapping | Path | str, max_steps: int = DEFAULT_MAX_STEPS,
                cache_dir: Path = DEFAULT_CACHE, client=None, fake: FakeAgent | FakeModel | None = None,
                check: Check | None = None, concurrency: int = 4, renders_dir: Path | None = None) -> list[Result]:
    """Agentic results for `items` (pictures items are copied to mode "agentic"; agentic items are used as is), in
    order. `model` is a Gemini model id or "fake:<p>"; `fake` overrides the offline agent (a FakeAgent, a runner
    FakeModel, or anything with `session(item) -> chat(messages, tools)`). `scene_dirs` maps seed -> scene folder, or
    is a scenes root holding <seed>/scene.json (or one scene folder). `check` grades J3 as in runner.run. Renders are
    cached in `renders_dir` (default cache_dir/renders)."""
    cache_dir = Path(cache_dir)
    renders_dir = Path(renders_dir) if renders_dir else cache_dir / "renders"
    cache = Cache(cache_dir / f"{_safe(model)}.agentic.jsonl")
    if isinstance(fake, FakeModel):
        fake = FakeAgent(fake.p, fake.seed, answerer=fake)
    if fake is None and model.startswith("fake"):
        fake = FakeAgent(float(model.split(":", 1)[1]) if ":" in model else 0.7)
    aitems = [agentic_item(i) for i in items]

    def one(item: Item) -> Result:
        key = episode_key(model, item, max_steps)
        row = cache.get(key)
        cached = row is not None
        base = {"mode": MODE, "job": item.job, "question": item.meta.get("question"),
                "base_item": item.meta.get("base_item")}
        if not cached:
            t0 = time.perf_counter()
            try:
                sd = _scene_dir(scene_dirs, item.seed)
                if sd is None:
                    raise FileNotFoundError(f"no scene folder for seed {item.seed}")
                scope = scope_for(item, sd)
                usage: dict = {}
                if fake is not None:
                    ep = run_episode(item, scope, fake.session(item), max_steps, renders_dir)
                    usd = 0.0
                else:
                    from iris.model_client import GeminiModel
                    m = GeminiModel(model, client=client)
                    ep = run_episode(item, scope, lambda msgs, tools: m.chat(msgs, tools), max_steps, renders_dir)
                    usage = m.usage.as_dict(model)
                    usd = usage["usd"]
            except Exception as e:   # one failed episode never sinks the run; it is retried next run
                return Result(item.id, model, None, None, {**base, "cached": False,
                                                          "error": f"{type(e).__name__}: {e}"},
                              time.perf_counter() - t0, 0.0)
            row = {"key": key, "model": model, "item_id": item.id, "reply": ep.pop("reply"),
                   "latency_s": round(time.perf_counter() - t0, 4), "cost_usd": usd,
                   "episode": {**ep, "max_steps": max_steps, "usage": usage}}
            cache.put(row)
        correct, detail = grade(item, row["reply"], check)
        return Result(item.id, model, row["reply"], correct,
                      {**detail, **base, "cached": cached, **row.get("episode", {})},
                      row["latency_s"], row["cost_usd"])

    with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
        return list(pool.map(one, aitems))
