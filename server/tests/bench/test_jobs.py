import hashlib
import json
import re
from collections import Counter
from dataclasses import asdict

import jsonschema
import pytest

from iris_bench import checker, controls, jobs, runner
from iris_bench.spec import JOB_CATEGORY, Camera, Element, Fix, Opening, Planted, Relation, Resolution, Scene, View

# The same leak checks as integrity.prompts_clean: kinds, ids, measurements, coordinates.
KINDS = ("beam", "column", "slab", "duct", "pipe", "tray", "bracket")
KIND_RE = re.compile(r"\b(" + "|".join(KINDS) + r")s?\b", re.IGNORECASE)
ID_RE = re.compile(r"\b[eo]\d+\b")
MEASURE_RE = re.compile(r"\b\d+(?:\.\d+)?\s*(?:mm|cm|m)\b|\bmm\b", re.IGNORECASE)
TRIPLE_RE = re.compile(r"\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)")
COORD_RE = re.compile(r"\b[xyz]\s*=\s*-?\d", re.IGNORECASE)
DECIMAL_RE = re.compile(r"\d\.\d")
ALL = set(JOB_CATEGORY)


# ------------------------------------------------------------------------------------------------- the scene

def make_scene(seed=1, annotated=True) -> Scene:
    """Beam e1 (openings o1, o2) under slab e5; duct e2 dips into e1 (real); pipe e3 on bracket e4 (by design) and
    well below e5 (apart); pipe e6 through o1; locked tray e7 crossed by pipe e8 (real, e8 must move); tray e9."""
    beam = Element("e1", "beam", "structure", "box", min=(0, -0.2, 2.5), max=(6, 0.2, 3.0),
                   openings=[Opening("o1", (2.8, -0.2, 2.6), (3.2, 0.2, 2.9)),
                             Opening("o2", (4.8, -0.2, 2.7), (4.9, 0.2, 2.8))])
    duct = Element("e2", "duct", "service", "box", min=(2.9, -3, 2.4), max=(3.1, 3, 2.6))
    pipe = Element("e3", "pipe", "service", "cylinder", start=(0, 1, 2.0), end=(6, 1, 2.0), radius=0.05)
    bracket = Element("e4", "bracket", "support", "box", min=(1, 0.9, 1.9), max=(1.1, 1.1, 1.95), supports="e3")
    slab = Element("e5", "slab", "structure", "box", min=(-1, -4, 3.0), max=(7, 4, 3.2))
    thru = Element("e6", "pipe", "service", "cylinder", start=(3.0, -1, 2.75), end=(3.0, 1, 2.75), radius=0.05)
    tray = Element("e7", "tray", "service", "box", min=(4.0, -3, 2.2), max=(4.4, 3, 2.3), locked=True)
    pipe8 = Element("e8", "pipe", "service", "cylinder", start=(3.5, -1.5, 2.28), end=(5.5, -1.5, 2.28), radius=0.05)
    tray9 = Element("e9", "tray", "service", "box", min=(0.5, 2.4, 2.15), max=(2.5, 2.6, 2.25))
    planted = [Planted("e1", "e2", "real", -0.1, mover="e2", good_fix=Fix("e2", dz=-0.15), fitting_openings=["o1"]),
               Planted("e3", "e4", "by_design", 0.0),
               Planted("e3", "e5", "not_touching", 0.95),
               Planted("e7", "e8", "real", -0.07, mover="e8", good_fix=Fix("e8", dz=-0.2))]
    s = Scene(seed=seed, elements=[beam, duct, pipe, bracket, slab, thru, tray, pipe8, tray9], planted=planted,
              challenge={"density": "low", "occlusion": 0.1})
    if annotated:
        annotate(s)
    return s


def annotate(s: Scene) -> None:
    """A hand-made stand-in for truth.annotate: relations written out, resolutions judged by check_fix."""
    s.relations = [Relation("e6", "e1", "passes_through", 0.1, via="o1"), Relation("e4", "e3", "supports", 0.0),
                   Relation("e2", "e1", "clashes", -0.1), Relation("e2", "e1", "crosses"),
                   Relation("e5", "e1", "touches", 0.0), Relation("e5", "e1", "above", 0.0),
                   Relation("e3", "e1", "parallel", 0.893), Relation("e2", "e3", "crosses", 0.35),
                   Relation("e2", "e3", "above", 0.35), Relation("e8", "e7", "clashes", -0.07),
                   Relation("e3", "e5", "clear_of", 0.95), Relation("e9", "e3", "parallel", 1.358)]
    for n, p in enumerate(s.planted):
        for label, fix in jobs.candidate_fixes(s, p).items():
            ck = checker.check_fix(s, fix)
            s.resolutions.append(Resolution(n, label, fix, ck["passed"], ck["clash_gone"], ck["new_hits"], ck))
    s.cameras = [Camera("A"), Camera("top", azimuth_deg=0, elevation_deg=90, projection="orthographic")]


# Like the renderer: every focus pair is lettered A, B (so letters repeat across pairs; e3 is in two pairs).
PAIR_LETTERS = [{"e2": "A", "e1": "B", "o1": "P", "o2": "Q"}, {"e3": "A", "e4": "B"}, {"e5": "A", "e3": "B"},
                {"e7": "A", "e8": "B"}]
GROUPS = {"g1": {"e2": "A", "e3": "B", "e6": "C"}, "g2": {"e3": "A", "e8": "B", "e9": "C"},
          "g3": {"e1": "A", "e6": "B", "e2": "C", "o1": "P", "o2": "Q"}}


def _view(name, tag, labels, focus):
    vis = {k: 500 for k in labels if k.startswith("e")}
    return View(name, f"{tag}_{name}.png", f"{tag}_{name}.id.png", dict(labels), {}, vis, focus=list(focus))


