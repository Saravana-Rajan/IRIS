import pytest
from fastapi.testclient import TestClient

from iris import app as app_module
from iris.fixtures import build_clash_fixture
from iris.service import Workspace


def test_open_verify_apply_export(tmp_path, monkeypatch):
    build_clash_fixture(tmp_path / "fixture-clash.ifc")
    monkeypatch.setattr(app_module, "ws", Workspace(samples=tmp_path))
    monkeypatch.setattr(app_module, "EXPORTS", tmp_path)
    c = TestClient(app_module.app)

    assert c.get("/api/samples").json() == {"files": ["fixture-clash.ifc"], "demos": []}
    sid = c.post("/api/scenes", json={"samples": ["fixture-clash.ifc"]}).json()["id"]
    duct = app_module.ws.scene(sid).model.by_type("IfcDuctSegment")[0].GlobalId
    beam = app_module.ws.scene(sid).model.by_type("IfcBeam")[0].GlobalId

    assert c.post(f"/api/scenes/{sid}/verify", json={"moved": [duct], "delta_m": [0, 0, -0.4]}).json()["passed"] is False
    assert c.post(f"/api/scenes/{sid}/verify", json={"moved": [duct], "delta_m": [0, 0, -0.8]}).json()["passed"] is True
    # Kept only once it passes again; a move still clashing is refused and leaves nothing to export.
    assert c.post(f"/api/scenes/{sid}/apply", json={"moved": [duct], "delta_m": [0, 0, -0.4],
                                                     "obstacles": [beam]}).status_code == 409
    assert c.get(f"/api/scenes/{sid}/export").status_code == 409
    assert c.post(f"/api/scenes/{sid}/apply", json={"moved": [duct], "delta_m": [0, 0, -0.8],
                                                     "obstacles": [beam]}).status_code == 200
    r = c.get(f"/api/scenes/{sid}/export")
    assert r.status_code == 200 and r.content.startswith(b"ISO-10303-21")


def test_sample_names_cannot_escape_the_samples_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "ws", Workspace(samples=tmp_path))
    c = TestClient(app_module.app)
    assert c.post("/api/scenes", json={"samples": ["../pyproject.toml"]}).status_code == 404


def test_federated_set_exports_only_the_edited_file(tmp_path, monkeypatch):
    build_clash_fixture(tmp_path / "structure.ifc", only=("beam",))
    build_clash_fixture(tmp_path / "services.ifc", only=("duct", "pipe"))
    monkeypatch.setattr(app_module, "ws", Workspace(samples=tmp_path))
    monkeypatch.setattr(app_module, "EXPORTS", tmp_path / "out")
    (tmp_path / "out").mkdir()
    c = TestClient(app_module.app)

    sid = c.post("/api/scenes", json={"samples": ["structure.ifc", "services.ifc"]}).json()["id"]
    assert c.get(f"/api/scenes/{sid}/files/1").content.startswith(b"ISO-10303-21")
    assert c.get(f"/api/scenes/{sid}/export").status_code == 409  # nothing changed yet

    duct = app_module.ws.scene(sid).models[1].by_type("IfcDuctSegment")[0].GlobalId
    assert c.post(f"/api/scenes/{sid}/verify", json={"moved": [duct], "delta_m": [0, 0, 0]}).json()["passed"] is False
    assert c.get(f"/api/scenes/{sid}/export").status_code == 409  # a check moves and moves back: still nothing changed
    beam = app_module.ws.scene(sid).models[0].by_type("IfcBeam")[0].GlobalId
    c.post(f"/api/scenes/{sid}/apply", json={"moved": [duct], "delta_m": [0, 0, -0.8], "obstacles": [beam]})
    r = c.get(f"/api/scenes/{sid}/export")
    assert r.status_code == 200 and "services.iris.ifc" in r.headers["content-disposition"]


