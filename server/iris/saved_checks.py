"""Saved checks: what the shipped sample models measure, kept so their first check builds no geometry.

Detection is deterministic on one machine: the same files, measured by the same code under the same tests, give the
same clashes, whatever the threads. A cold or busy instance spent nearly all of a first check on Northbank building
geometry: the element boxes when the models open (`IfcScene.bounds`), then the triangle tree (`detect._tree`) and the
measures. So the samples carry what that geometry gave, in `samples/saved-checks/*.json`, made by this module:

- **boxes**: each file's element boxes, by the file's SHA-256, taken by a scene the workspace opens from that file
  unchanged (`IfcScene.bounds(saved=True)`, `add_files(saved=True)`);
- **checks**: each test's measurement (the hits and touches of its candidate pairs), under one key for the whole run:
  the files' hashes in order, every element box to the bit, every test's settings and candidate pairs, the offset,
  `detect.VERSION`, the IfcOpenShell version and the platform. Only a run of a scene with no kept edit (revision 0)
  looks (`detect.run(replay=True)`).

**Per platform.** The same files measure a little differently on another processor and build: Northbank's boxes on
linux/x86_64 differ from macOS/arm64's in the last bit for 12 elements, and the intersection query's depths and points
for some pairs differ by more (46 depths, 309 points). So everything is kept per platform (`PLATFORM`): linux-x86_64
for Cloud Run and CI, darwin-arm64 for development. Before a process first replays a check it measures a few of its
clashes again on its own processor (`probe`); a machine that measures them differently runs live.

Everything after the measurement is made live, as in any run: the rules, ids, #N, the diff against the last run, the
report and its coverage. So a replayed check is the run a live one would be, through the same stream events. Any
difference misses and runs live: another byte in a file, a kept edit or a model added or removed (the revision), a box
moved (a trial's move and back), another test or setting, other candidate pairs, another platform, or other code
(`detect.VERSION`, `BOXES_VERSION`, IfcOpenShell).

Make them again after any change to what detection measures or how boxes are made (bump `detect.VERSION` or
`BOXES_VERSION` first), from `server/`: `uv run python -m iris.saved_checks --docker` (this machine, then
linux/x86_64 in Docker; no AI). `tests/test_saved_checks.py` fails while the shipped file is stale.
"""
from __future__ import annotations

import hashlib
import json
import logging
import platform as _platform
import subprocess
import sys
import time
from pathlib import Path

import ifcopenshell
import numpy as np

log = logging.getLogger(__name__)

SAMPLES = Path(__file__).resolve().parents[2] / "samples"
FOLDER = SAMPLES / "saved-checks"
# How boxes are made (`IfcScene._measure`: settings, kernels, what is physical): bump it with any change there, so boxes
# saved by older code are never taken; then make the saved checks again.
BOXES_VERSION = 1
# The demo sets saved: the file name under FOLDER → the sample files, in the order the demo opens them (demos.py).
SETS = {"northbank": ("Northbank-Architecture.ifc", "Northbank-MEP.ifc", "Northbank-Site.ifc",
                      "Northbank-Structure.ifc")}
# Where saved checks are made: the deployed service and CI (Cloud Run is linux/x86_64), and development Macs.
PLATFORMS = ("linux-x86_64", "darwin-arm64")
PROBES = 8   # clashes a process measures again before it first replays a check

_digests: dict[tuple, str] = {}
_loaded: dict[str, tuple[tuple, dict]] = {}
_probed: dict[str, bool] = {}   # run key → whether this machine measured its probe the same


def platform_name() -> str:
    """This machine's platform as saved checks are kept: "linux-x86_64", "darwin-arm64", …"""
    machine = _platform.machine().lower()
    machine = {"amd64": "x86_64", "aarch64": "arm64"}.get(machine, machine)
    return f"{sys.platform}-{machine}"


PLATFORM = platform_name()


