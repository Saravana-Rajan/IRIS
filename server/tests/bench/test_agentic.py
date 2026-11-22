"""Agentic mode: visual tools only, letters kept, steps capped, trajectories kept, graded exactly like pictures."""
import json
import os
from dataclasses import asdict, replace
from pathlib import Path

import jsonschema
import pytest
from PIL import Image

from iris_bench import agentic, jobs, render, runner
from iris_bench.agentic import (FakeAgent, agentic_item, answer_params, coerce_args, crop_box, leaks,
                                letters_consistent, render_view, run_agentic, scope_for, tool_specs, zoom_image)
from iris_bench.spec import Camera, Element, Fix, Item, Opening, Scene, View

LABELS = {"e1": "A", "e3": "B", "o1": "P"}
FOCUS = ["e1", "e3"]
IDS = ("e1", "e2", "e3", "e4", "o1")
KINDS = ("beam", "column", "slab", "duct", "pipe", "tray", "bracket")


def _scene() -> Scene:
    beam = Element("e1", "beam", "structure", "box", min=(0, -0.15, 2.4), max=(6, 0.15, 3.0),
                   openings=[Opening("o1", (2.5, -0.15, 2.55), (3.3, 0.15, 2.85))])
    duct = Element("e2", "duct", "service", "box", min=(2.6, -2, 2.6), max=(3.2, 2, 2.8))
    pipe = Element("e3", "pipe", "service", "cylinder", start=(4.2, -2, 2.7), end=(4.2, 2, 2.7), radius=0.06)
    slab = Element("e4", "slab", "structure", "box", min=(-2, -4, 3.0), max=(8, 4, 3.2))
    return Scene(seed=7, elements=[beam, duct, pipe, slab], planted=[])


def _png(path: Path, size=(256, 256), color=(200, 210, 220)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path)
    return path


@pytest.fixture
def scene_dir(tmp_path) -> Path:
    """A scene folder as the pipeline leaves it: scene.json, three pictures of the pair e1/e3 and views.json."""
    d = tmp_path / "scenes" / "7"
    d.mkdir(parents=True)
    _scene().save(d / "scene.json")
    views = []
    for i, name in enumerate("ABC"):
        img = _png(d / "render" / f"e1-e3_{name}.png", color=(200, 200 - 40 * i, 220))
        views.append(asdict(View(name, os.path.relpath(img, d), os.path.relpath(img, d), dict(LABELS),
                                 {"e1": "#ff0000", "e3": "#00ff00"}, {"e1": 900, "e3": 400}, list(FOCUS))))
    (d / "views.json").write_text(json.dumps(views))
    return d


def _letters() -> dict:
    return {"A": "e1", "B": "e3", "P": "o1", "C": "e2", "D": "e4"}


def _item(d: Path, job="J1_sort", **kw) -> Item:
    imgs = [str((d / "render" / f"e1-e3_{n}.png").resolve()) for n in "ABC"]
    schemas = {"J1_sort": jobs.schema_j1(), "J3_fix": jobs.schema_j3(["A", "B"], ["P"]),
               "J5_review": jobs.schema_j5(), "J7_pick_valid": jobs.schema_j7(3), "J8_spatial": jobs.schema_j8_order(["A", "B"])}
    expected = {"J1_sort": {"answer": "a"}, "J3_fix": {"element": "B", "direction": "up", "distance_mm": 300,
                                                       "via_opening": None},
                "J5_review": {"resolved": True}, "J7_pick_valid": {"valid": [1, 3]}, "J8_spatial": {"order": ["B", "A"]}}
    truth = {"question": "q", "answer": "x", "letters": _letters(), "pair": list(FOCUS), "expected": expected[job]}
    if job == "J5_review":
        truth["fix"] = asdict(Fix("e3", dz=0.4))
    if job == "J7_pick_valid":
        truth["candidates"] = [{"number": i, "fix": asdict(Fix("e3", dz=0.1 * i)), "valid": i != 2} for i in (1, 2, 3)]
    it = Item(id=f"7-{job}-0-pictures", seed=7, job=job, mode="pictures", images=imgs,
              prompt=jobs._finish("Here are pictures of two elements labelled A and B. Which is it?"),
              schema=schemas[job], truth=truth, meta={"question": "q", "n": 0}, categories=["spatial_reasoning"])
    return replace(it, **kw)


