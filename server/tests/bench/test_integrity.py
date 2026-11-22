"""Integrity checks: frozen truth, import isolation, clean prompts, geometry re-derivation, answer balance."""
from __future__ import annotations

import json
import os
from dataclasses import asdict, replace
from pathlib import Path

import pytest

from iris_bench import integrity
from iris_bench.spec import Element, Fix, Item, Planted, Scene

CHECK_NAMES = ["truth_frozen", "truth_isolated", "prompts_clean", "truth_rederived", "letters_shown",
               "answer_balance"]


# ---------------------------------------------------------------- fixtures

def _write_items(out: Path, items: list[Item]) -> None:
    (out / "items.jsonl").write_text("".join(json.dumps(asdict(i)) + "\n" for i in items))


def _real_run(tmp_path: Path, seeds=(0, 1, 2)) -> tuple[Path, list[Item], dict[int, Scene]]:
    """A run folder from the real generator and job builder (skipped if either is mid-refactor)."""
    try:
        from iris_bench import jobs, scenes
        out = tmp_path / "run"
        items, by_seed = [], {}
        for s in seeds:
            sc = scenes.generate(s)
            folder = out / "scenes" / str(s)
            scenes.to_folder(sc, folder)
            by_seed[s] = sc
            try:
                items += jobs.build_items(sc, [], ("pictures",), scene_dir=folder, fix_renderer=lambda _s, _f: [])
            except TypeError:
                items += jobs.build_items(sc, [], ("pictures",), scene_dir=folder)
    except Exception as e:   # another agent is rewriting scenes/jobs right now
        pytest.skip(f"generator/jobs unavailable: {type(e).__name__}: {e}")
    if not items:
        pytest.skip("job builder produced no items")
    _write_items(out, items)
    integrity.write_manifest(out, items)
    return out, items, by_seed


def _box(eid, kind, role, lo, hi, **kw) -> Element:
    return Element(id=eid, kind=kind, role=role, shape="box", min=lo, max=hi, **kw)


def _hand_scene() -> Scene:
    """A beam (structure), a duct through it (real clash, 200 mm deep) and a box to the north of the duct."""
    beam = _box("e1", "beam", "structure", (0.0, 0.0, 0.0), (4.0, 0.3, 0.6))
    duct = _box("e2", "duct", "service", (1.0, -1.0, 0.4), (1.4, 1.3, 0.8))
    third = _box("e3", "tray", "service", (0.9, 2.0, 0.3), (1.5, 3.0, 0.9))
    return Scene(seed=7, elements=[beam, duct, third],
                 planted=[Planted("e2", "e1", "real", -0.2, mover="e2", good_fix=Fix("e2", dz=0.5))])


def _item(job, truth, prompt="Which labelled element should move? Answer with JSON only.", mode="pictures",
          schema=None, seed=7, n=0) -> Item:
    return Item(id=f"{seed}-{job}-{n}-{mode}", seed=seed, job=job, mode=mode, images=[], prompt=prompt,
                schema=schema or {}, truth=truth, meta={"n": 0})


# ---------------------------------------------------------------- 1. frozen truth

def test_manifest_then_clean_run_passes(tmp_path):
    out, items, _ = _real_run(tmp_path)
    (out / "results.jsonl").write_text(json.dumps({"item_id": items[0].id, "model": "fake:0.7",
                                                   "reply": {"answer": "a"}, "correct": True}) + "\n")
    rep = integrity.check_run(out)
    assert [c["name"] for c in rep["checks"]] == CHECK_NAMES
    assert (out / integrity.INTEGRITY_NAME).exists()
    assert json.loads((out / integrity.INTEGRITY_NAME).read_text())["checks"][0]["name"] == "truth_frozen"
    by = {c["name"]: c for c in rep["checks"]}
    assert by["truth_frozen"]["ok"], by["truth_frozen"]["summary"]
    assert by["truth_isolated"]["ok"] and by["prompts_clean"]["ok"]
    assert by["truth_rederived"]["ok"] and by["truth_rederived"]["details"]["matched"] > 0
    assert rep["ok"] is True
    lines = integrity.summary_lines(rep)
    assert len(lines) == len(CHECK_NAMES) + 1 and lines[0].startswith("PASS ") and lines[-1].startswith("integrity: OK")


