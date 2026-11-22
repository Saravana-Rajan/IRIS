"""iris-bench: generate scenes, render them, build items, run a model, score and report.

    iris-bench generate --seeds 0:20 --out runs/x [--challenge occlusion=0.5 ...]
    iris-bench render   --out runs/x
    iris-bench build    --out runs/x [--modes pictures,pictures_text,no_image,swapped]
    iris-bench run      --out runs/x --model gemini-3.8-flash|fake:0.7
    iris-bench score    --out runs/x
    iris-bench report   --out runs/x
    iris-bench all      --seeds 0:20 --model fake:0.7 --out runs/x

Layout: runs/<name>/{scenes/<seed>/{scene.json, scene.ifc, *.png, views.json}, items.jsonl, results.jsonl,
scores.csv, scores.jsonl, graded.jsonl, item_scores.jsonl, report.md, report.html}.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
from pathlib import Path

from iris_bench.spec import Item, Result, Scene, View

ALL_MODES = ("pictures", "pictures_text", "no_image", "swapped")


def parse_seeds(spec: str) -> list[int]:
    """'0:20' -> 0..19, '3' -> [3], '1,4,9' -> [1, 4, 9], '0:20:5' -> 0,5,10,15."""
    out: list[int] = []
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        if ":" in part:
            bits = [int(b) for b in part.split(":")]
            out += list(range(*bits))
        else:
            out.append(int(part))
    return out


def _parse_value(v: str):
    for cast in (int, float):
        try:
            return cast(v)
        except ValueError:
            pass
    return {"true": True, "false": False}.get(v.lower(), v)


def parse_challenge(pairs: list[str] | None) -> dict:
    out = {}
    for p in pairs or []:
        k, _, v = p.partition("=")
        out[k.strip()] = _parse_value(v.strip())
    return out


def _scenes_dir(out: Path) -> Path:
    return Path(out) / "scenes"


def _seeds_on_disk(out: Path) -> list[int]:
    d = _scenes_dir(out)
    return sorted(int(p.name) for p in d.iterdir() if p.is_dir() and p.name.isdigit() and
                  (p / "scene.json").exists()) if d.exists() else []


def _pool(workers: int, fn, args: list) -> list:
    """Map fn over args in processes (workers > 1), else in this process. Errors come back as strings."""
    if workers <= 1 or len(args) <= 1:
        return [fn(a) for a in args]
    with ProcessPoolExecutor(max_workers=min(workers, len(args))) as ex:
        return list(ex.map(fn, args))


def _log(msg: str) -> None:
    print(f"[iris-bench] {msg}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------- generate (+ IFC)

def _generate_one(arg: tuple[int, str, dict, bool]) -> str:
    seed, out, challenge, ifc = arg
    try:
        from iris_bench import scenes
        folder = _scenes_dir(Path(out)) / str(seed)
        folder.mkdir(parents=True, exist_ok=True)
        scene = scenes.generate(seed, **challenge)
        to_folder = getattr(scenes, "to_folder", None)
        if to_folder is not None:
            to_folder(scene, folder)
        if not (folder / "scene.json").exists():
            scene.save(folder / "scene.json")
        if ifc and not (folder / "scene.ifc").exists():
            try:
                from iris_bench.ifc_writer import write_ifc
                write_ifc(scene, folder / "scene.ifc")
            except Exception as e:
                return f"seed {seed}: scene ok, IFC failed: {type(e).__name__}: {e}"
        return f"seed {seed}: ok ({len(scene.elements)} elements, {len(scene.planted)} planted)"
    except Exception as e:
        return f"seed {seed}: FAILED {type(e).__name__}: {e}"


def cmd_generate(a) -> int:
    seeds = parse_seeds(a.seeds)
    ch = parse_challenge(a.challenge)
    msgs = _pool(a.workers, _generate_one, [(s, str(a.out), ch, not a.no_ifc) for s in seeds])
    for m in msgs:
        _log(m)
    return 1 if all("FAILED" in m for m in msgs) else 0


# ---------------------------------------------------------------- render

def _render(scene_dir: Path, focus: list[str], views: list[str], style, fix=None) -> list[View]:
    from iris_bench.render import render_scene
    return list(render_scene(scene_dir, focus=focus, views=views, style=style, fix=fix))


def _render_one(arg: tuple[str, int]) -> str:
    out, seed = arg
    folder = _scenes_dir(Path(out)) / str(seed)
    try:
        scene = Scene.load(folder / "scene.json")
        style = scene.challenge.get("style")
        all_views: list[View] = []
        for p in scene.planted:
            all_views += _render(folder, [p.a, p.b], ["A", "B", "C"], style)
        # unique by image path (later renders of the same name for a different focus have different paths)
        seen, uniq = set(), []
        for v in all_views:
            if v.image not in seen:
                seen.add(v.image)
                uniq.append(v)
        (folder / "views.json").write_text(json.dumps([asdict(v) for v in uniq], indent=2))
        return f"seed {seed}: ok ({len(uniq)} views)"
    except Exception as e:
        return f"seed {seed}: FAILED {type(e).__name__}: {e}"


def cmd_render(a) -> int:
    seeds = parse_seeds(a.seeds) if a.seeds else _seeds_on_disk(a.out)
    msgs = _pool(a.workers, _render_one, [(str(a.out), s) for s in seeds])
    for m in msgs:
        _log(m)
    return 1 if msgs and all("FAILED" in m for m in msgs) else 0


# ---------------------------------------------------------------- build items (+ controls)

def _load_views(folder: Path) -> list[View]:
    p = folder / "views.json"
    if not p.exists():
        return []
    return [View(**v) for v in json.loads(p.read_text())]


def _build_one(arg: tuple[str, int, list[str], bool]) -> tuple[str, list[dict]]:
    out, seed, modes, j5 = arg
    folder = _scenes_dir(Path(out)) / str(seed)
    try:
        from iris_bench import jobs
        scene = Scene.load(folder / "scene.json")
        views = _load_views(folder)
        style = scene.challenge.get("style")

        def fix_renderer(sc: Scene, fix) -> list[View]:   # J5 before/after, rendered on demand
            from iris_bench import render
            focus = sorted({fix.element, *(x for p in sc.planted if fix.element in (p.a, p.b) for x in (p.a, p.b))})
            if hasattr(render, "render_fix"):
                return list(render.render_fix(folder, focus, fix))
            return _render(folder, focus, ["before", "after"], style, fix)

        base_modes = [m for m in modes if m in ("pictures", "pictures_text")] or ["pictures"]
        items = jobs.build_items(scene, views, tuple(base_modes), scene_dir=folder.resolve(),
                                 fix_renderer=fix_renderer if j5 else None)
        return f"seed {seed}: ok ({len(items)} items)", [asdict(i) for i in items]
    except Exception as e:
        return f"seed {seed}: FAILED {type(e).__name__}: {e}", []


def add_controls(items: list[Item], modes: list[str]) -> list[Item]:
    """no_image and swapped copies of every `pictures` item (swapped: next seed's same job with a different truth)."""
    try:
        from iris_bench import controls
    except Exception as e:
        _log(f"controls unavailable ({e}); skipping control items")
        return []
    pics = [i for i in items if i.mode == "pictures"]
    out: list[Item] = []
    if "no_image" in modes:
        out += [controls.no_image(i) for i in pics]
    if "swapped" in modes:
        by_job: dict[str, list[Item]] = {}
        for i in sorted(pics, key=lambda i: (i.seed, i.id)):
            by_job.setdefault(i.job, []).append(i)
        for job, lst in by_job.items():
            for k, it in enumerate(lst):
                for other in lst[k + 1:] + lst[:k]:
                    if other.seed != it.seed and other.truth != it.truth and other.images:
                        try:
                            out.append(controls.swapped(it, other))
                        except ValueError:
                            continue
                        break
    return out


def cmd_build(a) -> int:
    from iris_bench.score import write_jsonl
    seeds = parse_seeds(a.seeds) if a.seeds else _seeds_on_disk(a.out)
    modes = [m.strip() for m in a.modes.split(",") if m.strip()]
    res = _pool(a.workers, _build_one, [(str(a.out), s, modes, not a.no_j5) for s in seeds])
    items: list[Item] = []
    for msg, its in res:
        _log(msg)
        items += [Item(**d) for d in its]
    try:
        from iris_bench.jobs import balance_j1
        if a.balance:
            items = balance_j1(items)
    except Exception:
        pass
    items += add_controls(items, modes)
    write_jsonl(items, Path(a.out) / "items.jsonl")
    _log(f"{len(items)} items -> {Path(a.out) / 'items.jsonl'}")
    return 0 if items else 1


# ---------------------------------------------------------------- run model

def cmd_run(a) -> int:
    from iris_bench.runner import run
    from iris_bench.score import make_check, read_items, write_jsonl
    out = Path(a.out)
    items = read_items(out / "items.jsonl")
    if a.limit:
        items = items[: a.limit]
    t = time.time()
    try:
        from iris_bench import checker  # noqa: F401
        check = make_check(_scenes_dir(out))
    except Exception as e:
        _log(f"checker unavailable ({e}); J3/J5 stay ungraded until `score`")
        check = None
    results = run(items, a.model, cache_dir=out / "cache", concurrency=a.concurrency, check=check)
    write_jsonl(results, out / "results.jsonl")
    _log(f"{len(results)} results from {a.model} in {time.time() - t:.1f}s -> {out / 'results.jsonl'}")
    return 0


# ---------------------------------------------------------------- score / report

def cmd_score(a) -> int:
    from iris_bench.score import read_items, read_results, score_run
    out = Path(a.out)
    items, results = read_items(out / "items.jsonl"), read_results(out / "results.jsonl")
    graded, rows = score_run(items, results, out, scenes_dir=_scenes_dir(out), seed=a.boot_seed)
    acc = [r for r in rows if r["table"] == "accuracy" and r["job"] == "ALL"]
    for r in acc:
        _log(f"{r['model']} {r['mode']}: {r['accuracy']:.0%} [{r['ci_lo']:.0%}, {r['ci_hi']:.0%}] n={r['n']}")
    _log(f"{len(rows)} score rows -> {out / 'scores.csv'}")
    return 0


def cmd_report(a) -> int:
    from iris_bench.report import write_report
    from iris_bench.score import read_items, read_results, score_rows
    out = Path(a.out)
    items = read_items(out / "items.jsonl")
    graded_p = out / "graded.jsonl"
    results = read_results(graded_p if graded_p.exists() else out / "results.jsonl")
    scores_p = out / "scores.jsonl"
    rows = ([json.loads(l) for l in scores_p.read_text().splitlines() if l.strip()] if scores_p.exists()
            else score_rows(items, results, seed=a.boot_seed))
    md, ht = write_report(rows, items, results, out, title=a.title or f"Iris Bench: {out.name}")
    _log(f"report -> {md}, {ht}")
    return 0


def cmd_all(a) -> int:
    steps = [("generate", cmd_generate), ("render", cmd_render), ("build", cmd_build), ("run", cmd_run),
             ("score", cmd_score), ("report", cmd_report)]
    for name, fn in steps:
        t = time.time()
        _log(f"== {name}")
        rc = fn(a)
        _log(f"== {name} done in {time.time() - t:.1f}s (rc={rc})")
        if rc != 0 and name == "render":
            _log("render failed: continuing without pictures (items get no images; J5 skipped)")
            a.no_j5 = True
        elif rc != 0:
            _log(f"stopping: {name} failed")
            return rc
    return 0


# ---------------------------------------------------------------- argparse

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="iris-bench", description="Iris Bench: visual MEP coordination benchmark")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, seeds_required=False):
        p.add_argument("--out", type=Path, required=True, help="run folder, e.g. runs/x")
        p.add_argument("--seeds", required=seeds_required, default=None, help="0:20, 3, or 1,4,9")
        p.add_argument("--workers", type=int, default=os.cpu_count() or 4)
        p.add_argument("--boot-seed", type=int, default=0, help="bootstrap RNG seed")
        p.add_argument("--title", default=None)

    p = sub.add_parser("generate", help="generate scenes (scene.json + scene.ifc)")
    common(p, True)
    p.add_argument("--challenge", action="append", help="key=value passed to scenes.generate (repeatable)")
    p.add_argument("--no-ifc", action="store_true")
    p.set_defaults(fn=cmd_generate)

    p = sub.add_parser("render", help="render each planted pair (views A/B/C)")
    common(p)
    p.set_defaults(fn=cmd_render)

    p = sub.add_parser("build", help="build items + control items -> items.jsonl")
    common(p)
    p.add_argument("--modes", default=",".join(ALL_MODES))
    p.add_argument("--no-j5", action="store_true", help="skip J5 (no before/after renders)")
    p.add_argument("--balance", action="store_true", help="balance J1 kinds across the run")
    p.set_defaults(fn=cmd_build)

    p = sub.add_parser("run", help="ask a model -> results.jsonl")
    common(p)
    p.add_argument("--model", required=True, help="gemini-3.8-flash, fake:0.7, ...")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--concurrency", type=int, default=8)
    p.set_defaults(fn=cmd_run)

    p = sub.add_parser("score", help="grade + score -> scores.csv/jsonl")
    common(p)
    p.set_defaults(fn=cmd_score)

    p = sub.add_parser("report", help="report.md + report.html")
    common(p)
    p.set_defaults(fn=cmd_report)

    p = sub.add_parser("all", help="generate -> render -> build -> run -> score -> report")
    common(p, True)
    p.add_argument("--model", required=True)
    p.add_argument("--challenge", action="append")
    p.add_argument("--no-ifc", action="store_true")
    p.add_argument("--modes", default=",".join(ALL_MODES))
    p.add_argument("--no-j5", action="store_true")
    p.add_argument("--balance", action="store_true")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--concurrency", type=int, default=8)
    p.set_defaults(fn=cmd_all)
    return ap


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    return a.fn(a) or 0


if __name__ == "__main__":
    raise SystemExit(main())
