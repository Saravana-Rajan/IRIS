"""Iris Bench renderer, the Python side: scene.json -> PNGs + views.json through bench/render/render.mjs.

The pictures are drawn by three.js in headless Chromium (SwiftShader), so they are deterministic for a given job: the
letters, colours and seeded camera come from the seed (the scene's seed unless given). Per view the renderer writes
`<tag>_<view>.png` (the picture), `<tag>_<view>.id.png` (flat colour per element, for the visible-pixel counts) and
merges the views into `<out>/views.json`; `View.image` paths are relative to the scene folder.

Views: "A" the focus pair 40% see-through on a 0.5 m floor grid; "B" the pair solid with grey context (85%
transparent, within 2.5 m), same camera; "C" as A, 90° round. With a fix: "before_A"/"after_A" (and "_C") draw the
pair with faint context before and after the element is translated. Focus elements are lettered from ELEMENT_LETTERS
(A, B, C, D, F, …: no E or N, which the compass uses, no U, I or O), their openings from OPENING_LETTERS (P, Q, V, …,
never an element letter); past the end of a pool the letters repeat with a number (A2, …). `View.labels` maps both
element and opening ids to their letters; anything that reads or writes letters should use these two pools. Each
picture carries a scale
bar at the pair's depth (exact everywhere in orthographic views) and a compass (N = +Y, E = +X, up = +Z as this
camera sees them).

Cameras (`spec.Camera`): azimuth_deg in the world XY plane from +X (east) towards +Y (north), where the camera stands
(-90 = south side looking north); elevation_deg up from the horizon (90 = plan: north up, east right, any azimuth);
distance_factor > 1 backs off; projection "perspective" | "orthographic". A view name resolves against the cameras
given, else `scene.cameras`, else the seeded A / B / C; the camera named "B" draws B-style (context), others A-style.
"before_<cam>" / "after_<cam>" draw a fix from that camera.

Locked elements (`Element.locked`) are hatched with dashed edges in every view, their letter tag carries a padlock, and
the scale-bar panel shows the legend "[padlock] fixed" whenever one is drawn. None of it touches the id image.

Candidates (`render_candidates`): "before" plus one "after" picture per proposed fix ("cand_1", "cand_2", …, each with
its number in a big badge, top-left), one camera / framing / letters / colours for all, and a contact sheet
"cand_grid" (2 x 2 for up to four) with its own id image and visible-pixel counts.

views.json: every job's views are merged into `<out>/views.json` (replacing entries with the same image) under an
exclusive `fcntl.flock` on `<out>/views.json.lock`, written to a temporary file and renamed into place, so renders
running at the same time in other threads or processes never lose each other's entries (`merge_views_json`).

Crashes: `render_many` runs its jobs in one node + Chromium process. On a loaded machine that browser can die ("Target
page, context or browser has been closed"), taking every later job with it; those jobs (CRASH_MARKERS, or a process
that died without a result) are tried once more in a fresh browser (`RETRIES`). `render_many_lenient` returns the
views and a per-job error instead of raising; `STATS` counts restarts and recovered / failed jobs in this process.

Needs node and bench/render's node_modules (`cd bench/render && npm ci && npx playwright install chromium`).
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import asdict, is_dataclass
from pathlib import Path

from iris_bench.spec import Camera, Fix, View

RENDER_DIR = Path(__file__).resolve().parents[2] / "bench" / "render"
SCRIPT = RENDER_DIR / "render.mjs"
FIX_VIEWS = ("before_A", "after_A")
GRID_VIEW = "cand_grid"
# Letter pools for the pictures (bench.js has the same defaults; every job sends these). Elements skip E and N (the
# compass), U (its "up"), I and O (1 and 0); openings take the letters from P on that elements do not use.
ELEMENT_LETTERS = "ABCDFGHJKLMRST"
OPENING_LETTERS = "PQVWXYZ"


def available() -> bool:
    """True when node and the renderer's packages are installed."""
    return bool(shutil.which("node")) and (RENDER_DIR / "node_modules" / "playwright").exists() \
        and (RENDER_DIR / "node_modules" / "three").exists()


def _plain(x: object) -> dict | None:
    if x is None:
        return None
    return asdict(x) if is_dataclass(x) else dict(x)


def _hash(obj: object) -> str:
    return hashlib.sha1(json.dumps(obj, sort_keys=True).encode()).hexdigest()[:8]


def _fix_tag(focus: list[str], fix: dict) -> str:
    return f"{'-'.join(focus)}_fix{_hash(fix)}"


def _job(scene_dir: Path | str, focus: list[str], views=None, style: str = "shaded",
         fix: Fix | dict | None = None, seed: int | None = None, width: int = 1024, out_dir: Path | str | None = None,
         tag: str | None = None, cameras: list[Camera | dict] | None = None, compass: bool = True) -> dict:
    scene_dir = Path(scene_dir)
    fx = _plain(fix)
    job = {"scene_path": str((scene_dir / "scene.json").resolve()), "focus": list(focus),
           "views": list(views) if views is not None else None, "style": style, "fix": fx, "width": width,
           "out_dir": str(Path(out_dir).resolve() if out_dir else (scene_dir / "render").resolve()),
           "tag": tag or (_fix_tag(list(focus), fx) if fx else "-".join(focus)), "compass": compass,
           "letters": {"elements": ELEMENT_LETTERS, "openings": OPENING_LETTERS}, "views_json": False}
    if cameras:
        job["cameras"] = [_plain(c) for c in cameras]
    if seed is not None:
        job["seed"] = seed
    return job


