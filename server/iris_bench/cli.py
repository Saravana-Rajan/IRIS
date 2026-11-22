"""iris-bench: generate scenes, render them, build items, run a model, score, verify and report.

    iris-bench generate --seeds 0:20 --out runs/x [--challenge occlusion=0.5 ...] [--locked-services N]
                        [--cameras top,section,iso:30:45]
    iris-bench render   --out runs/x [--cameras top,section,iso:30:45]
    iris-bench build    --out runs/x [--modes pictures,pictures_text,no_image,swapped] [--jobs J1,J3,...]
    iris-bench run      --out runs/x --model gemini-3.8-flash|fake:0.7 --max-usd 2 [--thinking default|high|...]
                        [--sample 50] [--max-steps 4]
    iris-bench score    --out runs/x
    iris-bench verify   --out runs/x [--sample 25] [--boot-seed 0]
    iris-bench report   --out runs/x
    iris-bench export   --out runs/x --sample 50 --to datasets/sample [--seed 0]
    iris-bench all      --seeds 0:20 --model fake:0.7 --out runs/x [--jobs J1,...] [--cameras top,section,iso:30:45]
                        [--challenge k=v ...] [--locked-services N]

`all` runs generate -> render -> build -> run -> score -> verify -> report; it returns 2 when the integrity check
fails (the report is still written, with the failed checks in it).

Lean defaults for real (paid) runs: thinking at Google's default (`--thinking default`; Flash-Lite LOW), every
pictures item, a job-stratified sample of 100 items per control mode (`--control-sample`, 0 = all), media resolution
HIGH, and `--max-usd` (required for a real model) to stop starting calls once the run's new spend reaches it. `--thinking high` runs the same
items under the label "<model>@high" (its own cache, results rows and report rows), e.g. on `--sample 50`. Several
models / labels share one run folder: `run` replaces only its own label's rows in results.jsonl and records what it
sent (runner.settings_record) under manifest.json "model_runs".

Jobs: short names J1..J9 or full names (J1_sort ... J9_relation). Cameras: presets `top` (plan, orthographic),
`section`/`section_x` (along X, orthographic), `section_y`, `iso` (45 deg / 35.26 deg, perspective), letters A/B/C
(the renderer's defaults), or `name:AZ:EL[:DIST]` (azimuth, elevation in degrees, distance factor).

Layout: runs/<name>/{scenes/<seed>/{scene.json, scene.ifc, *.png, views.json}, items.jsonl, manifest.json,
results.jsonl, scores.csv, scores.jsonl, graded.jsonl, item_scores.jsonl, integrity.json, report.md, report.html}.
"""
from __future__ import annotations

import argparse
import inspect
from collections import Counter
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
from pathlib import Path

from iris_bench.spec import JOB_CATEGORY, Camera, Item, Planted, Result, Scene, View  # noqa: F401  (Result: re-export)

ALL_MODES = ("pictures", "pictures_text", "no_image", "swapped")
DEFAULT_VIEWS = ("A", "B", "C")
# Each render/build worker drives its own headless Chromium (SwiftShader, CPU-heavy): more than a few at once starve
# each other and the browsers crash ("browser has been closed"), so the camera renders fall back to A/B/C.
DEFAULT_RENDER_WORKERS = min(4, os.cpu_count() or 4)
CONTROL_MODES = ("no_image", "swapped", "pictures_text")
DEFAULT_MODEL = "gemini-3.8-flash"   # the model VisionBench evaluates (owner decision, Nov 22)
DEFAULT_CONTROL_SAMPLE = 100   # items per control mode (job-stratified, seeded); pictures items are all kept
BUDGET_RC = 3                  # `run` return code when --max-usd stopped it
# Names under which jobs.build_items may accept a J7 candidates renderer (the jobs module is still settling).
CANDIDATE_KWARGS = ("candidate_renderer", "candidates_renderer", "cand_renderer", "render_candidates",
                    "candidates_render")

# Camera presets: azimuth_deg, elevation_deg, projection.
CAMERA_PRESETS: dict[str, tuple[float, float, str]] = {
    "top": (0.0, 90.0, "orthographic"),
    "section": (0.0, 0.0, "orthographic"),
    "section_x": (0.0, 0.0, "orthographic"),
    "section_y": (90.0, 0.0, "orthographic"),
    "iso": (45.0, 35.26, "perspective"),
}


# ---------------------------------------------------------------- argument parsing helpers

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


def challenge_from_args(a) -> dict:
    """The challenge dict for scenes.generate: --challenge pairs plus --locked-services."""
    ch = parse_challenge(getattr(a, "challenge", None))
    n = getattr(a, "locked_services", None)
    if n is not None:
        ch["locked_services"] = int(n)
    return ch


def parse_jobs(spec) -> list[str] | None:
    """'J1,J3_fix' -> ['J1_sort', 'J3_fix'] (order kept, duplicates dropped). None, '' or 'all' -> None (every job).
    Raises ValueError on a name that is not a job."""
    if spec is None:
        return None
    if isinstance(spec, (list, tuple)):
        spec = ",".join(spec)
    tokens = [t.strip() for t in str(spec).split(",") if t.strip()]
    if not tokens or [t.lower() for t in tokens] == ["all"]:
        return None
    out: list[str] = []
    for t in tokens:
        hit = next((j for j in JOB_CATEGORY if j.lower() == t.lower() or j.split("_", 1)[0].lower() == t.lower()),
                   None)
        if hit is None:
            raise ValueError(f"unknown job {t!r}; use J1..J9 or one of {', '.join(JOB_CATEGORY)}")
        if hit not in out:
            out.append(hit)
    return out


