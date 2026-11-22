"""Saved checks (server/iris/saved_checks.py, docs/detection.md): an unchanged sample's measurement is replayed, and the
run is the live run in every way the rest of Iris reads; any difference runs live."""
import json
import shutil
from dataclasses import asdict, replace
from pathlib import Path

import ifcopenshell
import numpy as np
import pytest

from iris import detect, plans, saved_checks, triage
from iris.fixtures import build_detection_fixtures
from iris.scene import IfcScene
from iris.service import Workspace

NORTHBANK = saved_checks.SETS["northbank"]
SHIPPED = saved_checks.FOLDER / "northbank.json"
REGENERATE = "stale: run `uv run python -m iris.saved_checks --docker` from server/ and commit samples/saved-checks/"


@pytest.fixture(scope="module")
def saved(tmp_path_factory):
    """The detection fixtures as samples, with a saved check of their own: (models folder, saved folder, names)."""
    root = tmp_path_factory.mktemp("saved-checks")
    paths = build_detection_fixtures(root / "models")
    names = tuple(p.name for p in paths)
    path = root / "saved" / "fixture.json"
    saved_checks.write(saved_checks.merge(path, "fixture", saved_checks.make("fixture", names, samples=root / "models")),
                       path)
    (root / "none").mkdir()
    return root / "models", root / "saved", names


class _Probed(dict):
    pass


def _open(models: Path, names, folder: Path, monkeypatch) -> tuple[Workspace, str]:
    """A workspace that reads saved checks from `folder` (an empty one: it measures everything)."""
    monkeypatch.setattr(saved_checks, "FOLDER", folder)
    if not isinstance(saved_checks._probed, _Probed):   # what this test's probes found, forgotten after it
        monkeypatch.setattr(saved_checks, "_probed", _Probed())
    ws = Workspace(samples=models)
    ws.saved_folder = folder
    return ws, ws.open(list(names))


def _detect(ws: Workspace, sid: str, tests=None) -> tuple[dict, list[dict]]:
    events: list[dict] = []
    saved_checks.FOLDER = ws.saved_folder   # this workspace's (monkeypatch, in `_open`, puts the real one back)
    return ws.detect(sid, tests, on_event=events.append), events


def _plain(x):
    """What a run says, without the clock, the scene's id or the report's new id."""
    if isinstance(x, dict):
        skip = {"seconds", "ran_at", "scene_id"} | ({"id"} if "serial" in x else set())
        return {k: _plain(v) for k, v in x.items() if k not in skip}
    if isinstance(x, list):
        return [_plain(v) for v in x]
    return x


def _same_run(ws_live, sid_live, live, ws_saved, sid_saved, replayed) -> None:
    """The replayed run is the live one: report (ids, #N, names, measures, statuses), coverage, diff, kept checks,
    contacts, triage's input and Insights."""
    assert replayed["saved"] is True and live["saved"] is False
    for k in ("report", "check", "ran", "checks", "coverage", "diff", "elements", "offset", "requirements", "tests"):
        assert _plain(replayed[k]) == _plain(live[k]), k
    a, b = ws_live.report(live["report"]["id"]), ws_saved.report(replayed["report"]["id"])
    assert [(c.id, c.number) for c in a.clashes] == [(c.id, c.number) for c in b.clashes]
    assert [triage.describe(c) for c in a.clashes] == [triage.describe(c) for c in b.clashes]
    assert [triage.by_rule(c) for c in a.clashes] == [triage.by_rule(c) for c in b.clashes]
    assert ([[c.id for c in g] for g in triage.alike_groups(a.clashes)]
            == [[c.id for c in g] for g in triage.alike_groups(b.clashes)])
    assert sorted(map(sorted, ws_live.checks[sid_live].contacts())) == \
        sorted(map(sorted, ws_saved.checks[sid_saved].contacts()))
    assert plans.patterns(ws_live, sid_live, a.id) == plans.patterns(ws_saved, sid_saved, b.id)
    assert plans.root_causes(ws_live, sid_live, a.id) == plans.root_causes(ws_saved, sid_saved, b.id)


def _same_events(live: list[dict], replayed: list[dict]) -> None:
    """The same stream: every event in order, the phase that builds geometry worded for the saved one."""
    assert [e["type"] for e in live] == [e["type"] for e in replayed]
    for x, y in zip(live, replayed):
        if x["type"] == "phase":
            assert x["text"] == y["text"] or (x["text"].startswith("Building geometry for ")
                                              and y["text"].startswith("Unchanged sample models: taking the saved"))
        else:
            assert _plain(x) == _plain(y)


