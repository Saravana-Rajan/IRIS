"""The review queue's prepared fixes (prepare.py, docs/review-queue.md): live through the route, and saved sets replayed
through the same check. Scripted models only: nothing here reaches a real model."""
import importlib
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from iris import app as app_module
from iris import model_client, plans, prepare, requirements
from iris.fixtures import build_clash_fixture, build_route_fixture
from iris.limits import ProposeLimit
from iris.service import Workspace

GZIP = {"Accept-Encoding": "gzip, deflate, br, zstd"}


class Failing:
    """Proposes only a drop of the duct onto the pipe below the beam, every round: nothing passes."""
    model = "gemini-3.8-flash"

    def __init__(self):
        self.calls = 0

    def complete_json(self, system, text, images=None):
        self.calls += 1
        return {"understanding": "Through the beam.", "advice": "Ask the services designer.",
                "candidates": [{"title": "Drop duct 400 mm", "kind": "move", "move": "B", "delta_m": [0, 0, -0.40]}]}


class Recorded(prepare.ScriptedModel):
    """The scripted moves as if the configured proposal model had made them (its id and thinking level)."""
    model = "gemini-3.8-flash"
    label = ""
    thinking_level = "low"


class Refuses:
    """A model that must never be asked."""
    model = "gemini-3.8-flash"

    def complete_json(self, *a, **k):
        raise AssertionError("the model was called")


def _open(tmp_path, model, name="f.ifc"):
    if not (tmp_path / name).exists():
        build_clash_fixture(tmp_path / name)
    ws = Workspace(samples=tmp_path, model=model)
    sid = ws.open([name])
    rid = ws.detect(sid)["report"]["id"]
    return ws, sid, rid


def _events(r) -> list[dict]:
    return [json.loads(line) for line in r.text.splitlines() if line.strip()]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(app_module, "propose_limit", ProposeLimit(per_client_hour=1))
    return TestClient(app_module.app)


def test_live_prepare_streams_a_verified_fix_per_pair_and_charges_one_proposal(tmp_path, monkeypatch, client):
    ws, sid, rid = _open(tmp_path, prepare.ScriptedModel())
    monkeypatch.setattr(app_module, "ws", ws)
    [cid] = [c.id for c in ws.report(rid).clashes]

    r = client.post(f"/api/scenes/{sid}/prepare/stream", json={"report_id": rid, "clash_ids": [cid]}, headers=GZIP)
    assert r.status_code == 200 and r.headers["content-encoding"] == "identity"
    events = _events(r)
    types = [e["type"] for e in events]
    assert types[0] == "prepare_start" and types[-1] == "done"
    assert types.index("prepared") > max(i for i, t in enumerate(types) if t == "item")
    start = events[0]
    assert start["total"] == 1 and start["saved"] is None and start["items"][0]["saved"] is False
    [p] = [e for e in events if e["type"] == "prepared"]
    assert p["status"] == "ready" and p["source"] == "live" and p["clash_ids"] == [cid] and (p["done"], p["total"]) == (1, 1)
    assert p["model"] == "Scripted test model" and "why" not in p
    titles = [o["title"] for o in p["options"]]
    assert titles == ["Raise Supply duct 400x300 400 mm", "Raise Supply duct 400x300 600 mm"]   # the drop hit the pipe
    for o in p["options"]:
        assert sorted(o["pair"]) == sorted([p["element_a"], p["element_b"]]) and o["before"] and o["min_clearance_m"] > 0
        assert o["model"] == "Scripted test model"
    assert events[-1] == {"type": "done", "ready": 1, "failed": 0, "total": 1, "seconds": events[-1]["seconds"]}
    assert ws.scene(sid).revision == 0   # nothing kept
    # One proposal for the one pair: the allowance (one an hour) is spent, refused before any stream.
    again = client.post(f"/api/scenes/{sid}/prepare/stream", json={"report_id": rid, "clash_ids": [cid]})
    assert again.status_code == 429 and "proposals" in again.json()["detail"]


def test_one_card_per_pair_and_all_or_nothing_charging(tmp_path, monkeypatch, client):
    # One duct through two columns: Fix together merges them into one item; the queue keeps a card per pair.
    build_route_fixture(tmp_path / "route.ifc")
    ws = Workspace(samples=tmp_path, model=prepare.ScriptedModel())
    sid = ws.open(["route.ifc"])
    rid = ws.detect(sid)["report"]["id"]
    monkeypatch.setattr(app_module, "ws", ws)
    m = ws.scene(sid).model
    duct = next(e for e in m.by_type("IfcDuctSegment") if e.Tag == "RT-2").GlobalId
    ids = [c.id for c in ws.report(rid).clashes if duct in (c.a.global_id, c.b.global_id) and c.distance_m < 0]
    assert len(plans.pairs_for(ws, sid, rid, ids)[0]) == 1
    assert len(prepare.pairs(ws, sid, rid, ids)[0]) == 2
    # Two pairs need two proposals; one is left this hour: refused whole, before the stream.
    r = client.post(f"/api/scenes/{sid}/prepare/stream", json={"report_id": rid, "clash_ids": ids})
    assert r.status_code == 429 and "2" in r.json()["detail"]