def parse_cameras(spec) -> list[Camera]:
    """'top,section,iso:30:45' -> Cameras. Presets: top, section/section_x, section_y, iso; any other name (A, B, C
    ...) keeps the Camera defaults. 'name:AZ:EL[:DIST]' overrides azimuth, elevation and distance factor (keeping the
    preset's projection). Repeated names get _2, _3 ... so every camera's pictures have their own file names.
    Raises ValueError on a malformed entry."""
    if spec is None:
        return []
    if isinstance(spec, (list, tuple)):
        spec = ",".join(spec)
    out: list[Camera] = []
    used: set[str] = set()
    for tok in (t.strip() for t in str(spec).split(",")):
        if not tok:
            continue
        name, *nums = [p.strip() for p in tok.split(":")]
        if not name or not (name[0].isalpha() and all(c.isalnum() or c in "_-" for c in name)):
            raise ValueError(f"bad camera name in {tok!r}")
        if len(nums) not in (0, 2, 3):
            raise ValueError(f"camera {tok!r}: use name, name:AZ:EL or name:AZ:EL:DIST")
        try:
            vals = [float(n) for n in nums]
        except ValueError:
            raise ValueError(f"camera {tok!r}: angles must be numbers") from None
        preset = CAMERA_PRESETS.get(name.lower())
        cam = Camera(name=name)
        if preset:
            cam.azimuth_deg, cam.elevation_deg, cam.projection = preset
        if vals:
            cam.azimuth_deg, cam.elevation_deg = vals[0], vals[1]
            if not -90.0 <= cam.elevation_deg <= 90.0:
                raise ValueError(f"camera {tok!r}: elevation must be within -90..90 degrees")
        if len(vals) == 3:
            if vals[2] <= 0:
                raise ValueError(f"camera {tok!r}: distance factor must be positive")
            cam.distance_factor = vals[2]
        base, k = cam.name, 2
        while cam.name in used:
            cam.name = f"{base}_{k}"
            k += 1
        used.add(cam.name)
        out.append(cam)
    return out


def _jobs_type(s: str) -> list[str] | None:
    try:
        return parse_jobs(s)
    except ValueError as e:
        raise argparse.ArgumentTypeError(str(e)) from None


def _cameras_type(s: str) -> list[Camera]:
    try:
        return parse_cameras(s)
    except ValueError as e:
        raise argparse.ArgumentTypeError(str(e)) from None


# ---------------------------------------------------------------- signature-tolerant calls

def _params(fn) -> dict:
    try:
        return dict(inspect.signature(fn).parameters)
    except (TypeError, ValueError):
        return {}


def _takes_var_kw(fn) -> bool:
    return any(p.kind is p.VAR_KEYWORD for p in _params(fn).values())


def _kw(fn, **kw) -> dict:
    """The keyword arguments `fn` accepts (all of them when it takes **kwargs)."""
    if _takes_var_kw(fn):
        return kw
    ps = _params(fn)
    return {k: v for k, v in kw.items() if k in ps}


def _call_flex(fn, **avail):
    """Call fn with whichever of the available names its signature asks for; TypeError when it needs one we lack."""
    args, kwargs = [], {}
    for name, p in _params(fn).items():
        if p.kind in (p.VAR_POSITIONAL, p.VAR_KEYWORD):
            continue
        if name in avail:
            if p.kind is p.POSITIONAL_ONLY:
                args.append(avail[name])
            else:
                kwargs[name] = avail[name]
        elif p.default is p.empty:
            raise TypeError(f"{getattr(fn, '__name__', fn)} needs {name!r}")
    return fn(*args, **kwargs)


# ---------------------------------------------------------------- small helpers

def _scenes_dir(out: Path) -> Path:
    return Path(out) / "scenes"


def _seeds_on_disk(out: Path) -> list[int]:
    d = _scenes_dir(out)
    return sorted(int(p.name) for p in d.iterdir() if p.is_dir() and p.name.isdigit() and
                  (p / "scene.json").exists()) if d.exists() else []


def _seeds_of(a) -> list[int]:
    s = getattr(a, "seeds", None)
    return parse_seeds(s) if s else _seeds_on_disk(a.out)


def _pool(workers: int, fn, args: list) -> list:
    """Map fn over args in processes (workers > 1), else in this process. Errors come back as strings."""
    if workers <= 1 or len(args) <= 1:
        return [fn(a) for a in args]
    with ProcessPoolExecutor(max_workers=min(workers, len(args))) as ex:
        return list(ex.map(fn, args))


def _render_workers(a) -> int:
    """Processes for stages that drive a browser (render, build): --render-workers, never more than --workers."""
    rw = getattr(a, "render_workers", None) or DEFAULT_RENDER_WORKERS
    return max(1, min(rw, getattr(a, "workers", rw) or rw))


def _log(msg: str) -> None:
    print(f"[iris-bench] {msg}", file=sys.stderr, flush=True)


def _cam_dicts(cams) -> list[dict] | None:
    return [asdict(c) for c in cams] if cams else None


# ---------------------------------------------------------------- generate (+ IFC)

def _generate_one(arg: tuple) -> str:
    seed, out, challenge, ifc, cams = (*arg, None)[:5] if len(arg) == 4 else arg
    try:
        from iris_bench import scenes
        folder = _scenes_dir(Path(out)) / str(seed)
        folder.mkdir(parents=True, exist_ok=True)
        gen = scenes.generate
        passed = dict(challenge) if _takes_var_kw(gen) else _kw(gen, **challenge)
        cameras = [Camera(**c) for c in cams] if cams else []
        if cameras and "cameras" in _params(gen):
            passed["cameras"] = cameras
        scene = gen(seed, **passed)
        for k, v in challenge.items():   # knobs the generator did not take still slice the results
            scene.challenge.setdefault(k, v)
        if cameras:
            scene.cameras = cameras
        to_folder = getattr(scenes, "to_folder", None)
        if to_folder is not None:
            to_folder(scene, folder)
        if not (folder / "scene.json").exists() or cameras:
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
    ch = challenge_from_args(a)
    cams = _cam_dicts(getattr(a, "cameras", None))
    msgs = _pool(a.workers, _generate_one,
                 [(s, str(a.out), ch, not getattr(a, "no_ifc", False), cams) for s in seeds])
    for m in msgs:
        _log(m)
    return 1 if all("FAILED" in m for m in msgs) else 0