def digest(path: Path) -> str:
    """The file's SHA-256, kept while its size and time stay the same (a scene's files do not change on disk)."""
    st = path.stat()
    key = (str(path.resolve()), st.st_size, st.st_mtime_ns)
    if key not in _digests:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for block in iter(lambda: f.read(1 << 20), b""):
                h.update(block)
        if len(_digests) > 256:   # uploads come and go: keep it small
            _digests.clear()
        _digests[key] = h.hexdigest()
    return _digests[key]


def _data() -> dict:
    """Every saved file in FOLDER, merged: {"boxes": {box key: {gid: box}}, "checks": {run key: {probe, tests}}}. Read
    once, and again when a file there changes."""
    folder = Path(FOLDER)
    files = sorted(folder.glob("*.json")) if folder.is_dir() else []
    stamp = tuple((p.name, p.stat().st_mtime_ns, p.stat().st_size) for p in files)
    held = _loaded.get(str(folder))
    if held is not None and held[0] == stamp:
        return held[1]
    merged: dict = {"boxes": {}, "checks": {}}
    for p in files:
        try:
            doc = json.loads(p.read_text())
            merged["boxes"].update(doc.get("boxes") or {})
            merged["checks"].update(doc.get("checks") or {})
        except (OSError, ValueError, AttributeError):
            log.warning("saved checks: %s is unreadable; everything runs live", p.name)
    _loaded[str(folder)] = (stamp, merged)
    return merged


def _box_key(sha: str, big: bool, where: str | None = None) -> str:
    return (f"{sha}|big={int(big)}|boxes={BOXES_VERSION}|ifcopenshell={ifcopenshell.version}"
            f"|platform={where or PLATFORM}")


def boxes(path: Path, big: bool) -> dict[str, np.ndarray] | None:
    """The saved boxes of the file at `path` as opened unchanged (GlobalId → [[min], [max]], in model order), or None."""
    try:
        sha = digest(path)
    except OSError:
        return None
    got = _data()["boxes"].get(_box_key(sha, big))
    if got is None:
        return None
    try:
        return {g: np.array([b[:3], b[3:]], dtype=float).reshape(2, 3) for g, b in got.items()}
    except (TypeError, ValueError, AttributeError):   # a damaged entry: measure the file
        log.warning("saved checks: the boxes saved for %s are damaged; measuring them", path.name)
        return None


def _settings(test) -> dict:
    """What a test asks, without its name (words only): its id, kind, sides, tolerance, clearance, rules, size."""
    from dataclasses import asdict
    return {k: v for k, v in asdict(test).items() if k not in ("name", "enabled")}


def _boxes_digest(boxes: dict[str, np.ndarray]) -> str:
    """Every element box as it is now, to the bit: a move a trial made and undid can leave a box a rounding apart."""
    h = hashlib.sha256()
    for g, b in boxes.items():
        h.update(g.encode())
        h.update(np.asarray(b, dtype="<f8").tobytes())
    return h.hexdigest()


def run_key(scene, tests, pairs: dict[str, list[tuple[str, str]]], offset, where: str | None = None) -> str | None:
    """The key of one run's measurement (None when the scene has a kept edit or a file is gone): the files' hashes in
    order, every element box as it is now, every test's settings and candidate pairs, the offset, the code that
    measures and the platform. The pairs as a set (each as it is oriented): a test measures the same whatever order
    they come in, and the sweep's order of boxes that start together differs between machines (NumPy's sort)."""
    from . import detect
    if scene.revision != 0:
        return None
    try:
        files = [digest(p) for p in scene.paths]
    except OSError:
        return None
    what = {"detect": detect.VERSION, "boxes": BOXES_VERSION, "ifcopenshell": ifcopenshell.version,
            "platform": where or PLATFORM, "files": files, "box_bits": _boxes_digest(scene.bounds()),
            "offset": [float(x) for x in offset],
            "tests": [{"test": _settings(t), "pairs": sorted(list(p) for p in pairs[t.id])} for t in tests]}
    return hashlib.sha256(json.dumps(what, sort_keys=True).encode()).hexdigest()