def make_views(scene=None) -> list[View]:
    scene = scene or make_scene()
    out = []
    for p, labels in zip(scene.planted, PAIR_LETTERS):
        out += [_view(n, f"{p.a}-{p.b}", labels, [p.a, p.b]) for n in "ABC"]
    for tag, labels in GROUPS.items():
        out.append(_view("A", tag, labels, [k for k in labels if k.startswith("e")]))
    return out


def _focus_labels(scene, focus):
    labels = {e: "ABCDEFGH"[i] for i, e in enumerate(focus)}
    ops = [o.id for e in focus for o in scene.element(e).openings]
    labels.update({o: "PQRS"[i] for i, o in enumerate(ops)})
    return labels


def _fix_focus(scene, fixes):
    moved = {f.element for f in fixes}
    return sorted(moved | {x for p in scene.planted if moved & {p.a, p.b} for x in (p.a, p.b)})


def fix_renderer(scene, fix):
    focus = _fix_focus(scene, [fix])
    labels = _focus_labels(scene, focus)
    tag = hashlib.sha1(json.dumps(asdict(fix), sort_keys=True).encode()).hexdigest()[:8]
    vis = {e: 300 for e in focus}
    return [View("before_A", f"fix{tag}_before_A.png", "b.png", labels, {}, vis, focus),
            View("after_A", f"fix{tag}_after_A.png", "a.png", labels, {}, vis, focus)]


def cand_renderer(scene, focus, fixes, grid_only=False):
    labels = _focus_labels(scene, focus)
    vis = {e: 300 for e in focus}
    views = [] if grid_only else [View(f"cand_{i + 1}", f"cand_{i + 1}.png", "c.png", labels, {}, vis, focus)
                                  for i in range(len(fixes))]
    return views + [View("cand_grid", "cand_grid.png", "g.png", labels, {}, vis, focus)]


def build(scene=None, views=None, modes=("pictures", "pictures_text"), **kw):
    scene = scene or make_scene()
    kw.setdefault("fix_renderer", fix_renderer)
    kw.setdefault("cand_renderer", cand_renderer)
    return jobs.build_items(scene, views if views is not None else make_views(scene), modes=modes, **kw)


@pytest.fixture(scope="module")
def items():
    return build()


def pics(items, job=None, question=None):
    return [i for i in items if i.mode == "pictures" and (job is None or i.job == job)
            and (question is None or i.truth.get("question") == question)]


# ------------------------------------------------------------------------------------------------- shape of the set

def test_every_job_builds(items):
    by = Counter((i.job, i.mode) for i in items)
    for j in ALL:
        assert by[(j, "pictures")] >= 1 and by[(j, "pictures")] == by[(j, "pictures_text")], j
    assert by[("J1_sort", "pictures")] == 8          # 4 pairs x (sort + binary)
    assert {i.truth["question"] for i in pics(items, "J1_sort")} == {"sort", "binary"}
    assert by[("J2_who_moves", "pictures")] == 2 and by[("J7_pick_valid", "pictures")] == 2
    assert len({i.id for i in items}) == len(items)


def test_categories_truth_evidence(items):
    for it in items:
        assert it.categories == [JOB_CATEGORY[it.job]]
        t = it.truth
        assert t.get("question") and isinstance(t.get("letters"), dict) and t["letters"], it.id
        if it.job != "J3_fix":
            assert "answer" in t and isinstance(t["expected"], dict), it.id
        assert it.evidence and it.evidence.get("source"), it.id
        assert it.meta["question"] == t["question"] and it.meta["job"] == it.job


def test_pictures_prompts_clean(items):
    for it in items:
        assert it.prompt.rstrip().endswith("Answer with JSON only.")
        assert "\"confidence\"" in it.prompt and "\"reason\"" in it.prompt
        if it.mode != "pictures":
            continue
        for rx in (KIND_RE, ID_RE, MEASURE_RE, TRIPLE_RE, COORD_RE, DECIMAL_RE):
            assert not rx.search(it.prompt), (rx.pattern, it.id, it.prompt)
        assert "Measured facts" not in it.prompt


def test_pictures_text_has_facts(items):
    for it in items:
        if it.mode == "pictures_text":
            assert "Measured facts" in it.prompt and "mm" in it.prompt, it.id


def test_schemas_valid_and_expected_replies_pass(items):
    for it in items:
        jsonschema.Draft202012Validator.check_schema(it.schema)
        assert set(it.schema["required"]) == set(it.schema["properties"])
        assert {"confidence", "reason"} <= set(it.schema["required"])
        assert it.schema["additionalProperties"] is False
        exp = runner.expected_reply(it)
        if it.job != "J3_fix":
            assert exp is not None, it.id
        if exp is not None:
            jsonschema.validate(exp, it.schema)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate({**(exp or {}), "confidence": 1.5}, it.schema)
        json.dumps(it.schema)
        json.dumps(it.truth)
        json.dumps(it.evidence)


# ------------------------------------------------------------------------------------------------- letters (regression)

def test_letters_are_per_item(items):
    """Regression: the renderer letters each pair A/B. Each item must use its own pair's letters and pictures, and
    J3's reference must resolve to the planted mover."""
    s = make_scene()
    for it in items:
        if it.job not in ("J1_sort", "J2_who_moves", "J3_fix", "J4_opening"):
            continue
        n = it.meta["pair_index"]
        p = s.planted[n]
        tag = f"{p.a}-{p.b}_"
        assert it.images and all(img.startswith(tag) for img in it.images), (it.id, it.images)
        lt = it.truth["letters"]
        for eid, letter in PAIR_LETTERS[n].items():
            assert lt[letter] == eid, (it.id, letter)
        assert len(set(lt.values())) == len(lt)
    for it in pics(items, "J3_fix"):
        p = s.planted[it.meta["pair_index"]]
        f = jobs.reply_to_fix(it, it.truth["expected"])
        assert f.element == p.mover and checker.check_fix(s, f)["passed"]
    for it in pics(items, "J2_who_moves"):
        assert it.truth["letters"][it.truth["mover_letter"]] == s.planted[it.meta["pair_index"]].mover


