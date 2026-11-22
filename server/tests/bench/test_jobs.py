import json
import re
from collections import Counter

import jsonschema
import pytest

from iris_bench import controls, jobs, runner
from iris_bench.spec import Element, Fix, Opening, Planted, Scene, View

FORBIDDEN = ("beam", "duct", "pipe", "tray", "mm", "column", "slab", "bracket")


def make_scene(seed=1) -> Scene:
    beam = Element("e1", "beam", "structure", "box", min=(0, -0.2, 2.5), max=(6, 0.2, 3.0),
                   openings=[Opening("o1", (2.8, -0.2, 2.6), (3.2, 0.2, 2.9)),
                             Opening("o2", (4.8, -0.2, 2.7), (4.9, 0.2, 2.8))])
    duct = Element("e2", "duct", "service", "box", min=(2.9, -3, 2.4), max=(3.1, 3, 2.6))
    pipe = Element("e3", "pipe", "service", "cylinder", start=(0, 1, 2.0), end=(6, 1, 2.0), radius=0.05)
    bracket = Element("e4", "bracket", "support", "box", min=(1, 0.9, 1.9), max=(1.1, 1.1, 1.95), supports="e3")
    slab = Element("e5", "slab", "structure", "box", min=(-1, -4, 3.0), max=(7, 4, 3.2))
    planted = [Planted("e1", "e2", "real", -0.1, mover="e2", good_fix=Fix("e2", dz=-0.15), fitting_openings=["o1"]),
               Planted("e3", "e4", "by_design", 0.0),
               Planted("e3", "e5", "not_touching", 0.95)]
    return Scene(seed=seed, elements=[beam, duct, pipe, bracket, slab], planted=planted,
                 challenge={"density": "low", "occlusion": 0.1})


def make_views(labels=None) -> list[View]:
    labels = labels or {"e1": "C", "e2": "A", "e3": "D", "e4": "B", "e5": "E", "o1": "Q", "o2": "P"}
    vis = {k: 500 for k in labels if k.startswith("e")}
    return [View(n, f"{n}.png", f"{n}_id.png", labels, {}, vis, focus=["e1", "e2"]) for n in "ABC"] + \
           [View("A2", "A2.png", "A2_id.png", labels, {}, vis, focus=["e3", "e4", "e5"])]


def fix_renderer(scene, fix):
    labels = make_views()[0].labels
    return [View("before", "before.png", "b_id.png", labels, {}, {"e2": 300}),
            View("after", "after.png", "a_id.png", labels, {}, {"e2": 250})]


@pytest.fixture
def items():
    return jobs.build_items(make_scene(), make_views(), modes=("pictures", "pictures_text"),
                            fix_renderer=fix_renderer)


def test_all_jobs_built(items):
    by = Counter((i.job, i.mode) for i in items)
    assert by[("J1_sort", "pictures")] == 3
    for j in ("J2_who_moves", "J3_fix", "J4_opening", "J5_review"):
        assert by[(j, "pictures")] == 1 and by[(j, "pictures_text")] == 1
    assert len({i.id for i in items}) == len(items)


def test_pictures_prompts_clean(items):
    for it in items:
        assert it.prompt.rstrip().endswith("Answer with JSON only.")
        if it.mode == "pictures":
            low = it.prompt.lower()
            for w in FORBIDDEN:
                assert w not in low, (w, it.job, it.prompt)
            assert not re.search(r"\d+\s*(mm|m)\b", low)
            for e in make_scene().elements:   # ids never shown
                assert not re.search(rf"\b{e.id}\b", it.prompt)


def test_pictures_text_has_facts(items):
    t = next(i for i in items if i.job == "J1_sort" and i.mode == "pictures_text")
    assert "Measured facts" in t.prompt and "mm" in t.prompt


def test_schemas_valid_and_expected_replies_pass(items):
    for it in items:
        jsonschema.Draft202012Validator.check_schema(it.schema)
        exp = runner.expected_reply(it)
        if exp is not None:
            jsonschema.validate(exp, it.schema)
        json.dumps(it.schema)