def test_export_carries_every_accepted_fix_and_no_tried_ones(tmp_path, monkeypatch):
    """Offsets, moves and trials in one session: the exported files hold all the kept edits, and only those."""
    import io
    import json
    import zipfile

    import ifcopenshell
    import ifcopenshell.util.placement
    from iris import agent
    from iris.fixtures import build_run_fixture

    build_run_fixture(tmp_path / "services.ifc")
    build_clash_fixture(tmp_path / "structure.ifc", only=("beam",))
    monkeypatch.setattr(app_module, "ws", Workspace(samples=tmp_path))
    monkeypatch.setattr(app_module, "EXPORTS", tmp_path / "out")
    (tmp_path / "out").mkdir()
    c = TestClient(app_module.app)
    sid = c.post("/api/scenes", json={"samples": ["services.ifc", "structure.ifc"]}).json()["id"]
    scene = app_module.ws.scene(sid)
    services, structure = scene.models
    main = next(e for e in services.by_type("IfcDuctSegment") if e.Tag == "SA-1").GlobalId
    beam = services.by_type("IfcBeam")[0].GlobalId
    slab = services.by_type("IfcSlab")[0].GlobalId
    other_beam = structure.by_type("IfcBeam")[0].GlobalId

    agent._try_move(scene, {"title": "tried, not kept", "delta_m": [0, 0, -2.0]}, other_beam, 0.025)
    agent._try_offset(scene, {"split_m": [2.0, 4.0], "dz_m": 0.5}, main, beam, 0.025)
    assert c.get(f"/api/scenes/{sid}/export").status_code == 409  # trials only

    def keep(moved, delta):
        return c.post(f"/api/scenes/{sid}/apply", json={"moved": [moved], "delta_m": delta, "obstacles": [main]})
    offset = {"element": main, "other": beam, "split_m": [2.0, 4.0], "dz_m": 0.4}
    # The structure model's beam runs along the supply main: the offset's risers would cut it, so it is not kept.
    assert c.post(f"/api/scenes/{sid}/offset/apply", json=offset).status_code == 409
    assert c.get(f"/api/scenes/{sid}/export").status_code == 409
    assert keep(other_beam, [0.5, 0, -1.0]).status_code == 200   # another discipline: that beam out of the way
    pieces = c.post(f"/api/scenes/{sid}/offset/apply", json=offset).json()["pieces"]
    assert keep(slab, [0, 0, 0.1]).status_code == 200            # same file, second fix

    r = c.get(f"/api/scenes/{sid}/export")
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert r.headers["content-disposition"].endswith('filename="iris-export.zip"')  # the files share no project name
    files = zipfile.ZipFile(io.BytesIO(r.content))
    # The models, and the edit log beside them (every kept fix, docs/manual-edits.md)
    assert sorted(files.namelist()) == ["iris-edits.csv", "iris-edits.json", "services.iris.ifc", "structure.iris.ifc"]
    assert len(json.loads(files.read("iris-edits.json"))) == 3
    out = ifcopenshell.file.from_string(files.read("services.iris.ifc").decode())
    assert all(out.by_guid(g) for g in pieces)                                   # the offset's five pieces
    z = lambda m, g: ifcopenshell.util.placement.get_local_placement(m.by_guid(g).ObjectPlacement)[2, 3]
    assert z(out, slab) == pytest.approx(z(services, slab))                       # the live model, moved
    assert z(out, slab) == pytest.approx(3.5)                                     # 3.4 + 0.1
    moved = ifcopenshell.file.from_string(files.read("structure.iris.ifc").decode())
    x = ifcopenshell.util.placement.get_local_placement(moved.by_guid(other_beam).ObjectPlacement)[0, 3]
    assert x == pytest.approx(0.5)                                                # the kept move, not the tried one


def test_a_multi_file_export_is_named_for_its_project():
    northbank = ["Northbank-Structure.ifc", "Northbank-MEP.ifc", "Northbank-Architecture.ifc", "Northbank-Site.ifc"]
    assert app_module.export_zip_name(northbank) == "Northbank-iris.zip"
    assert app_module.export_zip_name(["PC-03-Palletising-Cell-RevA.step"]) == "PC-03-Palletising-Cell-RevA-iris.zip"
    assert app_module.export_zip_name(["services.ifc", "structure.ifc"]) == "iris-export.zip"
    assert app_module.export_zip_name(['Block "A"/1-MEP.ifc', 'Block "A"/1-Structure.ifc']) == "Block -A-1-iris.zip"
    assert app_module.export_zip_name([]) == "iris-export.zip"