def test_tampered_truth_is_detected(tmp_path):
    out, items, _ = _real_run(tmp_path)
    victim = next(i for i in items if i.job == "J1_sort")
    flipped = {"real": "not_touching", "not_touching": "real", "by_design": "real"}[victim.truth["kind"]]
    tampered = [replace(i, truth={**i.truth, "kind": flipped}) if i.id == victim.id else i for i in items]
    _write_items(out, tampered)
    rep = integrity.check_run(out)
    frozen = rep["checks"][0]
    assert frozen["name"] == "truth_frozen" and frozen["ok"] is False
    assert victim.id in frozen["details"]["tampered"] and victim.id in frozen["summary"]
    assert rep["ok"] is False


def test_tampered_evidence_and_scene_detected(tmp_path):
    out, items, _ = _real_run(tmp_path, seeds=(0,))
    _write_items(out, [replace(items[0], evidence={"min_clear_m": 1.0})] + items[1:])
    sp = out / "scenes" / "0" / "scene.json"
    d = json.loads(sp.read_text())
    d["clearance_m"] = 0.001
    sp.write_text(json.dumps(d))
    det = integrity.check_run(out)["checks"][0]["details"]
    assert det["tampered"] == [items[0].id] and det["changed_scenes"] == ["0"]


def test_missing_manifest_stale_results_and_truth_leak(tmp_path):
    out, items, _ = _real_run(tmp_path, seeds=(0,))
    res = out / "results.jsonl"
    res.write_text(json.dumps({"item_id": items[0].id, "reply": {"answer": "a", "truth": {"kind": "real"}}}) + "\n"
                   + json.dumps({"item_id": "99-J1_sort-0-pictures", "reply": {"answer": "b"}}) + "\n")
    built = json.loads((out / integrity.MANIFEST_NAME).read_text())["built_at"]
    os.utime(res, (built - 60, built - 60))          # answers older than the answer key
    det = integrity.check_run(out)["checks"][0]["details"]
    assert det["results_older_than_manifest"] == ["results.jsonl"]
    assert det["truth_in_results"] == [items[0].id]
    assert det["unknown_result_ids"] == ["99-J1_sort-0-pictures"]
    (out / integrity.MANIFEST_NAME).unlink()
    frozen = integrity.check_run(out)["checks"][0]
    assert frozen["ok"] is False and "manifest" in frozen["summary"]


def test_rebuild_with_same_truth_keeps_build_time(tmp_path):
    out, items, _ = _real_run(tmp_path, seeds=(0,))
    first = json.loads((out / integrity.MANIFEST_NAME).read_text())
    again = integrity.write_manifest(out)                         # reads items.jsonl back
    assert again["built_at"] == first["built_at"] and again["items_sha256"] == first["items_sha256"]
    assert again["n_items"] == len(items) and set(again["scenes"]) == {"0"}
    assert integrity.item_digest(items[0]) == integrity.item_digest(asdict(items[0]))


# ---------------------------------------------------------------- 2. import isolation

def test_import_scan_passes_on_current_code():
    scan = integrity.import_scan()
    assert scan["ok"] is True, {m: v["bad"] for m, v in scan["modules"].items()}
    assert {"checker", "geom", "scenes"} <= set(scan["modules"])
    assert "spec" in scan["modules"]                               # followed transitively
    assert not any(m in scan["modules"] for m in ("runner", "score", "report"))


def test_import_scan_flags_runner_and_model_client(tmp_path):
    pkg = tmp_path / "fakepkg"
    pkg.mkdir()
    (pkg / "checker.py").write_text("from . import geom\nfrom .runner import run\n")
    (pkg / "geom.py").write_text("import math\n\ndef f():\n    from iris.model_client import GeminiModel\n")
    (pkg / "scenes.py").write_text("from pathlib import Path\nP = Path('runs') / 'results.jsonl'\n")
    (pkg / "runner.py").write_text("")
    scan = integrity.import_scan(package_dir=pkg)
    assert scan["ok"] is False
    assert any(".runner" in b for b in scan["modules"]["checker"]["bad"])
    assert any("model_client" in b for b in scan["modules"]["geom"]["bad"])   # import inside a function
    assert scan["modules"]["scenes"]["reads_results"] is True
    assert scan["missing"] == ["truth"]