# ---------------------------------------------------------------- render

def _render(scene_dir: Path, focus: list[str], views: list[str], style, fix=None, cameras=None) -> list[View]:
    from iris_bench.render import render_scene
    kw: dict = {"views": list(views), "fix": fix}
    if style:
        kw["style"] = style
    if cameras and "cameras" in _params(render_scene):
        kw["cameras"] = list(cameras)
    return list(render_scene(scene_dir, focus, **_kw(render_scene, **kw)))


def _stats_delta(before: dict, after: dict) -> dict:
    return {k: after.get(k, 0) - before.get(k, 0) for k in after}


def _render_one(arg: tuple) -> dict:
    """Render every planted pair of one seed in one browser (render_many, retried once on a browser crash): the
    scene's cameras (or --cameras), and for a pair whose camera render still fails, the default A/B/C views. Returns a
    stats dict with a log line in "msg"."""
    out, seed, cams = (*arg, None)[:3] if len(arg) == 2 else arg
    folder = _scenes_dir(Path(out)) / str(seed)
    st = {"seed": seed, "pairs": 0, "cameras": [], "camera_pairs_ok": 0, "fallback_pairs": 0, "failed_pairs": 0,
          "views": 0, "restarts": 0, "retried_jobs": 0, "recovered_jobs": 0, "errors": [], "failed": False}
    try:
        from iris_bench import render
        scene = Scene.load(folder / "scene.json")
        style = scene.challenge.get("style")
        cameras = [Camera(**c) for c in cams] if cams else list(scene.cameras or [])
        pairs = [[p.a, p.b] for p in scene.planted]
        st["pairs"], st["cameras"] = len(pairs), [c.name for c in cameras]
        stats0 = dict(render.STATS)

        def job(focus: list[str], views, cams_=None) -> dict:
            j: dict = {"scene_dir": folder, "focus": list(focus), "views": list(views)}
            if style:
                j["style"] = style
            if cams_:
                j["cameras"] = list(cams_)
            return j

        all_views: list[View] = []
        todo = pairs
        if cameras and pairs:
            res, errs = render.render_many_lenient([job(f, [c.name for c in cameras], cameras) for f in pairs])
            todo = []
            for f, vs, e in zip(pairs, res, errs):
                if e is None:
                    all_views += vs
                else:
                    todo.append(f)
                    st["errors"].append(e[:300])
            st["camera_pairs_ok"], st["fallback_pairs"] = len(pairs) - len(todo), len(todo)
        if todo:   # no cameras, or the camera render failed even after a retry: the renderer's own A/B/C views
            res, errs = render.render_many_lenient([job(f, DEFAULT_VIEWS) for f in todo])
            for vs, e in zip(res, errs):
                if e is None:
                    all_views += vs
                else:
                    st["failed_pairs"] += 1
                    st["errors"].append(e[:300])
        d = _stats_delta(stats0, render.STATS)
        st.update(restarts=d["restarts"], retried_jobs=d["retried_jobs"], recovered_jobs=d["recovered_jobs"])
        # unique by image path (later renders of the same name for a different focus have different paths)
        seen, uniq = set(), []
        for v in all_views:
            if v.image not in seen:
                seen.add(v.image)
                uniq.append(v)
        if uniq:   # locked read-merge-write, safe against concurrent renders into the same scene folder
            render.merge_views_json(folder, uniq)
        st["views"] = len(uniq)
        note = ""
        if st["fallback_pairs"]:
            note += (f"; cameras {st['cameras']} failed for {st['fallback_pairs']}/{len(pairs)} pairs, fell back to "
                     f"{'/'.join(DEFAULT_VIEWS)}")
        if st["restarts"]:
            note += (f"; browser restarted {st['restarts']}x "
                     f"({st['recovered_jobs']}/{st['retried_jobs']} jobs recovered)")
        if st["failed_pairs"]:
            note += f"; {st['failed_pairs']} pairs not rendered"
        st["failed"] = bool(pairs) and st["failed_pairs"] == len(pairs)
        st["msg"] = f"seed {seed}: {'FAILED no pictures' if st['failed'] else 'ok'} ({len(uniq)} views){note}"
    except Exception as e:
        st["failed"] = True
        st["msg"] = f"seed {seed}: FAILED {type(e).__name__}: {e}"
    return st


def _render_summary(stats: list[dict]) -> dict:
    keys = ("pairs", "camera_pairs_ok", "fallback_pairs", "failed_pairs", "views", "restarts", "retried_jobs",
            "recovered_jobs")
    tot = {k: sum(int(s.get(k, 0)) for s in stats) for k in keys}
    tot["seeds"] = len(stats)
    tot["seeds_with_fallback"] = sum(1 for s in stats if s.get("fallback_pairs"))
    tot["seeds_failed"] = sum(1 for s in stats if s.get("failed"))
    return tot


def cmd_render(a) -> int:
    seeds = _seeds_of(a)
    cams = _cam_dicts(getattr(a, "cameras", None))
    stats = _pool(_render_workers(a), _render_one, [(str(a.out), s, cams) for s in seeds])
    for s in stats:
        _log(s["msg"])
    tot = _render_summary(stats)
    _log(f"render: cameras rendered for {tot['camera_pairs_ok']}/{tot['pairs']} pairs; fallback to "
         f"{'/'.join(DEFAULT_VIEWS)} for {tot['fallback_pairs']} pairs ({tot['seeds_with_fallback']}/{tot['seeds']} "
         f"seeds); browser restarts {tot['restarts']} ({tot['recovered_jobs']}/{tot['retried_jobs']} jobs recovered); "
         f"{tot['failed_pairs']} pairs not rendered")
    _write_render_stats(Path(a.out), "render", {"total": tot, "per_seed": [{k: v for k, v in s.items() if k != "msg"}
                                                                           for s in stats]})
    return 1 if stats and all(s.get("failed") for s in stats) else 0