def test_a_model_with_no_fix_that_passes_gives_a_failed_card_with_why(tmp_path, monkeypatch, client):
    ws, sid, rid = _open(tmp_path, Failing())
    monkeypatch.setattr(app_module, "ws", ws)
    r = client.post(f"/api/scenes/{sid}/prepare/stream", json={"report_id": rid, "pick": "deepest"})
    events = _events(r)
    [p] = [e for e in events if e["type"] == "prepared"]
    assert p["status"] == "failed" and p["options"] == [] and p["tried"] == plans.PLAN_ROUNDS
    assert "IfcPipeSegment" in p["why"] or "LTHW" in p["why"]
    assert "Ask the services designer." in p["why"]
    assert events[-1]["failed"] == 1 and events[-1]["ready"] == 0


def test_deepest_picks_open_hard_clashes_and_skips_the_fixed(tmp_path, monkeypatch, client):
    ws, sid, rid = _open(tmp_path, prepare.ScriptedModel())
    monkeypatch.setattr(app_module, "ws", ws)
    [cid] = [c.id for c in ws.report(rid).clashes]
    assert prepare.deepest(ws, sid, rid, []) == [cid]
    assert prepare.deepest(ws, sid, rid, [cid]) == []
    r = client.post(f"/api/scenes/{sid}/prepare/stream", json={"report_id": rid, "pick": "deepest", "fixed": [cid]})
    assert r.status_code == 422 and r.json()["detail"] == "Nothing to prepare."
    assert client.post(f"/api/scenes/{sid}/prepare/stream",
                       json={"report_id": rid, "clash_ids": ["nope"]}).status_code == 404
    assert client.post("/api/scenes/nope/prepare/stream", json={"report_id": rid}).status_code == 404


def _generate(tmp_path, monkeypatch, model=None) -> Path:
    folder = tmp_path / "prepared"
    monkeypatch.setenv("IRIS_PREPARED_DIR", str(folder))
    ws, sid, rid = _open(tmp_path, Refuses())
    out = prepare.generate(ws, sid, rid, prepare.deepest(ws, sid, rid, []), model or Recorded(),
                           out=folder / "fixture.json")
    assert out["items"] == 1 and out["ready"] == 1 and out["calls"] == 1 and ws.scene(sid).revision == 0
    return folder / "fixture.json"


def test_a_saved_set_is_replayed_through_the_check_and_costs_nothing(tmp_path, monkeypatch, client):
    path = _generate(tmp_path, monkeypatch)
    data = json.loads(path.read_text())
    assert data["format"] == 1 and data["model"] == "gemini-3.8-flash" and data["model_label"] == "Gemini Flash"
    assert data["label"] == prepare.LABEL and len(data["calls"]) == 1 and list(data["items"].values())[0]["options"] == 2
    assert not list(path.parent.glob("*.tmp"))

    ws, sid, rid = _open(tmp_path, Refuses())   # a fresh server: its model raises if asked
    monkeypatch.setattr(app_module, "ws", ws)
    saved = prepare.load_saved(ws, sid)
    assert saved is not None and saved.path == path
    [cid] = [c.id for c in ws.report(rid).clashes]
    for _ in range(2):   # an allowance of one an hour: a replay takes none of it
        r = client.post(f"/api/scenes/{sid}/prepare/stream", json={"report_id": rid, "clash_ids": [cid]})
        assert r.status_code == 200
    events = _events(r)
    start = events[0]
    assert start["items"][0]["saved"] is True
    assert start["saved"]["model"] == "Gemini Flash" and start["saved"]["label"] == prepare.LABEL
    assert start["saved"]["title"].startswith(f"{prepare.LABEL} (Gemini Flash, ")
    [p] = [e for e in events if e["type"] == "prepared"]
    assert p["status"] == "ready" and p["source"] == "saved" and p["model"] == "Gemini Flash"
    for o in p["options"]:   # tried and checked again here, not read from the file
        assert o["min_clearance_m"] is not None and o["before"] and o["model"] == "Gemini Flash" and o["pair"]