class FakeRender:
    """Stands in for render.render_scene: writes a PNG per view and letters the focus like LABELS (or `labels`)."""

    def __init__(self, labels=None):
        self.calls = []
        self.labels = labels

    def __call__(self, scene_dir, focus, views=None, style="shaded", fix=None, seed=None, width=1024, out_dir=None,
                 tag=None, cameras=None, compass=True):
        self.calls.append({"focus": list(focus), "views": list(views), "fix": fix, "cameras": cameras})
        png = _png(Path(out_dir) / f"{tag}_{views[0]}.png", color=(10 * len(self.calls) % 255, 120, 90))
        labels = self.labels or {k: v for k, v in LABELS.items() if k in focus or k.startswith("o")}
        return [View(views[0], os.path.relpath(png, scene_dir), os.path.relpath(png, scene_dir), labels, {}, {},
                     list(focus))]


@pytest.fixture
def fake_render(monkeypatch):
    fr = FakeRender()
    monkeypatch.setattr(render, "render_scene", fr)
    return fr


class Recorder:
    """Wraps a session's chat: keeps every message list and tool list it was given."""

    def __init__(self, agent):
        self.agent, self.seen = agent, []

    def session(self, item):
        chat = self.agent.session(item)

        def rec(messages, tools):
            self.seen.append((json.loads(json.dumps(messages)), tools))
            return chat(messages, tools)
        return rec


class Scripted:
    """An agent that plays fixed assistant turns (then repeats the last one)."""

    def __init__(self, *turns):
        self.turns, self.calls = list(turns), 0

    def session(self, item):
        queue = list(self.turns)

        def chat(messages, tools):
            self.calls += 1
            return queue.pop(0) if len(queue) > 1 else queue[0]
        return chat