def _hits(m: dict) -> dict:
    from . import detect
    return {frozenset((a, b)): detect._Hit(a, b, float(d), [float(x) for x in point]) for a, b, d, point in m["hits"]}


def find(scene, ix, tests, plans, offset) -> dict | None:
    """The saved measurement of this run, test id → (hits, touches) as `detect._measure` gives them, or None: every
    test or none, and only once this machine has measured the check's probe as it was saved."""
    checks = _data()["checks"]
    if not checks:
        return None
    key = run_key(scene, tests, {t.id: pairs for t, _, _, pairs in plans}, offset)
    saved = checks.get(key) if key is not None else None
    try:
        if saved is None or set(saved["tests"]) != {t.id for t in tests}:
            return None
        if key not in _probed:
            _probed[key] = probe(ix, {t.id: t for t in tests}, saved, offset)
            if not _probed[key]:
                log.warning("saved checks: this machine measures the saved check's probe differently; it runs live")
        if not _probed[key]:
            return None
        return {tid: (_hits(m), [(a, b) for a, b in m["touches"]]) for tid, m in saved["tests"].items()}
    except (KeyError, TypeError, ValueError, AttributeError):   # a damaged entry saves nothing: the run measures
        log.warning("saved checks: the saved check is damaged; it runs live")
        _probed[key] = False
        return None


def probe(ix, tests: dict, saved: dict, offset) -> bool:
    """Measure the saved check's probe again here (a few clashes the triangle queries measured, where machines differ
    most): True when every one comes out to the bit as saved."""
    from . import detect
    probes = [p for p in saved.get("probe") or [] if p[0] in tests and p[0] in saved["tests"]]
    if not probes:
        return True
    tree = detect._tree(ix, {g for _, a, b in probes for g in (a, b)}, np.asarray(offset, dtype=float))
    solids = detect._Solids(ix)
    for tid, a, b in probes:
        want = _hits(saved["tests"][tid]).get(frozenset((a, b)))
        got = detect._measure(ix, solids, tests[tid], [(a, b)], tree, np.asarray(offset, dtype=float))[0]
        have = got.get(frozenset((a, b)))
        if want is None or have is None or (have.distance_m, have.point) != (want.distance_m, want.point):
            return False
    return True


# ------------------------------------------------------------------------------------------------- making them