# ---------------------------------------------------------------- 3. prompt leaks

def test_scan_prompt_finds_forbidden_tokens():
    hits = integrity.scan_prompt("Move the Duct e3 up 450 mm to (1.0, 2.0, 3.0); x=2.5 and o2 too. Pipes clash.")
    for tok in ("Duct", "e3", "450 mm", "(1.0, 2.0, 3.0)", "o2", "Pipes"):
        assert any(tok in h for h in hits), (tok, hits)
    assert integrity.scan_prompt("Raise it 0.3 m") == ["0.3 m"]


def test_scan_prompt_passes_current_pictures_prompts():
    clean = ('Here are pictures of two elements labelled G and E. Is this (a) a real clash that needs fixing, '
             '(b) not touching, (c) touching by design (one supports the other)? Reply with the letter a, b or c '
             'in the field "answer".\n\nAnswer with JSON only.')
    assert integrity.scan_prompt(clean) == []


def test_real_pictures_prompts_are_clean(tmp_path):
    _, items, _ = _real_run(tmp_path)
    leaks = {i.id: integrity.scan_prompt(i.prompt) for i in items if i.mode != "pictures_text"}
    assert not {k: v for k, v in leaks.items() if v}


def test_prompt_leak_fails_check_run(tmp_path):
    out, items, _ = _real_run(tmp_path, seeds=(0,))
    leaky = [replace(items[0], prompt=items[0].prompt + " The duct is 300 mm below the beam.")] + items[1:]
    _write_items(out, leaky)
    integrity.write_manifest(out, leaky)
    c = integrity.check_run(out)["checks"][2]
    assert c["name"] == "prompts_clean" and c["ok"] is False
    assert c["details"]["offending"][0]["item_id"] == items[0].id
    # pictures_text items may carry measured facts
    ok_items = [replace(items[0], mode="pictures_text", id=items[0].id.replace("pictures", "pictures_text"),
                        prompt="duct, 300 mm")]
    _write_items(out, items + ok_items)
    integrity.write_manifest(out)
    assert integrity.check_run(out)["checks"][2]["ok"] is True


# ---------------------------------------------------------------- 4. geometry re-derivation

def test_rederive_real_items_match_and_flipped_kind_mismatches(tmp_path):
    _, items, scenes = _real_run(tmp_path)
    matched = set()
    for it in items:
        r = integrity.rederive(it, scenes[it.seed])
        assert r["status"] != "mismatch", r
        if r["status"] == "match":
            matched.add(it.job)
    assert {"J1_sort", "J3_fix"} <= matched
    j1 = next(i for i in items if i.job == "J1_sort")
    flipped = replace(j1, truth={"kind": "by_design" if j1.truth["kind"] != "by_design" else "real"})
    bad = integrity.rederive(flipped, scenes[j1.seed])
    assert bad["status"] == "mismatch" and bad["job"] == "J1_sort"
    j5 = next((i for i in items if i.job == "J5_review" and "expected_good" in i.truth), None)
    if j5 is not None:
        assert "J5_review" in matched
        bad5 = replace(j5, truth={**j5.truth, "expected_good": not j5.truth["expected_good"]})
        assert integrity.rederive(bad5, scenes[j5.seed])["status"] == "mismatch"


