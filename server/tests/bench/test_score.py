"""Score and report on synthetic Items/Results: no scene, renderer, checker or model needed."""
from __future__ import annotations

import csv
import json
import math
import random

from iris_bench import report, score
from iris_bench.spec import Item, Result

LETTERS = {"A": "e1", "B": "e2", "P": "o1"}
AXES = {"up": [0, 0, 1], "down": [0, 0, -1], "north": [0, 1, 0], "south": [0, -1, 0], "east": [1, 0, 0],
        "west": [-1, 0, 0]}


def _item(seed, job, n, mode, truth, meta=None, images=None):
    return Item(id=f"{seed}-{job}-{n}-{mode}", seed=seed, job=job, mode=mode,
                images=images if images is not None else ([] if mode == "no_image" else [f"view_{n}_A.png"]),
                prompt="?", schema={}, truth=truth, meta=meta or {})


def _j3_truth(direction="up", dist=400, via=None):
    return {"mover": "e1", "letters": LETTERS, "axes": AXES, "pair": ["e1", "e2"],
            "expected": {"element": "A", "direction": direction, "distance_mm": dist, "via_opening": via}}


def test_bootstrap_ci_bounds_sane():
    rng = random.Random(1)
    vals = [1.0 if rng.random() < 0.7 else 0.0 for _ in range(200)]
    lo, hi = score.bootstrap_ci(vals, seed=3)
    m = sum(vals) / len(vals)
    assert 0.0 <= lo <= m <= hi <= 1.0
    assert 0.03 < hi - lo < 0.2
    assert score.bootstrap_ci(vals, seed=3) == (lo, hi)        # seeded
    assert score.bootstrap_ci([1.0] * 5) == (1.0, 1.0)
    assert all(math.isnan(x) for x in score.bootstrap_ci([]))


def test_accuracy_rows_and_ci_contain_mean():
    items = [_item(s, "J1_sort", 0, "pictures", {"kind": "real"}) for s in range(20)]
    results = [Result(i.id, "fake:0.7", {"answer": "a"}, s % 4 != 0) for s, i in enumerate(items)]
    rows = score.score_rows(items, results)
    acc = [r for r in rows if r["table"] == "accuracy" and r["job"] == "J1_sort"][0]
    assert acc["n"] == 20 and acc["accuracy"] == 0.75
    assert acc["ci_lo"] <= 0.75 <= acc["ci_hi"]


def test_j1_taxonomy_false_clear_vs_false_alarm():
    items = [_item(0, "J1_sort", 0, "pictures", {"kind": "real"}),
             _item(1, "J1_sort", 0, "pictures", {"kind": "not_touching"}),
             _item(2, "J1_sort", 0, "pictures", {"kind": "by_design"}),
             _item(3, "J1_sort", 0, "pictures", {"kind": "real"}),
             _item(4, "J1_sort", 0, "pictures", {"kind": "real"})]
    results = [Result(items[0].id, "m", {"answer": "b"}, False),     # missed a real clash
               Result(items[1].id, "m", {"answer": "a"}, False),     # alarm on a gap
               Result(items[2].id, "m", {"answer": "b"}, False),     # wrong label, not a safety error
               Result(items[3].id, "m", None, None),                 # unparseable
               Result(items[4].id, "m", {"answer": "a"}, True)]
    tax = {r["error"]: r["count"] for r in score.score_rows(items, results) if r["table"] == "taxonomy"}
    assert tax == {"false_clear": 1, "false_alarm": 1, "wrong_label": 1, "unparseable": 1}


def test_j5_taxonomy():
    def t(res):   # jobs.py's J5 truth: does the shown fix resolve the ORIGINAL clash (Resolution.resolves_original)
        return {"resolved": res, "resolves_original": res, "expected": {"resolved": res}, "answer": res}
    items = [_item(0, "J5_review", 0, "pictures", t(False)),
             _item(1, "J5_review", 0, "pictures", t(True)),
             _item(2, "J5_review", 0, "pictures", t(True)),
             _item(3, "J5_review", 0, "pictures", {"expected_good": False})]          # a pre-"resolved" truth
    results = [Result(items[0].id, "m", {"resolved": True}, False),
               Result(items[1].id, "m", {"resolved": False}, False),
               Result(items[2].id, "m", {"resolved": True}, True),
               Result(items[3].id, "m", {"good": True}, False)]
    tax = {r["error"]: r["count"] for r in score.score_rows(items, results) if r["table"] == "taxonomy"}
    assert tax == {"approved_bad_fix": 2, "rejected_good_fix": 1}
    # the error type follows the truth's "resolved", not a checker verdict left in the detail
    r = Result(items[1].id, "m", {"resolved": False}, False, {"fix_passed": False})
    assert score.classify(items[1], r) == "rejected_good_fix"
    assert score.truth_text(items[0]) == "not resolved" and score.truth_text(items[1]) == "resolved"