def test_a_replayed_check_is_the_live_check(saved, monkeypatch):
    models, folder, names = saved
    ws_live, sid_live = _open(models, names, folder.parent / "none", monkeypatch)
    live, live_events = _detect(ws_live, sid_live)
    ws_saved, sid_saved = _open(models, names, folder, monkeypatch)
    replayed, replayed_events = _detect(ws_saved, sid_saved)
    assert live["report"]["clashes"], "the fixture has clashes to compare"
    _same_run(ws_live, sid_live, live, ws_saved, sid_saved, replayed)
    _same_events(live_events, replayed_events)
    # Again: the same ids and numbers, now active, and still replayed.
    again_live, _ = _detect(ws_live, sid_live)
    again, _ = _detect(ws_saved, sid_saved)
    _same_run(ws_live, sid_live, again_live, ws_saved, sid_saved, again)
    assert {c["status"] for c in again["report"]["clashes"]} == {"active"}
    # A check on filters next to it is kept with it, as after a live run (it has nothing saved: it measures).
    ducts = [{"a": {"classes": ["IfcDuctSegment"]}, "b": {}}]
    check_live, _ = _detect(ws_live, sid_live, ducts)
    check, _ = _detect(ws_saved, sid_saved, ducts)
    assert check["saved"] is False and check_live["saved"] is False
    for k in ("report", "checks", "coverage", "diff"):
        assert _plain(check[k]) == _plain(check_live[k]), k
    assert [c["key"] for c in check["checks"]] == ["models", check["check"]]


def test_the_saved_boxes_are_the_measured_boxes(saved, monkeypatch):
    models, folder, names = saved
    monkeypatch.setattr(saved_checks, "FOLDER", folder)
    paths = [models / n for n in names]
    measured = IfcScene(paths).bounds()
    taken = IfcScene(paths).bounds(saved=True)
    assert list(taken) == list(measured)
    assert all(np.array_equal(taken[g], measured[g]) for g in measured)
    # Added to an open scene, a file takes its saved boxes too.
    one = IfcScene(paths[:1])
    one.bounds(saved=True)
    one.add_files(paths[1:], saved=True)
    assert list(one.bounds()) == list(measured) and all(np.array_equal(one.bounds()[g], measured[g]) for g in measured)
    # Only when asked: a scene that may have been changed before its first boxes measures them.
    monkeypatch.setattr(saved_checks, "boxes", lambda *a: pytest.fail("saved boxes taken unasked"))
    assert list(IfcScene(paths).bounds()) == list(measured)


def test_a_kept_edit_a_moved_box_or_other_settings_run_live(saved, monkeypatch):
    models, folder, names = saved
    ws, sid = _open(models, names, folder, monkeypatch)
    scene = ws.scene(sid)
    tests = [t for t in detect.default_tests(scene) if t.enabled]
    assert detect.run(scene, tests, replay=True).saved
    assert not detect.run(scene, tests).saved, "a direct run measures unless it asks"
    # Another tolerance, a rule switched off, another clearance or one test fewer: live.
    for changed in ([replace(tests[0], tolerance_m=0.002), *tests[1:]],
                    [replace(tests[0], rules={**tests[0].rules, "connected": False}), *tests[1:]],
                    [replace(tests[0], kind="clearance", clearance_m=0.025), *tests[1:]],
                    tests[1:]):
        run = detect.run(scene, changed, replay=True)
        assert not run.saved
        assert _plain(asdict(run.report)["clashes"]) == _plain(asdict(detect.run(scene, changed).report)["clashes"])
    # Other code: another measure, box maker or IfcOpenShell.
    for module, name, value in ((detect, "VERSION", detect.VERSION + 1),
                                (saved_checks, "BOXES_VERSION", saved_checks.BOXES_VERSION + 1),
                                (ifcopenshell, "version", "0.0.0")):
        with monkeypatch.context() as m:
            m.setattr(module, name, value)
            assert not detect.run(scene, tests, replay=True).saved, name
    # A box moved and not (yet) back, as in a trial: live, even before any edit is kept.
    duct = next(g for g in scene.bounds() if scene.entity(g).Name == "Pipe P3 under beam")
    scene.translate([duct], (0.0, 0.0, -0.3))
    assert scene.revision == 0 and not detect.run(scene, tests, replay=True).saved
    scene.translate([duct], (0.0, 0.0, 0.3))
    # A kept edit: live from then on, and what it measures is what a direct run measures.
    ws.apply(sid, [duct], [0.0, 0.0, -0.3])
    after, _ = _detect(ws, sid)
    assert after["saved"] is False
    assert len(after["report"]["clashes"]) == len(detect.run(scene).report.clashes)