def test_truths_and_meta(items):
    j1 = {i.truth["kind"] for i in items if i.job == "J1_sort"}
    assert j1 == {"real", "by_design", "not_touching"}
    j2 = next(i for i in items if i.job == "J2_who_moves")
    assert j2.truth["mover_letter"] == "A"
    j4 = next(i for i in items if i.job == "J4_opening")
    assert j4.truth["fitting"] == ["Q"] and j4.schema["properties"]["fitting"]["items"]["enum"] == ["P", "Q"]
    j3 = next(i for i in items if i.job == "J3_fix")
    assert j3.truth["expected"] == {"element": "A", "direction": "down", "distance_mm": 150, "via_opening": None}
    assert "P" in j3.prompt and "Q" in j3.prompt
    real = next(i for i in items if i.job == "J1_sort" and i.truth["kind"] == "real")
    assert real.meta["overlap_mm"] == 100 and real.meta["gap_mm"] == 0 and real.meta["density"] == "low"
    assert real.meta["visible_px"] == {"C": 500, "A": 500}
    j5 = next(i for i in items if i.job == "J5_review")
    assert j5.images == ["before.png", "after.png"] and j5.truth["fix"]["element"] == "e2"
    assert j5.truth["variant"] in ("good", "too_small", "wrong_direction", "hits_third")


def test_letters_missing_from_views_are_filled():
    its = jobs.build_items(make_scene(), make_views({"e1": "C"}), jobs=("J3_fix",))
    letters = its[0].truth["letters"]
    assert set(letters.values()) >= {"e1", "e2", "o1", "o2"}
    assert all(k in "PQRSTUVWXYZ" for k, v in letters.items() if v.startswith("o"))


def test_reply_to_fix(items):
    j3 = next(i for i in items if i.job == "J3_fix" and i.mode == "pictures")
    f = jobs.reply_to_fix(j3, {"element": "A", "direction": "north", "distance_mm": 250, "via_opening": "Q"})
    assert (f.element, f.dx, f.dy, f.dz, f.via_opening) == ("e2", 0, 0.25, 0, "o1")
    f = jobs.reply_to_fix(j3, {"element": "a", "direction": "down", "distance_mm": 150, "via_opening": None})
    assert f.dz == pytest.approx(-0.15) and f.via_opening is None
    for bad in ({"element": "Z", "direction": "up", "distance_mm": 1, "via_opening": None},
                {"element": "A", "direction": "sideways", "distance_mm": 1, "via_opening": None},
                {"element": "A", "direction": "up", "distance_mm": 1, "via_opening": "A"},
                {"element": "Q", "direction": "up", "distance_mm": 1, "via_opening": None}):
        with pytest.raises(ValueError):
            jobs.reply_to_fix(j3, bad)


def test_candidate_fixes():
    s = make_scene()
    c = jobs.candidate_fixes(s, s.planted[0])
    assert set(c) == {"good", "too_small", "wrong_direction", "hits_third"}
    assert c["too_small"].dz == pytest.approx(-0.0375)
    assert c["wrong_direction"].dy != 0 and c["wrong_direction"].dz == 0   # along the run (Y)


def test_balance_j1():
    its = []
    for seed in range(4):
        its += jobs.build_items(make_scene(seed), make_views(), jobs=("J1_sort",))
    its += jobs.build_items(Scene(9, make_scene().elements, [make_scene().planted[0]]), make_views(), jobs=("J1_sort",))
    bal = jobs.balance_j1(its, seed=3)
    counts = Counter(i.truth["kind"] for i in bal)
    assert set(counts.values()) == {4}


def test_letter_order_randomised_by_seed():
    firsts = {jobs.build_items(make_scene(s), make_views(), jobs=("J1_sort",))[0].prompt.split("labelled ")[1][0]
              for s in range(20)}
    assert firsts == {"A", "C"}


