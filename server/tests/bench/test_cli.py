"""cli wiring without a browser or a model: render retries and fallback, build renderers, controls, agentic, budget."""
import json
from dataclasses import asdict

import pytest

from iris_bench import cli, jobs, render, runner
from iris_bench.score import read_results, write_jsonl
from iris_bench.spec import Camera, Element, Item, Planted, Result, Scene, View


def _scene(seed: int = 0) -> Scene:
    els = [Element("e1", "beam", "structure", "box", min=(0, 0, 3), max=(4, 0.3, 3.5)),
           Element("e2", "duct", "service", "box", min=(1, -1, 3.2), max=(1.4, 2, 3.6)),
           Element("e3", "pipe", "service", "box", min=(2, -1, 2.0), max=(2.1, 2, 2.1))]
    return Scene(seed=seed, elements=els, planted=[Planted("e1", "e2", "real", -0.3, mover="e2"),
                                                   Planted("e1", "e3", "not_touching", 0.9)],
                 cameras=[Camera("A"), Camera("top", 0, 90, 1, "orthographic")])


def _folder(tmp_path, seed=0) -> "Path":   # noqa: F821
    d = tmp_path / "scenes" / str(seed)
    d.mkdir(parents=True)
    _scene(seed).save(d / "scene.json")
    return d


def _view_dict(name, focus):
    return {"name": name, "image": f"render/{'-'.join(focus)}_{name}.png", "id_image": "x.id.png",
            "labels": {e: "AB"[i] for i, e in enumerate(focus)}, "colors": {}, "visible_px": {e: 9 for e in focus},
            "focus": list(focus)}


# ---------------------------------------------------------------- render: one retry in a fresh browser

def test_render_many_retries_crashed_jobs_once(tmp_path, monkeypatch):
    d = _folder(tmp_path)
    calls = []

    def fake_node(payload, timeout):
        calls.append([j["focus"] for j in payload])
        if len(calls) == 1:   # the browser dies after the first job; the third job is broken on its own
            return [[_view_dict("A", payload[0]["focus"])],
                    {"error": "page.evaluate: Target page, context or browser has been closed"},
                    {"error": "scene has no element e9"}]
        return [[_view_dict("A", j["focus"])] for j in payload]
    monkeypatch.setattr(render, "_node", fake_node)
    s0 = dict(render.STATS)
    jobs_ = [{"scene_dir": d, "focus": f, "views": ["A"]} for f in (["e1", "e2"], ["e1", "e3"], ["e9", "e1"])]
    views, errs = render.render_many_lenient(jobs_)
    assert calls == [[["e1", "e2"], ["e1", "e3"], ["e9", "e1"]], [["e1", "e3"]]]   # only the crashed job again
    assert [len(v) for v in views] == [1, 1, 0] and errs[:2] == [None, None] and "e9" in errs[2]
    assert render.STATS["restarts"] - s0["restarts"] == 1 and render.STATS["recovered_jobs"] - s0["recovered_jobs"] == 1
    listed = json.loads((d / "render" / "views.json").read_text())
    assert {v["image"] for v in listed} == {"render/e1-e2_A.png", "render/e1-e3_A.png"}
    calls.clear()
    with pytest.raises(RuntimeError, match="e9"):                                 # strict form still raises
        render.render_many(jobs_)


def test_render_many_whole_process_death_is_retried(tmp_path, monkeypatch):
    d = _folder(tmp_path)
    n = []

    def fake_node(payload, timeout):
        n.append(1)
        if len(n) == 1:
            return [{"error": "renderer failed (1): browserType.launch: Browser closed."} for _ in payload]
        return [[_view_dict("A", j["focus"])] for j in payload]
    monkeypatch.setattr(render, "_node", fake_node)
    out = render.render_many([{"scene_dir": d, "focus": ["e1", "e2"], "views": ["A"]}])
    assert len(n) == 2 and out[0][0].name == "A"


