"""Projects (projects.py, docs/engineer-workflow.md): kept on disk, opened again with their edits, clash numbers,
titles, decisions, reviews and reports; private by unguessable id; written atomically; capped."""
import hashlib
import json
import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

from iris import app as app_module
from iris import owner, projects
from iris.fixtures import build_clash_fixture
from iris.service import SAMPLES, Workspace

PAIR = ["Northbank-Structure.ifc", "Northbank-MEP.ifc"]
DUCT, TRAY, GIRDER = "2AbvqKF25LGeR0M34N_jld", "3tQ7zxxRDMefPXL6hbHmO2", "1eVHoPtl1IhAbbhivqVqb0"
DOC = "a" * 32


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("IRIS_PROJECTS_DIR", str(tmp_path / "projects"))
    monkeypatch.delenv("IRIS_PROJECTS_MAX", raising=False)
    monkeypatch.setattr(app_module, "EXPORTS", tmp_path)
    return tmp_path / "projects"


def _client(monkeypatch, ws: Workspace) -> TestClient:
    monkeypatch.setattr(app_module, "ws", ws)
    return TestClient(app_module.app)


def _sha(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _cid(ws: Workspace, sid: str, a: str, b: str) -> str:
    return next(cid for cid, was in ws.checks[sid].ids.items() if {was["a"], was["b"]} == {a, b})


def _row(report: dict, a: str, b: str) -> dict:
    return next(c for c in report["clashes"] if {c["a"]["global_id"], c["b"]["global_id"]} == {a, b})


def test_a_project_keeps_a_demo_set_its_edits_numbers_titles_decisions_reviews_and_reports(store, monkeypatch):
    ws = Workspace()
    c = _client(monkeypatch, ws)
    sid = c.post("/api/scenes", json={"samples": PAIR}).json()["id"]
    ws.detect(sid)
    # A number that drifted from what a fresh detection would give, and a model-written title.
    tray = _cid(ws, sid, TRAY, GIRDER)
    ws.checks[sid].numbers[tray] = 777
    ws.checks[sid].keep_titles({tray: "Cable tray through the L02 transfer girder"})
    scene = ws.scene(sid)
    with ws.journal(sid).record(scene, "you", "move", title="Raise the supply main"):
        ws.apply(sid, [DUCT], [0.0, 0.0, 0.4])
    raised = scene.bounds()[DUCT].copy()
    decision = {"clash_id": tray, "clash_key": projects.clash_key("hard", TRAY, GIRDER), "number": 777,
                "option": {"title": "Drop the tray", "kind": "move", "moved": [TRAY], "delta_m": [0, 0, -0.5]},
                "state": "failed_validation", "decision": "requested_another", "reason": "hits the slab",
                "reviewer": "Priya"}
    assert c.post(f"/api/scenes/{sid}/decisions", json=decision).status_code == 200

    p = c.post("/api/projects", json={"name": "Northbank tower"}).json()
    pid = p["id"]
    assert projects.ID.fullmatch(pid) and p["files"] == [] and p["scene_id"] is None and p["counts"] is None

    # Attach: the originals (not the edit), each with its size and hash.
    p = c.post(f"/api/projects/{pid}/attach", json={"scene_id": sid}).json()
    assert [f["name"] for f in p["files"]] == PAIR and {f["kind"] for f in p["files"]} == {"IFC"}
    for f in p["files"]:
        assert f["sha256"] == _sha(SAMPLES / f["name"]) and f["size"] == (SAMPLES / f["name"]).stat().st_size
        assert _sha(store / pid / "models" / f["name"]) == f["sha256"]
    assert p["scene_id"] == sid

    key = projects.clash_key("hard", TRAY, GIRDER)
    assert key == f"hard|{'|'.join(sorted([TRAY, GIRDER]))}"
    p = c.put(f"/api/projects/{pid}/reviews", json={"key": key, "status": "author", "note": "tray team to drop it",
                                                     "by": "Priya", "number": 777}).json()
    assert p["reviews"][key]["status"] == "author" and p["reviews"][key]["number"] == 777
    assert c.put(f"/api/projects/{pid}/reviews", json={"key": key, "status": "maybe"}).status_code == 422

    # Save: every model as it is now, the edit log, the decisions and what each clash keeps.
    p = c.post(f"/api/projects/{pid}/save", json={"scene_id": sid}).json()
    [saved] = p["saved"]
    assert saved["n"] == 1 and saved["files"] == PAIR and saved["edits"] == 1
    folder = store / pid / "saved" / "1"
    assert _sha(folder / "Northbank-Structure.ifc") == _sha(SAMPLES / "Northbank-Structure.ifc")
    assert _sha(folder / "Northbank-MEP.ifc") != _sha(SAMPLES / "Northbank-MEP.ifc")   # the edit
    state = json.loads((folder / "state.json").read_text())
    assert len(state["entries"]) == 1 and state["decisions"][0]["decision"] == "requested_another"
    assert state["entries"][0]["session"] == sid   # E-ids start again each session: saved ones carry theirs
    assert state["clashes"][tray]["number"] == 777 and state["clashes"][tray]["key"] == key
    assert not [x for x in (store / pid).rglob("*") if x.name.endswith(".tmp") or x.name.startswith(".")]

    # The server lets every scene go (eviction): the project's files stay.
    ws.max_scenes = 1
    ws._evict(0)
    assert sid not in ws.scenes and (folder / "Northbank-MEP.ifc").is_file()

    # Open: the saved state, in a folder of the scene's own; numbers, titles, decisions and history come back.
    r = c.post(f"/api/projects/{pid}/open").json()
    sid2 = r["scene_id"]
    assert sid2 != sid and r["project"]["scene_id"] == sid2 and r["scene"]["files"] == PAIR
    assert all(not root.resolve().is_relative_to(store.resolve()) for root in ws._roots[sid2])
    assert np.allclose(ws.scene(sid2).bounds()[DUCT], raised)
    assert ws.checks[sid2].numbers[tray] == 777
    edits = c.get(f"/api/scenes/{sid2}/edits").json()
    assert edits["decisions"][0]["reviewer"] == "Priya" and edits["entries"] == []   # undo starts from here
    assert len(ws.journal(sid2).earlier) == 1
    report = ws.detect(sid2)["report"]
    row = _row(report, TRAY, GIRDER)
    assert row["id"] == tray and row["number"] == 777 and row["title"] == "Cable tray through the L02 transfer girder"
    assert max(c_["number"] for c_ in report["clashes"]) > 777   # new numbers go on after the highest kept

    # A second save carries the earlier history forward.
    p = c.post(f"/api/projects/{pid}/save", json={"scene_id": sid2}).json()
    assert [s["n"] for s in p["saved"]] == [1, 2] and p["saved"][1]["edits"] == 1
    again = json.loads((store / pid / "saved" / "2" / "state.json").read_text())
    assert [e["session"] for e in again["entries"]] == [sid]   # the earlier session's, not the one that saved it

    # Reports: copied from the server's documents while it holds them, then served from the project.
    monkeypatch.setitem(app_module._documents, DOC, (b"%PDF-1.4 a report", "iris-report.pdf", "application/pdf"))
    p = c.post(f"/api/projects/{pid}/reports", json={"doc_id": f"/api/documents/{DOC}", "name": "iris-report.pdf",
                                                      "kind": "pdf"}).json()
    assert [(x["doc_id"], x["name"], x["kind"]) for x in p["reports"]] == [(DOC, "iris-report.pdf", "pdf")]
    got = c.get(f"/api/projects/{pid}/reports/{DOC}")
    assert got.status_code == 200 and got.content == b"%PDF-1.4 a report"
    assert c.post(f"/api/projects/{pid}/reports", json={"doc_id": "b" * 32, "name": "x.pdf",
                                                         "kind": "pdf"}).status_code == 404   # expired
    assert c.post(f"/api/projects/{pid}/reports", json={"doc_id": DOC, "name": "x", "kind": "docx"}).status_code == 422

    # Rename and the page's counts.
    p = c.patch(f"/api/projects/{pid}", json={"name": "Northbank", "counts": {"clashes": 452, "open": 450,
                                                                              "resolved": 1, "reviewed": 1}}).json()
    assert p["name"] == "Northbank" and p["counts"]["clashes"] == 452 and len(p["reviews"]) == 1
    assert c.patch(f"/api/projects/{pid}", json={"counts": {"clashes": -1}}).status_code == 400
    assert c.patch(f"/api/projects/{pid}", json={"name": "Again"}).json()["counts"]["open"] == 450   # kept
    assert c.get(f"/api/projects/{pid}").json()["name"] == "Again"


def test_opening_from_the_originals_seeds_numbers_and_titles_from_the_reviews(store, monkeypatch):
    ws = Workspace()
    c = _client(monkeypatch, ws)
    sid = c.post("/api/scenes", json={"samples": PAIR}).json()["id"]
    pid = c.post("/api/projects", json={"name": "Northbank"}).json()["id"]
    c.post(f"/api/projects/{pid}/attach", json={"scene_id": sid})
    key = projects.clash_key("hard", GIRDER, TRAY)
    c.put(f"/api/projects/{pid}/reviews", json={"key": key, "status": "by_design", "number": 900,
                                                "title": "Tray through the girder"})
    sid2 = c.post(f"/api/projects/{pid}/open").json()["scene_id"]
    assert ws.scene(sid2).bounds()[DUCT] is not None and not ws.scene(sid2)._edited
    row = _row(ws.detect(sid2)["report"], TRAY, GIRDER)
    assert row["number"] == 900 and row["title"] == "Tray through the girder"


def test_projects_are_listed_only_by_id_except_for_the_owner(store, tmp_path, monkeypatch):
    c = _client(monkeypatch, Workspace(samples=tmp_path))
    a = c.post("/api/projects", json={"name": "A"}).json()["id"]
    b = c.post("/api/projects", json={"name": "B"}).json()["id"]
    assert c.get("/api/projects").status_code == 403
    listed = c.get(f"/api/projects?ids={a},{'f' * 24},../../etc,{a}").json()
    assert [p["id"] for p in listed] == [a]
    assert c.get("/api/projects?ids=").json() == []
    for bad in ("..%2F..%2Fetc", "A" * 24, a[:-1], "x"):
        assert c.get(f"/api/projects/{bad}").status_code == 404
    with pytest.raises(projects.NotFound):
        projects.get("../" + a)
    monkeypatch.setenv("IRIS_OWNER_TOKEN", "x" * 40)
    boss = TestClient(app_module.app, base_url="https://testserver")
    boss.cookies.set(owner.COOKIE, owner.cookie_value())
    assert {p["id"] for p in boss.get("/api/projects").json()} == {a, b}
    assert c.post("/api/projects", json={"name": ""}).status_code == 422
    assert c.post("/api/projects", json={"name": "x" * 500}).status_code == 422


def test_projects_are_capped(store, tmp_path, monkeypatch):
    monkeypatch.setenv("IRIS_PROJECTS_MAX", "2")
    c = _client(monkeypatch, Workspace(samples=tmp_path))
    assert c.post("/api/projects", json={"name": "one"}).status_code == 200
    assert c.post("/api/projects", json={"name": "two"}).status_code == 200
    r = c.post("/api/projects", json={"name": "three"})
    assert r.status_code == 409 and "2 projects" in r.json()["detail"]
    assert len(list(store.iterdir())) == 2


def test_writes_are_atomic(store, tmp_path, monkeypatch):
    build_clash_fixture(tmp_path / "fixture-clash.ifc")
    ws = Workspace(samples=tmp_path)
    c = _client(monkeypatch, ws)
    sid = c.post("/api/scenes", json={"samples": ["fixture-clash.ifc"]}).json()["id"]
    pid = c.post("/api/projects", json={"name": "Before"}).json()["id"]
    c.post(f"/api/projects/{pid}/attach", json={"scene_id": sid})
    before = (store / pid / "project.json").read_bytes()

    def fail(src, dest):
        raise OSError("disk full")
    with monkeypatch.context() as m:
        m.setattr(projects.os, "replace", fail)
        with pytest.raises(OSError):
            projects.patch(pid, name="After")
        with pytest.raises(OSError):
            projects.save(ws, pid, sid)
    # The project as it was, no half-written file or folder left behind.
    assert (store / pid / "project.json").read_bytes() == before
    assert not [x for x in (store / pid).rglob("*") if x.name.startswith(".")]
    assert not (store / pid / "saved" / "1").exists() and json.loads(before)["saved"] == []


def test_a_step_model_is_kept_as_step(store, tmp_path, monkeypatch):
    from test_step import write_step
    src = write_step(tmp_path / "Test-cell.step")
    ws = Workspace(samples=tmp_path)
    c = _client(monkeypatch, ws)
    sid = c.post("/api/scenes", json={"samples": ["Test-cell.step"]}).json()["id"]
    pid = c.post("/api/projects", json={"name": "Cell"}).json()["id"]
    p = c.post(f"/api/projects/{pid}/attach", json={"scene_id": sid}).json()
    assert p["files"] == [{"name": "Test-cell.step", "kind": "STEP", "size": src.stat().st_size, "sha256": _sha(src)}]
    scene = ws.scene(sid)
    run = scene.connected_run({scene.entity(g).Name: g for g in scene.bounds()}["Ladder run 1"])
    ws.apply(sid, run, (0.0, 0.0, 1.5))
    c.post(f"/api/projects/{pid}/save", json={"scene_id": sid})
    saved = store / pid / "saved" / "1" / "Test-cell.step"
    assert saved.read_bytes().startswith(b"ISO-10303-21") and _sha(saved) != _sha(src)
    r = c.post(f"/api/projects/{pid}/open").json()
    assert r["scene"]["step"] == {"0": "Test-cell.step"}
    again = ws.scene(r["scene_id"])
    ladder = {again.entity(g).Name: g for g in again.bounds()}["Ladder run 1"]
    first = {scene.entity(g).Name: g for g in scene.bounds()}["Ladder run 1"]
    assert again.bounds()[ladder][0][2] == pytest.approx(scene.bounds()[first][0][2], abs=1e-3)   # raised 1.5 m


def test_opening_a_project_with_nothing_attached_says_so(store, tmp_path, monkeypatch):
    c = _client(monkeypatch, Workspace(samples=tmp_path))
    pid = c.post("/api/projects", json={"name": "Empty"}).json()["id"]
    assert c.post(f"/api/projects/{pid}/open").status_code == 409
    assert c.post(f"/api/projects/{pid}/attach", json={"scene_id": "0123456789ab"}).status_code == 404
    assert c.post(f"/api/projects/{'0' * 24}/open").status_code == 404


def test_a_report_for_a_project_names_it_and_reads_its_saved_decisions_when_no_log_is_live(store, tmp_path,
                                                                                         monkeypatch):
    build_clash_fixture(tmp_path / "fixture-clash.ifc")
    ws = Workspace(samples=tmp_path)
    c = _client(monkeypatch, ws)
    sid = c.post("/api/scenes", json={"samples": ["fixture-clash.ifc"]}).json()["id"]
    rid = ws.detect(sid)["report"]["id"]
    clashes = ws.report(rid).clashes
    decision = {"clash_id": clashes[0].id, "clash_key": "hard|A|B", "decision": "rejected", "state": "unverified",
                "option": {"title": "Drop the duct", "kind": "move", "moved": ["A"]}, "reviewer": "Priya"}
    assert c.post(f"/api/scenes/{sid}/decisions", json=decision).status_code == 200
    pid = c.post("/api/projects", json={"name": "Northbank tower"}).json()["id"]
    c.post(f"/api/projects/{pid}/attach", json={"scene_id": sid})
    c.post(f"/api/projects/{pid}/save", json={"scene_id": sid})
    assert projects.saved_decisions(pid)[0]["reviewer"] == "Priya"

    seen: list[dict] = []

    def generate(report, verdicts, model, **kw):
        seen.append(kw)
        return b"%PDF-1.7", "iris-report.pdf", "application/pdf"
    monkeypatch.setattr(app_module.document, "generate", generate)
    monkeypatch.setattr(app_module, "_take", lambda limit, request: None)
    url = f"/api/reports/{rid}/document/stream"
    triage = {x.id: {"verdict": "real_clash", "severity": "high"} for x in clashes}

    # The scene is open: the project's name on the cover, the decisions from its live edit log.
    assert '"ready"' in c.post(url, json={"scene_id": sid, "triage": triage, "project_id": pid}).text
    assert seen[-1]["project_name"] == "Northbank tower" and seen[-1]["decisions"] is None
    assert seen[-1]["journal"] is ws.journals[sid]
    # No live edit log (the scene went with a restart or an eviction): the newest saved state's decisions.
    assert '"ready"' in c.post(url, json={"scene_id": "0123456789ab", "triage": triage, "project_id": pid}).text
    assert seen[-1]["journal"] is None and [d["reviewer"] for d in seen[-1]["decisions"]] == ["Priya"]
    # Without a project: no name, nothing read from disk.
    c.post(url, json={"triage": triage})
    assert seen[-1]["project_name"] is None and seen[-1]["decisions"] is None
    for bad in ("f" * 24, "../" + pid):
        r = c.post(url, json={"scene_id": sid, "triage": triage, "project_id": bad})
        assert r.status_code == 404 and r.json()["detail"] == "No such project."
    assert len(seen) == 3


def test_a_report_builds_without_triage_and_keeps_the_accepted_fix(store, tmp_path, monkeypatch):
    # Triage is optional (no run, no verdicts from the page): the route builds, and the fix goes to the report.
    build_clash_fixture(tmp_path / "fixture-clash.ifc")
    ws = Workspace(samples=tmp_path)
    c = _client(monkeypatch, ws)
    sid = c.post("/api/scenes", json={"samples": ["fixture-clash.ifc"]}).json()["id"]
    rid = ws.detect(sid)["report"]["id"]
    first = ws.report(rid).clashes[0]
    seen: list[tuple] = []

    def generate(report, verdicts, model, **kw):
        seen.append((verdicts, kw))
        return b"%PDF-1.7", "iris-report.pdf", "application/pdf"
    monkeypatch.setattr(app_module.document, "generate", generate)
    monkeypatch.setattr(app_module, "_take", lambda limit, request: None)
    evidence = {first.id: {"status": "accepted", "title": "Raise the duct"}}
    r = c.post(f"/api/reports/{rid}/document/stream", json={"scene_id": sid, "evidence": evidence})
    assert r.status_code == 200 and '"ready"' in r.text
    verdicts, kw = seen[-1]
    assert verdicts == {} and kw["evidence"] == evidence