def test_letters_missing_from_views_are_filled():
    s = make_scene()
    v = [View("A", "a.png", "a_id.png", {"e1": "C"}, {}, {"e1": 500, "e2": 500}, focus=["e1", "e2"])]
    its = jobs.build_items(s, v, jobs=("J3_fix",))
    letters = its[0].truth["letters"]
    assert set(letters.values()) >= {"e1", "e2", "o1", "o2"}
    assert letters["C"] == "e1"
    assert all(k in jobs.OPENING_LETTERS for k, v in letters.items() if v.startswith("o"))
    assert all(k in jobs.ELEMENT_LETTERS + "C" for k, v in letters.items() if v.startswith("e"))
    assert not {"E", "N", "U", "I", "O"} & set(letters)


def test_letter_order_randomised_by_seed():
    firsts = set()
    for seed in range(20):
        it = jobs.build_items(make_scene(seed), make_views(), jobs=("J1_sort",))[0]
        firsts.add(it.prompt.split("labelled ")[1][0])
    assert firsts == {"A", "B"}


def test_subset_of_jobs_builds_the_same_items(items):
    sub = build(jobs=("J5_review",))
    full = {i.id: i for i in items}
    assert sub and all(full[i.id].prompt == i.prompt and full[i.id].truth == i.truth for i in sub)


# ------------------------------------------------------------------------------------------------- J1-J4

def test_j1_sort_and_binary(items):
    kinds = {i.meta["pair_index"]: i.truth["kind"] for i in pics(items, "J1_sort", "sort")}
    assert kinds == {0: "real", 1: "by_design", 2: "not_touching", 3: "real"}
    for it in pics(items, "J1_sort", "binary"):
        assert it.truth["clash"] == (it.truth["kind"] == "real") == it.truth["expected"]["clash"]
        assert it.evidence["source"] == "geom.distance" and it.evidence["agrees"]
        assert it.schema["properties"]["clash"] == {"type": "boolean"}
        assert "\"clash\"" in it.prompt
    real = next(i for i in pics(items, "J1_sort", "sort") if i.meta["pair_index"] == 0)
    assert real.truth["expected"] == {"answer": "a"} and real.evidence["distance_m"] == pytest.approx(-0.1)
    assert real.meta["overlap_mm"] == 100 and real.meta["gap_mm"] == 0 and real.meta["density"] == "low"
    assert real.meta["visible_px"] == {"B": 500, "A": 500}


def test_j2_locked_service(items):
    j2 = {i.meta["pair_index"]: i for i in pics(items, "J2_who_moves")}
    assert j2[0].truth["mover_letter"] == "A" and j2[0].truth["mover"] == "e2"
    locked = j2[3]
    assert locked.truth["mover"] == "e8" and locked.truth["mover_letter"] == "B" and locked.truth["locked"] == ["A"]
    assert locked.evidence["locked"] == {"A": True, "B": False} and locked.evidence["agrees"]
    assert locked.meta["locked_in_pair"] is True
    for it in j2.values():
        assert "padlock" in it.prompt
    txt = next(i for i in build(jobs=("J2_who_moves",)) if i.mode == "pictures_text" and i.meta["pair_index"] == 3)
    assert "locked" in txt.prompt.split("Measured facts")[1]


def test_j3_j4(items):
    j3 = next(i for i in pics(items, "J3_fix") if i.meta["pair_index"] == 0)
    assert j3.truth["expected"] == {"element": "A", "direction": "down", "distance_mm": 150, "via_opening": None}
    assert j3.evidence["source"] == "checker.check_fix" and j3.evidence["passed"] is True
    assert "P" in j3.prompt and "Q" in j3.prompt
    j4 = next(i for i in pics(items, "J4_opening") if i.meta["pair_index"] == 0)
    assert j4.truth["fitting"] == ["P"] and j4.schema["properties"]["fitting"]["items"]["enum"] == ["P", "Q"]
    assert j4.evidence["openings"]["P"]["fits"] is True and j4.evidence["openings"]["Q"]["fits"] is False
    assert j4.evidence["agrees"]


# ------------------------------------------------------------------------------------------------- J5-J7

def test_j5_truth_is_resolves_original_not_validity(items):
    j5 = pics(items, "J5_review")
    assert {i.meta["pair_index"] for i in j5} == {0, 3}
    for it in j5:
        res = next(r for r in make_scene().resolutions if r.pair == it.meta["pair_index"] and r.label == it.truth["label"])
        assert it.truth["resolved"] == res.resolves_original == it.truth["expected"]["resolved"]
        assert it.truth["fix"] == asdict(res.fix) and it.truth["valid"] == res.valid
        assert it.evidence["source"] == "scene.resolutions" and "min_clear_m" in it.evidence
        assert len(it.images) == 2 and "before_A" in it.images[0] and "after_A" in it.images[1]
        assert "\"resolved\"" in it.prompt
    per_pair = Counter((i.meta["pair_index"], i.truth["resolved"]) for i in j5)
    assert set(per_pair.values()) == {1} and len(per_pair) == 4   # one yes, one no per pair
    # a fix that clears the clash but hits something new still resolves the ORIGINAL clash
    s = make_scene()
    s.resolutions = [r for r in s.resolutions if r.label in ("hits_third", "too_small")]
    hit = next(i for i in jobs.build_items(s, make_views(s), fix_renderer=fix_renderer, jobs=("J5_review",))
               if i.truth["label"] == "hits_third")
    assert hit.truth["resolved"] is True and hit.truth["valid"] is False