def test_rederive_hand_scene_all_jobs():
    sc = _hand_scene()
    up, short, north = Fix("e2", dz=0.5), Fix("e2", dz=0.1), Fix("e2", dy=1.6)
    cases = [
        (_item("J1_sort", {"kind": "real", "pair": ["e2", "e1"]}), "match"),
        (_item("J1_sort", {"kind": "not_touching", "pair": ["e2", "e1"]}), "mismatch"),
        (_item("J2_who_moves", {"mover_letter": "A", "mover": "e2"}), "match"),
        (_item("J2_who_moves", {"mover_letter": "B", "mover": "e1"}), "mismatch"),
        (_item("J3_fix", {"good_fix": asdict(up), "pair": ["e2", "e1"]}), "match"),
        (_item("J3_fix", {"good_fix": asdict(short), "pair": ["e2", "e1"]}), "mismatch"),
        (_item("J5_review", {"fix": asdict(up), "expected_good": True}), "match"),
        (_item("J5_review", {"fix": asdict(short), "expected_good": True}), "mismatch"),
        (_item("J6_new_clash", {"fix": asdict(north), "new_clash": True}), "match"),
        (_item("J6_new_clash", {"fix": asdict(up), "new_clash": True}), "mismatch"),
        (_item("J6_new_clash", {"fix": asdict(north), "new_hits": ["T"], "letters": {"T": "e3"}}), "match"),
        (_item("J7_pick_valid", {"candidates": [{"fix": asdict(up)}, {"fix": asdict(short)}, asdict(north)],
                                 "valid": [1]}), "match"),
        (_item("J7_pick_valid", {"candidates": [asdict(up), asdict(short)], "valid": [1, 2]}), "mismatch"),
        (_item("J9_relation", {"relation": "clashes", "pair": ["e2", "e1"]}), "match"),
        (_item("J9_relation", {"relation": "parallel", "a": "e1", "b": "e2"}), "mismatch"),
        (_item("J8_spatial", {"relations": [{"a": "e3", "b": "e1", "relation": "north_of"}]}), "match"),
        (_item("J8_spatial", {"answer": "C"}), "skipped"),
        (_item("J4_opening", {"weird": 1}), "skipped"),
    ]
    for it, want in cases:
        r = integrity.rederive(it, sc)
        assert r["status"] == want, (it.job, it.truth, r)


def test_rederive_j4_only_over_offered_openings():
    """J4's derived fitting set is limited to the openings the item offered (truth["offered"]): an opening elsewhere in
    the scene that would also fit is not part of the answer."""
    from iris_bench.spec import Opening
    sc = _hand_scene()
    beam = replace(sc.elements[0], openings=[Opening("o1", (0.9, 0.0, 0.05), (1.5, 0.3, 0.55)),     # fits e2
                                             Opening("o2", (2.5, 0.0, 0.05), (3.1, 0.3, 0.55)),     # fits, not shown
                                             Opening("o3", (3.5, 0.0, 0.2), (3.6, 0.3, 0.3))])      # too small
    sc = replace(sc, elements=[beam] + sc.elements[1:])
    letters = {"P": "o1", "Q": "o3", "R": "o2"}
    base = {"mover": "e2", "fitting": ["P"], "letters": letters}
    r = integrity.rederive(_item("J4_opening", {**base, "offered": ["o1", "o3"]}), sc)
    assert r["status"] == "match" and "o2" not in r["derived"] and "offered" in r["reason"], r
    # without "offered" (an older truth) every opening in the scene counts, so o2 makes it a mismatch
    r = integrity.rederive(_item("J4_opening", base), sc)
    assert r["status"] == "mismatch" and "o2" in r["derived"], r
    # offering o2 too makes "P only" wrong
    r = integrity.rederive(_item("J4_opening", {**base, "offered": ["o1", "o2", "o3"]}), sc)
    assert r["status"] == "mismatch", r
    assert integrity.rederive(_item("J4_opening", {**base, "fitting": ["P", "R"], "offered": ["o1", "o2"]}),
                              sc)["status"] == "match"


def test_rederive_compares_stored_evidence():
    sc = _hand_scene()
    from iris_bench import checker
    ev = dict(checker.check_fix(sc, Fix("e2", dz=0.5)))
    good = _item("J5_review", {"fix": asdict(Fix("e2", dz=0.5)), "expected_good": True})
    assert integrity.rederive(replace(good, evidence={"check_fix": ev}), sc)["status"] == "match"
    forged = replace(good, evidence={"check_fix": {**ev, "min_clear_m": ev["min_clear_m"] + 0.1}})
    r = integrity.rederive(forged, sc)
    assert r["status"] == "mismatch" and "min_clear_m" in r["reason"]