def test_a_tampered_saved_reply_is_checked_and_not_shown(tmp_path, monkeypatch, client):
    path = _generate(tmp_path, monkeypatch)
    data = json.loads(path.read_text())
    for reply in data["calls"].values():   # every idea now drops the duct onto the pipe
        for c in reply["candidates"]:
            c["delta_m"] = [0, 0, -0.40]
            c["title"] = "Tampered drop"
    path.write_text(json.dumps(data))
    ws, sid, rid = _open(tmp_path, Refuses())
    monkeypatch.setattr(app_module, "ws", ws)
    r = client.post(f"/api/scenes/{sid}/prepare/stream", json={"report_id": rid, "pick": "deepest"})
    [p] = [e for e in _events(r) if e["type"] == "prepared"]
    assert p["source"] == "saved" and p["status"] == "failed" and p["options"] == []
    assert "Tampered drop" not in json.dumps(p["options"])


def test_a_question_the_saved_set_does_not_hold_fails_that_item_plainly(tmp_path, monkeypatch, client):
    path = _generate(tmp_path, monkeypatch)
    data = json.loads(path.read_text())
    data["calls"] = {}
    path.write_text(json.dumps(data))
    ws, sid, rid = _open(tmp_path, Refuses())
    monkeypatch.setattr(app_module, "ws", ws)
    events = _events(client.post(f"/api/scenes/{sid}/prepare/stream", json={"report_id": rid, "pick": "deepest"}))
    [p] = [e for e in events if e["type"] == "prepared"]
    assert p["status"] == "failed" and p["source"] == "saved" and p["why"] == prepare.MISS
    [done] = [e for e in events if e["type"] == "item" and e["status"] == "done"]
    assert done["title"] == prepare.MISS


def test_the_saved_key_misses_on_any_difference(tmp_path, monkeypatch):
    path = _generate(tmp_path, monkeypatch)
    ws, sid, rid = _open(tmp_path, Refuses())
    assert prepare.load_saved(ws, sid).path == path

    with monkeypatch.context() as m:   # another proposal model configured
        m.setenv("GEMINI_MODEL", "gemini-4-argon")
        assert prepare.load_saved(ws, sid) is None
    with monkeypatch.context() as m:   # another thinking level
        m.setenv("GEMINI_THINKING_LEVEL", "high")
        assert prepare.load_saved(ws, sid) is None
    with monkeypatch.context() as m:   # what a prepared fix is made of changed
        m.setattr(prepare, "VERSION", prepare.VERSION + 1)
        assert prepare.load_saved(ws, sid) is None
    doc = requirements.parse({"format": requirements.FORMAT, "name": "x"})
    with requirements.using(requirements.register(doc)):   # requirements in force
        assert prepare.saved_key(ws, sid) is None and prepare.load_saved(ws, sid) is None
    assert prepare.load_saved(ws, sid) is not None

    # A kept edit: the scene's revision moves on.
    duct = ws.scene(sid).model.by_type("IfcDuctSegment")[0].GlobalId
    ws.apply(sid, [duct], [0, 0, 0.4])
    assert ws.scene(sid).revision > 0 and prepare.load_saved(ws, sid) is None

    # The same name, other bytes.
    other = tmp_path / "other"
    other.mkdir()
    (other / "f.ifc").write_bytes((tmp_path / "f.ifc").read_bytes().replace(b"Iris fixture", b"Iris fixturf"))
    ws2 = Workspace(samples=other, model=Refuses())
    assert prepare.load_saved(ws2, ws2.open(["f.ifc"])) is None
    # The same bytes elsewhere: a hit (the key is the files' names and bytes, not where they are).
    (other / "f.ifc").write_bytes((tmp_path / "f.ifc").read_bytes())
    ws3 = Workspace(samples=other, model=Refuses())
    assert prepare.load_saved(ws3, ws3.open(["f.ifc"])) is not None


def test_a_scripted_set_is_labelled_as_scripted_and_only_used_where_that_model_is_configured(tmp_path, monkeypatch):
    path = _generate(tmp_path, monkeypatch, prepare.ScriptedModel())
    data = json.loads(path.read_text())
    assert data["model"] == "scripted" and data["model_label"] == "Scripted test model"
    ws, sid, rid = _open(tmp_path, Refuses())
    assert prepare.load_saved(ws, sid) is None   # the configured model is not the one that made it
    monkeypatch.setenv("GEMINI_MODEL", "scripted")
    monkeypatch.setenv("GEMINI_THINKING_LEVEL", "")
    saved = prepare.load_saved(ws, sid)
    events = []
    prepare.run(ws, sid, rid, prepare.deepest(ws, sid, rid, []), events.append, saved)
    [p] = [e for e in events if e["type"] == "prepared"]
    assert p["source"] == "saved" and p["status"] == "ready"
    assert {o["model"] for o in p["options"]} == {"Scripted test model"}