def test_j3_taxonomy_and_partial_credit():
    t = _j3_truth("up", 400)
    cases = [
        ({"element": "A", "direction": "up", "distance_mm": 410, "via_opening": None}, True, {}, None),
        ({"element": "A", "direction": "down", "distance_mm": 400, "via_opening": None}, False, {}, "wrong_direction"),
        ({"element": "A", "direction": "up", "distance_mm": 100, "via_opening": None}, False, {}, "too_small"),
        ({"element": "B", "direction": "up", "distance_mm": 400, "via_opening": None}, False, {}, "wrong_element"),
        ({"element": "A", "direction": "up", "distance_mm": 900, "via_opening": None}, False,
         {"new_hits": ["e7"]}, "hits_new_element"),
        ({"element": "Z", "direction": "sideways"}, False, {}, "unparseable"),
        (None, None, {}, "unparseable"),
    ]
    items, results = [], []
    for k, (reply, ok, det, _) in enumerate(cases):
        it = _item(k, "J3_fix", 0, "pictures", t)
        items.append(it)
        results.append(Result(it.id, "m", reply, ok, det))
    for it, r, (_, _, _, want) in zip(items, results, cases):
        assert score.classify(it, r) == want, (it.id, r.reply)
    p0 = score.j3_partial(items[0], results[0])
    assert p0["direction_right"] is True and p0["distance_in_band"] is True
    p1 = score.j3_partial(items[1], results[1])
    assert p1["direction_right"] is False and p1["distance_in_band"] is True
    p2 = score.j3_partial(items[2], results[2])
    assert p2["direction_right"] is True and p2["distance_in_band"] is False   # 300 mm short of 400 +- 60
    partial = [r for r in score.score_rows(items, results) if r["table"] == "partial"][0]
    assert partial["n"] == 7 and 0 < partial["direction_right"] < 1


def test_j3_band_floor_25mm():
    t = _j3_truth("up", 100)   # 15% of 100 mm = 15 mm < 25 mm floor
    it = _item(0, "J3_fix", 0, "pictures", t)
    near = Result(it.id, "m", {"element": "A", "direction": "up", "distance_mm": 124, "via_opening": None}, False)
    far = Result(it.id, "m", {"element": "A", "direction": "up", "distance_mm": 130, "via_opening": None}, False)
    assert score.j3_partial(it, near)["distance_in_band"] is True
    assert score.j3_partial(it, far)["distance_in_band"] is False


def test_j3_right_opening():
    it = _item(0, "J3_fix", 0, "pictures", _j3_truth("east", 500, via="P"))
    good = Result(it.id, "m", {"element": "A", "direction": "east", "distance_mm": 500, "via_opening": "P"}, True)
    none = Result(it.id, "m", {"element": "A", "direction": "east", "distance_mm": 500, "via_opening": None}, False)
    assert score.j3_partial(it, good)["right_opening"] is True
    assert score.j3_partial(it, none)["right_opening"] is False


def test_control_deltas_paired():
    items, results = [], []
    for s in range(10):
        for mode, right in (("pictures", s < 8), ("no_image", s < 3), ("swapped", s < 2), ("pictures_text", True)):
            it = _item(s, "J2_who_moves", 0, mode, {"mover_letter": "A"})
            items.append(it)
            results.append(Result(it.id, "m", {"mover_letter": "A" if right else "B"}, right))
    ctl = {r["mode"]: r for r in score.score_rows(items, results) if r["table"] == "control"}
    assert set(ctl) == {"no_image", "swapped", "pictures_text"}
    assert abs(ctl["no_image"]["delta"] - (-0.5)) < 1e-9
    assert abs(ctl["swapped"]["delta"] - (-0.6)) < 1e-9
    assert abs(ctl["pictures_text"]["delta"] - 0.2) < 1e-9
    assert ctl["no_image"]["ci_lo"] <= -0.5 <= ctl["no_image"]["ci_hi"]
    assert ctl["no_image"]["n"] == 10


def test_slices_bucket_numeric_and_categorical():
    items, results = [], []
    for s in range(12):
        meta = {"occlusion": s / 12, "view": "iso" if s % 2 else "plan", "visible_px": {"A": 100 + 500 * s, "B": 9e9}}
        it = _item(s, "J1_sort", 0, "pictures", {"kind": "real"}, meta)
        items.append(it)
        results.append(Result(it.id, "m", {"answer": "a"}, s < 6))
    sl = [r for r in score.score_rows(items, results) if r["table"] == "slice"]
    occ = {r["bucket"]: r for r in sl if r["factor"] == "occlusion"}
    assert occ["[0,0.25)"]["accuracy"] == 1.0 and occ[">=0.75"]["accuracy"] == 0.0
    assert {r["bucket"] for r in sl if r["factor"] == "view"} == {"iso", "plan"}
    assert any(r["factor"] == "visible_px" for r in sl)


def test_cost_weighted_score():
    items = [_item(s, "J1_sort", 0, "pictures", {"kind": "real"}) for s in range(4)]
    results = [Result(items[0].id, "m", {"answer": "b"}, False)] + \
              [Result(i.id, "m", {"answer": "a"}, True) for i in items[1:]]
    cost = [r for r in score.score_rows(items, results) if r["table"] == "cost"][0]
    assert cost["accuracy"] == 0.75
    assert abs(cost["mean_cost"] - 5 / 4) < 1e-9
    assert abs(cost["cost_weighted_score"] - (1 - 5 / 20)) < 1e-9


def test_score_run_writes_files_and_grade_hook(tmp_path):
    items = [_item(s, "J1_sort", 0, "pictures", {"kind": "real"}, {"gap_mm": 5.0 * s}) for s in range(5)]
    results = [Result(i.id, "fake:0.7", {"answer": "a"}, None) for i in items]

    def grade(item, result, scene):
        from dataclasses import replace
        return replace(result, correct=True, detail={"reason": "matches truth"})

    graded, rows = score.score_run(items, results, tmp_path, grade_fn=grade)
    assert all(r.correct for r in graded)
    for f in ("scores.csv", "scores.jsonl", "graded.jsonl", "item_scores.jsonl"):
        assert (tmp_path / f).exists()
    with (tmp_path / "scores.csv").open() as f:
        assert len(list(csv.DictReader(f))) == len(rows)
    first = json.loads((tmp_path / "scores.jsonl").read_text().splitlines()[0])
    assert first["table"] == "accuracy"