def _candidates_job(scene_dir: Path | str, focus: list[str], fixes: list[Fix | dict], camera: Camera | dict | None = None,
                    grid: bool = True, style: str = "shaded", seed: int | None = None, width: int = 1024,
                    out_dir: Path | str | None = None, tag: str | None = None, compass: bool = True) -> dict:
    if not fixes:
        raise ValueError("render_candidates needs at least one fix")
    fxs = [_plain(f) for f in fixes]
    cam = _plain(camera) if camera is not None else "A"      # None: the seeded A camera
    views = [{"name": "before", "phase": "before", "camera": cam, "fix": None}]
    views += [{"name": f"cand_{i}", "phase": "after", "camera": cam, "fix": f, "badge": str(i)}
              for i, f in enumerate(fxs, 1)]
    job = _job(scene_dir, focus, views=views, style=style, seed=seed, width=width, out_dir=out_dir, compass=compass,
               tag=tag or f"{'-'.join(focus)}_cands{_hash({'fixes': fxs, 'camera': cam})}")
    if grid:
        job["grid"] = {"name": GRID_VIEW, "views": [v["name"] for v in views[1:]]}
    return job


_VIEW_KEYS = ("name", "image", "id_image", "labels", "colors", "visible_px", "focus")


def _views(res: list) -> list[View]:
    return [View(**{k: v[k] for k in _VIEW_KEYS}) for v in res]