def _write_render_stats(out: Path, stage: str, data: dict) -> None:
    """render_stats.json in the run folder: {"render": ..., "build": ...}; never fails the stage."""
    p = Path(out) / "render_stats.json"
    try:
        cur = json.loads(p.read_text()) if p.exists() else {}
        cur[stage] = data
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(cur, indent=1, default=str))
    except Exception as e:
        _log(f"render_stats.json not written ({type(e).__name__}: {e})")


# ---------------------------------------------------------------- build items (+ controls)

def _load_views(folder: Path) -> list[View]:
    p = folder / "views.json"
    if not p.exists():
        return []
    return [View(**v) for v in json.loads(p.read_text())]


def _fixes_of(cands) -> list:
    """Fix objects from a list of Fixes, Resolutions (anything with .fix) or dicts with a "fix"."""
    out = []
    for c in cands or []:
        if hasattr(c, "fix"):
            out.append(c.fix)
        elif isinstance(c, dict) and "fix" in c:
            out.append(c["fix"])
        else:
            out.append(c)
    return out


def _fix_element(f) -> str | None:
    return f.get("element") if isinstance(f, dict) else getattr(f, "element", None)


def _focus_for(sc: Scene, fixes: list) -> list[str]:
    """The moved elements plus their planted clash partners."""
    movers = {e for e in (_fix_element(f) for f in fixes) if e}
    return sorted(movers | {x for p in sc.planted if movers & {p.a, p.b} for x in (p.a, p.b)})


def _guarded(fn, name: str, stats: dict):
    """A renderer that never raises: a failed render returns no views (build_items then skips that J5/J6 fix, that
    J7 candidate set or that J8/J9 group) and is counted in `stats`."""
    def wrapped(*args, **kw):
        stats["calls"] += 1
        try:
            return fn(*args, **kw)
        except Exception as e:
            stats["failed"] += 1
            if len(stats["errors"]) < 3:
                stats["errors"].append(f"{name}: {type(e).__name__}: {str(e)[:200]}")
            return []
    return wrapped


def _build_one(arg: tuple) -> tuple[str, list[dict], dict]:
    """Items of one seed. The fix (J5/J6), candidate (J7) and group (J8/J9) renderers come from
    jobs.renderers_for(folder); fix and candidate renders are skipped with --no-j5. Returns (log line, items as
    dicts, render stats)."""
    out, seed, modes, j5, jobs_ = (*arg, None)[:5] if len(arg) == 4 else arg
    folder = _scenes_dir(Path(out)) / str(seed)
    rst = {"seed": seed, "calls": 0, "failed": 0, "errors": [], "restarts": 0, "recovered_jobs": 0}
    try:
        from iris_bench import jobs
        scene = Scene.load(folder / "scene.json")
        views = _load_views(folder)
        style = scene.challenge.get("style")
        note, rend, stats0, render = "", {}, None, None
        try:
            from iris_bench import render
            if render.available():
                stats0 = dict(render.STATS)
                rend = dict(jobs.renderers_for(folder.resolve(), style=style))
            else:
                note = "; renderer not installed (no J5/J6/J7 pictures, no J8/J9 group renders)"
        except Exception as e:
            note = f"; renderer unavailable ({type(e).__name__}: {e})"
        if not j5:
            rend.pop("fix_renderer", None)
            rend.pop("cand_renderer", None)
        bparams = _params(jobs.build_items)
        kw: dict = {"scene_dir": folder.resolve()}
        kw.update({k: _guarded(fn, k, rst) for k, fn in rend.items() if k in bparams})
        if jobs_ and "jobs" in bparams:
            kw["jobs"] = tuple(jobs_)
        base_modes = [m for m in modes if m in ("pictures", "pictures_text")] or ["pictures"]
        items = jobs.build_items(scene, views, tuple(base_modes), **kw)
        if jobs_:
            items = [i for i in items if i.job in jobs_]
        if stats0 is not None:
            d = _stats_delta(stats0, render.STATS)
            rst.update(restarts=d["restarts"], recovered_jobs=d["recovered_jobs"])
        if rst["calls"]:
            note += f"; {rst['calls']} renders, {rst['failed']} failed"
            if rst["restarts"]:
                note += f", browser restarted {rst['restarts']}x"
            if rst["errors"]:
                note += f" ({rst['errors'][0][:160]})"
        per_job: dict[str, int] = {}
        for i in items:
            if i.mode == base_modes[0]:
                per_job[i.job.split("_")[0]] = per_job.get(i.job.split("_")[0], 0) + 1
        jobs_txt = " ".join(f"{k}:{v}" for k, v in sorted(per_job.items()))
        return f"seed {seed}: ok ({len(items)} items; {jobs_txt}){note}", [asdict(i) for i in items], rst
    except Exception as e:
        return f"seed {seed}: FAILED {type(e).__name__}: {e}", [], rst


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


def write_manifest(out: Path, items: list[Item]) -> None:
    """Record the truth hashes at build time (integrity check (a)); never fails the build."""
    try:
        from iris_bench import integrity
    except Exception as e:
        _log(f"integrity unavailable ({type(e).__name__}: {e}); no manifest.json written")
        return
    try:
        m = integrity.write_manifest(Path(out), items)
        digest = (m or {}).get("items_sha256", "") if isinstance(m, dict) else ""
        _log(f"manifest -> {Path(out) / 'manifest.json'}" + (f" (items sha256 {digest[:12]})" if digest else ""))
    except Exception as e:
        _log(f"manifest FAILED {type(e).__name__}: {e}")


def _base_of(item: Item) -> str:
    return item.id.removesuffix(f"-{item.mode}")


