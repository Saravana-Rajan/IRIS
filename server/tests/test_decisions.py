"""Decisions (journal.py, docs/engineer-workflow.md): what a reviewer decided about a proposal, kept with the edits;
a keep through the fix and plan routes records its reviewer and an "accepted", geometry-validated decision with the
check's evidence; an "as designed" plan is never geometry-validated."""
import pytest
from fastapi.testclient import TestClient

from iris import app as app_module
from iris import journal, plans, projects
from iris.fixtures import build_clash_fixture
from iris.service import Workspace


@pytest.fixture
def scene(tmp_path, monkeypatch):
    build_clash_fixture(tmp_path / "fixture-clash.ifc")
    ws = Workspace(samples=tmp_path)
    monkeypatch.setattr(app_module, "ws", ws)
    c = TestClient(app_module.app)
    sid = c.post("/api/scenes", json={"samples": ["fixture-clash.ifc"]}).json()["id"]
    m = ws.scene(sid).model
    return c, ws, sid, m.by_type("IfcDuctSegment")[0].GlobalId, m.by_type("IfcBeam")[0].GlobalId


def _decision(**over) -> dict:
    return {"clash_id": "s123", "clash_key": "hard|A|B", "number": 4,
            "option": {"title": "Drop the duct", "kind": "move", "moved": ["A"], "delta_m": [0, 0, -0.4],
                       "rationale": "under the beam"},
            "state": "failed_validation", "decision": "rejected", "reason": "hits the pipe", "reviewer": "Sam",
            "check": {"verified": False, "reason": "collision with the pipe"}, **over}


def test_the_decisions_route_checks_what_it_is_given(scene):
    c, ws, sid, duct, beam = scene
    url = f"/api/scenes/{sid}/decisions"
    for bad in (_decision(state="approved"), _decision(decision="maybe"), _decision(option=None),
                _decision(option={"title": "x", "kind": "move", "moved": ["A"], "delta_m": [0, 1]}),
                _decision(clash_key=""), _decision(number=0), _decision(reviewer="x" * 500),
                {k: v for k, v in _decision().items() if k != "clash_id"}):
        assert c.post(url, json=bad).status_code == 422, bad
    assert c.post("/api/scenes/0123456789ab/decisions", json=_decision()).status_code == 404
    r = c.post(url, json={**_decision(), "at": 1})   # the time is the server's
    assert r.status_code == 200
    stored = r.json()["decision"]
    assert stored["at"] > 1 and stored["decision"] == "rejected" and stored["check"]["verified"] is False
    c.post(url, json=_decision(decision="requested_another", state="unverified", check=None))
    log = c.get(f"/api/scenes/{sid}/edits").json()
    assert [d["decision"] for d in log["decisions"]] == ["rejected", "requested_another"]
    assert log["decisions"][1]["option"]["delta_m"] == [0, 0, -0.4] and "check" not in log["decisions"][1]
    assert log["entries"] == [] and not log["can_undo"]   # a decision is not an edit


def test_the_journal_refuses_unknown_states():
    log = journal.Journal()
    with pytest.raises(ValueError):
        log.add_decision({"state": "approved", "decision": "accepted", "option": {}})
    with pytest.raises(ValueError):
        log.add_decision({"state": "unverified", "decision": "kept", "option": {}})
    d = log.add_decision({"state": "unverified", "decision": "modified", "option": {"title": "t"}})
    assert d["at"] and log.summary()["decisions"] == [d]


def test_a_fix_kept_by_a_reviewer_records_who_and_an_accepted_decision_with_its_evidence(scene):
    c, ws, sid, duct, beam = scene
    report = ws.detect(sid)["report"]
    clash = next(x for x in report["clashes"] if {x["a"]["global_id"], x["b"]["global_id"]} == {duct, beam})
    option = {"kind": "move", "title": "Drop the duct", "moved": [duct], "delta_m": [0, 0, -0.8],
              "pair": [duct, beam], "rationale": "clear of the beam and the pipe"}
    r = c.post(f"/api/scenes/{sid}/fix/apply", json={"option": option, "clash_id": clash["id"],
                                                       "reviewer": "Priya", "reason": "cheapest change"})
    assert r.status_code == 200
    [d] = r.json()["decisions"]
    assert d["decision"] == "accepted" and d["state"] == "geometry_validated"
    assert d["reviewer"] == "Priya" and d["reason"] == "cheapest change"
    assert d["clash_id"] == clash["id"] and d["number"] == clash["number"]
    assert d["clash_key"] == projects.clash_key(clash["test_type"], duct, beam)
    assert d["option"] == {"title": "Drop the duct", "kind": "move", "moved": [duct], "delta_m": [0, 0, -0.8],
                           "rationale": "clear of the beam and the pipe"}
    assert d["check"]["verified"] is True and d["check"]["checked_against"] >= 2
    assert d["check"]["min_clearance_m"] is not None and d["entry"] == "E1" and d["session"] == sid
    log = c.get(f"/api/scenes/{sid}/edits").json()
    [entry] = log["entries"]
    assert entry["actor"] == "Priya" and entry["source"] == "fix"
    assert entry["check"] == {"verified": True, "min_clearance_m": d["check"]["min_clearance_m"],
                              "checked_against": d["check"]["checked_against"]}
    assert log["decisions"] == [d]
    # A fix that no longer passes keeps nothing and decides nothing.
    again = c.post(f"/api/scenes/{sid}/fix/apply", json={"option": {**option, "delta_m": [0, 0, 0.8]},
                                                          "clash_id": clash["id"], "reviewer": "Priya"})
    assert again.status_code == 409 and len(c.get(f"/api/scenes/{sid}/edits").json()["decisions"]) == 1


