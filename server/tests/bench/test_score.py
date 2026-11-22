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
    items = [_item(0, "J5_review", 0, "pictures", {"expected_good": False}),
             _item(1, "J5_review", 0, "pictures", {"expected_good": True}),
             _item(2, "J5_review", 0, "pictures", {"expected_good": True})]
    results = [Result(items[0].id, "m", {"good": True}, False), Result(items[1].id, "m", {"good": False}, False),
               Result(items[2].id, "m", {"good": True}, True)]
    tax = {r["error"]: r["count"] for r in score.score_rows(items, results) if r["table"] == "taxonomy"}
    assert tax == {"approved_bad_fix": 1, "rejected_good_fix": 1}


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