def test_render_one_falls_back_per_pair_and_counts(tmp_path, monkeypatch):
    d = _folder(tmp_path)
    seen = []

    def fake_lenient(jobs_, timeout=1800, retries=1):
        seen.append([(j["focus"], tuple(j["views"]), bool(j.get("cameras"))) for j in jobs_])
        views, errs = [], []
        for j in jobs_:
            if j.get("cameras") and j["focus"] == ["e1", "e3"]:
                views.append([])
                errs.append("render of ... failed after a retry: browser has been closed")
            else:
                views.append([View(**_view_dict(v, j["focus"])) for v in j["views"]])
                errs.append(None)
        return views, errs
    monkeypatch.setattr(render, "render_many_lenient", fake_lenient)
    st = cli._render_one((str(tmp_path), 0, None))
    assert seen[0] == [(["e1", "e2"], ("A", "top"), True), (["e1", "e3"], ("A", "top"), True)]
    assert seen[1] == [(["e1", "e3"], ("A", "B", "C"), False)]          # only the failed pair falls back
    assert st["camera_pairs_ok"] == 1 and st["fallback_pairs"] == 1 and st["failed_pairs"] == 0
    assert "fell back" in st["msg"] and not st["failed"]
    names = {(tuple(v["focus"]), v["name"]) for v in json.loads((d / "views.json").read_text())}
    assert names == {(("e1", "e2"), "A"), (("e1", "e2"), "top"), (("e1", "e3"), "A"), (("e1", "e3"), "B"),
                     (("e1", "e3"), "C")}
    tot = cli._render_summary([st, {**st, "fallback_pairs": 0}])
    assert tot["fallback_pairs"] == 1 and tot["seeds_with_fallback"] == 1 and tot["seeds"] == 2


def test_render_workers_default_and_cap():
    a = cli.build_parser().parse_args(["render", "--out", "/tmp/x"])
    assert a.render_workers == cli.DEFAULT_RENDER_WORKERS <= 4
    a = cli.build_parser().parse_args(["render", "--out", "/tmp/x", "--render-workers", "9", "--workers", "2"])
    assert cli._render_workers(a) == 2


# ---------------------------------------------------------------- build: renderers_for, guarded

def test_build_one_passes_renderers_for_and_guards_failures(tmp_path, monkeypatch):
    _folder(tmp_path)
    got = {}

    def boom(*a, **k):
        raise RuntimeError("browser has been closed")

    def fake_renderers_for(scene_dir, style=None, camera=None):
        got["scene_dir"] = scene_dir
        return {"fix_renderer": boom, "cand_renderer": lambda sc, focus, fixes: ["cand"],
                "group_renderer": lambda sc, focus: ["group"]}

    def fake_build_items(scene, views, modes=("pictures",), *, scene_dir=None, fix_renderer=None, cand_renderer=None,
                         group_renderer=None, jobs=None):
        got.update(kw={"fix": fix_renderer, "cand": cand_renderer, "group": group_renderer}, jobs=jobs, modes=modes)
        got["fix_out"] = fix_renderer(scene, None) if fix_renderer else None
        got["cand_out"] = cand_renderer(scene, focus=["e1"], fixes=[]) if cand_renderer else None
        return [Item(id=f"0-{j}-0-pictures", seed=0, job=j, mode="pictures", images=[], prompt="?", schema={},
                     truth={}) for j in ("J1_sort", "J5_review", "J8_spatial")]
    monkeypatch.setattr(render, "available", lambda: True)
    monkeypatch.setattr(jobs, "renderers_for", fake_renderers_for)
    monkeypatch.setattr(jobs, "build_items", fake_build_items)
    msg, items, st = cli._build_one((str(tmp_path), 0, ["pictures", "no_image"], True, ["J1_sort", "J8_spatial"]))
    assert "ok" in msg and "J1:1 J8:1" in msg and "1 failed" in msg, msg
    assert all(got["kw"].values()) and got["jobs"] == ("J1_sort", "J8_spatial") and got["modes"] == ("pictures",)
    assert got["fix_out"] == [] and got["cand_out"] == ["cand"]           # a failed render gives no views
    assert st["calls"] == 2 and st["failed"] == 1 and "browser has been closed" in st["errors"][0]
    assert [d["job"] for d in items] == ["J1_sort", "J8_spatial"]
    _, _, st = cli._build_one((str(tmp_path), 0, ["pictures"], False, None))       # --no-j5: groups only
    assert got["kw"]["fix"] is None and got["kw"]["cand"] is None and got["kw"]["group"] is not None