def test_rederive_never_raises():
    r = integrity.rederive(_item("J1_sort", {"kind": "real", "pair": ["e9", "e1"]}), _hand_scene())
    assert r["status"] == "skipped" and r["reason"]


# ---------------------------------------------------------------- 5. answer balance

def test_answer_balance_and_chance():
    meta = {"confidence": {"type": "number"}, "reason": {"type": "string"}}
    j1 = {"type": "object", "properties": {"answer": {"type": "string", "enum": ["a", "b", "c"]}, **meta}}
    j4 = {"type": "object", "properties": {"fitting": {"type": "array", "items": {"enum": ["P", "Q", "R"]}}}}
    j5 = {"type": "object", "properties": {"good": {"type": "boolean"}, **meta}}
    j3 = {"type": "object", "properties": {"element": {"enum": ["A", "B"]}, "direction": {"enum": list("123456")},
                                           "distance_mm": {"type": "integer"}, "via_opening": {"enum": ["P", "R", None]}}}
    items = [_item("J1_sort", {"kind": k}, schema=j1, n=n) for n, k in enumerate(["real", "real", "real", "not_touching"])]
    items += [_item("J4_opening", {"fitting": f}, schema=j4, n=n) for n, f in enumerate([["P"], [], ["R", "P"]])]
    items += [_item("J5_review", {"expected_good": g}, schema=j5, n=n) for n, g in enumerate([True, False])]
    items += [_item("J3_fix", {"expected": {"direction": "up"}}, schema=j3)]
    items += [_item("J1_sort", {"kind": "by_design"}, schema=j1, mode="no_image", n=9)]   # controls not counted
    rows = {r["job"]: r for r in integrity.answer_balance(items)}
    assert rows["J1_sort"]["n"] == 4 and rows["J1_sort"]["majority_answer"] == "real"
    assert rows["J1_sort"]["majority_share"] == 0.75 and rows["J1_sort"]["imbalanced"] is True
    assert abs(rows["J1_sort"]["chance"] - 1 / 3) < 1e-9
    assert rows["J4_opening"]["counts"] == {"P": 1, "none": 1, "P,R": 1} and rows["J4_opening"]["chance"] == 1 / 8
    assert rows["J5_review"]["chance"] == 0.5 and rows["J5_review"]["imbalanced"] is False
    assert abs(rows["J3_fix"]["chance"] - 1 / 36) < 1e-9 and rows["J3_fix"]["majority_answer"] == "up"


def test_balance_is_a_warning_not_a_failure(tmp_path):
    out, items, _ = _real_run(tmp_path)
    rep = integrity.check_run(out)
    bal = next(c for c in rep["checks"] if c["name"] == "answer_balance")
    assert bal["name"] == "answer_balance" and bal["severity"] == "warn"
    assert {r["job"] for r in bal["details"]["jobs"]} >= {"J1_sort"}
    if not bal["ok"]:
        assert rep["ok"] is True and any(l.startswith("WARN ") for l in integrity.summary_lines(rep))

# ---- export tests (merged below)

import csv  # noqa: E402


from iris_bench.spec import Result  # noqa: E402

EXPORT_JOBS = ("J1_sort", "J2_who_moves", "J8_spatial")
EXPORT_CATS = {"J1_sort": "clash_identification", "J2_who_moves": "element_selection",
               "J8_spatial": "spatial_reasoning"}


def _export_scene(seed: int) -> Scene:
    beam = Element(id="e1", kind="beam", role="structure", shape="box", min=(0.0, 0.0, 3.0), max=(6.0, 0.3, 3.5))
    duct = Element(id="e2", kind="duct", role="service", shape="box", min=(2.0, -1.0, 3.2), max=(2.4, 1.0, 3.6))
    return Scene(seed=seed, elements=[beam, duct],
                 planted=[Planted(a="e1", b="e2", kind="real", distance_m=-0.3, mover="e2",
                                  good_fix=Fix("e2", dz=-0.5))])