def test_a_page_can_reopen_a_scene_the_server_still_holds(tmp_path, monkeypatch):
    build_clash_fixture(tmp_path / "fixture-clash.ifc")
    monkeypatch.setattr(app_module, "ws", Workspace(samples=tmp_path))
    c = TestClient(app_module.app)
    sid = c.post("/api/scenes", json={"samples": ["fixture-clash.ifc"]}).json()["id"]
    info = c.get(f"/api/scenes/{sid}").json()
    assert info["files"] == ["fixture-clash.ifc"] and info["step"] == {}
    assert info["report_id"] is None and info["checks"] == []
    c.post(f"/api/scenes/{sid}/detect/stream", json={}).read()
    info = c.get(f"/api/scenes/{sid}").json()
    assert info["report_id"] in app_module.ws.reports
    assert [k["key"] for k in info["checks"]] == ["models"] and info["checks"][0]["coverage"]
    assert c.get("/api/scenes/nothing-here").status_code == 404


def test_a_scene_or_report_the_server_let_go_says_so(tmp_path, monkeypatch):
    """A restart drops every open scene and report: their 404 names what is gone, for the page to offer to open them
    again (api.ts, setGoneHandler). A scene still held, or an id the server never makes, gets no such header."""
    build_clash_fixture(tmp_path / "fixture-clash.ifc")
    monkeypatch.setattr(app_module, "ws", Workspace(samples=tmp_path))
    c = TestClient(app_module.app)
    sid = c.post("/api/scenes", json={"samples": ["fixture-clash.ifc"]}).json()["id"]
    c.post(f"/api/scenes/{sid}/detect/stream", json={}).read()
    rid = c.get(f"/api/scenes/{sid}").json()["report_id"]
    assert "x-iris-gone" not in c.get(f"/api/scenes/{sid}/classes").headers

    monkeypatch.setattr(app_module, "ws", Workspace(samples=tmp_path))   # the server restarted
    r = c.post(f"/api/scenes/{sid}/built/stream", json={"look": "", "ids": "", "normals": ""})
    assert r.status_code == 404 and r.json()["detail"] == "Model not loaded. Open it again."
    assert r.headers["x-iris-gone"] == f"scene:{sid}"
    r = c.get(f"/api/reports/{rid}")
    assert r.status_code == 404 and r.headers["x-iris-gone"] == f"report:{rid}"
    r = c.get("/api/scenes/not%0Aan-id")
    assert r.status_code == 404 and "x-iris-gone" not in r.headers


GONE_SID, GONE_RID = "0123456789ab", "fedcba987654"   # ids the server could have made, held by none
STREAM = {"Accept-Encoding": "gzip, deflate, br, zstd"}   # as a browser asks (CLAUDE.md, "Streams behind a proxy")
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 16