def test_j6_new_clash_balanced(items):
    j6 = pics(items, "J6_new_clash")
    assert Counter(i.truth["new_clash"] for i in j6) == {True: 2, False: 2}
    for it in j6:
        assert it.truth["new_clash"] == bool(it.truth["new_hits"]) == it.truth["expected"]["new_clash"]
        assert it.truth["fix"] and it.evidence["source"] == "scene.resolutions"
        if it.truth["new_clash"]:
            assert it.truth["resolves_original"] is True and it.truth["label"] == "hits_third"
            assert all(len(x) == 1 for x in it.truth["new_hit_letters"])
        else:
            assert it.truth["label"] == "good"
    # J5 and J6 on the same move share the same pictures (one render)
    imgs = {i.truth["label"]: i.images for i in pics(items, "J5_review") + j6 if i.meta["pair_index"] == 0}
    assert len(set(map(tuple, imgs.values()))) == len(imgs)
    # balance trims a lopsided run back to even
    lop = [i for i in j6 if i.truth["new_clash"]] + j6
    lop = [i for k, i in enumerate(lop) if i.id not in {x.id for x in lop[:k]}] + \
        [jobs.build_items(make_scene(5), make_views(), fix_renderer=fix_renderer, jobs=("J6_new_clash",))[0]]
    bal = jobs.balance_j6(lop, seed=1)
    c = Counter(i.truth["new_clash"] for i in bal)
    assert c[True] == c[False]


def test_j7_pick_valid(items):
    for it in pics(items, "J7_pick_valid"):
        cands = it.truth["candidates"]
        assert 3 <= len(cands) <= 4 and [c["number"] for c in cands] == list(range(1, len(cands) + 1))
        valid = [c["number"] for c in cands if c["valid"]]
        assert valid and it.truth["valid"] == valid == it.truth["expected"]["valid"]
        invalid = [c for c in cands if not c["valid"]]
        assert len(invalid) >= 2 and any(c["resolves_original"] or c["label"] == "too_small" for c in invalid)
        for c in cands:   # the truth is what check_fix says
            assert checker.check_fix(make_scene(), Fix(**c["fix"]))["passed"] == c["valid"]
        assert it.meta["layout"] == "separate"
        assert it.images[-len(cands):] == [f"cand_{k}.png" for k in range(1, len(cands) + 1)]
        # the pair's own picture leads only when it letters the pair as the candidates do
        lead = it.images[:-len(cands)]
        if it.meta["pair_index"] == 3:      # e7/e8 lettered A/B in both
            assert lead == ["e7-e8_A.png"] and it.prompt.startswith("The first picture shows")
        else:                               # pair views letter e2 A, the candidates e1 A: left out
            assert lead == [] and it.prompt.startswith("These pictures concern")
        assert it.schema["properties"]["valid"]["items"] == {"type": "integer", "minimum": 1, "maximum": len(cands)}
        assert len(it.evidence["candidates"]) == len(cands)
    grid = build(jobs=("J7_pick_valid",), modes=("pictures",),
                 cand_renderer=lambda sc, focus, fixes: cand_renderer(sc, focus, fixes, grid_only=True))
    assert grid and all(i.images[-1] == "cand_grid.png" and len(i.images) <= 2 and i.meta["layout"] == "grid"
                        and "grid" in i.prompt for i in grid)


def test_locked_mover_is_an_invalid_candidate():
    s = make_scene()
    lock_move = Fix("e7", dz=0.3)
    ck = checker.check_fix(s, lock_move)
    assert not ck["passed"] and "locked" in ck["reason"]
    s.resolutions = [r for r in s.resolutions if r.pair != 3 or r.label in ("good", "too_small")]
    s.resolutions.append(Resolution(3, "wrong_element", lock_move, ck["passed"], ck["clash_gone"], ck["new_hits"], ck))
    j7 = next(i for i in build(s, jobs=("J7_pick_valid",), modes=("pictures",)) if i.meta["pair_index"] == 3)
    row = next(c for c in j7.truth["candidates"] if c["label"] == "wrong_element")
    assert row["valid"] is False and row["number"] not in j7.truth["valid"] and "padlock" in j7.prompt
    ev = next(c for c in j7.evidence["candidates"] if c["label"] == "wrong_element")
    assert ev["reason"] == ck["reason"] and ev["min_clear_m"] == ck["min_clear_m"]   # evidence = Resolution.evidence


def test_moves_barred_only_by_allowed_moves_stay_out_of_j7():
    s = make_scene(annotated=False)
    s.element("e8").allowed_moves = ["up", "north", "south", "east", "west"]   # the good move (down) is barred
    annotate(s)
    recs = {r["label"]: r for r in jobs.pair_resolutions(s, 3, s.planted[3])}
    assert recs["good"]["valid"] is False and recs["good"]["hidden_rule"] is True
    assert recs["too_small"]["hidden_rule"] is False and recs["hits_third"]["hidden_rule"] is False   # visibly wrong
    its = build(s, modes=("pictures",), jobs=("J5_review", "J6_new_clash", "J7_pick_valid"))
    assert all(c["label"] != "good" for i in its if i.job == "J7_pick_valid" and i.meta["pair_index"] == 3
               for c in i.truth["candidates"])
    j56 = [i for i in its if i.job != "J7_pick_valid" and i.meta["pair_index"] == 3]
    assert {i.truth["resolves_original"] for i in j56} == {True, False}   # J5/J6 still use every move


# ------------------------------------------------------------------------------------------------- J8 / J9