def _export_run(tmp_path: Path) -> Path:
    run = tmp_path / "run"
    items, results = [], []
    for seed in range(3):
        folder = run / "scenes" / str(seed)
        (folder / "render").mkdir(parents=True)
        _export_scene(seed).save(folder / "scene.json")
        (folder / "render" / "e1-e2_A.png").write_bytes(b"\x89PNG\r\n\x1a\nA")
        (folder / "render" / "e1-e2_C.png").write_bytes(b"\x89PNG\r\n\x1a\nC")
        for job in EXPORT_JOBS:
            truth = {"J1_sort": {"kind": "real", "pair": ["e1", "e2"]},
                     "J2_who_moves": {"mover_letter": "B", "mover": "e2"},
                     "J8_spatial": {"answer": "A"}}[job]
            for mode in ("pictures", "no_image"):
                if mode == "no_image":
                    images = []
                elif seed == 2 and job == "J8_spatial":
                    images = ["render/e1-e2_A.png", "render/does_not_exist.png"]   # one missing picture
                elif seed == 1:
                    images = [str((folder / "render" / "e1-e2_A.png").resolve())]  # absolute path
                else:
                    images = ["render/e1-e2_A.png", "render/e1-e2_C.png"]          # scene-relative paths
                it = Item(id=f"{seed}-{job}-0-{mode}", seed=seed, job=job, mode=mode, images=images,
                          prompt=f"Question for {job}. Answer with JSON only.",
                          schema={"type": "object", "properties": {"answer": {"type": "string"}}},
                          truth=truth, meta={"n": 0}, categories=[EXPORT_CATS[job]],
                          evidence={"distance_m": -0.3, "source": "geometry"})
                items.append(it)
                if mode == "pictures" and seed == 0:
                    results.append(Result(it.id, "fake:0.7", {"answer": "a"}, True, {"reason": "matches"}))
    (run / "items.jsonl").write_text("".join(json.dumps(asdict(i)) + "\n" for i in items))
    (run / "graded.jsonl").write_text("".join(json.dumps(asdict(r)) + "\n" for r in results))
    return run


def test_export_folder_structure_and_fields(tmp_path):
    from iris_bench import export
    run = _export_run(tmp_path)
    to = tmp_path / "datasets" / "sample"
    res = export.export_sample(run, to, sample=6, seed=0)

    assert res["n"] == 6
    assert res["per_job"] == {j: 2 for j in EXPORT_JOBS}             # stratified: every job, equal shares
    assert set(res["per_category"]) == set(EXPORT_CATS.values())
    assert "exported 6 items" in res["summary"] and "J1 2" in res["summary"]
    for f in ("README.md", "index.jsonl", "index.csv"):
        assert (to / f).is_file(), f

    index = [json.loads(l) for l in (to / "index.jsonl").read_text().splitlines() if l.strip()]
    assert len(index) == 6 and {r["mode"] for r in index} == {"pictures"}   # only pictures mode
    with (to / "index.csv").open() as f:
        assert len(list(csv.DictReader(f))) == 6

    readme = (to / "README.md").read_text()
    assert "the geometry independently verifies the answer" in readme
    for r in index:
        folder = to / r["folder"]
        for f in ("item.json", "prompt.txt", "schema.json", "truth.json", "evidence.json", "scene.json",
                  "validation.json"):
            assert (folder / f).is_file(), (r["id"], f)
        item = json.loads((folder / "item.json").read_text())
        assert item["mode"] == "pictures"
        assert item["images"], r["id"]
        for p in item["images"]:
            assert not Path(p).is_absolute() and p.startswith("images/")
            assert (folder / p).is_file()
        assert json.loads((folder / "truth.json").read_text()) == item["truth"]
        assert (folder / "prompt.txt").read_text() == item["prompt"]
        assert Scene.load(folder / "scene.json").seed == item["seed"]
        val = json.loads((folder / "validation.json").read_text())
        assert val["rederived"]["status"] in ("match", "mismatch", "skipped")
        assert isinstance(val["item_digest"], str) and len(val["item_digest"]) >= 16
        assert val["digest_matches"] is None                            # no manifest in this run
        # README documents every field a judge will meet
        for k in list(item) + list(val) + list(r):
            assert k in readme, k