# ---------------------------------------------------------------- controls subsample, agentic, budget, merge

def _item(seed, job, n, mode):
    return Item(id=f"{seed}-{job}-{n}-{mode}", seed=seed, job=job, mode=mode, images=[], prompt="?", schema={},
                truth={"answer": "a", "expected": {"answer": "a"}, "kind": "real", "n": n})


def test_subsample_controls_keeps_pictures_and_shares_base_items():
    items = []
    for s in range(4):
        for job in ("J1_sort", "J8_spatial", "J9_relation"):
            for n in range(5):
                items += [_item(s, job, n, m) for m in ("pictures", "pictures_text", "no_image", "swapped")]
    out = cli.subsample_controls(items, 10, seed=0)
    assert sum(i.mode == "pictures" for i in out) == 60
    for m in cli.CONTROL_MODES:
        kept = [i for i in out if i.mode == m]
        assert len(kept) == 10 and {i.job for i in kept} == {"J1_sort", "J8_spatial", "J9_relation"}
    bases = [{cli._base_of(i) for i in out if i.mode == m} for m in cli.CONTROL_MODES]
    assert bases[0] == bases[1] == bases[2]
    assert cli.subsample_controls(items, 0) == items


def test_build_adds_agentic_copies(monkeypatch):
    pics = [_item(0, "J1_sort", 0, "pictures"), _item(0, "J1_sort", 0, "no_image")]
    ag = cli.agentic_items(pics)
    assert [i.id for i in ag] == ["0-J1_sort-0-agentic"] and ag[0].mode == "agentic"
    import sys
    monkeypatch.setitem(sys.modules, "iris_bench.agentic", None)                   # module absent: a note, no items
    assert cli.agentic_items(pics) == []


def _run_folder(tmp_path, items):
    out = tmp_path / "run"
    (out / "scenes").mkdir(parents=True)
    write_jsonl(items, out / "items.jsonl")
    return out


def test_cmd_run_routes_agentic_merges_models_and_records_settings(tmp_path, monkeypatch):
    items = [_item(0, "J1_sort", 0, "pictures"), _item(0, "J1_sort", 0, "agentic"), _item(0, "J1_sort", 0, "no_image")]
    out = _run_folder(tmp_path, items)
    got = {}

    def fake_run(its, model, cache_dir=None, concurrency=8, check=None, max_usd=None):
        got["run"] = ([i.mode for i in its], model, max_usd)
        return [Result(i.id, model, {"answer": "a"}, True, {"cached": False}, 0.1, 0.01) for i in its]

    def fake_agentic(its, model, scene_dirs, max_steps=4, cache_dir=None, client=None, fake=None, check=None,
                     concurrency=4, renders_dir=None, max_usd=None):
        got["agentic"] = ([i.mode for i in its], model, max_steps, str(scene_dirs))
        return [Result(i.id, model, {"answer": "a"}, True, {"cached": False}, 0.1, 0.02) for i in its]
    import iris_bench.agentic as agentic
    monkeypatch.setattr(runner, "run", fake_run)
    monkeypatch.setattr(agentic, "run_agentic", fake_agentic)
    a = cli.build_parser().parse_args(["run", "--out", str(out), "--model", "gemini-3.8-flash", "--thinking", "high",
                                       "--max-usd", "1.5"])
    assert cli.cmd_run(a) == 0
    assert got["run"] == (["pictures", "no_image"], "gemini-3.8-flash@high", 1.5)
    assert got["agentic"][:3] == (["agentic"], "gemini-3.8-flash@high", 4)
    assert got["agentic"][3].endswith("scenes")
    a = cli.build_parser().parse_args(["run", "--out", str(out)])                 # default model, no budget: refused
    assert a.model == "gemini-3.8-flash" and cli.cmd_run(a) == 1
    a = cli.build_parser().parse_args(["run", "--out", str(out), "--max-usd", "2"])
    assert cli.cmd_run(a) == 0
    res = read_results(out / "results.jsonl")
    assert sorted({r.model for r in res}) == ["gemini-3.8-flash", "gemini-3.8-flash@high"] and len(res) == 6
    runs = json.loads((out / "manifest.json").read_text())["model_runs"]
    assert runs["gemini-3.8-flash@high"]["thinking"] == "thinking_level=HIGH"
    assert runs["gemini-3.8-flash"]["thinking"] == "google-default"
    assert runs["gemini-3.8-flash"]["media_resolution"] == "MEDIA_RESOLUTION_HIGH"
    assert runs["gemini-3.8-flash"]["usd_new_this_run"] == pytest.approx(0.04)
    monkeypatch.setattr(agentic, "run_agentic", lambda its, model, scene_dirs, max_steps=4: 1 / 0)
    assert cli.run_agentic_items(items[1:2], a, out, None, max_usd=1.0) == []        # no cap support: skipped