def test_the_edit_log_csv_says_who_kept_a_fix_and_what_its_check_found(scene):
    import csv
    import io
    c, ws, sid, duct, beam = scene
    option = {"kind": "move", "title": "Drop the duct", "moved": [duct], "delta_m": [0, 0, -0.8], "pair": [duct, beam]}
    assert c.post(f"/api/scenes/{sid}/fix/apply", json={"option": option, "reviewer": "Priya"}).status_code == 200
    rows = list(csv.reader(io.StringIO(c.get(f"/api/scenes/{sid}/edits?format=csv").text)))
    assert rows[0] == ["id", "when", "source", "kind", "title", "summary", "clashes", "follows", "changed", "created",
                       "removed", "warnings", "state", "actor", "check", "verified", "min_clearance_mm",
                       "checked_against"]   # the old columns first, in their order
    row = dict(zip(rows[0], rows[1]))
    check = ws.journal(sid).entries[0].check
    assert row["id"] == "E1" and row["source"] == "fix" and row["state"] == "kept" and row["actor"] == "Priya"
    assert row["verified"] == "true" and row["min_clearance_mm"] == str(round(check["min_clearance_m"] * 1000))
    assert row["checked_against"] == str(check["checked_against"]) and int(row["checked_against"]) >= 2
    assert row["check"] == (f"verified by geometry, nearest +{row['min_clearance_mm']} mm, "
                            f"against {row['checked_against']} elements")   # document.check_words


def test_a_plan_kept_by_a_reviewer_decides_each_fix_and_takes_a_key_the_server_cannot_work_out(scene):
    c, ws, sid, duct, beam = scene
    option = {"kind": "move", "title": "Raise the duct", "moved": [duct], "delta_m": [0, 0, 0.4], "pair": [duct, beam]}
    r = c.post(f"/api/scenes/{sid}/plan/apply", json={"options": [option], "clash_ids": ["c0001"], "reviewer": "Sam",
                                                       "clash_keys": ["nw|Coordination|Clash1"], "numbers": [12]})
    assert r.status_code == 200
    [d] = r.json()["decisions"]
    assert d["clash_key"] == "nw|Coordination|Clash1" and d["number"] == 12 and d["reviewer"] == "Sam"
    assert "reason" not in d and d["check"]["checked_against"] >= 1
    assert c.get(f"/api/scenes/{sid}/edits").json()["entries"][0]["actor"] == "Sam"


def test_a_keep_without_a_reviewer_still_records_the_decision(scene):
    c, ws, sid, duct, beam = scene
    option = {"kind": "move", "title": "Raise the duct", "moved": [duct], "delta_m": [0, 0, 0.4], "pair": [duct, beam]}
    [d] = c.post(f"/api/scenes/{sid}/fix/apply", json={"option": option}).json()["decisions"]
    assert d["decision"] == "accepted" and "reviewer" not in d and d["clash_key"] == "" and d["clash_id"] == ""
    assert c.get(f"/api/scenes/{sid}/edits").json()["entries"][0]["actor"] is None


def test_an_as_designed_root_cause_is_never_geometry_validated(tmp_path):
    from test_plans import _report_xml, _setup
    ws, sid, rid, main, beam = _setup(tmp_path)
    end = next(e for e in ws.scene(sid).model.by_type("IfcDuctSegment") if e.Tag != "SA-1").GlobalId
    (tmp_path / "reports" / "r4").mkdir(parents=True)
    (tmp_path / "reports" / "r4" / "report.xml").write_text(_report_xml([(main, beam, -0.15), (end, beam, -0.05)]))
    rid4 = ws.open_report_sample("r4").id

    class Cause:
        def complete_json(self, system, text, images=None):
            return {"root_cause": "they bear on the beam", "strategy": "as_designed", "reason": "mark them by design"}
    ws._model = Cause()
    plan = plans.build_root_cause(ws, sid, rid4, beam)
    assert plan.strategy == "as_designed" and plan.items == []
    assert plan.check["passed"] is False and plan.check["geometry"] is False
    assert plan.check["items"] == {} and plan.check["conflicts"] == []