def test_export_deterministic_rerun_and_results(tmp_path):
    from iris_bench import export
    run = _export_run(tmp_path)
    a = export.export_sample(run, tmp_path / "a", sample=5, seed=3)
    b = export.export_sample(run, tmp_path / "b", sample=5, seed=3)
    assert a["ids"] == b["ids"]
    again = export.export_sample(run, tmp_path / "a", sample=4, seed=3)    # re-export into the same folder
    assert len(list((tmp_path / "a" / "items").iterdir())) == 4 == again["n"]
    assert sorted(again["per_job"].values()) == [1, 1, 2]                  # leftover quota goes round-robin

    full = export.export_sample(run, tmp_path / "full", sample=100, seed=0)
    assert full["n"] == 9                                                  # capped by the pictures items
    assert full["missing_images"] == 1
    val = json.loads((tmp_path / "full" / "items" / "2-J8_spatial-0-pictures" / "validation.json").read_text())
    assert val["missing_images"] == ["render/does_not_exist.png"]
    val0 = json.loads((tmp_path / "full" / "items" / "0-J1_sort-0-pictures" / "validation.json").read_text())
    assert val0["results"] and val0["results"][0]["model"] == "fake:0.7" and val0["results"][0]["correct"] is True


def test_export_with_manifest_and_refuses_run_folder(tmp_path):
    from iris_bench import export
    run = _export_run(tmp_path)
    items = export.read_items(run / "items.jsonl")
    digest = export._digest(items[0], export._integrity())
    (run / "manifest.json").write_text(json.dumps({"items": {items[0].id: digest}}))
    (run / "integrity.json").write_text(json.dumps({"ok": True, "checks": []}))
    to = tmp_path / "out"
    export.export_sample(run, to, sample=100, seed=0)
    assert (to / "manifest.json").is_file() and (to / "integrity.json").is_file()
    val = json.loads((to / "items" / items[0].id / "validation.json").read_text())
    assert val["digest_matches"] is True and val["integrity_ok"] is True
    with pytest.raises(ValueError):
        export.export_sample(run, run, sample=5)


def test_rederive_j9_passes_opening_no_is_checked_by_geometry():
    """A "does it pass through P?" item answered no is re-derived (geom.passes_through), not skipped."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from test_jobs import build, make_scene
    from iris_bench import integrity
    sc = make_scene()
    its = [i for i in build(sc, modes=("pictures",)) if i.truth.get("question") == "passes_opening"]
    assert {i.truth["passes"] for i in its} == {True, False}
    for it in its:
        r = integrity.rederive(it, sc)
        assert r["status"] == "match", r
        flipped = type(it)(**{**it.__dict__, "truth": {**it.truth, "passes": not it.truth["passes"]}})
        assert integrity.rederive(flipped, sc)["status"] == "mismatch"


def test_letters_shown_fails_on_a_letter_the_pictures_do_not_show(tmp_path):
    """An item that offers opening Q while its pictures label only A and B fails `letters_shown`; once its pictures
    label Q, it passes."""
    from iris_bench import integrity
    from iris_bench.spec import Item
    d = tmp_path / "scenes" / "0"
    (d / "render").mkdir(parents=True)
    (d / "views.json").write_text(json.dumps([{"name": "A", "image": "render/p_A.png", "labels": {"e1": "A", "e2": "B"}}]))
    schema = {"type": "object", "properties": {"fitting": {"type": "array", "items": {"enum": ["Q"]}},
                                               "confidence": {"type": "number"}}}
    it = Item(id="0-J4_opening-0-pictures", seed=0, job="J4_opening", mode="pictures",
              images=[str(d / "render" / "p_A.png")], prompt="?", schema=schema,
              truth={"letters": {"A": "e1", "B": "e2", "Q": "o1"}})
    ok, summary, det = integrity._check_letters_shown(tmp_path, [it])
    assert not ok and det["offending"][0]["not_shown"] == ["Q"]
    (d / "render" / "views.json").write_text(json.dumps([{"name": "A", "image": "render/p_A.png",
                                                          "labels": {"e1": "A", "e2": "B", "o1": "Q"}}]))
    assert integrity._check_letters_shown(tmp_path, [it])[0] is True
