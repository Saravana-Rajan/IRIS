"""One grading rule: runner.grade (with score.make_check), score.check_reply and score.grade agree on every job.

Items come from the job builder on the hand-made scene of test_jobs and on generated scenes (scenes.generate, which
annotates), with stub renderers (no browser). Each scene is saved as <tmp>/<seed>/scene.json for make_check.
Every job but J3 is graded against truth["expected"]; J3 by checker.check_fix on the proposed move."""
from __future__ import annotations

from dataclasses import asdict

import jsonschema
import pytest

from iris_bench import checker, jobs, runner, score, scenes
from iris_bench.spec import JOB_CATEGORY, Result, Scene, View
from tests.bench.test_jobs import build, cand_renderer, fix_renderer, make_scene, make_views

ALL_JOBS = set(JOB_CATEGORY)
GEN_SEEDS = (3, 4)
META = {"confidence": 0.5, "reason": "Read off the pictures."}


# ------------------------------------------------------------------------------------------------- stub renderers

def _labels(scene: Scene, focus: list[str]) -> dict[str, str]:
    """Like the renderer: the focus elements lettered afresh, then their openings."""
    out = {e: jobs.ELEMENT_LETTERS[i] for i, e in enumerate(focus)}
    ops = [o.id for e in focus for o in scene.element(e).openings]
    out.update({o: jobs.OPENING_LETTERS[i] for i, o in enumerate(ops)})
    return out


def _view(name: str, tag: str, scene: Scene, focus: list[str]) -> View:
    return View(name, f"{tag}_{name}.png", f"{tag}_{name}.id.png", _labels(scene, focus), {},
                {e: 400 for e in focus}, focus=list(focus))


def pair_views(scene: Scene) -> list[View]:
    return [_view(n, f"{p.a}-{p.b}", scene, [p.a, p.b]) for p in scene.planted for n in ("A", "C")]


def group_renderer(scene: Scene, focus: list[str]) -> list[View]:
    return [_view("A", "grp-" + "-".join(focus), scene, list(focus))]


# ------------------------------------------------------------------------------------------------- the item set

def _save(root, scene: Scene) -> Scene:
    folder = root / str(scene.seed)
    folder.mkdir(parents=True, exist_ok=True)
    scene.save(folder / "scene.json")
    return Scene.load(folder / "scene.json")       # what make_check will load


@pytest.fixture(scope="module")
def bench(tmp_path_factory):
    root = tmp_path_factory.mktemp("scenes")
    hand = make_scene()
    sets = [(hand, build(hand, modes=("pictures",)))]
    for seed in GEN_SEEDS:
        sc = scenes.generate(seed, density=2, decoys=1, locked_services=1)
        sets.append((sc, jobs.build_items(sc, pair_views(sc), ("pictures",), fix_renderer=fix_renderer,
                                          cand_renderer=cand_renderer, group_renderer=group_renderer)))
    assert len({sc.seed for sc, _ in sets}) == len(sets)
    pairs = []
    for sc, items in sets:
        loaded = _save(root, sc)
        pairs += [(it, loaded) for it in items]
    return root, pairs


def wrong_reply(item) -> dict:
    """A schema-valid wrong answer: J3 a move of distance 0 (the clash stays); booleans flipped; J4/J7 a different
    set; J8 order reversed; any other choice the first other option the schema allows."""
    exp = item.truth["expected"]
    if item.job == "J3_fix":
        return {**exp, "distance_mm": 0, **META}
    props = item.schema["properties"]
    out = {}
    for k, want in exp.items():
        if isinstance(want, bool):
            out[k] = not want
        elif isinstance(want, list):
            if k in runner.SET_FIELDS:
                items = props[k]["items"]
                pool = items.get("enum") or list(range(items["minimum"], items["maximum"] + 1))
                out[k] = [] if want else [pool[0]]
            else:
                out[k] = list(reversed(want))
        else:
            out[k] = next(v for v in props[k]["enum"] if v != want)
    return {**out, **META}


def _three(item, reply, scene, check):
    r_ok, r_d = runner.grade(item, reply, check=check)
    c_ok, c_d = score.check_reply(item, reply, scene)
    g = score.grade(item, Result(item.id, "m", reply, None, {"needs_checker": True}, 0.0, 0.0), scene)
    return (r_ok, c_ok, g.correct), (r_d, c_d, g.detail), g


# ------------------------------------------------------------------------------------------------- agreement

def test_three_graders_agree_on_every_job(bench):
    root, pairs = bench
    check = score.make_check(root)
    covered, n = set(), 0
    for item, scene in pairs:
        perfect = runner.expected_reply(item)
        if perfect is None:      # e.g. a J3 whose planted move is along two axes (no single-axis reply form)
            continue
        for reply, want in ((perfect, True), (wrong_reply(item), False)):
            jsonschema.validate(reply, item.schema)
            oks, details, _ = _three(item, reply, scene, check)
            assert oks == (want, want, want), (item.id, reply, details)
            n += 1
        covered.add(item.job)
    assert covered == ALL_JOBS
    assert n >= 2 * len(ALL_JOBS)