def stratified(items: list[Item], seed: int = 0) -> list[Item]:
    """`items` in a seeded, job-stratified order: shuffled within each job (one RNG per job, so a change in one job's
    items never reorders another's), then round-robin over the jobs."""
    import random
    by_job: dict[str, list[Item]] = {}
    for it in sorted(items, key=lambda i: i.id):
        by_job.setdefault(it.job, []).append(it)
    for job, lst in by_job.items():
        random.Random(f"stratified-{seed}-{job}").shuffle(lst)
    out, k = [], 0
    while any(k < len(v) for v in by_job.values()):
        out += [by_job[j][k] for j in sorted(by_job) if k < len(by_job[j])]
        k += 1
    return out


def run_order(items: list[Item], seed: int = 0) -> list[Item]:
    """The order `run` asks in, so a --max-usd stop leaves a balanced subset: every pictures item first (job-
    stratified), then the control modes interleaved base item by base item (same stratified order), then agentic."""
    order = {_base_of(it): k for k, it in enumerate(stratified([i for i in items if i.mode == "pictures"], seed))}
    rank = {"pictures": 0, "pictures_text": 1, "no_image": 1, "swapped": 1, "agentic": 2}
    return sorted(items, key=lambda i: (rank.get(i.mode, 1), order.get(_base_of(i), 1 << 30), i.mode, i.id))


def sample_items(items: list[Item], n: int, n_controls: int = 0, seed: int = 0) -> list[Item]:
    """The first `n` pictures (and agentic) items in the job-stratified order, plus up to `n_controls` items per
    control mode, taken in the same stratified base order (so they pair with the pictures sample first)."""
    pics = stratified([i for i in items if i.mode in ("pictures", "agentic")], seed)[:n]
    if n_controls <= 0:
        return pics
    order = {_base_of(it): k for k, it in enumerate(stratified([i for i in items if i.mode == "pictures"], seed))}
    out = list(pics)
    for mode in CONTROL_MODES:
        ctl = sorted((i for i in items if i.mode == mode), key=lambda i: (order.get(_base_of(i), 1 << 30), i.id))
        out += ctl[:n_controls]
    return out


def subsample_controls(items: list[Item], n: int, seed: int = 0) -> list[Item]:
    """Keep every non-control item and at most `n` items per control mode (no_image, swapped, pictures_text): the
    same job-stratified order of base items for every mode, so the controls are mostly the same questions. n <= 0
    keeps everything."""
    if not n or n <= 0:
        return items
    order = {_base_of(it): k for k, it in enumerate(stratified([i for i in items if i.mode == "pictures"], seed))}
    keep: set[str] = set()
    for mode in CONTROL_MODES:
        ctl = sorted((i for i in items if i.mode == mode), key=lambda i: (order.get(_base_of(i), 1 << 30), i.id))
        keep.update(i.id for i in ctl[:n])
    return [i for i in items if i.mode not in CONTROL_MODES or i.id in keep]


def agentic_items(items: list[Item]) -> list[Item]:
    """The "agentic" copy of every pictures item (iris_bench.agentic.agentic_item); [] with a note when the module
    is missing."""
    try:
        from iris_bench.agentic import agentic_item
    except Exception as e:
        _log(f"agentic mode unavailable ({type(e).__name__}: {e}); no agentic items built")
        return []
    return [agentic_item(i) for i in items if i.mode == "pictures"]


def cmd_build(a) -> int:
    from iris_bench.score import write_jsonl
    seeds = _seeds_of(a)
    modes = [m.strip() for m in a.modes.split(",") if m.strip()]
    jobs_ = getattr(a, "jobs", None)
    res = _pool(_render_workers(a), _build_one,
                [(str(a.out), s, modes, not getattr(a, "no_j5", False), jobs_) for s in seeds])
    items: list[Item] = []
    rstats = []
    for msg, its, *rest in res:
        _log(msg)
        items += [Item(**d) for d in its]
        rstats += rest[:1]
    if rstats:
        tot = {k: sum(int(r.get(k, 0)) for r in rstats) for k in ("calls", "failed", "restarts", "recovered_jobs")}
        _log(f"build renders: {tot['calls']} ({tot['failed']} failed, browser restarts {tot['restarts']}, "
             f"{tot['recovered_jobs']} jobs recovered)")
        _write_render_stats(Path(a.out), "build", {"total": tot, "per_seed": rstats})
    if jobs_:
        items = [i for i in items if i.job in jobs_]
    try:
        from iris_bench.jobs import balance_j1
        if getattr(a, "balance", False):
            items = balance_j1(items)
    except Exception:
        pass
    items += add_controls(items, modes)
    n_ctl = getattr(a, "control_sample", DEFAULT_CONTROL_SAMPLE)
    before = len(items)
    items = subsample_controls(items, n_ctl, seed=getattr(a, "boot_seed", 0))
    if len(items) < before:
        _log(f"controls: kept {n_ctl} per control mode (job-stratified), dropped {before - len(items)} control items")
    if "agentic" in modes:
        items += agentic_items(items)
    write_jsonl(items, Path(a.out) / "items.jsonl")
    _log(f"{len(items)} items -> {Path(a.out) / 'items.jsonl'}")
    if items:
        write_manifest(Path(a.out), items)
    return 0 if items else 1


# ---------------------------------------------------------------- run model