def merge_views_json(out_dir: Path | str, views: list[View | dict]) -> None:
    """Merge views into `out_dir/views.json`: entries with the same image are replaced, the rest kept. Read, merge and
    write happen under an exclusive flock on `views.json.lock`, and the file is replaced atomically, so concurrent
    renders into one folder (threads or processes) keep every entry. A views.json that is not valid JSON raises."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = [{k: (asdict(v) if is_dataclass(v) else v)[k] for k in _VIEW_KEYS} for v in views]
    vj = out_dir / "views.json"
    with open(out_dir / "views.json.lock", "a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            prior = json.loads(vj.read_text()) if vj.exists() else []
            mine = {r["image"] for r in rows}
            merged = [v for v in prior if v.get("image") not in mine] + rows
            fd, tmp = tempfile.mkstemp(dir=out_dir, prefix=".views.", suffix=".json.tmp")
            try:
                with os.fdopen(fd, "w") as f:
                    json.dump(merged, f, indent=2)
                    f.flush()
                    os.fsync(f.fileno())
                os.chmod(tmp, 0o644)
                os.replace(tmp, vj)
            except BaseException:
                Path(tmp).unlink(missing_ok=True)
                raise
        finally:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)


# A browser that dies under load (OOM, a starved GPU process, a SwiftShader stall) fails every job after it with one of
# these; such jobs are worth one more try in a fresh browser. A job whose own scene or view is wrong is not.
CRASH_MARKERS = ("has been closed", "target closed", "browser closed", "disconnected", "crashed", "page crashed",
                 "protocol error", "renderer failed", "timed out", "timeout", "econnreset", "socket hang up")
RETRIES = 1
# Per-process counters (render_many calls, browser restarts, jobs retried / recovered / still failing).
STATS: dict[str, int] = {"calls": 0, "jobs": 0, "restarts": 0, "retried_jobs": 0, "recovered_jobs": 0,
                         "failed_jobs": 0}


def _crashed(err: str) -> bool:
    e = str(err).lower()
    return any(m in e for m in CRASH_MARKERS)


def _node(payload: list[dict], timeout: float) -> list:
    """One node + Chromium process over `payload`: one entry per job, a list of view dicts or {"error": ...}. A process
    that dies before writing its result (or times out) yields an error entry for every job."""
    with tempfile.TemporaryDirectory(prefix="iris-bench-render-") as tmp:
        jf, rf = Path(tmp) / "jobs.json", Path(tmp) / "result.json"
        jf.write_text(json.dumps(payload))
        try:
            proc = subprocess.run(["node", str(SCRIPT), "--jobs", str(jf), "--result", str(rf)], cwd=RENDER_DIR,
                                  capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return [{"error": f"renderer timed out after {timeout:.0f} s"} for _ in payload]
        if not rf.exists():
            return [{"error": f"renderer failed ({proc.returncode}): {proc.stderr[-2000:]}"} for _ in payload]
        results = json.loads(rf.read_text())
    if len(results) < len(payload):
        results += [{"error": "renderer returned no result for this job"}] * (len(payload) - len(results))
    return results


def _is_err(res) -> bool:
    return isinstance(res, dict) and bool(res.get("error"))


def render_many_lenient(jobs: list[dict], timeout: float = 1800, retries: int = RETRIES
                        ) -> tuple[list[list[View]], list[str | None]]:
    """`render_many` that never raises for a failed job: (views per job, error per job or None). Jobs that fail
    because the browser crashed (CRASH_MARKERS, or the whole process died) are tried again in a fresh browser, up to
    `retries` times. Views of the jobs that worked are merged into their views.json."""
    if not jobs:
        return [], []
    payload = [_candidates_job(**j) if "fixes" in j else _job(**j) for j in jobs]
    STATS["calls"] += 1
    STATS["jobs"] += len(payload)
    results = _node(payload, timeout)
    retried: set[int] = set()
    for _ in range(max(0, retries)):
        redo = [i for i, r in enumerate(results) if _is_err(r) and _crashed(r["error"])]
        if not redo:
            break
        STATS["restarts"] += 1
        STATS["retried_jobs"] += len(redo)
        retried.update(redo)
        for i, r in zip(redo, _node([payload[i] for i in redo], timeout)):
            results[i] = r
    out: list[list[View]] = []
    errors: list[str | None] = []
    by_dir: dict[str, list[View]] = {}          # one locked merge per output folder
    for i, (job, res) in enumerate(zip(payload, results)):
        if _is_err(res):
            STATS["failed_jobs"] += 1
            errors.append(f"render of {job['scene_path']} {job['focus']} failed"
                          f"{' after a retry' if i in retried else ''}: {res['error']}")
            out.append([])
            continue
        if i in retried:
            STATS["recovered_jobs"] += 1
        errors.append(None)
        out.append(_views(res))
        by_dir.setdefault(job["out_dir"], []).extend(out[-1])
    for d, views in by_dir.items():             # the jobs that worked are listed even when another failed
        merge_views_json(d, views)
    return out, errors


def render_many(jobs: list[dict], timeout: float = 1800, retries: int = RETRIES) -> list[list[View]]:
    """Render many jobs in one browser. A job is the keyword arguments of `render_scene` (scene_dir, focus, and
    optionally views, cameras, style, fix, seed, width, out_dir, tag, compass), or of `render_candidates` when it has
    `fixes` (scene_dir, focus, fixes, and optionally camera, grid, style, seed, width, out_dir, tag, compass). Returns
    one list of Views per job, in order. Jobs lost to a browser crash are retried once in a fresh browser; a job that
    still fails raises RuntimeError (after the others' views are merged into views.json)."""
    out, errors = render_many_lenient(jobs, timeout=timeout, retries=retries)
    bad = [e for e in errors if e]
    if bad:
        raise RuntimeError("; ".join(bad))
    return out


def render_scene(scene_dir: Path, focus: list[str], views=None, style: str = "shaded",
                 fix: Fix | None = None, seed: int | None = None, width: int = 1024,
                 out_dir: Path | None = None, tag: str | None = None, cameras: list[Camera] | None = None,
                 compass: bool = True) -> list[View]:
    """Render views of one focus pair of `scene_dir/scene.json`; PNGs go to `scene_dir/render/`.

    `views` are names ("A", "B", "C", "before_A", a camera's name, ...). With no views: one view per camera in
    `cameras`, else per `scene.cameras`, else A, B, C (the seeded cameras). `compass=False` leaves the compass out."""
    return render_many([dict(scene_dir=scene_dir, focus=focus, views=views, style=style, fix=fix, seed=seed,
                             width=width, out_dir=out_dir, tag=tag, cameras=cameras, compass=compass)])[0]


def render_fix(scene_dir: Path, focus: list[str], fix: Fix, views=None, style: str = "shaded",
               seed: int | None = None, width: int = 1024, cameras: list[Camera] | None = None,
               compass: bool = True) -> list[View]:
    """Before/after pictures of a fix (the element translated): views named "before_A", "after_A" (add "before_C",
    "after_C" for the side view); with `cameras`, "before_<name>" and "after_<name>" per camera. Same camera, letters
    and colours in both, so they compare directly."""
    if views is None:
        views = [f"{p}_{c.name}" for c in cameras for p in ("before", "after")] if cameras else FIX_VIEWS
    return render_scene(scene_dir, focus, views=views, style=style, fix=fix, seed=seed, width=width, cameras=cameras,
                        compass=compass)


def render_candidates(scene_dir: Path, focus: list[str], fixes: list[Fix], camera: Camera | None = None,
                      grid: bool = True, style: str = "shaded", seed: int | None = None, width: int = 1024,
                      out_dir: Path | None = None, tag: str | None = None, compass: bool = True) -> list[View]:
    """Pictures for "which proposal is valid": "before", then "cand_1" … "cand_N" (each fix applied on its own, its
    number in a big badge top-left), then "cand_grid" (a contact sheet of the candidates, 2 x 2 for up to four) unless
    grid=False. One camera (`camera`, else the seeded A), framing, letters and colours for all of them."""
    return render_many([dict(scene_dir=scene_dir, focus=focus, fixes=fixes, camera=camera, grid=grid, style=style,
                             seed=seed, width=width, out_dir=out_dir, tag=tag, compass=compass)])[0]