def test_j8_order_reversed_is_wrong_everywhere(bench):
    root, pairs = bench
    check = score.make_check(root)
    orders = [(it, sc) for it, sc in pairs if it.job == "J8_spatial" and it.truth["question"] == "order"]
    assert orders
    for it, sc in orders:
        rev = {"order": list(reversed(it.truth["expected"]["order"])), **META}
        assert _three(it, rev, sc, check)[0] == (False, False, False)
        assert score._generic_grade(it, rev)[0] is False


def test_off_schema_is_ungraded_by_runner_and_score_grade(bench):
    """score.grade regrades through runner.grade, so an off-schema answer stays ungraded (None) as in the runner.
    check_reply is the hook runner.grade calls after its schema check; it agrees on every job but J3, whose hook
    body only reads the move (an unusable one is wrong)."""
    root, pairs = bench
    check = score.make_check(root)
    for job, bad in (("J5_review", {"resolved": "yes"}), ("J6_new_clash", {"new_clash": 1}),
                     ("J7_pick_valid", {"valid": "1"}), ("J4_opening", {"fitting": "P"}),
                     ("J3_fix", {"element": "A", "direction": "sideways", "distance_mm": 10, "via_opening": None})):
        it, sc = next((i, s) for i, s in pairs if i.job == job)
        (r_ok, c_ok, g_ok), details, g = _three(it, {**bad, **META}, sc, check)
        assert r_ok is None and g_ok is None and "schema_error" in g.detail, (job, details)
        assert c_ok is (False if job == "J3_fix" else None), (job, details)


# ------------------------------------------------------------------------------------- J5: resolved, not passed

@pytest.fixture(scope="module")
def j5_hit(tmp_path_factory):
    """The hand scene's "hits_third" move: it clears the original clash (resolved) but hits a third element, so
    check_fix fails it (valid False). J5 asks only about the original clash."""
    root = tmp_path_factory.mktemp("j5")
    s = make_scene()
    s.resolutions = [r for r in s.resolutions if r.label in ("hits_third", "too_small")]
    it = next(i for i in jobs.build_items(s, make_views(s), fix_renderer=fix_renderer, jobs=("J5_review",))
              if i.truth["label"] == "hits_third")
    return root, it, _save(root, s)


def test_j5_graded_on_resolved_even_when_check_fix_fails(j5_hit):
    root, it, sc = j5_hit
    fix = score._fix_from(it.truth["fix"])
    ck = checker.check_fix(sc, fix)
    assert ck["passed"] is False and ck["clash_gone"] is True and ck["new_hits"]      # the premise
    assert it.truth["resolved"] is True and it.truth["valid"] is False
    check = score.make_check(root)
    yes = {"resolved": True, **META}
    oks, (r_d, c_d, g_d), g = _three(it, yes, sc, check)
    assert oks == (True, True, True)
    for d in (c_d, g_d):                     # the checker re-run rides along as detail only
        assert d["geometry"]["passed"] is False and d["geometry"]["clash_gone"] is True
        assert d["geometry"]["new_hits"] == ck["new_hits"] and d["geometry_agrees"] is True
        assert d["resolved"] is True and "resolves the original clash" in d["reason"]
    no = {"resolved": False, **META}
    oks, _, g = _three(it, no, sc, check)
    assert oks == (False, False, False)
    assert score.classify(it, g) == "rejected_good_fix"
    assert score.truth_text(it).startswith("resolved")


def test_j5_reference_never_from_check_fix(j5_hit):
    """Even a stored answer the re-run disagrees with grades the reply; the disagreement is reported."""
    root, it, sc = j5_hit
    flipped = type(it)(**{**asdict(it), "truth": {**it.truth, "resolved": False, "resolves_original": False,
                                                  "answer": False, "expected": {"resolved": False}}})
    oks, (_, c_d, g_d), g = _three(flipped, {"resolved": False, **META}, sc, score.make_check(root))
    assert oks == (True, True, True)
    assert c_d["geometry_agrees"] is False and g_d["geometry_agrees"] is False
    oks, _, g = _three(flipped, {"resolved": True, **META}, sc, score.make_check(root))
    assert oks == (False, False, False) and score.classify(flipped, g) == "approved_bad_fix"


def test_score_grade_adds_geometry_detail_to_runner_graded_reviews(bench):
    """J5/J6/J7 results the runner already graded keep `correct` and gain the checker's re-run as detail."""
    _, pairs = bench
    seen = set()
    for it, sc in pairs:
        if it.job not in ("J5_review", "J6_new_clash", "J7_pick_valid"):
            continue
        for reply in (runner.expected_reply(it), wrong_reply(it)):
            ok, d = runner.grade(it, reply)
            r = score.grade(it, Result(it.id, "m", reply, ok, d, 0.0, 0.0), sc)
            assert r.correct is ok and ok is not None, it.id
            assert "geometry" in r.detail and "geometry_agrees" in r.detail, it.id
        seen.add(it.job)
    assert seen == {"J5_review", "J6_new_clash", "J7_pick_valid"}