def run_agentic_items(items: list[Item], a, out: Path, check, max_usd: float | None = None) -> list:
    """Agentic items through iris_bench.agentic.run_agentic (guarded import: skipped with a note when absent)."""
    if not items:
        return []
    try:
        from iris_bench.agentic import run_agentic
    except Exception as e:
        _log(f"agentic: iris_bench.agentic.run_agentic unavailable ({type(e).__name__}: {e}); "
             f"{len(items)} agentic items skipped")
        return []
    if max_usd is not None and not str(a.model).startswith("fake") and not (
            "max_usd" in _params(run_agentic) or _takes_var_kw(run_agentic)):
        _log(f"agentic: run_agentic takes no spend cap (max_usd); {len(items)} agentic items skipped on a paid model")
        return []
    kw = _kw(run_agentic, cache_dir=out / "cache", check=check, concurrency=getattr(a, "concurrency", 8),
             **({"max_steps": a.max_steps} if getattr(a, "max_steps", None) else {}),
             **({"max_usd": max_usd} if max_usd is not None else {}))
    t = time.time()
    res = list(run_agentic(items, a.model, _scenes_dir(out), **kw))
    _log(f"{len(res)} agentic results from {a.model} in {time.time() - t:.1f}s")
    return res


def _record_model_run(out: Path, label: str, results: list, n_items: int, new_usd: float, budget_hit: bool) -> None:
    """manifest.json "model_runs"[label]: the request settings, counts and cost of the latest `run` (never fails)."""
    from iris_bench import runner
    mp = out / "manifest.json"
    try:
        man = json.loads(mp.read_text()) if mp.exists() else {}
        rec = ({"model": label, "fake": True} if label.startswith("fake") else runner.settings_record(label))
        versions = sorted({str((r.detail or {}).get("model_version")) for r in results
                           if (r.detail or {}).get("model_version")})
        cache_rows = []
        cp = out / "cache" / f"{runner._safe(label)}.jsonl"
        if cp.exists():
            for line in cp.read_text().splitlines():
                try:
                    cache_rows.append(json.loads(line))
                except ValueError:
                    continue
        rec["usd_all_calls_in_cache"] = round(sum(float(r.get("cost_usd") or 0) for r in cache_rows), 4)
        rec["n_calls_in_cache"] = len(cache_rows)
        rec.update({"run_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "n_items": n_items, "n_results": len(results),
                    "n_no_reply": sum(1 for r in results if r.reply is None),
                    "n_transport_failed": sum(1 for r in results if unasked(r) and
                                              (r.detail or {}).get("error") != "budget"),
                    "n_budget_skipped": sum(1 for r in results if (r.detail or {}).get("error") == "budget"),
                    "usd_total_recorded": round(sum(r.cost_usd or 0.0 for r in results), 4),
                    "usd_new_this_run": round(new_usd, 4), "budget_hit": budget_hit, "model_versions": versions})
        man.setdefault("model_runs", {})[label] = rec
        mp.write_text(json.dumps(man, indent=1, sort_keys=True, default=str))
    except Exception as e:
        _log(f"manifest model_runs not written ({type(e).__name__}: {e})")


def unasked(r) -> bool:
    """A result the model never answered: skipped at the budget, or a call that failed in transport after its
    retries (not cached; the next `run` asks again). Kept out of results.jsonl, so it is never scored as wrong. A reply
    that is not JSON is the model's own failure (detail.failure) and stays."""
    d = r.detail or {}
    return r.reply is None and bool(d.get("error")) and not d.get("failure") and d.get("error") != "no reply"


def _merge_results(path: Path, label: str, new: list) -> list:
    """results.jsonl rows of other model labels, then this run's: several models share one run folder."""
    from iris_bench.score import read_results
    keep = []
    if path.exists():
        keep = [r for r in read_results(path) if r.model != label]
    return keep + list(new)


def cmd_run(a) -> int:
    from iris_bench import runner
    from iris_bench.runner import run
    from iris_bench.score import make_check, read_items, write_jsonl
    out = Path(a.out)
    items = read_items(out / "items.jsonl")
    if getattr(a, "ids", None):
        want = {x.strip() for x in Path(a.ids).read_text().split() if x.strip()}
        unknown = want - {i.id for i in items}
        items = [i for i in items if i.id in want]
        _log(f"--ids {a.ids}: {len(items)} items" + (f" ({len(unknown)} ids not in items.jsonl)" if unknown else ""))
    if getattr(a, "sample", 0):
        items = sample_items(items, a.sample, getattr(a, "sample_controls", 0), seed=getattr(a, "boot_seed", 0))
        _log(f"--sample {a.sample} --sample-controls {getattr(a, 'sample_controls', 0)}: {len(items)} items "
             f"({', '.join(f'{m} {n}' for m, n in sorted(Counter(i.mode for i in items).items()))})")
    items = run_order(items, seed=getattr(a, "boot_seed", 0))
    if getattr(a, "limit", 0):
        items = items[: a.limit]
    label = a.model if a.model.startswith("fake") else runner.model_label(a.model, getattr(a, "thinking", None))
    max_usd = getattr(a, "max_usd", None)
    if not label.startswith("fake") and max_usd is None:
        _log(f"refusing paid calls to {label} without a budget: add --max-usd (e.g. --max-usd 2), or use fake:0.7")
        return 1
    if not label.startswith("fake"):
        _log(f"model {label}: thinking {runner.thinking_for(label) or 'google-default'}, media resolution "
             f"{runner.MEDIA_RESOLUTION}" + (f", budget ${max_usd:.2f}" if max_usd is not None else ", NO budget cap"))
    t = time.time()
    try:
        from iris_bench import checker  # noqa: F401
        check = make_check(_scenes_dir(out))
    except Exception as e:
        _log(f"checker unavailable ({e}); J3/J5 stay ungraded until `score`")
        check = None
    ag = [i for i in items if i.mode == "agentic"]
    rest = [i for i in items if i.mode != "agentic"]
    results = run(rest, label, cache_dir=out / "cache", concurrency=getattr(a, "concurrency", 8), check=check,
                  max_usd=max_usd)
    _log(f"{len(results)} results from {label} in {time.time() - t:.1f}s")
    spent = sum(r.cost_usd or 0.0 for r in results if not (r.detail or {}).get("cached"))
    left = None if max_usd is None else max(0.0, max_usd - spent)
    a_label = a.model
    a.model = label
    try:
        if left is None or left > 0:
            results += run_agentic_items(ag, a, out, check, max_usd=left)
        elif ag:
            _log(f"agentic: budget spent, {len(ag)} agentic items not run")
    finally:
        a.model = a_label
    kept = [r for r in results if not unasked(r)]
    write_jsonl(_merge_results(out / "results.jsonl", label, kept), out / "results.jsonl")
    cost = sum(r.cost_usd or 0.0 for r in results if not (r.detail or {}).get("cached"))
    skipped = sum(1 for r in results if (r.detail or {}).get("error") == "budget")
    failed = [r for r in results if unasked(r) and (r.detail or {}).get("error") != "budget"]
    unparsed = sum(1 for r in kept if r.reply is None)
    budget_hit = bool(skipped) or (max_usd is not None and cost >= max_usd)
    _record_model_run(out, label, results, len(items), cost, budget_hit)
    for r in failed[:3]:
        _log(f"  call failed: {r.item_id}: {str((r.detail or {}).get('error'))[:200]}")
    _log(f"{len(kept)} results for {label} -> {out / 'results.jsonl'} (new spend ${cost:.4f}; "
         f"total recorded ${sum(r.cost_usd or 0.0 for r in results):.4f}; {unparsed} replies not JSON; "
         f"{len(failed)} calls failed in transport (not written; a rerun asks again)"
         + (f"; BUDGET ${max_usd:.2f} reached, {skipped} items not asked" if budget_hit else "") + ")")
    return BUDGET_RC if budget_hit else 0