def test_the_generator_runs_offline_unless_told_to_call_gemini(monkeypatch):
    monkeypatch.setattr(model_client, "make_client", model_client.make_client)   # restored after the test
    monkeypatch.setattr(model_client.load_env, "__defaults__", model_client.load_env.__defaults__)
    monkeypatch.setenv("GEMINI_API_KEY", "not-a-key")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "not-a-project")
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "evals"))
    gen = importlib.import_module("prepare_saved")
    gen.offline()
    import os
    assert "GEMINI_API_KEY" not in os.environ and "GOOGLE_CLOUD_PROJECT" not in os.environ
    with pytest.raises(RuntimeError, match="offline"):
        model_client.GeminiModel().complete_json("s", "t")
    assert model_client.model_id("proposal")   # the key still names the configured model
    sys.modules.pop("prepare_saved", None)


def test_with_no_credentials_saved_pairs_replay_and_live_ones_fail_plainly_uncharged(tmp_path, monkeypatch, client):
    """No GOOGLE_CLOUD_PROJECT, no GEMINI_API_KEY (conftest drops them): the default model cannot be called, so a saved
    pair still replays (no client is made) and a pair the set does not hold fails with NO_MODEL, charging nothing."""
    path = _generate(tmp_path, monkeypatch)
    assert not model_client.configured()
    ws, sid, rid = _open(tmp_path, None)   # the default: a GeminiModel with no client and no credentials
    assert isinstance(ws.model, model_client.GeminiModel) and not model_client.can_call(ws.model)
    monkeypatch.setattr(model_client, "make_client", lambda: pytest.fail("a client was made"))
    monkeypatch.setattr(app_module, "ws", ws)
    events = _events(client.post(f"/api/scenes/{sid}/prepare/stream", json={"report_id": rid, "pick": "deepest"}))
    [p] = [e for e in events if e["type"] == "prepared"]
    assert p["source"] == "saved" and p["status"] == "ready" and p["options"]

    data = json.loads(path.read_text())
    data["items"] = {}   # the set holds no pair now: it would be prepared live
    path.write_text(json.dumps(data))
    for _ in range(2):   # an allowance of one an hour: nothing is charged
        r = client.post(f"/api/scenes/{sid}/prepare/stream", json={"report_id": rid, "pick": "deepest"})
        assert r.status_code == 200
    events = _events(r)
    [p] = [e for e in events if e["type"] == "prepared"]
    assert p["source"] == "live" and p["status"] == "failed" and p["why"] == prepare.NO_MODEL
    assert "RuntimeError" not in r.text


NORTHBANK_SET = Path(__file__).resolve().parents[2] / "samples" / "prepared" / "Northbank.json"


@pytest.mark.skipif(not NORTHBANK_SET.exists(), reason="no saved set for Northbank")
def test_a_fresh_clone_replays_northbank_s_saved_fixes_with_no_credentials(monkeypatch, client):
    """The sample as the demo card opens it, on the code's own defaults and no credentials: the saved set's key matches
    and its answer-key pairs replay through the geometry check, with no model client made."""
    from iris import demos
    from iris.service import SAMPLES
    monkeypatch.delenv("IRIS_PREPARED_DIR", raising=False)
    monkeypatch.setattr(model_client, "make_client", lambda: pytest.fail("a client was made"))
    demo = next(d for d in demos.DEMOS if d.id == "northbank")
    ws = Workspace(samples=SAMPLES)   # the default model: Gemini with no credentials
    sid = ws.open(list(demo.files))
    rid = ws.detect(sid)["report"]["id"]
    saved = prepare.load_saved(ws, sid)
    assert saved is not None and saved.path.name == "Northbank.json", prepare.saved_key(ws, sid)
    monkeypatch.setattr(app_module, "ws", ws)
    girder = "1eVHoPtl1IhAbbhivqVqb0"
    ids = [cid for k, it in saved.items.items() if girder in k for cid in it["clash_ids"]]
    assert ids
    r = client.post(f"/api/scenes/{sid}/prepare/stream", json={"report_id": rid, "clash_ids": ids})
    assert r.status_code == 200 and "No model configured" not in r.text
    cards = [e for e in _events(r) if e["type"] == "prepared"]
    assert cards and all(c["source"] == "saved" for c in cards)
    assert any(c["status"] == "ready" for c in cards)
    for c in cards:
        for o in c["options"]:   # checked by geometry here
            assert o["min_clearance_m"] is not None and o["before"]