def _run_fixture(model="fake:0.7"):
    items, results = [], []
    for s in range(6):
        for mode in ("pictures", "no_image"):
            it = _item(s, "J1_sort", 0, mode, {"kind": "real"}, {"occlusion": s / 6, "style": "flat"})
            items.append(it)
            ok = (s % 3 != 0) if mode == "pictures" else s % 2 == 0
            results.append(Result(it.id, model, {"answer": "a" if ok else "b"}, ok,
                                  {"reason": "label matches" if ok else "said not touching; it overlaps 40 mm"}))
    return items, results


def test_report_renders_markdown_and_html(tmp_path):
    items, results = _run_fixture()
    (tmp_path / "scenes" / "0").mkdir(parents=True)
    (tmp_path / "scenes" / "0" / "view_0_A.png").write_bytes(b"\x89PNG")
    rows = score.score_rows(items, results)
    md_p, html_p = report.write_report(rows, items, results, tmp_path, title="Smoke")
    md, ht = md_p.read_text(), html_p.read_text()
    assert "FAKE MODEL" in md and "FAKE MODEL" in ht
    assert "## Controls" in md and "no_image" in md
    assert "✅" in md and "❌" in md
    assert "scenes/0/view_0_A.png" in md                      # thumbnail is relative to the report
    assert "said not touching" in md
    assert ht.startswith("<!doctype html>") and "<svg" in ht and "http" not in ht.split("<body>")[1][:2000]
    assert "false_clear" in md


def test_report_real_model_not_marked_fake(tmp_path):
    items, results = _run_fixture(model="gemini-3.8-flash")
    md = report.render_markdown(score.score_rows(items, results), items, results, tmp_path)
    assert "FAKE MODEL" not in md


def test_cli_parsing():
    from iris_bench import cli
    assert cli.parse_seeds("0:3") == [0, 1, 2]
    assert cli.parse_seeds("1,4,9") == [1, 4, 9]
    assert cli.parse_challenge(["occlusion=0.5", "style=flat", "decoys=3"]) == \
        {"occlusion": 0.5, "style": "flat", "decoys": 3}
    a = cli.build_parser().parse_args(["all", "--seeds", "0:3", "--model", "fake:0.7", "--out", "/tmp/x"])
    assert a.fn is cli.cmd_all


# ---------------------------------------------------------------- categories, calibration, plausible-but-wrong

from dataclasses import asdict as _asdict  # noqa: E402

from iris_bench.spec import CATEGORIES, Element, Fix, Planted, Scene  # noqa: E402


def _cat_item(seed, job, truth, categories=None, mode="pictures"):
    it = _item(seed, job, 0, mode, truth)
    if categories is not None:
        it.categories = categories
    return it


def test_item_categories_fallback_and_explicit():
    assert score.item_categories(_cat_item(0, "J7_pick_valid", {})) == ["resolution_validity"]
    assert score.item_categories(_cat_item(0, "J8_spatial", {}, ["spatial_reasoning", "bogus",
                                                                  "relationship_understanding"])) == \
        ["spatial_reasoning", "relationship_understanding"]


def test_category_scores_with_cis():
    items, results = [], []
    for s in range(10):      # J5 + J7 both score as resolution_validity; J1 as clash_identification
        for job, ok in (("J5_review", s < 8), ("J7_pick_valid", s < 4), ("J1_sort", s < 5)):
            it = _cat_item(s, job, {})
            items.append(it)
            results.append(Result(it.id, "m", {"answer": "x"}, ok))
    it = _cat_item(99, "J8_spatial", {}, ["spatial_reasoning", "relationship_understanding"])
    items.append(it)
    results.append(Result(it.id, "m", {"answer": "A"}, True))
    cat = {r["category"]: r for r in score.score_rows(items, results) if r["table"] == "category"}
    assert set(cat) == {"resolution_validity", "clash_identification", "spatial_reasoning",
                        "relationship_understanding"}
    rv = cat["resolution_validity"]
    assert rv["n"] == 20 and abs(rv["accuracy"] - 0.6) < 1e-9 and rv["jobs"] == "J5_review,J7_pick_valid"
    assert rv["ci_lo"] <= 0.6 <= rv["ci_hi"]
    assert cat["clash_identification"]["accuracy"] == 0.5
    assert cat["spatial_reasoning"]["n"] == cat["relationship_understanding"]["n"] == 1   # counted in both
    order = [r["category"] for r in score.score_rows(items, results) if r["table"] == "category"]
    assert order == sorted(order, key=CATEGORIES.index)
    # per-job tables are still there
    assert {r["job"] for r in score.score_rows(items, results) if r["table"] == "accuracy"} >= {"J5_review", "ALL"}


def test_reply_confidence_and_reason():
    assert score.reply_confidence({"confidence": 0.7}) == 0.7
    assert score.reply_confidence({"confidence": 85}) == 0.85
    assert score.reply_confidence({"confidence": "high"}) == 0.85
    assert score.reply_confidence({"confidence": True}) is None
    assert score.reply_confidence({"answer": "a"}) is None
    assert score.reply_reason({"reason": " gap is visible "}) == "gap is visible"
    assert score.answer_text({"answer": "a", "confidence": 0.9, "reason": "x"}) == "answer=a"


def _calib_fixture():
    items, results = [], []
    for s in range(20):
        it = _cat_item(s, "J1_sort", {"kind": "real", "pair": ["e1", "e2"]})
        items.append(it)
        conf = 0.9 if s < 10 else 0.3
        ok = (s < 6) if s < 10 else (s < 13)       # 6/10 right at 0.9, 3/10 right at 0.3
        results.append(Result(it.id, "m", {"answer": "a" if ok else "b", "confidence": conf, "reason": "-"}, ok))
    it = _cat_item(50, "J1_sort", {"kind": "real"})                       # no confidence: not in calibration
    items.append(it)
    results.append(Result(it.id, "m", {"answer": "a"}, True))
    return items, results