def test_runner_budget_stops_new_calls(tmp_path, monkeypatch):
    items = [_item(0, "J1_sort", n, "pictures") for n in range(6)]
    calls = []

    def fake_call(model, client, item):
        calls.append(item.id)
        return {"answer": "a"}, 0.5, {"model_version": "v", "finish_reason": "STOP"}
    monkeypatch.setattr(runner, "_call_gemini", fake_call)
    res = runner.run(items, "gemini-x", cache_dir=tmp_path, concurrency=1, max_usd=1.0)
    assert len(calls) == 2 and sum(r.detail.get("error") == "budget" for r in res) == 4
    assert res[0].detail["model_version"] == "v"
    res = runner.run(items, "gemini-x", cache_dir=tmp_path, concurrency=1, max_usd=1.0)   # cached ones are free
    assert len(calls) == 4


def test_thinking_labels():
    assert runner.model_label("gemini-3.8-flash", "default") == "gemini-3.8-flash"
    assert runner.model_label("gemini-3.8-flash", "HIGH") == "gemini-3.8-flash@high"
    assert runner.thinking_for("gemini-3.8-flash") is None
    assert runner.thinking_for("gemini-3.5-flash-lite") == "LOW"
    assert runner.thinking_for("gemini-4-argon@high") == "HIGH"
    assert runner.bench_cost("gemini-3.8-flash@high", 1_000_000, 1_000_000) == pytest.approx(0.75 + 3.75)


def test_unparseable_reply_is_cached_as_a_failed_answer(tmp_path, monkeypatch):
    it = _item(0, "J1_sort", 0, "pictures")
    n = []

    def fake_call(model, client, item):
        n.append(1)
        return None, 0.01, {"failure": "max_tokens", "finish_reason": "MAX_TOKENS"}
    monkeypatch.setattr(runner, "_call_gemini", fake_call)
    r = runner.run([it], "gemini-x", cache_dir=tmp_path)[0]
    assert r.reply is None and r.correct is None and r.detail["failure"] == "max_tokens"
    runner.run([it], "gemini-x", cache_dir=tmp_path)
    assert len(n) == 1                                                             # never retried


def test_gemini_request_shape(tmp_path):
    png = tmp_path / "a.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    it = Item(id="0-J1_sort-0-pictures", seed=0, job="J1_sort", mode="pictures", images=[str(png), str(png)],
              prompt="Which?", schema={"type": "object", "properties": {"answer": {"type": "string"}}}, truth={})
    contents, cfg = runner.gemini_request(it, "gemini-3.8-flash")
    parts = contents[0].parts
    assert [p.text for p in parts if p.text] == ["Image 1:", "Image 2:", "Which?"] and parts[-1].text == "Which?"
    assert cfg.thinking_config is None and cfg.temperature is None
    assert cfg.response_json_schema == it.schema and "HIGH" in str(cfg.media_resolution)
    _, cfg = runner.gemini_request(it, "gemini-4-argon@high")
    assert str(cfg.thinking_config.thinking_level).endswith("HIGH") and not cfg.thinking_config.include_thoughts