@pytest.mark.parametrize("method,path,send,gone", [
    # Streams: refused before they start, never a 200 stream with an error event.
    ("post", "/api/scenes/{s}/propose/stream", {"json": {"element_a": "a", "element_b": "b", "report_id": "{r}"}}, "scene"),
    ("post", "/api/scenes/{s}/prepare/stream", {"json": {"report_id": "{r}", "clash_ids": ["c"]}}, "scene"),
    ("post", "/api/scenes/{s}/plan/stream", {"json": {"report_id": "{r}", "clash_ids": ["c"]}}, "scene"),
    ("post", "/api/scenes/{s}/context/stream", {"json": {"element_a": "a", "element_b": "b"}}, "scene"),
    ("post", "/api/scenes/{s}/built/stream", {"json": {"look": "", "ids": "", "normals": ""}}, "scene"),
    ("post", "/api/scenes/{s}/detect/stream", {"json": {}}, "scene"),
    ("post", "/api/scenes/{s}/models/upload/stream", {}, "scene"),
    ("post", "/api/reports/{r}/triage/stream", {}, "report"),
    ("post", "/api/reports/{r}/titles/stream", {}, "report"),
    ("post", "/api/reports/{r}/document/stream", {"json": {}}, "report"),
    # The rest of a scene's routes, a body the page could send (checked before the body's own checks).
    ("get", "/api/scenes/{s}", {}, "scene"),
    ("get", "/api/scenes/{s}/edits", {}, "scene"),
    ("get", "/api/scenes/{s}/export", {}, "scene"),
    ("get", "/api/scenes/{s}/files/0", {}, "scene"),
    ("get", "/api/scenes/{s}/checks", {}, "scene"),
    ("get", "/api/scenes/{s}/detect/tests", {}, "scene"),
    ("get", "/api/scenes/{s}/requirements/default", {}, "scene"),
    ("post", "/api/scenes/{s}/requirements/preview", {"content": b"{}"}, "scene"),
    ("post", "/api/scenes/{s}/propose", {"json": {"element_a": "a", "element_b": "b"}}, "scene"),
    ("post", "/api/scenes/{s}/apply", {"json": {"moved": [], "delta_m": [0, 0, 0]}}, "scene"),
    ("post", "/api/scenes/{s}/fix/apply", {"json": {"option": {}}}, "scene"),
    ("post", "/api/scenes/{s}/trim/apply", {"json": {"element": "e", "end": "start", "by_m": 0.1}}, "scene"),
    ("post", "/api/scenes/{s}/offset/check", {"json": {"element": "e", "split_m": [1, 2], "dz_m": 0.1}}, "scene"),
    ("post", "/api/scenes/{s}/offset/apply", {"json": {"element": "e", "split_m": [1, 2], "dz_m": 0.1}}, "scene"),
    ("post", "/api/scenes/{s}/plan/apply", {"json": {"options": []}}, "scene"),
    ("post", "/api/scenes/{s}/edits/undo", {"json": {}}, "scene"),
    ("post", "/api/scenes/{s}/edit/apply", {"json": {"op": {}}}, "scene"),
    ("delete", "/api/scenes/{s}/checks/k", {}, "scene"),
    # A report's routes: the report first where the path names it first.
    ("get", "/api/reports/{r}/clashes/c/measure/{s}", {}, "report"),
    ("get", "/api/reports/{r}/match/{s}", {}, "report"),
    ("get", "/api/reports/{r}/root_causes/{s}", {}, "scene"),
    ("get", "/api/reports/{r}/patterns/{s}", {}, "scene"),
    ("post", "/api/reports/{r}/patterns/{s}/triage", {"json": {}}, "scene"),
    ("get", "/api/reports/{r}/clashes/c/images/0", {}, "report"),
    ("post", "/api/reports/{r}/clashes/c/images", {"data": {"label": "A"}, "files": {"image": ("a.png", PNG, "image/png")}}, "report"),
    ("post", "/api/reports/{r}/clashes/c/images", {"data": {"label": "A"}, "files": {"image": ("a.txt", b"no", "text/plain")}}, "report"),
    ("get", "/api/reports/{r}/triage", {}, "report"),
    ("post", "/api/reports/{r}/triage/stop", {}, "report"),
    ("get", "/api/reports/{r}/titles", {}, "report"),
    ("get", "/api/reports/{r}/teams", {}, "report"),
])
def test_every_scene_and_report_route_says_what_is_gone(tmp_path, monkeypatch, method, path, send, gone):
    """After a restart (or scale to zero) every route of a scene or report the server no longer holds answers a plain
    404 naming it (`X-Iris-Gone`), streams included, before anything starts: the page reopens it (api.ts goneOf)."""
    monkeypatch.setattr(app_module, "ws", Workspace(samples=tmp_path))
    monkeypatch.setattr(app_module, "EXPORTS", tmp_path)
    fill = lambda v: v.replace("{s}", GONE_SID).replace("{r}", GONE_RID) if isinstance(v, str) else v
    if "json" in send:
        send = {**send, "json": {k: fill(v) for k, v in send["json"].items()}}
    r = getattr(TestClient(app_module.app), method)(fill(path), headers=STREAM, **send)
    assert r.status_code == 404, r.text
    assert r.headers["x-iris-gone"] == (f"scene:{GONE_SID}" if gone == "scene" else f"report:{GONE_RID}")
    assert r.headers["content-type"] == "application/json" and r.json()["detail"].endswith("Open it again.")
    assert not (tmp_path / GONE_SID).exists()   # nothing made for it (an export's folder)