def test_j8_spatial(items):
    j8 = {(i.meta["group"], i.truth["question"]): i for i in pics(items, "J8_spatial")}
    # g1 = {e2: A, e3: B, e6: C}: heights e3 < e2 < e6; "north" is ambiguous (the runs along Y span it)
    assert j8[(0, "highest")].truth["answer"] == "C" and j8[(0, "highest")].truth["answer_id"] == "e6"
    assert j8[(0, "order")].truth["answer"] == ["B", "A", "C"] and j8[(0, "order")].truth["expected"] == \
        {"order": ["B", "A", "C"]}
    assert (0, "north") not in j8
    btw = j8[(0, "between")]
    assert btw.truth["answer"] in ("A", "none") and "none" in btw.schema["properties"]["answer"]["enum"]
    if btw.truth["answer"] == "A":
        assert set(btw.truth["ends"]) == {"e3", "e6"}
    # g2 = {e3: A, e8: B, e9: C}: e9 furthest north
    assert j8[(1, "north")].truth["answer"] == "C" and j8[(1, "north")].evidence["axis"] == "y"
    # g3 = {e1, e6, e2}: the deep beam spans e6 (its top above, its bottom below): no "highest"
    assert (2, "highest") not in j8
    for it in j8.values():
        assert it.evidence["source"] == "geom.bbox" and it.evidence["margin_m"] >= jobs.AMBIGUOUS_M
        assert it.truth["relations"] and all({"a", "b", "relation"} <= set(c) for c in it.truth["relations"])
        assert all(img.startswith("g") for img in it.images)
    order = j8[(0, "order")]
    assert order.schema["properties"]["order"]["minItems"] == order.schema["properties"]["order"]["maxItems"] == 3


def test_j8_skips_ambiguous_margins():
    def run(top_gap):
        a = Element("e1", "duct", "service", "box", min=(0, 0, 2.0), max=(1, 0.2, 2.2))
        b = Element("e2", "duct", "service", "box", min=(0, 1, 2.0 + top_gap), max=(1, 1.2, 2.2 + top_gap))
        c = Element("e3", "duct", "service", "box", min=(0, 2, 1.0), max=(1, 2.2, 1.2))
        s = Scene(seed=3, elements=[a, b, c], planted=[])
        v = [View("A", "g.png", "g_id.png", {"e1": "A", "e2": "B", "e3": "C"}, {}, {"e1": 9, "e2": 9, "e3": 9},
                  ["e1", "e2", "e3"])]
        return {i.truth["question"]: i for i in jobs.build_items(s, v, jobs=("J8_spatial",))}
    near = run(0.02)                     # A and B within 20 mm of each other in height
    assert "highest" not in near and "order" not in near
    far = run(0.2)
    assert far["highest"].truth["answer"] == "B" and far["order"].truth["answer"] == ["C", "A", "B"]
    assert far["north"].truth["answer"] == "C" and far["highest"].evidence["margin_m"] == pytest.approx(0.2)


def test_j9_relations(items):
    rel = pics(items, "J9_relation", "relation")
    got = {tuple(sorted(i.truth["pair"])): i.truth["relation"] for i in rel}
    assert got[("e1", "e6")] == "passes_through" and got[("e1", "e2")] == "clashes"
    assert got.get(("e3", "e4")) == "supports" and got.get(("e3", "e5")) == "clear_of"
    pt = next(i for i in rel if i.truth["relation"] == "passes_through")
    assert (pt.truth["a"], pt.truth["b"], pt.truth["via"]) == ("e6", "e1", "o1")
    assert pt.evidence["source"] == "scene.relations"
    assert Counter(i.truth["relation"] for i in rel).most_common(1)[0][1] <= jobs.J9_PER_RELATION
    for it in rel:
        assert it.schema["properties"]["relation"]["enum"] == list(jobs.RELATIONS)
        assert it.truth["answer"] == it.truth["relation"] == it.truth["expected"]["relation"]
        assert it.truth["relation"] not in ("crosses", "parallel", "clear_of") or \
            it.evidence["distance_m"] >= jobs.AMBIGUOUS_M
    ops = pics(items, "J9_relation", "passes_opening")
    yes = [i for i in ops if i.truth["passes"]]
    assert yes and all(i.truth["element"] == "e6" and i.truth["opening"] == "o1" for i in yes)
    assert any(not i.truth["passes"] for i in ops)
    for it in ops:
        assert it.truth["expected"] == {"passes": it.truth["passes"]}
        lt = it.truth["letters"]
        assert lt[it.prompt.split("opening ")[-1][0]] == it.truth["opening"]


def test_fallback_without_annotations():
    s = make_scene(annotated=False)
    its = build(s, modes=("pictures",))
    assert {i.job for i in its} == ALL
    for it in its:
        if it.job in ("J5_review", "J6_new_clash"):
            assert it.evidence["source"] == "checker.check_fix"
        if it.job == "J9_relation" and it.truth["question"] == "relation":
            assert it.evidence["source"] == "geom"
    pt = [i for i in its if i.job == "J9_relation" and i.truth.get("relation") == "passes_through"]
    assert pt and pt[0].truth["via"] == "o1" and pt[0].truth["a"] == "e6"


def test_group_renderer_used_when_views_label_pairs_only():
    s = make_scene()
    pair_only = [v for v in make_views(s) if not v.image.startswith("g")]
    calls = []

    def group_renderer(sc, focus):
        calls.append(list(focus))
        return [_view("A", "grp" + "-".join(focus), _focus_labels(sc, focus), focus)]
    its = jobs.build_items(s, pair_only, jobs=("J8_spatial",), group_renderer=group_renderer)
    assert calls and all(len(f) >= 3 for f in calls) and its
    assert jobs.build_items(s, pair_only, jobs=("J8_spatial",)) == []