def test_run_order_pictures_first_then_controls_interleaved():
    items = []
    for s in range(2):
        for job in ("J1_sort", "J9_relation"):
            for n in range(3):
                items += [_item(s, job, n, m) for m in ("no_image", "agentic", "pictures", "swapped", "pictures_text")]
    out = cli.run_order(items)
    modes = [i.mode for i in out]
    assert modes[:12] == ["pictures"] * 12 and modes[-12:] == ["agentic"] * 12
    ctl = out[12:-12]
    assert [i.mode for i in ctl[:3]] == ["no_image", "pictures_text", "swapped"]        # one base item at a time
    assert len({cli._base_of(i) for i in ctl[:3]}) == 1
    assert {i.job for i in out[:2]} == {"J1_sort", "J9_relation"}                         # stratified by job


def test_unasked_results_are_not_written(tmp_path, monkeypatch):
    items = [_item(0, "J1_sort", n, "pictures") for n in range(4)]
    out = _run_folder(tmp_path, items)

    asked = []

    def fake_run(its, model, cache_dir=None, concurrency=8, check=None, max_usd=None):
        asked.extend(i.id for i in its)
        return [Result(its[0].id, model, {"answer": "a"}, True, {"cached": False}, 0.1, 0.6),
                Result(its[1].id, model, None, None, {"error": "unparseable", "failure": "max_tokens"}, 0.1, 0.01),
                Result(its[2].id, model, None, None, {"error": "ServerError: 503"}, 0.1, 0.0),
                Result(its[3].id, model, None, None, {"error": "budget"}, 0.0, 0.0)]
    monkeypatch.setattr(runner, "run", fake_run)
    a = cli.build_parser().parse_args(["run", "--out", str(out), "--max-usd", "0.5"])
    assert cli.cmd_run(a) == cli.BUDGET_RC
    written = read_results(out / "results.jsonl")
    assert [r.item_id for r in written] == asked[:2]                        # the model's non-JSON reply counts
    rec = json.loads((out / "manifest.json").read_text())["model_runs"]["gemini-3.8-flash"]
    assert rec["n_transport_failed"] == 1 and rec["n_budget_skipped"] == 1 and rec["budget_hit"] is True


def test_sample_items_pairs_controls_with_the_pictures_sample():
    items = []
    for s in range(3):
        for job in ("J1_sort", "J8_spatial"):
            for n in range(4):
                items += [_item(s, job, n, m) for m in ("pictures", "pictures_text", "no_image", "swapped")]
    out = cli.sample_items(items, 6, 2)
    pics = [i for i in out if i.mode == "pictures"]
    assert len(pics) == 6 and {i.job for i in pics} == {"J1_sort", "J8_spatial"}
    for m in cli.CONTROL_MODES:
        ctl = [i for i in out if i.mode == m]
        assert len(ctl) == 2 and {cli._base_of(i) for i in ctl} <= {cli._base_of(i) for i in pics}
    assert cli.sample_items(items, 6) == pics


def test_run_ids_file_selects_items(tmp_path, monkeypatch):
    items = [_item(0, "J1_sort", n, "pictures") for n in range(4)]
    out = _run_folder(tmp_path, items)
    asked = []

    def fake_run(its, model, cache_dir=None, concurrency=8, check=None, max_usd=None):
        asked.extend(i.id for i in its)
        return []
    monkeypatch.setattr(runner, "run", fake_run)
    (tmp_path / "ids.txt").write_text(f"{items[1].id}\n{items[3].id} nope")
    a = cli.build_parser().parse_args(["run", "--out", str(out), "--model", "fake:0.7", "--ids", str(tmp_path / "ids.txt")])
    cli.cmd_run(a)
    assert sorted(asked) == sorted([items[1].id, items[3].id])