def test_calibration_and_ece():
    items, results = _calib_fixture()
    rows = score.score_rows(items, results)
    buckets = {r["bucket"]: r for r in rows if r["table"] == "calibration"}
    assert set(buckets) == {"0.8-1.0", "0.2-0.4"}
    hi = buckets["0.8-1.0"]
    assert hi["n"] == 10 and abs(hi["accuracy"] - 0.6) < 1e-9 and abs(hi["gap"] - 0.3) < 1e-9
    assert abs(buckets["0.2-0.4"]["gap"]) < 1e-9
    summ = [r for r in rows if r["table"] == "calibration_summary"][0]
    assert summ["n"] == 21 and summ["n_conf"] == 20 and abs(summ["coverage"] - 20 / 21) < 1e-9
    assert abs(summ["ece"] - 0.15) < 1e-9                    # 0.5 * |0.6 - 0.9| + 0.5 * |0.3 - 0.3|
    brier = (6 * 0.1 ** 2 + 4 * 0.9 ** 2 + 3 * 0.7 ** 2 + 7 * 0.3 ** 2) / 20
    assert abs(summ["brier"] - brier) < 1e-9
    assert abs(summ["overconfidence"] - 0.15) < 1e-9
    assert score.ece([1.0, 1.0], [1.0, 1.0]) == 0.0 and math.isnan(score.ece([], []))


def test_confidently_wrong_per_category():
    items, results = _calib_fixture()
    it = _cat_item(60, "J2_who_moves", {"mover_letter": "A"})
    items.append(it)
    results.append(Result(it.id, "m", {"mover_letter": "B", "confidence": 0.95}, False))
    cw = {r["category"]: r for r in score.score_rows(items, results) if r["table"] == "confidently_wrong"}
    ci = cw["clash_identification"]
    assert (ci["n_conf"], ci["n_confident"], ci["n_cw"]) == (20, 10, 4)
    assert abs(ci["rate"] - 0.2) < 1e-9 and abs(ci["share_of_confident"] - 0.4) < 1e-9
    assert cw["element_selection"]["rate"] == 1.0
    assert cw["ALL"]["n_cw"] == 5 and cw["ALL"]["threshold"] == 0.8


def test_mentioned_lexical_rules():
    assert score.mentioned("A", "Element A is the run that can move")
    assert score.mentioned("A", "B sits on A.")
    assert not score.mentioned("A", "A duct crosses B here")              # sentence-opening article
    assert score.mentioned("A", "Clearly: A moves up")
    assert score.mentioned("A", "A moves above B")                        # sentence-opening, but a verb follows
    assert not score.mentioned("A", "A small gap. B is fine")
    assert not score.mentioned("I", "I think B moves")
    assert not score.mentioned("P", "Pipe B passes")
    assert score.mentioned("2", "candidate 2 clears everything")
    assert not score.mentioned("2", "the gap is about 25 mm")
    assert score.mentioned("passes through", "B passes through opening P")


def test_plausible_but_wrong_detection():
    letters = {"A": "e1", "B": "e2", "P": "o1"}
    cases = [  # (job, truth, reply, correct, plausible?)
        ("J2_who_moves", {"mover_letter": "A", "mover": "e1", "letters": letters},
         {"mover_letter": "B", "confidence": 0.9, "reason": "Element A is the service run, so move it"}, False, True),
        ("J2_who_moves", {"mover_letter": "A", "mover": "e1", "letters": letters},
         {"mover_letter": "B", "confidence": 0.9, "reason": "A duct crosses B; B moves"}, False, False),
        ("J2_who_moves", {"mover_letter": "A", "mover": "e1", "letters": letters},
         {"mover_letter": "A", "confidence": 0.9, "reason": "A moves"}, True, False),      # right: not listed
        ("J4_opening", {"fitting": ["P"], "letters": letters},
         {"fitting": [], "confidence": 0.6, "reason": "opening P looks too tight for A"}, False, True),
        ("J7_pick_valid", {"valid": [2], "letters": letters},
         {"valid": [1, 2], "confidence": 0.8, "reason": "candidate 2 clears it; candidate 1 also looks fine"},
         False, True),
    ]
    items, results = [], []
    for k, (job, truth, reply, ok, _) in enumerate(cases):
        it = _cat_item(k, job, truth)
        items.append(it)
        results.append(Result(it.id, "m", reply, ok, {"reason": "checker says no"} if not ok else {}))
    per = {r["item_id"]: r for r in score.item_rows(items, results)}
    for it, (_, _, _, _, want) in zip(items, cases):
        assert per[it.id]["plausible"] is want, it.id
    pw = [r for r in score.score_rows(items, results) if r["table"] == "plausible_wrong"]
    assert [r["job"] for r in pw] == ["J2_who_moves", "J7_pick_valid", "J4_opening"]   # most confident first
    first = pw[0]
    assert first["model_reason"].startswith("Element A") and first["checker_reason"] == "checker says no"
    assert first["mentions"] == ["A"] and first["truth_answer"] == "A" and first["answer"] == "mover_letter=B"


def _geo_scene():
    els = [Element("e1", "beam", "structure", "box", min=(0, -0.15, 2.6), max=(6, 0.15, 3.0)),
           Element("e2", "duct", "service", "box", min=(2.8, -3, 2.7), max=(3.2, 3, 2.9)),
           Element("e3", "pipe", "service", "cylinder", start=(1, 0.5, 3.33), end=(5, 0.5, 3.33), radius=0.03)]
    return Scene(seed=7, elements=els,
                 planted=[Planted("e1", "e2", "real", -0.2, mover="e2", good_fix=Fix("e2", dz=-0.5))])