def test_fake_run_and_cache(items, tmp_path):
    fake = runner.FakeModel(0.7)
    res = runner.run(items, "fake:0.7", cache_dir=tmp_path, fake=fake)
    assert len(res) == len(items) and fake.calls == len(items)
    assert all(r.reply is not None for r in res)
    graded = [r for r in res if r.correct is not None]
    assert graded and all(isinstance(r.correct, bool) for r in graded)
    assert all(r.detail.get("needs_checker") for r in res if r.item_id.split("-")[1] in ("J3_fix", "J5_review"))
    fake2 = runner.FakeModel(0.7)
    res2 = runner.run(items, "fake:0.7", cache_dir=tmp_path, fake=fake2)
    assert fake2.calls == 0 and all(r.detail["cached"] for r in res2)
    assert [r.reply for r in res] == [r.reply for r in res2]


def test_fake_perfect_is_correct(items, tmp_path):
    res = runner.run(items, "fake:1.0", cache_dir=tmp_path)
    assert all(r.correct for r in res if r.correct is not None)


def test_check_callable_used(items, tmp_path):
    seen = []

    def check(item, reply):
        if item.job == "J3_fix":
            seen.append(jobs.reply_to_fix(item, reply))
        return True, {"checked": True}
    res = runner.run(items, "fake:1.0", cache_dir=tmp_path, check=check)
    assert all(r.correct for r in res) and seen


def test_gemini_path_uses_client(items, tmp_path, monkeypatch):
    calls = []

    def fake_call(model, client, item):
        calls.append(item.id)
        return runner.expected_reply(item) or {"good": True}, 0.001
    monkeypatch.setattr(runner, "_call_gemini", fake_call)
    j1 = [i for i in items if i.job == "J1_sort"]
    res = runner.run(j1, "gemini-x", cache_dir=tmp_path)
    assert len(calls) == len(j1) and all(r.correct and r.cost_usd == 0.001 for r in res)
    runner.run(j1, "gemini-x", cache_dir=tmp_path)
    assert len(calls) == len(j1)


def test_controls(items):
    it = next(i for i in items if i.job == "J1_sort" and i.truth["kind"] == "real" and i.mode == "pictures")
    ni = controls.no_image(it)
    assert ni.mode == "no_image" and ni.images == [] and ni.prompt == it.prompt and ni.truth == it.truth
    assert ni.id.endswith("-no_image") and ni.id != it.id
    other = next(i for i in jobs.build_items(make_scene(2), make_views(), jobs=("J1_sort",))
                 if i.truth["kind"] != "real")
    other.images = ["/other/A.png"]
    sw = controls.swapped(it, other)
    assert sw.mode == "swapped" and sw.images == ["/other/A.png"] and sw.truth == it.truth
    assert sw.meta["images_from"] == other.id
    with pytest.raises(ValueError):
        controls.swapped(it, it)


def test_write_batch_jsonl(items, tmp_path):
    png = b"\x89PNG\r\n\x1a\nfake"
    for n in ("A", "B", "C", "A2", "before", "after"):
        (tmp_path / f"{n}.png").write_bytes(png)
    its = jobs.build_items(make_scene(), make_views(), scene_dir=tmp_path, fix_renderer=fix_renderer)
    out = tmp_path / "batch.jsonl"
    assert runner.write_batch_jsonl(its, out) == len(its)
    lines = [json.loads(x) for x in out.read_text().splitlines()]
    req = lines[0]["request"]
    gc = req["generationConfig"]
    assert gc["responseMimeType"] == "application/json" and gc["responseSchema"]["type"] == "OBJECT"
    assert req["contents"][0]["parts"][0]["inlineData"]["mimeType"] == "image/png"
    j3 = next(json.loads(x)["request"] for x, i in zip(out.read_text().splitlines(), its) if i.job == "J3_fix")
    via = j3["generationConfig"]["responseSchema"]["properties"]["via_opening"]
    assert via["nullable"] is True and None not in via["enum"]