def test_renderers_for(monkeypatch, tmp_path):
    from iris_bench import render
    seen = {}
    monkeypatch.setattr(render, "render_fix", lambda d, focus, fix, **kw: seen.setdefault("fix", (focus, fix)) and [],
                        raising=False)
    monkeypatch.setattr(render, "render_candidates", lambda d, focus, fixes, **kw: seen.setdefault("cand", kw) and [],
                        raising=False)
    monkeypatch.setattr(render, "render_scene", lambda d, focus, **kw: seen.setdefault("grp", kw) and [],
                        raising=False)
    r = jobs.renderers_for(tmp_path, camera=Camera("top"))
    s = make_scene()
    r["fix_renderer"](s, Fix("e2", dz=-0.1))
    r["cand_renderer"](s, ["e1", "e2"], [Fix("e2", dz=-0.1)])
    r["group_renderer"](s, ["e1", "e2", "e3"])
    assert seen["fix"][0] == ["e1", "e2"] and seen["cand"]["camera"].name == "top" and seen["grp"]["views"]


# ------------------------------------------------------------------------------------------------- runner

def test_reply_to_fix(items):
    j3 = next(i for i in pics(items, "J3_fix") if i.meta["pair_index"] == 0)
    f = jobs.reply_to_fix(j3, {"element": "A", "direction": "north", "distance_mm": 250, "via_opening": "P"})
    assert (f.element, f.dx, f.dy, f.dz, f.via_opening) == ("e2", 0, 0.25, 0, "o1")
    f = jobs.reply_to_fix(j3, {"element": "a", "direction": "down", "distance_mm": 150, "via_opening": None})
    assert f.dz == pytest.approx(-0.15) and f.via_opening is None
    for bad in ({"element": "Z", "direction": "up", "distance_mm": 1, "via_opening": None},
                {"element": "A", "direction": "sideways", "distance_mm": 1, "via_opening": None},
                {"element": "A", "direction": "up", "distance_mm": 1, "via_opening": "A"},
                {"element": "P", "direction": "up", "distance_mm": 1, "via_opening": None}):
        with pytest.raises(ValueError):
            jobs.reply_to_fix(j3, bad)


def test_candidate_fixes():
    s = make_scene()
    c = jobs.candidate_fixes(s, s.planted[0])
    assert set(c) == {"good", "too_small", "wrong_direction", "hits_third"}
    assert c["too_small"].dz == pytest.approx(-0.0375)
    assert c["wrong_direction"].dy != 0 and c["wrong_direction"].dz == 0   # along the run (Y)


def test_fake_run_and_cache(items, tmp_path):
    fake = runner.FakeModel(0.7)
    res = runner.run(items, "fake:0.7", cache_dir=tmp_path, fake=fake)
    assert len(res) == len(items) and fake.calls == len(items)
    by_id = {i.id: i for i in items}
    for r in res:
        it = by_id[r.item_id]
        assert r.reply is not None and 0 <= r.reply["confidence"] <= 1 and r.reply["reason"].startswith("fake")
        jsonschema.validate(r.reply, it.schema)
        if it.job == "J3_fix":
            assert r.correct is None and r.detail["needs_checker"]
        else:
            assert isinstance(r.correct, bool), r.item_id
            assert r.detail["question"] == it.truth["question"] and "confidence" in r.detail
    assert {by_id[r.item_id].job for r in res if r.correct is not None} == ALL - {"J3_fix"}
    fake2 = runner.FakeModel(0.7)
    res2 = runner.run(items, "fake:0.7", cache_dir=tmp_path, fake=fake2)
    assert fake2.calls == 0 and all(r.detail["cached"] for r in res2)
    assert [r.reply for r in res] == [r.reply for r in res2]


def test_fake_perfect_is_correct(items, tmp_path):
    res = runner.run(items, "fake:1.0", cache_dir=tmp_path)
    assert all(r.correct for r in res if r.correct is not None)
    assert sum(r.correct is None for r in res) == len([i for i in items if i.job == "J3_fix"])


def test_fake_wrong_is_mostly_wrong(items, tmp_path):
    res = runner.run(items, "fake:0.0", cache_dir=tmp_path)
    graded = [r for r in res if r.correct is not None]
    assert sum(r.correct for r in graded) < len(graded)


def test_grading_rules(items):
    j7 = pics(items, "J7_pick_valid")[0]
    valid = j7.truth["valid"]
    invalid = [c["number"] for c in j7.truth["candidates"] if not c["valid"]]
    base = {"confidence": 0.5, "reason": "r"}
    ok, d = runner.grade(j7, {"valid": list(reversed(valid)), **base})
    assert ok and d["partial"]
    ok, d = runner.grade(j7, {"valid": valid + invalid[:1], **base})
    assert not ok and not d["partial"] and d["picked_invalid"] == 1
    ok, d = runner.grade(j7, {"valid": [], **base})
    assert not ok and d["missed_valid"] == len(valid)
    order = next(i for i in pics(items, "J8_spatial") if i.truth["question"] == "order")
    assert runner.grade(order, {"order": order.truth["answer"], **base})[0] is True
    assert runner.grade(order, {"order": list(reversed(order.truth["answer"])), **base})[0] is False
    j5 = pics(items, "J5_review")[0]
    ok, d = runner.grade(j5, {"resolved": j5.truth["resolved"], "confidence": 0.9, "reason": "x" * 500})
    assert ok and d["reason_truncated"] and d["confidence"] == 0.9
    ok, d = runner.grade(j5, {"resolved": j5.truth["resolved"]})          # confidence/reason missing: still graded
    assert ok and "schema_warning" in d
    assert runner.grade(j5, {"resolved": "yes", **base})[0] is None      # the answer itself off-schema
    j1 = next(i for i in pics(items, "J1_sort", "sort") if i.truth["kind"] == "real")
    ok, d = runner.grade(j1, {"answer": "a", **base})
    assert ok and d["answer"] == "real"