# ---------------------------------------------------------------- score / verify / report / export

def cmd_score(a) -> int:
    from iris_bench.score import read_items, read_results, score_run
    out = Path(a.out)
    items, results = read_items(out / "items.jsonl"), read_results(out / "results.jsonl")
    graded, rows = score_run(items, results, out, scenes_dir=_scenes_dir(out), seed=getattr(a, "boot_seed", 0))
    acc = [r for r in rows if r["table"] == "accuracy" and r["job"] == "ALL"]
    for r in acc:
        _log(f"{r['model']} {r['mode']}: {r['accuracy']:.0%} [{r['ci_lo']:.0%}, {r['ci_hi']:.0%}] n={r['n']}")
    _log(f"{len(rows)} score rows -> {out / 'scores.csv'}")
    return 0


def _integrity_lines(integrity, rep: dict) -> list[str]:
    fn = getattr(integrity, "summary_lines", None) if integrity is not None else None
    if fn is not None:
        try:
            return list(fn(rep))
        except Exception:
            pass
    lines = [f"integrity: {'PASS' if rep.get('ok') else 'FAIL'}"]
    for c in rep.get("checks", []):
        lines.append(f"  {'ok  ' if c.get('ok') else 'FAIL'} {c.get('name', '?')}: {c.get('summary', '')}")
    return lines


def cmd_verify(a) -> int:
    out = Path(a.out)
    a._integrity = None
    try:
        from iris_bench import integrity
    except Exception as e:
        _log(f"integrity unavailable ({type(e).__name__}: {e}); nothing verified")
        return 1
    sample = getattr(a, "verify_sample", None) or getattr(a, "sample", None) or 25
    try:
        rep = integrity.check_run(out, **_kw(integrity.check_run, sample=sample, seed=getattr(a, "boot_seed", 0),
                                             write=True))
    except Exception as e:
        _log(f"integrity check FAILED to run: {type(e).__name__}: {e}")
        return 1
    a._integrity = rep
    a._integrity_lines = _integrity_lines(integrity, rep)
    for line in a._integrity_lines:
        _log(line)
    _log(f"integrity -> {out / 'integrity.json'}")
    return 0 if rep.get("ok") else 1


def cmd_report(a) -> int:
    from iris_bench.report import write_report
    from iris_bench.score import read_items, read_results, score_rows
    out = Path(a.out)
    items = read_items(out / "items.jsonl")
    graded_p = out / "graded.jsonl"
    results = read_results(graded_p if graded_p.exists() else out / "results.jsonl")
    scores_p = out / "scores.jsonl"
    rows = ([json.loads(l) for l in scores_p.read_text().splitlines() if l.strip()] if scores_p.exists()
            else score_rows(items, results, seed=getattr(a, "boot_seed", 0)))
    md, ht = write_report(rows, items, results, out, title=getattr(a, "title", None) or f"Iris Bench: {out.name}")
    _log(f"report -> {md}, {ht}")
    return 0


def cmd_export(a) -> int:
    from iris_bench import export
    out, to = Path(a.out), Path(a.to)
    res = export.export_sample(out, to, **_kw(export.export_sample, sample=a.sample, seed=a.seed))
    summary = res.get("summary") if isinstance(res, dict) else None
    _log(summary or f"exported a sample of {a.sample} items -> {to}")
    return 0


def cmd_all(a) -> int:
    steps = [("generate", cmd_generate), ("render", cmd_render), ("build", cmd_build), ("run", cmd_run),
             ("score", cmd_score), ("verify", cmd_verify), ("report", cmd_report)]
    verify_rc = 0
    for name, fn in steps:
        t = time.time()
        _log(f"== {name}")
        rc = fn(a)
        _log(f"== {name} done in {time.time() - t:.1f}s (rc={rc})")
        if rc != 0 and name == "render":
            _log("render failed: continuing without pictures (items get no images; J5/J6/J7 skipped)")
            a.no_j5 = True
        elif rc == BUDGET_RC and name == "run":
            _log("run stopped at the --max-usd budget: scoring and reporting the partial results")
        elif rc != 0 and name == "verify":
            verify_rc = rc
            _log("integrity check did not pass: writing the report anyway (see its integrity section)")
        elif rc != 0:
            _log(f"stopping: {name} failed")
            return rc
    rep = getattr(a, "_integrity", None)
    if rep is None:
        _log("integrity: not verified (integrity module unavailable or crashed)")
        return 0
    for line in getattr(a, "_integrity_lines", None) or []:
        _log(line)
    return 2 if (verify_rc or not rep.get("ok")) else 0


