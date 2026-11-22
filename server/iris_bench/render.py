"""Iris Bench renderer, the Python side: scene.json -> PNGs + views.json through bench/render/render.mjs.

The pictures are drawn by three.js in headless Chromium (SwiftShader), so they are deterministic for a given job: the
letters, colours and camera come from the seed (the scene's seed unless given). Per view the renderer writes
`<tag>_<view>.png` (the picture), `<tag>_<view>.id.png` (flat colour per element, for the visible-pixel counts) and
merges the views into `<out>/views.json`; `View.image` paths are relative to the scene folder.

Views: "A" the focus pair 40% see-through on a 0.5 m floor grid; "B" the pair solid with grey context (85%
transparent, within 2.5 m), same camera; "C" as A, 90° round. With a fix: "before_A"/"after_A" (and "_C") draw the
pair with faint context before and after the element is translated. Focus elements are lettered A, B, …; openings of
focus elements P, Q, …; `View.labels` maps both element and opening ids to their letters. Each picture carries a scale
bar at the pair's depth.

Needs node and bench/render's node_modules (`cd bench/render && npm ci && npx playwright install chromium`).
"""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import tempfile
from dataclasses import asdict, is_dataclass
from pathlib import Path

from iris_bench.spec import Fix, View

RENDER_DIR = Path(__file__).resolve().parents[2] / "bench" / "render"
SCRIPT = RENDER_DIR / "render.mjs"
FIX_VIEWS = ("before_A", "after_A")


def available() -> bool:
    """True when node and the renderer's packages are installed."""
    return bool(shutil.which("node")) and (RENDER_DIR / "node_modules" / "playwright").exists() \
        and (RENDER_DIR / "node_modules" / "three").exists()


def _fix_dict(fix: Fix | dict | None) -> dict | None:
    if fix is None:
        return None
    return asdict(fix) if is_dataclass(fix) else dict(fix)


def _fix_tag(focus: list[str], fix: dict) -> str:
    h = hashlib.sha1(json.dumps(fix, sort_keys=True).encode()).hexdigest()[:8]
    return f"{'-'.join(focus)}_fix{h}"


def _job(scene_dir: Path | str, focus: list[str], views=("A", "B", "C"), style: str = "shaded",
         fix: Fix | dict | None = None, seed: int | None = None, width: int = 1024, out_dir: Path | str | None = None,
         tag: str | None = None) -> dict:
    scene_dir = Path(scene_dir)
    fx = _fix_dict(fix)
    job = {"scene_path": str((scene_dir / "scene.json").resolve()), "focus": list(focus), "views": list(views),
           "style": style, "fix": fx, "width": width,
           "out_dir": str(Path(out_dir).resolve() if out_dir else (scene_dir / "render").resolve()),
           "tag": tag or (_fix_tag(list(focus), fx) if fx else "-".join(focus))}
    if seed is not None:
        job["seed"] = seed
    return job


def _views(res: list) -> list[View]:
    return [View(**{k: v[k] for k in ("name", "image", "id_image", "labels", "colors", "visible_px", "focus")}) for v in res]


def render_many(jobs: list[dict], timeout: float = 1800) -> list[list[View]]:
    """Render many jobs in one browser. Each job is the keyword arguments of `render_scene` (scene_dir, focus, and
    optionally views, style, fix, seed, width, out_dir, tag). Returns one list of Views per job, in order."""
    if not jobs:
        return []
    payload = [_job(**j) for j in jobs]
    with tempfile.TemporaryDirectory(prefix="iris-bench-render-") as tmp:
        jf, rf = Path(tmp) / "jobs.json", Path(tmp) / "result.json"
        jf.write_text(json.dumps(payload))
        proc = subprocess.run(["node", str(SCRIPT), "--jobs", str(jf), "--result", str(rf)], cwd=RENDER_DIR,
                              capture_output=True, text=True, timeout=timeout)
        if not rf.exists():
            raise RuntimeError(f"renderer failed ({proc.returncode}): {proc.stderr[-2000:]}")
        results = json.loads(rf.read_text())
    out = []
    for job, res in zip(payload, results):
        if isinstance(res, dict) and res.get("error"):
            raise RuntimeError(f"render of {job['scene_path']} {job['focus']} failed: {res['error']}")
        out.append(_views(res))
    return out


def render_scene(scene_dir: Path, focus: list[str], views=("A", "B", "C"), style: str = "shaded",
                 fix: Fix | None = None, seed: int | None = None, width: int = 1024,
                 out_dir: Path | None = None, tag: str | None = None) -> list[View]:
    """Render the named views of one focus pair of `scene_dir/scene.json`; PNGs go to `scene_dir/render/`."""
    return render_many([dict(scene_dir=scene_dir, focus=focus, views=views, style=style, fix=fix, seed=seed,
                             width=width, out_dir=out_dir, tag=tag)])[0]


def render_fix(scene_dir: Path, focus: list[str], fix: Fix, views=FIX_VIEWS, style: str = "shaded",
               seed: int | None = None, width: int = 1024) -> list[View]:
    """Before/after pictures of a fix (the element translated): views named "before_A", "after_A" (add "before_C",
    "after_C" for the side view). Same camera, letters and colours in both, so they compare directly."""
    return render_scene(scene_dir, focus, views=views, style=style, fix=fix, seed=seed, width=width)