GEO_LETTERS = {"A": "e1", "B": "e2", "C": "e3"}
CANDS = [Fix("e2", dz=0.4), Fix("e2", dz=-0.5), Fix("e2", dz=0.1)]   # hits e3 / valid / clash stays


def test_j6_graded_on_truth_with_checker_reason():
    sc = _geo_scene()
    it = _cat_item(7, "J6_new_clash", {"fix": _asdict(CANDS[0]), "new_clash": True, "letters": GEO_LETTERS})
    ok, d = score.check_reply(it, {"new_clash": False, "confidence": 0.9, "reason": "B clears C"}, sc)
    assert ok is False and d["new_clash"] is True and "e3 [C]" in d["reason"]
    assert d["geometry"]["new_hits"] == ["e3"] and d["geometry_agrees"] is True     # the re-run is detail only
    ok, _ = score.check_reply(it, {"new_clash": True}, sc)
    assert ok is True
    r = Result(it.id, "m", {"new_clash": False}, False, d)
    assert score.classify(it, r) == "missed_new_clash"
    # the stored truth decides even where the re-run says otherwise; the disagreement is reported
    odd = _cat_item(7, "J6_new_clash", {"fix": _asdict(CANDS[0]), "new_clash": False, "letters": GEO_LETTERS})
    ok, d = score.check_reply(odd, {"new_clash": False}, sc)
    assert ok is True and d["geometry_agrees"] is False and d["geometry"]["new_hits"] == ["e3"]


def test_j7_graded_on_truth_with_checker_reason():
    sc = _geo_scene()
    it = _cat_item(7, "J7_pick_valid", {"candidates": [_asdict(f) for f in CANDS], "valid": [2],
                                        "letters": GEO_LETTERS})
    ok, d = score.check_reply(it, {"valid": [2], "confidence": 0.7, "reason": "candidate 2 drops below"}, sc)
    assert ok is True and d["valid"] == [2] and d["geometry"]["valid"] == [2] and d["geometry_agrees"] is True
    ok, d = score.check_reply(it, {"valid": [1, 2]}, sc)
    assert ok is False and "picked 1, invalid: clearance 0 mm to e3 [C] < required 25 mm" in d["reason"]
    assert score.classify(it, Result(it.id, "m", {"valid": [1, 2]}, False, d)) == "approved_bad_fix"
    ok, d = score.check_reply(it, {"valid": []}, sc)
    assert ok is False and "missed 2, valid" in d["reason"]
    assert score.classify(it, Result(it.id, "m", {"valid": []}, False, d)) == "rejected_good_fix"
    # truth, not the re-run: a stored valid set the checker would not give still grades the reply
    odd = _cat_item(7, "J7_pick_valid", {"candidates": [_asdict(f) for f in CANDS], "valid": [2, 3],
                                         "letters": GEO_LETTERS})
    ok, d = score.check_reply(odd, {"valid": [3, 2]}, sc)
    assert ok is True and d["geometry_agrees"] is False


def test_j5_and_j3_reasons_carry_letters():
    sc = _geo_scene()
    it = _cat_item(7, "J5_review", {"fix": _asdict(CANDS[2]), "resolved": False, "resolves_original": False,
                                    "expected": {"resolved": False}, "letters": GEO_LETTERS})
    ok, d = score.check_reply(it, {"resolved": True, "confidence": 0.9, "reason": "B is lifted clear of A"}, sc)
    assert ok is False and "clash not gone" in d["reason"] and "e1 [A]" in d["reason"]
    assert d["resolved"] is False and d["geometry"]["clash_gone"] is False and d["geometry_agrees"] is True
    row = score.item_rows([it], [Result(it.id, "m", {"resolved": True, "confidence": 0.9,
                                                      "reason": "B is lifted clear of A"}, ok, d)])[0]
    assert row["plausible"] is True and "clash not gone" in row["checker_reason"]
    assert row["error"] == "approved_bad_fix" and row["truth_answer"] == "not resolved"


def test_j5_legacy_expected_good_truth_still_grades():
    sc = _geo_scene()
    it = _cat_item(7, "J5_review", {"fix": _asdict(CANDS[1]), "expected_good": True, "letters": GEO_LETTERS})
    assert score.check_reply(it, {"good": True}, sc)[0] is True
    assert score.check_reply(it, {"good": False}, sc)[0] is False
    assert score.classify(it, Result(it.id, "m", {"good": False}, False)) == "rejected_good_fix"


def test_geometry_verdict_falls_back_to_evidence():
    it = _cat_item(0, "J1_sort", {"kind": "real", "pair": ["e1", "e2"], "letters": {"A": "e1", "B": "e2"}})
    it.evidence = {"reason": "overlap 40 mm between e1 and e2"}
    v = score.geometry_verdict(it, Result(it.id, "m", {"answer": "b"}, False))
    assert v == "reference: real; overlap 40 mm between e1 [A] and e2 [B]"


def test_generic_grade_for_new_jobs():
    it = _cat_item(0, "J9_relation", {"answer": "passes_through"})
    assert score._generic_grade(it, {"answer": "passes through", "confidence": 0.5, "reason": "x"})[0] is True
    assert score._generic_grade(it, {"answer": "crosses"})[0] is False
    it8 = _cat_item(0, "J8_spatial", {"answer": "C"})
    assert score._generic_grade(it8, {"answer": "c"})[0] is True