def make(name: str, files: tuple[str, ...], samples: Path = SAMPLES) -> dict:
    """Measure one demo set live on this machine and return what is saved for it here: each file's boxes, the default
    check's measurement and its probe."""
    from . import detect
    from .scene import IfcScene
    paths = [samples / f for f in files]
    scene = IfcScene(paths)
    big = scene.big()
    saved_boxes = {}
    for i, p in enumerate(paths):   # each file as `_measure` makes it (one file's boxes never depend on another's)
        got = scene._measure([i])
        saved_boxes[_box_key(digest(p), big)] = {g: [float(x) for x in b.ravel()] for g, b in got.items()}
    measured: dict = {}
    t = time.perf_counter()
    live = detect.run(scene, measured=measured)
    seconds = time.perf_counter() - t
    ix = detect._Index(scene)
    tests = [t for t in detect.default_tests(scene, ix) if t.enabled]
    key = run_key(scene, tests, {tid: m[0] for tid, m in measured.items()}, live.offset)
    if key is None:
        raise RuntimeError("a fresh scene has no key")
    # The probe: hits the triangle queries measured (their point is not the boxes' middle), spread over the tests.
    queried = sorted((tid, h.a, h.b) for tid, (_, hits, _) in measured.items() for h in hits.values()
                     if h.point != detect._box_point(ix, h.a, h.b))
    probes = [list(queried[k * len(queried) // PROBES]) for k in range(min(PROBES, len(queried)))]
    entry = {"platform": PLATFORM, "probe": probes,
             "tests": {tid: {"hits": sorted([h.a, h.b, h.distance_m, h.point] for h in hits.values()),
                             "touches": [list(p) for p in touches]}
                       for tid, (_, hits, touches) in measured.items()}}
    if not probe(ix, {t.id: t for t in tests}, entry, live.offset):
        raise RuntimeError("the probe measures differently from the run it was taken from")
    return {"made": {"detect": detect.VERSION, "boxes": BOXES_VERSION, "ifcopenshell": ifcopenshell.version,
                     "files": {f: digest(p) for f, p in zip(files, paths)},
                     "live": {"clashes": len(live.report.clashes), "elements": live.elements,
                              "seconds": round(seconds, 2)}},
            "boxes": saved_boxes, "checks": {key: entry}}


def merge(path: Path, name: str, made: dict) -> dict:
    """The saved file at `path` with this platform's part replaced by `made` (other platforms' parts kept)."""
    try:
        doc = json.loads(path.read_text())
    except (OSError, ValueError):
        doc = {}
    mine = f"|platform={PLATFORM}"
    return {"about": f"Saved check of the {name} sample models, per platform (server/iris/saved_checks.py). "
                     "Generated by `uv run python -m iris.saved_checks --docker` from server/; do not edit by hand.",
            "platforms": {**{k: v for k, v in (doc.get("platforms") or {}).items() if k != PLATFORM},
                          PLATFORM: made["made"]},
            "boxes": {**{k: v for k, v in (doc.get("boxes") or {}).items() if not k.endswith(mine)}, **made["boxes"]},
            "checks": {**{k: v for k, v in (doc.get("checks") or {}).items() if v.get("platform") != PLATFORM},
                       **made["checks"]}}


def write(doc: dict, path: Path) -> None:
    """One box per line, the checks indented, so a regenerated file diffs readably."""
    lines = ["{", f'"about": {json.dumps(doc["about"])},', f'"platforms": {json.dumps(doc["platforms"], sort_keys=True)},',
             '"boxes": {']
    keys = sorted(doc["boxes"])
    for n, bk in enumerate(keys):
        bs = doc["boxes"][bk]
        lines.append(f"  {json.dumps(bk)}: {{")
        lines += [f"    {json.dumps(g)}: {json.dumps(b)}" + ("," if j < len(bs) - 1 else "")
                  for j, (g, b) in enumerate(bs.items())]
        lines.append("  }" + ("," if n < len(keys) - 1 else ""))
    lines.append("},")
    lines.append(f'"checks": {json.dumps(doc["checks"], sort_keys=True, indent=1)}')
    lines.append("}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n")


def docker_command() -> list[str]:
    """This module run in linux/x86_64 (Cloud Run's platform) under Docker, with this machine's IfcOpenShell and NumPy,
    writing into the same folder."""
    import defusedxml
    root = Path(__file__).resolve().parents[2]
    pins = [f"ifcopenshell=={ifcopenshell.version}", f"numpy=={np.__version__}", f"defusedxml=={defusedxml.__version__}"]
    return ["docker", "run", "--rm", "--platform", "linux/amd64", "-v", f"{root / 'server' / 'iris'}:/src/server/iris:ro",
            "-v", f"{SAMPLES}:/src/samples", "-w", "/src/server", "-e", "PYTHONPATH=/src/server",
            "python:3.13-slim-bookworm", "sh", "-c",
            f"pip install -q --root-user-action=ignore {' '.join(pins)} && python -m iris.saved_checks"]


def main(argv: list[str]) -> int:
    if argv and argv[0] not in ("--docker",):
        print("usage: python -m iris.saved_checks [--docker]   (--docker: then linux/x86_64 too, in Docker)")
        return 2
    for name, files in SETS.items():
        if not all((SAMPLES / f).exists() for f in files):
            print(f"{name}: sample files missing, skipped")
            continue
        made = make(name, files)
        path = Path(FOLDER) / f"{name}.json"
        write(merge(path, name, made), path)
        live = made["made"]["live"]
        print(f"{name} on {PLATFORM}: {live['clashes']} clashes in {live['elements']} elements "
              f"({live['seconds']} s live) → {path}")
    if argv and PLATFORM != "linux-x86_64":
        print("linux/x86_64, in Docker…")
        return subprocess.call(docker_command())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