def test_a_held_report_with_a_scene_let_go_names_the_scene(tmp_path, monkeypatch):
    """A report still held, its scene gone (let go to make room): the routes naming both say it is the scene."""
    build_clash_fixture(tmp_path / "fixture-clash.ifc")
    monkeypatch.setattr(app_module, "ws", Workspace(samples=tmp_path))
    c = TestClient(app_module.app)
    sid = c.post("/api/scenes", json={"samples": ["fixture-clash.ifc"]}).json()["id"]
    c.post(f"/api/scenes/{sid}/detect/stream", json={}, headers=STREAM).read()
    rid = c.get(f"/api/scenes/{sid}").json()["report_id"]
    cid = c.get(f"/api/reports/{rid}").json()["clashes"][0]["id"]
    assert c.get(f"/api/reports/{rid}/clashes/{cid}/measure/{sid}").status_code == 200
    app_module.ws.scenes.pop(sid)
    for path in (f"/api/reports/{rid}/clashes/{cid}/measure/{sid}", f"/api/reports/{rid}/match/{sid}",
                 f"/api/reports/{rid}/patterns/{sid}", f"/api/reports/{rid}/root_causes/{sid}"):
        r = c.get(path)
        assert r.status_code == 404 and r.headers["x-iris-gone"] == f"scene:{sid}", path
    for path, body in ((f"/api/scenes/{sid}/plan/stream", {"report_id": rid, "clash_ids": [cid]}),
                       (f"/api/scenes/{sid}/prepare/stream", {"report_id": rid, "clash_ids": [cid]})):
        r = c.post(path, json=body, headers=STREAM)
        assert r.status_code == 404 and r.headers["x-iris-gone"] == f"scene:{sid}", path
        assert r.headers["content-type"] == "application/json"


def test_models_let_go_while_an_upload_came_in_say_so_before_the_stream(tmp_path, monkeypatch):
    build_clash_fixture(tmp_path / "fixture-clash.ifc")
    monkeypatch.setattr(app_module, "ws", Workspace(samples=tmp_path))
    monkeypatch.setattr(app_module, "MODELS", tmp_path / "models")
    monkeypatch.setattr(app_module, "_take", lambda limit, request: None)
    c = TestClient(app_module.app)
    sid = c.post("/api/scenes", json={"samples": ["fixture-clash.ifc"]}).json()["id"]
    monkeypatch.setattr(app_module.ws, "check_adding", lambda s, paths: app_module.ws.scenes.pop(s))
    r = c.post(f"/api/scenes/{sid}/models/upload/stream", files=[("files", ("more.ifc", b"ISO-10303-21;"))],
               headers=STREAM)
    assert r.status_code == 404 and r.headers["x-iris-gone"] == f"scene:{sid}"
    assert r.headers["content-type"] == "application/json"
    assert not any((tmp_path / "models").iterdir())   # the files that came in are deleted


def test_a_stream_whose_report_is_gone_names_the_report(tmp_path, monkeypatch):
    """A scene still held, the report its stream names gone: a 404 naming the report, before the stream."""
    build_clash_fixture(tmp_path / "fixture-clash.ifc")
    monkeypatch.setattr(app_module, "ws", Workspace(samples=tmp_path))
    c = TestClient(app_module.app)
    sid = c.post("/api/scenes", json={"samples": ["fixture-clash.ifc"]}).json()["id"]
    for path, body in (("propose/stream", {"element_a": "a", "element_b": "b", "report_id": GONE_RID}),
                       ("prepare/stream", {"report_id": GONE_RID, "clash_ids": ["c"]}),
                       ("plan/stream", {"report_id": GONE_RID, "clash_ids": ["c"]}),
                       ("context/stream", {"element_a": "a", "element_b": "b", "report_id": GONE_RID, "clash_id": "c"})):
        r = c.post(f"/api/scenes/{sid}/{path}", json=body, headers=STREAM)
        assert r.status_code == 404 and r.headers["x-iris-gone"] == f"report:{GONE_RID}", path
        assert r.headers["content-type"] == "application/json"


def test_eviction_spares_what_live_links_point_at(tmp_path):
    for name in ("a.ifc", "b.ifc", "c.ifc"):
        build_clash_fixture(tmp_path / name)
    kept: set[str] = set()
    ws = Workspace(samples=tmp_path, max_scenes=2, keep=lambda: kept)
    first = ws.open(["a.ifc"])
    kept.add(first)                       # an agent link points at the oldest scene
    second = ws.open(["b.ifc"])
    ws.open(["c.ifc"])                    # one too many: the unlinked one goes, not the oldest
    assert first in ws.scenes and second not in ws.scenes