def test_generic_grade_order_is_ordered_sets_are_not():
    order = _cat_item(0, "J8_spatial", {"question": "order", "answer": ["A", "C", "B"]})
    assert score._generic_grade(order, {"order": ["A", "C", "B"]})[0] is True
    assert score._generic_grade(order, {"order": ["B", "C", "A"]})[0] is False      # reversed: wrong
    assert score._generic_grade(order, {"order": ["A", "B", "C"]})[0] is False      # sorted: wrong
    fit = _cat_item(0, "J4_opening", {"answer": ["P", "Q"]})
    assert score._generic_grade(fit, {"fitting": ["Q", "P"]})[0] is True             # J4 is a set
    val = _cat_item(0, "J7_pick_valid", {"expected": {"valid": [1, 3]}})
    assert score._generic_grade(val, {"valid": [3, 1]})[0] is True                   # J7 is a set
    # and the same through check_reply (no "expected": the order is derived from the truth's answer)
    assert score.check_reply(order, {"order": ["A", "C", "B"]}, None)[0] is True
    assert score.check_reply(order, {"order": ["B", "C", "A"]}, None)[0] is False


# ---------------------------------------------------------------- report: new sections
import html as _html  # noqa: E402
import json as _json  # noqa: E402

from iris_bench import report as _report  # noqa: E402
from iris_bench.spec import Item as _Item, Result as _Result  # noqa: E402

_NAN = float("nan")
_REASON = "A clearly sits above B, so moving A up 80 mm clears it"
_VERDICT = "clearance 6 mm to e1 < required 25 mm"


def _rep_item(seed, job, mode="pictures"):
    return _Item(id=f"{seed}-{job}-0-{mode}", seed=seed, job=job, mode=mode, images=[f"view_{seed}_A.png"],
                 prompt="?", schema={}, truth={"kind": "real"}, meta={})


def _rep_fixture():
    items = [_rep_item(0, "J1_sort"), _rep_item(1, "J3_fix"), _rep_item(2, "J7_pick_valid")]
    results = [_Result(items[0].id, "m", {"answer": "a", "confidence": 0.9, "reason": "they overlap"}, True),
               _Result(items[1].id, "m", {"element": "A", "direction": "up", "distance_mm": 80, "via_opening": None,
                                          "confidence": 0.95, "reason": _REASON}, False, {"reason": _VERDICT}),
               _Result(items[2].id, "m", {"valid": [1], "confidence": 0.4, "reason": "1 looks fine"}, False)]
    return items, results


def _rep_scores(n_plausible=1):
    m = "gemini-test"
    rows = [
        {"table": "accuracy", "model": m, "job": "J1_sort", "mode": "pictures", "n": 10, "accuracy": 0.7,
         "ci_lo": 0.4, "ci_hi": 0.9},
        {"table": "accuracy", "model": m, "job": "J7_pick_valid", "mode": "pictures", "n": 10, "accuracy": 0.3,
         "ci_lo": 0.1, "ci_hi": 0.6},
        {"table": "accuracy", "model": m, "job": "ALL", "mode": "pictures", "n": 20, "accuracy": 0.5,
         "ci_lo": 0.3, "ci_hi": 0.7},
        {"table": "category", "model": m, "category": "clash_identification", "mode": "pictures", "n": 10,
         "accuracy": 0.7, "ci_lo": 0.4, "ci_hi": 0.9, "jobs": "J1_sort"},
        {"table": "category", "model": m, "category": "resolution_validity", "mode": "pictures", "n": 10,
         "accuracy": 0.3, "ci_lo": 0.1, "ci_hi": 0.6, "jobs": "J5_review,J7_pick_valid"},
        {"table": "category", "model": m, "category": "resolution_validity", "mode": "no_image", "n": 10,
         "accuracy": 0.2, "ci_lo": 0.0, "ci_hi": 0.5, "jobs": "J5_review,J7_pick_valid"},
        {"table": "calibration", "model": m, "mode": "pictures", "bucket": "0.8-1.0", "lo": 0.8, "hi": 1.0, "n": 12,
         "mean_conf": 0.9, "accuracy": 0.5, "gap": 0.4},
        {"table": "calibration", "model": m, "mode": "pictures", "bucket": "0.4-0.6", "lo": 0.4, "hi": 0.6, "n": 4,
         "mean_conf": 0.5, "accuracy": 0.5, "gap": 0.0},
        {"table": "calibration_summary", "model": m, "mode": "pictures", "n": 20, "n_conf": 16, "coverage": 0.8,
         "mean_conf": 0.8, "accuracy": 0.5, "ece": 0.12345, "brier": 0.31, "overconfidence": 0.3},
        {"table": "confidently_wrong", "model": m, "mode": "pictures", "category": "ALL", "n": 20, "n_conf": 16,
         "n_confident": 12, "n_cw": 6, "rate": 6 / 16, "share_of_confident": 0.5, "threshold": 0.8},
        {"table": "confidently_wrong", "model": m, "mode": "pictures", "category": "movement_estimation", "n": 5,
         "n_conf": 0, "n_confident": 0, "n_cw": 0, "rate": _NAN, "share_of_confident": _NAN, "threshold": 0.8},
    ]
    for k in range(n_plausible):
        rows.append({"table": "plausible_wrong", "model": m, "mode": "pictures", "item_id": f"1-J3_fix-{k}-pictures"
                     if k else "1-J3_fix-0-pictures", "job": "J3_fix", "category": "movement_estimation",
                     "confidence": 0.95 - k * 0.01, "model_reason": _REASON, "checker_reason": _VERDICT,
                     "answer": "A up 80 mm", "truth_answer": "A up 400 mm", "mentions": ["A", "B"]})
    return rows