def test_check_hook_only_for_j3(items, tmp_path):
    seen = []

    def check(item, reply):
        seen.append(item.job)
        jobs.reply_to_fix(item, reply)
        return True, {"checked": True}
    res = runner.run(items, "fake:1.0", cache_dir=tmp_path, check=check)
    assert set(seen) == {"J3_fix"} and all(r.correct for r in res)


def test_gemini_path_uses_client(items, tmp_path, monkeypatch):
    calls = []

    def fake_call(model, client, item):
        calls.append(item.id)
        return runner.expected_reply(item), 0.001
    monkeypatch.setattr(runner, "_call_gemini", fake_call)
    j1 = pics(items, "J1_sort")
    res = runner.run(j1, "gemini-x", cache_dir=tmp_path)
    assert len(calls) == len(j1) and all(r.correct and r.cost_usd == 0.001 for r in res)
    runner.run(j1, "gemini-x", cache_dir=tmp_path)
    assert len(calls) == len(j1)


def test_legacy_items_still_grade():
    it = jobs.build_items(make_scene(), make_views(), jobs=("J1_sort",))[0]
    legacy = type(it)(**{**asdict(it), "truth": {"kind": "real"},
                         "schema": {"type": "object", "properties": {"answer": {"type": "string"}}}})
    assert runner.grade(legacy, {"answer": "a"})[0] is True
    assert runner.expected_reply(legacy) == {"answer": "a"}


# ------------------------------------------------------------------------------------------------- controls

def test_no_image_every_job(items):
    for it in pics(items):
        ni = controls.no_image(it)
        assert ni.mode == "no_image" and ni.images == [] and ni.prompt == it.prompt and ni.truth == it.truth
        assert ni.id == it.id[: -len("pictures")] + "no_image" and ni.categories == it.categories
    assert len({controls.no_image(i).id for i in pics(items)}) == len(pics(items))


def test_swapped(items):
    it = next(i for i in pics(items, "J1_sort", "sort") if i.truth["kind"] == "real")
    other = next(i for i in jobs.build_items(make_scene(2), make_views(), jobs=("J1_sort",))
                 if i.truth["question"] == "sort" and i.truth["kind"] != "real")
    other.images = ["/other/A.png"]
    sw = controls.swapped(it, other)
    assert sw.mode == "swapped" and sw.images == ["/other/A.png"] and sw.truth == it.truth
    assert sw.meta["images_from"] == other.id and sw.id.endswith("-swapped")
    with pytest.raises(ValueError):
        controls.swapped(it, it)
    binary = next(i for i in jobs.build_items(make_scene(2), make_views(), jobs=("J1_sort",))
                  if i.truth["question"] == "binary" and not i.truth["clash"])
    with pytest.raises(ValueError):        # a different question is not a swap
        controls.swapped(it, binary)
    # every job: swapping in another scene's item with a different answer works
    s2 = make_scene(2)
    for p in s2.planted:
        p.a, p.b = p.b, p.a                # different letters order does not matter; truths differ below
    others = build(make_scene(7), modes=("pictures",))
    for job in ALL:
        mine = pics(items, job)
        for a in mine:
            b = next((o for o in others if o.job == a.job and controls.answer_of(o) != controls.answer_of(a)
                      and o.truth.get("question") == a.truth.get("question")
                      and (a.job != "J7_pick_valid" or len(o.images) == len(a.images))), None)
            if b is not None:
                assert controls.swapped(a, b).images == b.images


def test_counterfactuals(items):
    cfs = controls.counterfactuals(items)
    assert {c.job for c in cfs} == {"J5_review", "J6_new_clash"}
    ids = {i.id for i in items}
    for c in cfs:
        a = next(i for i in items if i.id == c.meta["counterfactual_of"])
        assert c.mode == "pictures" and c.meta["control"] == "counterfactual" and c.id not in ids
        assert controls.answer_of(a) != controls.answer_of(c) and c.meta["change"]["what"] == "proposed move"
        assert a.meta["pair_index"] == c.meta["pair_index"] and a.truth["fix"] != c.truth["fix"]
    one = pics(items, "J5_review")
    yes = next(i for i in one if i.truth["resolved"])
    no = next(i for i in one if not i.truth["resolved"])
    cf = controls.counterfactual(yes, no)
    assert cf.meta["counterfactual_of"] == yes.id and cf.truth == no.truth
    with pytest.raises(ValueError):
        controls.counterfactual(yes, yes)
    # J1 across scenes generated as one-change variants (scene.challenge["cf_group"])
    s1, s2 = make_scene(11), make_scene(12)
    s2.elements[1] = Element("e2", "duct", "service", "box", min=(2.9, -3, 2.2), max=(3.1, 3, 2.4))   # lowered
    s2.planted[0] = Planted("e1", "e2", "not_touching", 0.1)
    for s in (s1, s2):
        s.challenge["cf_group"] = "duct-height"
    j1 = [i for s in (s1, s2) for i in jobs.build_items(s, make_views(s), jobs=("J1_sort",))]
    cf1 = controls.counterfactuals(j1)
    assert {(c.truth["question"], c.meta["pair_index"]) for c in cf1} == {("sort", 0), ("binary", 0)}


# ------------------------------------------------------------------------------------------------- balance, batch

def test_balance_j1():
    its = []
    for seed in range(4):
        its += jobs.build_items(make_scene(seed), make_views(), jobs=("J1_sort",))
    s = make_scene(9)
    s.planted = [s.planted[0]]
    its += jobs.build_items(s, make_views(make_scene()), jobs=("J1_sort",))
    bal = jobs.balance_j1(its, seed=3)
    sort = Counter(i.truth["kind"] for i in bal if i.truth["question"] == "sort")
    assert set(sort.values()) == {4}                       # real 9 -> 4, by_design 4, not_touching 4
    binary = Counter(i.truth["clash"] for i in bal if i.truth["question"] == "binary")
    assert binary[True] == binary[False] == 8               # 9 yes, 8 no -> 8 each
    assert all(i.job == "J1_sort" for i in bal)