# ---------------------------------------------------------------- argparse

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="iris-bench", description="Iris Bench: visual MEP coordination benchmark")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, seeds_required=False):
        p.add_argument("--out", type=Path, required=True, help="run folder, e.g. runs/x")
        p.add_argument("--seeds", required=seeds_required, default=None, help="0:20, 3, or 1,4,9")
        p.add_argument("--workers", type=int, default=os.cpu_count() or 4)
        p.add_argument("--boot-seed", type=int, default=0, help="bootstrap / sampling RNG seed")
        p.add_argument("--title", default=None)

    def gen_args(p):
        p.add_argument("--challenge", action="append", help="key=value passed to scenes.generate (repeatable)")
        p.add_argument("--locked-services", type=int, default=None,
                       help="lock N services (an explicit 'must not move' constraint, drawn with a lock badge)")
        p.add_argument("--no-ifc", action="store_true")

    def cam_args(p):
        p.add_argument("--cameras", type=_cameras_type, default=None,
                       help="viewpoints: top, section, section_y, iso, A/B/C or name:AZ:EL[:DIST], comma-separated")

    def render_args(p):
        p.add_argument("--render-workers", type=int, default=DEFAULT_RENDER_WORKERS,
                       help=f"processes that drive a browser in render/build (default {DEFAULT_RENDER_WORKERS})")

    def agentic_args(p):
        p.add_argument("--max-steps", type=int, default=4, help="agentic mode: model turns per episode (default 4)")

    def model_args(p):
        p.add_argument("--thinking", default="default",
                       help="default (Google's per-model default; Flash-Lite LOW) | low | medium | high: a level "
                            "other than default runs under the label <model>@<level>")
        p.add_argument("--max-usd", type=float, default=None,
                       help="stop starting model calls once this run's new spend reaches it (USD)")
        p.add_argument("--sample", type=int, default=0,
                       help="ask only N job-stratified pictures (and agentic) items, e.g. a thinking-HIGH comparison")
        p.add_argument("--ids", type=Path, default=None,
                       help="ask exactly the item ids listed in this file (whitespace-separated)")
        p.add_argument("--sample-controls", type=int, default=0,
                       help="with --sample: also K items per control mode, paired with the sample's base items first")

    def build_args(p):
        p.add_argument("--modes", default=",".join(ALL_MODES),
                       help="item modes: pictures,pictures_text,no_image,swapped (default) and optionally agentic")
        p.add_argument("--jobs", type=_jobs_type, default=None, help="J1,J3,... or full names (default: all jobs)")
        p.add_argument("--no-j5", action="store_true",
                       help="skip fix renders (J5/J6 before/after, J7 candidates)")
        p.add_argument("--balance", action="store_true", help="balance J1 kinds across the run")
        p.add_argument("--control-sample", type=int, default=DEFAULT_CONTROL_SAMPLE,
                       help=f"items per control mode (no_image, swapped, pictures_text), job-stratified; 0 = all "
                            f"(default {DEFAULT_CONTROL_SAMPLE})")

    p = sub.add_parser("generate", help="generate scenes (scene.json + scene.ifc)")
    common(p, True)
    gen_args(p)
    cam_args(p)
    p.set_defaults(fn=cmd_generate)

    p = sub.add_parser("render", help="render each planted pair (views A/B/C or the scene's cameras)")
    common(p)
    cam_args(p)
    render_args(p)
    p.set_defaults(fn=cmd_render)

    p = sub.add_parser("build", help="build items + control items -> items.jsonl + manifest.json")
    common(p)
    build_args(p)
    render_args(p)
    p.set_defaults(fn=cmd_build)

    p = sub.add_parser("run", help="ask a model -> results.jsonl")
    common(p)
    p.add_argument("--model", default=DEFAULT_MODEL,
                   help=f"model id (default {DEFAULT_MODEL}; e.g. gemini-3.5-flash-lite) or fake:<p>; a real model "
                        "needs --max-usd")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--concurrency", type=int, default=8)
    agentic_args(p)
    model_args(p)
    p.set_defaults(fn=cmd_run)

    p = sub.add_parser("score", help="grade + score -> scores.csv/jsonl")
    common(p)
    p.set_defaults(fn=cmd_score)

    p = sub.add_parser("verify", help="benchmark integrity checks -> integrity.json")
    common(p)
    p.add_argument("--sample", type=int, default=25, help="items whose truth is re-derived from scene.json")
    p.set_defaults(fn=cmd_verify)

    p = sub.add_parser("report", help="report.md + report.html")
    common(p)
    p.set_defaults(fn=cmd_report)

    p = sub.add_parser("export", help="copy a stratified sample of items into a self-contained folder for judges")
    common(p)
    p.add_argument("--to", type=Path, required=True, help="destination folder, e.g. datasets/sample")
    p.add_argument("--sample", type=int, default=50, help="number of items")
    p.add_argument("--seed", type=int, default=0, help="sampling seed")
    p.set_defaults(fn=cmd_export)

    p = sub.add_parser("all", help="generate -> render -> build -> run -> score -> verify -> report")
    common(p, True)
    p.add_argument("--model", default=DEFAULT_MODEL,
                   help=f"model id (default {DEFAULT_MODEL}) or fake:<p> (offline); a real model needs --max-usd")
    gen_args(p)
    cam_args(p)
    build_args(p)
    render_args(p)
    agentic_args(p)
    model_args(p)
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--concurrency", type=int, default=8)
    p.add_argument("--verify-sample", type=int, default=25, help="items re-derived by the integrity check")
    p.set_defaults(fn=cmd_all)
    return ap


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    return a.fn(a) or 0


if __name__ == "__main__":
    raise SystemExit(main())