def _call(name, args, i=0):
    return {"id": f"c{i}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


# ------------------------------------------------------------------------------------------------- items and tools

def test_agentic_item_copy():
    it = _item(Path("/nowhere"))
    a = agentic_item(it)
    assert a.id == "7-J1_sort-0-agentic" and a.mode == "agentic" and a.meta["base_item"] == it.id
    assert (a.prompt, a.schema, a.truth, a.images) == (it.prompt, it.schema, it.truth, it.images)
    assert agentic_item(a) is a
    with pytest.raises(ValueError):
        agentic_item(replace(it, mode="no_image"))


def test_tool_schemas_valid(scene_dir):
    from iris.model_client import to_tools
    for job in ("J1_sort", "J3_fix", "J5_review", "J7_pick_valid", "J8_spatial"):
        it = agentic_item(_item(scene_dir, job))
        scope = scope_for(it, scene_dir)
        tools = tool_specs(it, scope)
        assert [t["function"]["name"] for t in tools] == ["get_view", "zoom", "answer"]
        for t in tools:
            assert t["type"] == "function" and t["function"]["description"]
            jsonschema.Draft202012Validator.check_schema(t["function"]["parameters"])
        decls = to_tools(tools)[0].function_declarations
        assert [d.name for d in decls] == ["get_view", "zoom", "answer"]
        gv = tools[0]["function"]["parameters"]["properties"]
        assert gv["camera"]["enum"] == ["A", "B", "C", "top", "section"]
        assert ("state" in gv) == (job in ("J5_review", "J7_pick_valid"))
        if job == "J5_review":
            assert gv["state"]["enum"] == ["before", "after"]
        if job == "J7_pick_valid":
            assert gv["state"]["enum"] == ["before", "solution_1", "solution_2", "solution_3"]
        # the answer tool takes exactly the reply the item's schema takes
        good = runner.expected_reply(it)
        params = tools[2]["function"]["parameters"]
        sent = {**good, "via_opening": "none"} if job == "J3_fix" else good
        jsonschema.validate(sent, params)
        jsonschema.validate(coerce_args(sent, it.schema), it.schema)
    only = tool_specs(it, scope, looks=False)
    assert [t["function"]["name"] for t in only] == ["answer"]


def test_answer_params_and_coercion():
    s = jobs.schema_j3(["A", "B"], ["P", "Q"])
    p = answer_params(s)
    assert p["properties"]["via_opening"]["enum"] == ["P", "Q", "none"]
    assert None in s["properties"]["via_opening"]["enum"]          # the item's own schema is untouched
    got = coerce_args({"element": "A", "direction": "up", "distance_mm": 300.0, "via_opening": "none",
                       "confidence": 0.5, "reason": "r"}, s)
    assert got["distance_mm"] == 300 and type(got["distance_mm"]) is int and got["via_opening"] is None
    assert coerce_args({"valid": [1.0, 3.0]}, jobs.schema_j7(3)) == {"valid": [1, 3]}
    assert coerce_args({"answer": "none"}, jobs.schema_j8_pick(["A", "none"])) == {"answer": "none"}


def test_camera_for():
    assert agentic.camera_for({"camera": "b"}) == "B"
    top = agentic.camera_for({"camera": "top"})
    assert (top.elevation_deg, top.projection) == (90.0, "orthographic")
    free = agentic.camera_for({"azimuth_deg": -90.4, "elevation_deg": 120})
    assert (free.name, free.azimuth_deg, free.elevation_deg) == ("az270_el90", 270.0, 90.0)
    for bad in ({}, {"camera": "iso"}, {"azimuth_deg": "east"}):
        with pytest.raises(ValueError):
            agentic.camera_for(bad)


# ------------------------------------------------------------------------------------------------- zoom

def test_crop_box_math():
    assert crop_box(100, 50, 0.25, 0.2, 0.75, 0.6) == (25, 10, 75, 30)
    assert crop_box(100, 50, 0.75, 0.6, 0.25, 0.2) == (25, 10, 75, 30)       # corners in either order
    assert crop_box(100, 50, -1, -3, 2, 9) == (0, 0, 100, 50)                 # clamped
    assert crop_box(1000, 1000, 0.5, 0.5, 0.5, 0.5) == (475, 475, 525, 525)   # widened to 5% about its centre
    assert crop_box(1000, 1000, 0.0, 0.99, 0.01, 1.0) == (0, 950, 50, 1000)   # widened inside the picture
    assert crop_box(10, 10, float("nan"), 0, 1, 1) == (0, 0, 10, 10)


def test_zoom_image_upscales_to_1024(tmp_path):
    src = tmp_path / "src.png"
    im = Image.new("RGB", (200, 100), (0, 0, 0))
    im.paste((255, 0, 0), (100, 0, 200, 100))                                 # right half red
    im.save(src)
    out = tmp_path / "z.png"
    box = crop_box(200, 100, 0.5, 0.0, 1.0, 0.4)
    assert box == (100, 0, 200, 40)
    assert zoom_image(src, box, out) == (1024, 410)
    with Image.open(out) as z:
        assert z.size == (1024, 410) and z.getpixel((512, 200)) == (255, 0, 0)


# ------------------------------------------------------------------------------------------------- get_view

def test_scope_reads_the_items_views(scene_dir):
    s = scope_for(_item(scene_dir), scene_dir)
    assert s.focus == FOCUS and s.labels == LABELS and s.states == {"before": None} and not s.mixed_letters
    s5 = scope_for(_item(scene_dir, "J5_review"), scene_dir)
    assert set(s5.states) == {"before", "after"} and s5.states["after"]["element"] == "e3"


def test_get_view_cached_and_letter_checked(scene_dir, tmp_path, fake_render):
    s = scope_for(_item(scene_dir), scene_dir)
    png, view, cached = render_view(s, Camera("top", 0, 90, 1.0, "orthographic"), "before", tmp_path / "r")
    assert png.exists() and not cached and letters_consistent(view, s.labels)
    assert fake_render.calls[-1]["views"] == ["top"] and fake_render.calls[-1]["focus"] == FOCUS
    png2, _, cached2 = render_view(s, Camera("top", 0, 90, 1.0, "orthographic"), "before", tmp_path / "r")
    assert cached2 and png2 == png and len(fake_render.calls) == 1             # keyed by scene/focus/camera
    render_view(s, "C", "before", tmp_path / "r")
    assert fake_render.calls[-1]["views"] == ["C"] and fake_render.calls[-1]["cameras"] is None
    s5 = scope_for(_item(scene_dir, "J5_review"), scene_dir)
    render_view(s5, "A", "after", tmp_path / "r")
    assert fake_render.calls[-1]["views"] == ["after_A"] and fake_render.calls[-1]["fix"]["dz"] == 0.4
    render_view(s5, "A", "before", tmp_path / "r")
    assert fake_render.calls[-1]["views"] == ["before_A"]                      # framed like the before pictures
    assert not letters_consistent(View("x", "", "", {"e1": "B", "e3": "A"}, {}, {}, FOCUS), s.labels)
    assert not letters_consistent(View("x", "", "", {"e2": "A"}, {}, {}, FOCUS), s.labels)


def test_get_view_refuses_a_view_with_other_letters(scene_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(render, "render_scene", FakeRender(labels={"e1": "B", "e3": "A"}))
    agent = Scripted({"role": "assistant", "content": None, "tool_calls": [_call("get_view", {"camera": "top"})]},
                     {"role": "assistant", "content": '{"answer": "a", "confidence": 0.9, "reason": "r"}'})
    (r,) = run_agentic([_item(scene_dir)], "fake:1", scene_dir.parent, cache_dir=tmp_path / "c", fake=agent)
    call = r.detail["trajectory"][0]["calls"][0]
    assert call["letters_consistent"] is False and call["error"] == "that view is unavailable"
    assert r.detail["extra_images"] == 0 and "picture" not in call and r.correct is True


@pytest.mark.skipif(not render.available(), reason="node or bench/render node_modules not installed")
def test_get_view_real_renderer_keeps_letters(tmp_path):
    d = tmp_path / "scenes" / "7"
    d.mkdir(parents=True)
    _scene().save(d / "scene.json")
    shown = render.render_scene(d, FOCUS, views=("A",), width=512)
    (d / "views.json").write_text(json.dumps([asdict(v) for v in shown]))
    it = replace(_item(d, "J5_review"), images=[str((d / shown[0].image).resolve())])
    s = scope_for(it, d)
    assert s.focus == FOCUS and s.labels == shown[0].labels
    for cam, state in ((Camera("top", 0, 90, 1.0, "orthographic"), "before"),
                       (agentic.camera_for({"azimuth_deg": 200, "elevation_deg": 20}), "after")):
        png, view, cached = render_view(s, cam, state, tmp_path / "r")
        assert png.exists() and not cached
        assert {k: view.labels[k] for k in shown[0].labels} == shown[0].labels   # same letters
        assert {k: view.colors[k] for k in FOCUS} == {k: shown[0].colors[k] for k in FOCUS}   # same colours
        assert letters_consistent(view, s.labels)
        with Image.open(png) as im:
            assert im.size == (1024, 1024)


# ------------------------------------------------------------------------------------------------- the loop

def test_max_steps_enforced(scene_dir, tmp_path, fake_render):
    agent = FakeAgent(1.0, stubborn=True)
    (r,) = run_agentic([_item(scene_dir)], "fake:1", scene_dir.parent, max_steps=3, cache_dir=tmp_path / "c",
                       fake=agent)
    d = r.detail
    assert d["steps"] == 3 and agent.turns == 3 and d["forced_final"] is True
    assert [s["offered"] for s in d["trajectory"]] == ["all", "all", "answer"]
    assert len(d["views_requested"]) == 2 and d["answered_via"] == "tool" and r.correct is True

    mute = Scripted({"role": "assistant", "content": "Let me think about it."})
    (r2,) = run_agentic([_item(scene_dir)], "fake:mute", scene_dir.parent, max_steps=4, cache_dir=tmp_path / "c2",
                        fake=mute)
    assert mute.calls == 4 and r2.detail["steps"] == 4 and r2.reply is None and r2.correct is None
    assert sum(1 for s in r2.detail["trajectory"] if s.get("nudged")) == 3

    one = Scripted({"role": "assistant", "content": None, "tool_calls": [_call("answer", runner.expected_reply(
        _item(scene_dir)))]})
    (r3,) = run_agentic([_item(scene_dir)], "fake:one", scene_dir.parent, max_steps=1, cache_dir=tmp_path / "c3",
                        fake=one)
    assert r3.detail["steps"] == 1 and r3.detail["trajectory"][0]["offered"] == "answer" and r3.correct is True


def test_trajectory_recorded(scene_dir, tmp_path, fake_render):
    agent = FakeAgent(1.0, look=1.0, zoom=1.0, text=0.0)
    (r,) = run_agentic([_item(scene_dir, "J5_review")], "fake:1.0", scene_dir.parent, cache_dir=tmp_path / "c",
                       fake=agent)
    d = r.detail
    assert r.item_id == "7-J5_review-0-agentic" and d["mode"] == "agentic" and d["base_item"] == "7-J5_review-0-pictures"
    calls = [c for s in d["trajectory"] for c in s["calls"]]
    looks = [c for c in calls if c["tool"] in ("get_view", "zoom")]
    assert {"get_view", "zoom"} <= {c["tool"] for c in looks} and calls[-1]["tool"] == "answer"
    assert d["extra_images"] == len(looks) == d["tool_calls"] and d["zooms"] == 1
    assert [c["picture"] for c in looks] == list(range(4, 4 + len(looks)))      # numbered after the 3 shown
    gv = next(c for c in looks if c["tool"] == "get_view")
    assert gv["state"] in ("before", "after") and Path(gv["image"]).exists() and gv["letters_consistent"]
    z = next(c for c in looks if c["tool"] == "zoom")
    assert z["of_picture"] == 1 and z["box_px"] == [64, 64, 192, 192]
    with Image.open(z["image"]) as im:
        assert max(im.size) == 1024
    assert d["steps"] == len(d["trajectory"]) and d["answered_via"] == "tool" and r.correct is True
    assert d["views_requested"] and r.latency_s > 0 and r.cost_usd == 0.0

    # rerun: from the cache, no new turns
    turns = agent.turns
    (again,) = run_agentic([_item(scene_dir, "J5_review")], "fake:1.0", scene_dir.parent, cache_dir=tmp_path / "c",
                           fake=agent)
    assert again.detail["cached"] is True and agent.turns == turns and again.reply == r.reply
    assert again.detail["trajectory"] == d["trajectory"]


def test_fake_agent_deterministic_and_answers(scene_dir, tmp_path, fake_render):
    items = [_item(scene_dir, j) for j in ("J1_sort", "J5_review", "J7_pick_valid", "J8_spatial")]
    a = run_agentic(items, "fake:1.0", scene_dir.parent, cache_dir=tmp_path / "a")
    b = run_agentic(items, "fake:1.0", scene_dir.parent, cache_dir=tmp_path / "b")
    assert [r.reply for r in a] == [r.reply for r in b]
    assert [r.detail["views_requested"] for r in a] == [r.detail["views_requested"] for r in b]
    assert all(r.correct is True for r in a)
    assert all(r.item_id.endswith("-agentic") for r in a)


# ------------------------------------------------------------------------------------------------- grading

@pytest.mark.parametrize("job", ["J1_sort", "J3_fix", "J5_review", "J7_pick_valid", "J8_spatial"])
def test_graded_identically_to_pictures(scene_dir, tmp_path, fake_render, job):
    pic = _item(scene_dir, job)
    seen = []

    def check(item, reply):
        seen.append((item.id, item.mode, reply))
        return reply.get("element") == "B", {"checked": True}

    good = runner.expected_reply(pic)
    wrong = runner.random_from_schema(pic.schema, __import__("random").Random(3))
    off_schema = {"nonsense": True}
    no_meta = {k: v for k, v in good.items() if k not in ("confidence", "reason")}
    for k, reply in enumerate((good, wrong, off_schema, no_meta)):
        for via in ("tool", "text"):
            turn = ({"role": "assistant", "content": None, "tool_calls": [_call("answer", reply)]} if via == "tool"
                    else {"role": "assistant", "content": "```json\n" + json.dumps(reply) + "\n```"})
            (r,) = run_agentic([pic], f"fake:{k}{via}", scene_dir.parent, cache_dir=tmp_path / f"c{k}{via}",
                               fake=Scripted(turn), check=check)
            want_ok, want_detail = runner.grade(pic, reply, check)
            assert r.correct == want_ok, (reply, via)
            assert {k2: r.detail[k2] for k2 in want_detail} == want_detail
            assert r.reply == reply
    if job == "J3_fix":
        agentic_calls = [(i, r) for i, mode, r in seen if mode == "agentic"]   # the hook saw the agentic item
        assert ("7-J3_fix-0-agentic", good) in agentic_calls


def test_tool_transport_coercion_graded_like_the_plain_reply(scene_dir, tmp_path, fake_render):
    """Function-call JSON turns 300 into 300.0 and null into "none": the reply graded is the schema's own."""
    for job, sent in (("J3_fix", {"element": "B", "direction": "up", "distance_mm": 300.0, "via_opening": "none",
                                  "confidence": 0.8, "reason": "r"}),
                      ("J7_pick_valid", {"valid": [1.0, 3.0], "confidence": 0.8, "reason": "r"})):
        pic = _item(scene_dir, job)
        plain = coerce_args(sent, pic.schema)
        check = (lambda it, rep: (rep["distance_mm"] == 300 and rep["via_opening"] is None, {}))
        (r,) = run_agentic([pic], f"fake:{job}", scene_dir.parent, cache_dir=tmp_path / job,
                           fake=Scripted({"role": "assistant", "content": None,
                                          "tool_calls": [_call("answer", sent)]}), check=check)
        assert r.reply == plain and r.correct is True
        assert (r.correct, runner.grade(pic, plain, check)[0]) == (True, True)


# ------------------------------------------------------------------------------------------------- integrity

def _texts(messages) -> list[str]:
    """Every text the model is sent after the item's own prompt: system note, tool results, notes and captions."""
    out = []
    for i, m in enumerate(messages):
        c = m.get("content")
        if m["role"] == "tool" or (m["role"] in ("system", "user") and isinstance(c, str)):
            out.append(c if isinstance(c, str) else json.dumps(c))
        elif m["role"] == "user" and isinstance(c, list) and i > 1:
            out += [p["text"] for p in c if p.get("type") == "text"]
    return out


def test_no_forbidden_tokens_in_tool_outputs(scene_dir, tmp_path, fake_render):
    try:
        from iris_bench.integrity import scan_prompt
    except Exception:   # the integrity module is optional here; our own scan is the same patterns
        scan_prompt = leaks
    rec = Recorder(FakeAgent(0.5, look=1.0, zoom=1.0, stubborn=True))
    items = [_item(scene_dir, j) for j in ("J1_sort", "J3_fix", "J5_review", "J7_pick_valid")]
    bad = Scripted({"role": "assistant", "content": None, "tool_calls": [
        _call("get_view", {"camera": "iso"}, 1), _call("zoom", {"image_index": 99, "x0": 0, "y0": 0, "x1": 1, "y1": 1}, 2),
        _call("measure", {"a": "A"}, 3)]}, {"role": "assistant", "content": "{}"})
    run_agentic(items, "fake:0.5", scene_dir.parent, max_steps=3, cache_dir=tmp_path / "c", fake=rec)
    run_agentic(items[:1], "fake:bad", scene_dir.parent, max_steps=3, cache_dir=tmp_path / "d", fake=Recorder(bad))
    assert rec.seen
    texts = [t for msgs, _ in rec.seen for t in _texts(msgs)]
    texts += [json.dumps(tools) for _, tools in rec.seen]
    texts += [agentic.AGENT_SYSTEM, agentic.FORCE_NOTE, agentic.NUDGE_NOTE]
    tool_results = [m["content"] for msgs, _ in rec.seen for m in msgs if m["role"] == "tool"]
    assert any('"picture"' in t for t in tool_results)
    for t in texts:
        assert leaks(t) == [] and scan_prompt(t) == [], t
        assert ".png" not in t and "/" not in t.replace("w/", "")         # no file names or paths
        assert not any(i in t for i in IDS)
    for t in tool_results:   # only these keys ever come back
        assert set(json.loads(t)) <= {"picture", "shows", "error"}


def test_leak_guard_blocks_a_payload():
    rec = {}
    assert json.loads(agentic._clean_payload({"shows": "the e3 pipe, 300 mm away"}, rec)) == {"error": "unavailable"}
    assert set(rec["integrity_block"]) >= {"e3", "pipe", "300 mm"}
    assert agentic._clean_payload({"picture": 4, "shows": "the same parts from camera B"}, {}) == \
        '{"picture": 4, "shows": "the same parts from camera B"}'
    assert all(leaks(k) for k in KINDS) and leaks("x = 3") and leaks("(1, 2, 3)") and not leaks("Picture 4")