def test_write_batch_jsonl(tmp_path):
    png = b"\x89PNG\r\n\x1a\nfake"
    its = build(scene_dir=tmp_path, modes=("pictures",))
    for it in its:
        for p in it.images:
            with open(p, "wb") as f:
                f.write(png)
    out = tmp_path / "batch.jsonl"
    assert runner.write_batch_jsonl(its, out) == len(its)
    lines = [json.loads(x)["request"] for x in out.read_text().splitlines()]
    gc = lines[0]["generationConfig"]
    assert gc["responseMimeType"] == "application/json" and gc["responseJsonSchema"]["type"] == "object"
    assert gc["mediaResolution"] == "MEDIA_RESOLUTION_HIGH" and "thinkingConfig" not in gc     # Google default
    runner.write_batch_jsonl(its[:1], out, model="gemini-3.8-flash@high")
    assert json.loads(out.read_text())["request"]["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "HIGH"}
    runner.write_batch_jsonl(its, out)
    assert "temperature" not in gc
    for req, it in zip(lines, its):
        parts = req["contents"][0]["parts"]
        # "Image k:" before each image, the question last
        assert len(parts) == 2 * len(it.images) + 1 and parts[-1] == {"text": it.prompt}
        for k in range(len(it.images)):
            assert parts[2 * k] == {"text": f"Image {k + 1}:"}
            assert parts[2 * k + 1]["inlineData"]["mimeType"] == "image/png"
        assert req["generationConfig"]["responseJsonSchema"] == it.schema
        props = runner.to_vertex_schema(it.schema)["properties"]    # the OpenAPI form is still available
        assert props["confidence"] == {"type": "NUMBER", "minimum": 0, "maximum": 1}
        assert props["reason"]["maxLength"] == 200
        if it.job == "J3_fix":
            assert props["via_opening"]["nullable"] is True and None not in props["via_opening"]["enum"]
        if it.job == "J8_spatial" and it.truth["question"] == "order":
            assert props["order"]["minItems"] == props["order"]["maxItems"] == len(it.truth["answer"])


def test_balance_keeps_multi_answer_questions(items):
    bal = jobs.balance(items, seed=2)
    for q in ("relation", "order", "highest", "pick_valid", "fix", "opening", "who_moves"):
        assert [i.id for i in bal if i.truth["question"] == q] == [i.id for i in items if i.truth["question"] == q]
    for q in ("passes_opening", "resolves_original", "new_clash", "binary"):
        for mode in ("pictures", "pictures_text"):
            c = Counter(repr(i.truth["answer"]) for i in bal if i.truth["question"] == q and i.mode == mode)
            assert len(set(c.values())) == 1, (q, c)


# ------------------------------------------------------------------------------------------------- one letter map

def test_j8_j9_items_show_one_letter_map(tmp_path):
    """Renders letter each focus afresh: a pair shown in two groups' pictures (e2/e3 are A/B in g1 and B/A in g4)
    must never mix them in one item; every J8/J9 item's pictures share one letter map, the truth's."""
    scene = make_scene()
    views = make_views(scene) + [_view("A", "g4", {"e3": "A", "e2": "B", "e9": "C"}, ["e3", "e2", "e9"]),
                                 _view("C", "g4", {"e3": "A", "e2": "B", "e9": "C"}, ["e3", "e2", "e9"])]
    by_image = {v.image: v for v in views}
    its = [i for i in jobs.build_items(scene, views, modes=("pictures",), jobs=("J8_spatial", "J9_relation"))]
    assert {i.job for i in its} == {"J8_spatial", "J9_relation"}
    mixed_before = [v for v in views if {"e2", "e3"} <= set(v.labels)]
    assert len({(v.labels["e2"], v.labels["e3"]) for v in mixed_before}) == 2      # the trap is really there
    for it in its:
        shown = [by_image[p] for p in it.images]
        assert shown, it.id
        assert len({tuple(v.focus) for v in shown}) == 1, (it.id, [v.image for v in shown])
        letter_of = {}
        for v in shown:
            for k, lt in v.labels.items():
                assert letter_of.setdefault(k, lt) == lt, (it.id, k)
                assert it.truth["letters"].get(lt) == k, (it.id, lt, k)
    assert jobs.one_letter_map(mixed_before) == [v for v in mixed_before if v.labels["e2"] == mixed_before[0].labels["e2"]]



def test_openings_offered_only_when_labelled_in_the_pairs_pictures():
    """A pair whose pictures label no opening gets no J4 item, and its J3 offers no opening letter (no letter the
    model cannot see)."""
    scene = make_scene()
    views = make_views(scene)
    its = jobs.build_items(scene, views, modes=("pictures",), jobs=("J3_fix", "J4_opening"))
    by_pair = {(i.job, i.meta["pair_index"]): i for i in its}
    assert ("J4_opening", 0) in by_pair and ("J4_opening", 3) not in by_pair      # pair 3 (e7/e8) shows no opening
    j3 = by_pair[("J3_fix", 3)]
    assert j3.schema["properties"]["via_opening"]["enum"] == [None] and "no labelled openings" in j3.prompt
    for it in its:
        shown = {lt for v in views if _image_name(v) in {p.split("/")[-1] for p in it.images} for lt in v.labels.values()}
        for name in ("fitting", "via_opening"):
            prop = it.schema["properties"].get(name)
            if prop:
                enum = prop.get("enum") or prop["items"]["enum"]
                assert {x for x in enum if x} <= shown, (it.id, enum, shown)


def _image_name(v):
    return v.image.split("/")[-1]