def _rep_integrity(ok=False):
    return {"ok": ok, "generated_at": "2026-11-22T10:00:00Z", "out_dir": "runs/x", "n_items": 3, "checks": [
        {"name": "truth_frozen", "title": "Truth and evidence written before any model call", "ok": True,
         "severity": "error", "summary": "3/3 item digests match the build manifest", "details": {}},
        {"name": "prompts_clean", "title": "Pictures-mode prompts leak no kinds, ids or measurements", "ok": ok,
         "severity": "error", "summary": "1 prompt names 'duct'", "details": {}},
        {"name": "truth_rederived", "title": "Reference answers re-derived from scene.json", "ok": True,
         "severity": "error", "summary": "2 matched, 1 skipped",
         "details": {"checked": 3, "matched": 2, "mismatched": 0, "skipped": 1,
                     "per_job": {"J1_sort": {"checked": 1, "matched": 1, "mismatched": 0, "skipped": 0},
                                 "J8_spatial": {"checked": 1, "matched": 0, "mismatched": 0, "skipped": 1}}}},
        {"name": "answer_balance", "title": "Answer balance and chance baselines", "ok": True, "severity": "warn",
         "summary": "J1 majority 80%", "details": {"jobs": [
             {"job": "J1_sort", "n": 10, "counts": {"a": 8, "b": 2}, "majority_answer": "a", "majority_share": 0.8,
              "chance": 1 / 3, "imbalanced": True}]}},
    ]}


def test_report_new_sections_markdown(tmp_path):
    items, results = _rep_fixture()
    md = _report.render_markdown(_rep_scores(), items, results, tmp_path, integrity=_rep_integrity(ok=False))
    for h in ("## Scores by category (95% bootstrap CI)", "## Sounds reasonable vs geometrically correct",
              "### Plausible but wrong", "## Benchmark integrity"):
        assert h in md, h
    assert "Clash identification" in md and "Resolution validity" in md and "Movement estimation" in md
    assert "70% [40%, 90%] n=10" in md
    assert "### Categories by mode" in md and "no_image" in md
    assert "0.123" in md and "0.310" in md                     # ECE / Brier, three decimals
    assert "6 / 16" in md                                        # confidently wrong count
    assert _REASON in md and _VERDICT in md                      # side by side in one row
    row = next(l for l in md.splitlines() if _REASON in l and _VERDICT in l)
    assert "A up 400 mm" in row and "0.95" in row
    assert "J7 pick valid" in md
    assert "**Overall: FAIL**" in md and "✅" in md and "❌" in md and "⚠️" in md
    assert "Majority share" in md and "80%" in md and "33%" in md
    assert "Checked 3, matched 2, mismatched 0, skipped 1." in md
    assert "Model says: confidence 0.90; reason: they overlap" in md   # sample items show the model's own words


def test_report_new_sections_html(tmp_path):
    items, results = _rep_fixture()
    ht = _report.render_html(_rep_scores(), items, results, tmp_path, integrity=_rep_integrity(ok=True))
    body = ht.split("<body>")[1]
    assert 'class="reliability"' in ht and "<circle" in ht
    assert "http" not in body
    assert _html.escape(_REASON) in ht and _html.escape(_VERDICT) in ht
    assert "Geometry verdict (checker)" in ht and "Overall: PASS" in ht
    assert "Clash identification" in ht and "Benchmark integrity" in ht
    assert 'src="view_1_A.png"' in ht or "view_1_A.png" in ht   # thumbnail on the plausible-but-wrong card


def test_report_integrity_from_file_and_absent(tmp_path):
    items, results = _rep_fixture()
    md = _report.render_markdown(_rep_scores(), items, results, tmp_path)
    assert "_Integrity not checked: run `iris-bench verify --out <run>`._" in md
    (tmp_path / "integrity.json").write_text(_json.dumps(_rep_integrity(ok=True)))
    md_p, html_p = _report.write_report(_rep_scores(), items, results, tmp_path, title="T")
    assert "**Overall: PASS**" in md_p.read_text() and "Overall: PASS" in html_p.read_text()


def test_report_plausible_capped_and_sorted(tmp_path):
    items, results = _rep_fixture()
    rows = _report.plausible_rows(_rep_scores(n_plausible=20))
    assert len(rows) == _report.PLAUSIBLE_TOP
    confs = [r["confidence"] for r in rows]
    assert confs == sorted(confs, reverse=True)


def test_report_old_rows_without_new_tables(tmp_path):
    items, results = _rep_fixture()
    old = [r for r in _rep_scores() if r["table"] == "accuracy"]
    md = _report.render_markdown(old, items, results, tmp_path)
    assert "_No category scores in this run._" in md
    assert "_No replies carried a confidence._" in md and "_No plausible-but-wrong answers._" in md
    ht = _report.render_html(old, items, results, tmp_path)
    assert "No plausible-but-wrong answers." in ht


# ---------------------------------------------------------------- cli: verify, export, new flags


import pytest  # noqa: E402

from iris_bench import cli  # noqa: E402
from iris_bench.spec import Camera  # noqa: E402


def test_parse_jobs_short_full_and_bad():
    assert cli.parse_jobs("J1,J3_fix") == ["J1_sort", "J3_fix"]
    assert cli.parse_jobs("j9, J1 ,J1") == ["J9_relation", "J1_sort"]       # case, spaces, duplicates
    assert cli.parse_jobs(None) is None and cli.parse_jobs("") is None and cli.parse_jobs("all") is None
    with pytest.raises(ValueError):                                          # parse_jobs: ValueError
        cli.parse_jobs("J1,J10")
    with pytest.raises(SystemExit):                                          # argparse: SystemExit
        cli.build_parser().parse_args(["build", "--out", "x", "--jobs", "J0"])