def test_a_file_with_another_byte_runs_live(saved, tmp_path, monkeypatch):
    models, folder, names = saved
    for n in names:
        shutil.copy(models / n, tmp_path / n)
    with open(tmp_path / names[-1], "a") as f:
        f.write("\n")   # the same model, one byte more: another hash
    ws, sid = _open(tmp_path, names, folder, monkeypatch)
    out, _ = _detect(ws, sid)
    assert out["saved"] is False
    ws_live, sid_live = _open(models, names, folder.parent / "none", monkeypatch)
    live, _ = _detect(ws_live, sid_live)
    assert _plain(out["report"]["clashes"]) == _plain(live["report"]["clashes"])


def test_a_damaged_saved_file_saves_nothing(saved, tmp_path, monkeypatch):
    models, folder, names = saved
    (tmp_path / "broken.json").write_text("{not json")
    ws, sid = _open(models, names, tmp_path, monkeypatch)
    out, _ = _detect(ws, sid)
    assert out["saved"] is False and out["report"]["clashes"]
    # Damaged entries under the right keys: the boxes are measured and the check runs live, nothing breaks.
    doc = json.loads((folder / "fixture.json").read_text())
    doc["boxes"] = {k: {g: [1.0] for g in v} for k, v in doc["boxes"].items()}
    doc["checks"] = {k: {**v, "tests": {t: {"hits": [["x"]], "touches": 5} for t in v["tests"]}}
                     for k, v in doc["checks"].items()}
    (tmp_path / "broken.json").write_text(json.dumps(doc))
    ws, sid = _open(models, names, tmp_path, monkeypatch)
    out, _ = _detect(ws, sid)
    assert out["saved"] is False
    assert _plain(out["report"]["clashes"]) == _plain(_detect(*_open(models, names, folder.parent / "none",
                                                                     monkeypatch))[0]["report"]["clashes"])


# ------------------------------------------------------------------------------------------------- the shipped file

needs_samples = pytest.mark.skipif(not all((saved_checks.SAMPLES / f).exists() for f in NORTHBANK),
                                   reason="the Northbank samples are not here")


@needs_samples
def test_the_shipped_saved_check_is_current():
    """Made by this code from these samples, for Cloud Run's platform (and CI's) and for development Macs."""
    doc = json.loads(SHIPPED.read_text())
    files = {f: saved_checks.digest(saved_checks.SAMPLES / f) for f in NORTHBANK}
    assert set(doc["platforms"]) == set(saved_checks.PLATFORMS), REGENERATE
    for where, made in doc["platforms"].items():
        assert {k: made[k] for k in ("detect", "boxes", "ifcopenshell")} == {
            "detect": detect.VERSION, "boxes": saved_checks.BOXES_VERSION, "ifcopenshell": ifcopenshell.version}, \
            f"{where}: {REGENERATE}"
        assert made["files"] == files, f"{where}: {REGENERATE}"
        assert sum(k.endswith(f"|platform={where}") for k in doc["boxes"]) == len(NORTHBANK)
        assert [c["platform"] for c in doc["checks"].values()].count(where) == 1
        assert all(len(c["probe"]) == saved_checks.PROBES for c in doc["checks"].values())


@needs_samples
def test_northbank_replays_its_live_check(tmp_path, monkeypatch):
    """The demo's first check, replayed, is the live check: every clash, #N and measure, the coverage and the rest."""
    ws_live, sid_live = _open(saved_checks.SAMPLES, NORTHBANK, tmp_path, monkeypatch)
    live, live_events = _detect(ws_live, sid_live)
    ws_saved, sid_saved = _open(saved_checks.SAMPLES, NORTHBANK, SHIPPED.parent, monkeypatch)
    replayed, replayed_events = _detect(ws_saved, sid_saved)
    if saved_checks.PLATFORM not in saved_checks.PLATFORMS or False in saved_checks._probed.values():
        assert not replayed["saved"]
        pytest.skip(f"{saved_checks.PLATFORM} measures differently from the saved check's platform: it runs live")
    assert replayed["saved"], REGENERATE
    assert len(replayed["report"]["clashes"]) == 464 and replayed["elements"] == 1732
    _same_run(ws_live, sid_live, live, ws_saved, sid_saved, replayed)
    _same_events(live_events, replayed_events)