def test_parse_cameras_presets_and_angles():
    cams = cli.parse_cameras("top,section,iso:30:45")
    assert [c.name for c in cams] == ["top", "section", "iso"]
    top, sec, iso = cams
    assert (top.elevation_deg, top.projection) == (90.0, "orthographic")
    assert (sec.azimuth_deg, sec.elevation_deg, sec.projection) == (0.0, 0.0, "orthographic")
    assert (iso.azimuth_deg, iso.elevation_deg, iso.projection) == (30.0, 45.0, "perspective")
    a, b = cli.parse_cameras("A,iso:10:20:1.5")
    assert a == Camera("A") and b.distance_factor == 1.5
    assert [c.name for c in cli.parse_cameras("iso,iso:120:30")] == ["iso", "iso_2"]   # unique names
    assert cli.parse_cameras("section_y")[0].azimuth_deg == 90.0
    for bad in ("iso:30", "iso:x:y", "top:0:120", "1abc"):
        with pytest.raises(ValueError):
            cli.parse_cameras(bad)


def test_parser_all_verify_export():
    p = cli.build_parser()
    a = p.parse_args(["all", "--seeds", "0:3", "--model", "fake:0.7", "--out", "/tmp/x", "--jobs", "J1,J2",
                      "--cameras", "top", "--challenge", "occlusion=0.5", "--locked-services", "2"])
    assert a.fn is cli.cmd_all
    assert a.jobs == ["J1_sort", "J2_who_moves"]
    assert [c.name for c in a.cameras] == ["top"]
    assert cli.challenge_from_args(a) == {"occlusion": 0.5, "locked_services": 2}
    v = p.parse_args(["verify", "--out", "x"])
    assert v.fn is cli.cmd_verify and v.sample == 25
    e = p.parse_args(["export", "--out", "x", "--sample", "10", "--to", "y"])
    assert e.fn is cli.cmd_export and e.sample == 10 and str(e.to) == "y" and e.seed == 0
    g = p.parse_args(["generate", "--seeds", "0", "--out", "x", "--locked-services", "1", "--cameras", "iso"])
    assert cli.challenge_from_args(g) == {"locked_services": 1} and g.cameras[0].name == "iso"


def _tiny_scene(seed: int, **challenge) -> Scene:
    els = [Element("e1", "beam", "structure", "box", min=(0, 0, 3), max=(4, 0.3, 3.5)),
           Element("e2", "duct", "service", "box", min=(1, -1, 3.2), max=(1.4, 2, 3.6))]
    return Scene(seed=seed, elements=els, planted=[Planted("e1", "e2", "real", -0.3, mover="e2")],
                 challenge=dict(challenge))


def _stub_module(monkeypatch, name: str, **attrs):
    """Install a stand-in iris_bench.<name> (so these tests do not depend on the generator/jobs/renderer mid-rewrite)."""
    import sys
    import types

    import iris_bench
    mod = types.ModuleType(f"iris_bench.{name}")
    for k, v in attrs.items():
        setattr(mod, k, v)
    monkeypatch.setitem(sys.modules, f"iris_bench.{name}", mod)
    monkeypatch.setattr(iris_bench, name, mod, raising=False)
    return mod


def test_generate_filters_kwargs_and_saves_cameras(tmp_path, monkeypatch):
    scenes = _stub_module(monkeypatch, "scenes")
    seen = {}

    def fake_generate(seed, *, occlusion=0.0):   # no **kwargs: unknown knobs must not reach it
        seen["kw"] = {"occlusion": occlusion}
        return _tiny_scene(seed, occlusion=occlusion)

    monkeypatch.setattr(scenes, "generate", fake_generate, raising=False)
    a = cli.build_parser().parse_args(["generate", "--seeds", "0", "--out", str(tmp_path), "--workers", "1",
                                       "--no-ifc", "--challenge", "occlusion=0.5", "--locked-services", "2",
                                       "--cameras", "top,iso:30:45"])
    assert cli.cmd_generate(a) == 0
    sc = Scene.load(tmp_path / "scenes" / "0" / "scene.json")
    assert seen["kw"] == {"occlusion": 0.5}
    assert sc.challenge["locked_services"] == 2                 # kept for slicing even though not passed
    assert [c.name for c in sc.cameras] == ["top", "iso"] and sc.cameras[1].azimuth_deg == 30.0


# _build_one with renderers_for and guarded renders: tests/bench/test_cli.py


def test_all_runs_verify_before_report_and_returns_2_on_failure(tmp_path, monkeypatch):
    order = []
    for name in ("generate", "render", "build", "run", "score", "report"):
        monkeypatch.setattr(cli, f"cmd_{name}", lambda a, n=name: order.append(n) or 0)

    def fake_verify(a):
        order.append("verify")
        a._integrity, a._integrity_lines = {"ok": False, "checks": []}, ["integrity: FAIL"]
        return 1

    monkeypatch.setattr(cli, "cmd_verify", fake_verify)
    a = cli.build_parser().parse_args(["all", "--seeds", "0:1", "--model", "fake:0.7", "--out", str(tmp_path)])
    assert cli.cmd_all(a) == 2
    assert order == ["generate", "render", "build", "run", "score", "verify", "report"]

    def ok_verify(a):
        a._integrity, a._integrity_lines = {"ok": True, "checks": []}, ["integrity: PASS"]
        return 0

    monkeypatch.setattr(cli, "cmd_verify", ok_verify)
    assert cli.cmd_all(a) == 0


def test_verify_without_run_folder_does_not_crash(tmp_path):
    a = cli.build_parser().parse_args(["verify", "--out", str(tmp_path)])
    rc = cli.cmd_verify(a)
    assert rc in (0, 1)
    if getattr(a, "_integrity", None) is not None:
        assert json.loads((tmp_path / "integrity.json").read_text())["ok"] in (True, False)
