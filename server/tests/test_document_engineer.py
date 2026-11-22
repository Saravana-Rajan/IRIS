"""The coordination report for the engineer-first workflow (docs/engineer-workflow.md, step 10): the project and its
models on the cover, GlobalIds on each page, the kept fix as the edit log re-checked it, what backs a fix (never the
page's word alone), the reviewers' decisions as a proposal history and as BCF comments.

These test the HTML and the rows, not the PDF bytes: WeasyPrint needs pango, which a dev Mac may not have."""
import io
import zipfile
from pathlib import Path

import pytest

from iris import document
from iris.journal import Entry, Journal
from iris.reports import Report, ReportClash, ReportElement

GA, GB = "1eVHoPtl1IhAbbhivqVqb0", "2AbvqKF25LGeR0M34N_jld"   # the girder and the duct
AT = 1795341600.0   # 2026-11-22 10:00 UTC


def _report(source: str = "iris", ref: str | None = None) -> Report:
    a = ReportElement(GA, "IfcBeam", "TB-L02-01", "Level 02", "Structure.ifc")
    b = ReportElement(GB, "IfcDuctSegment", "SA-MAIN-L02-5", "Level 02", "MEP.ifc")
    c = ReportClash("c1", "Supply air main x girder", None, "Structure vs MEP", "hard", None, "new", -0.3, None, None,
                    a, b, source=source, number=42, ref=ref)
    other = ReportClash("c2", "Tray x girder", None, "Structure vs MEP", "hard", None, "new", -0.4, None, None,
                        ReportElement("3tQ7zxxRDMefPXL6hbHmO2", "IfcCableCarrierSegment", "LV-TRAY", "Level 02", "MEP.ifc"),
                        a, source=source, number=57)
    return Report("r", "Northbank", Path("."), [], [c, other], origin=source)


def _option(**over) -> dict:
    return {"title": "Raise the duct", "kind": "move", "moved": [GB], "delta_m": [0.0, 0.0, 0.4],
            "rationale": "Clear the girder web.", "also_needs": "", "min_clearance_m": 0.05, "checked_against": 120,
            "meets": [], **over}


def _kept(check: dict | None = None, option: dict | None = None, source: str = "fix") -> Entry:
    """An accepted fix as `plans.apply` records it: the option as re-checked at keep in `params.options`."""
    return Entry(id="E3", seq=3, at=AT, source=source, kind="move", title="Raise the duct",
                 summary="Raise the duct: move up 400 mm", params={"options": [option or _option()]}, elements=[GB],
                 names={GB: "IfcDuctSegment 'SA-MAIN-L02-5'"},
                 clashes=[{"id": "c1", "pair": [GA, GB]}],
                 check={"verified": True, "min_clearance_m": 0.05} if check is None else check)


def _journal(*entries, decisions=None) -> Journal:
    j = Journal()
    j.entries.extend(entries)
    if decisions is not None:
        j.decisions = decisions   # the field the engineer-workflow slice adds; read with getattr
    return j


def _rows(report=None, evidence=None, journal=None, decisions=None, matches=None):
    report = report or _report()
    return document.build_rows(report, {"c1": {"verdict": "real_clash", "severity": "high"}}, {}, matches, None,
                               evidence or {}, {}, {}, journal=journal, decisions=decisions)


def _page(rows, cid="c1") -> str:
    row = next(r for r in rows if r.clash.id == cid)
    return document._page(row, 1)


def _decision(**over) -> dict:
    return {"clash_id": "c1", "clash_key": f"hard|{'|'.join(sorted([GA, GB]))}", "number": 42,
            "option": {"title": "Raise the duct", "kind": "move", "moved": [GB], "delta_m": [0, 0, 0.4],
                       "rationale": "Clear the girder web."},
            "state": "geometry_validated", "decision": "rejected", "reason": "Ceiling void too shallow",
            "reviewer": "A. Engineer", "at": AT,
            "check": {"verified": True, "min_clearance_m": 0.05, "checked_against": 120}, **over}


# ------------------------------------------------------------------------------------------------- the cover

def test_the_cover_names_the_project_and_each_model_only_when_known():
    rows = _rows()
    models = [{"file": "Structure.ifc", "team": "Structure", "schema": "IFC4", "elements": 696},
              {"file": "MEP.ifc", "team": "MEP", "schema": "IFC2X3", "elements": 868}]
    html_text = document.render_html("t", "s", rows, {}, {}, project_name="Northbank tower", models=models)
    assert "Project: Northbank tower" in html_text
    assert "<h3>Models</h3>" in html_text and "<td>IFC2X3</td>" in html_text and "<td>868</td>" in html_text
    bare = document.render_html("t", "s", rows, {}, {})
    assert "Project:" not in bare and "<h3>Models</h3>" not in bare
    # Without the scene there is no schema or count to say: those columns are left out, not filled in.
    plain = document.render_html("t", "s", rows, {}, {}, models=[{"file": "MEP.ifc", "team": "MEP"}])
    assert "<th>Schema</th>" not in plain and "<th>Elements</th>" not in plain and "<td>MEP.ifc</td>" in plain


def test_model_info_reads_schema_and_count_from_the_open_scene_only(tmp_path):
    from iris.fixtures import build_edit_fixture
    from iris.scene import IfcScene
    scene = IfcScene(build_edit_fixture(tmp_path / "edit.ifc"))
    m = scene.models[0]
    info = document.model_info(["edit.ifc", "Other.ifc", "unknown model"], {"edit.ifc": "Structure"}, scene)
    assert info[0] == {"file": "edit.ifc", "team": "Structure", "schema": m.schema,
                       "elements": len(m.by_type("IfcElement"))}
    assert info[1] == {"file": "Other.ifc", "team": None}   # not open: nothing made up
    assert len(info) == 2                                    # "unknown model" is not a model
    assert document.model_info(["edit.ifc"], {}, None) == [{"file": "edit.ifc", "team": None}]


# ------------------------------------------------------------------------------------------------- a clash's page

def test_the_facts_carry_the_globalids_of_a_and_b():
    page = _page(_rows())
    assert f"GlobalId {GA}" in page and f"GlobalId {GB}" in page
    # Matched in the open scene: the scene's GlobalIds, not the report's.
    page = _page(_rows(matches={"c1": {"a": "0aaaaaaaaaaaaaaaaaaaaa", "b": "0bbbbbbbbbbbbbbbbbbbbb"}}))
    assert "GlobalId 0aaaaaaaaaaaaaaaaaaaaa" in page and f"GlobalId {GA}" not in page
    no_ids = _report()
    no_ids.clashes[0].a.global_id = no_ids.clashes[0].b.global_id = None
    assert "GlobalId" not in _page(_rows(no_ids))


def test_a_kept_fix_shows_what_the_edit_log_rechecked_at_keep():
    rows = _rows(journal=_journal(_kept()))
    row = rows[0]
    assert row.section == "page" and document.evidence_state(row) == "kept"
    fix = document.fix_html(row)
    assert "Geometry-validated at keep" in fix and "Applied to the model" in fix
    assert "<dt>Edit</dt><dd>move up 400 mm</dd>" in fix
    assert "<dt>Direction</dt><dd>up</dd>" in fix and "<dt>Distance</dt><dd>400 mm</dd>" in fix
    assert f"<dt>Moved element</dt><dd>IfcDuctSegment &#x27;SA-MAIN-L02-5&#x27; · GlobalId {GB}</dd>" in fix
    assert "<span class='ai-tag'>AI-drafted</span> Clear the girder web." in fix
    assert "<dt>Required clearance</dt><dd>25 mm</dd>" in fix      # no requirements: the 25 mm default the check used
    assert "<dt>Measured clearance</dt><dd>50 mm minimum, at keep</dd>" in fix
    assert "<dt>Checked against</dt><dd>120 elements, at keep</dd>" in fix
    assert "Passed again when kept (E3, 10:00 UTC)" in fix


def test_lines_without_data_are_left_out():
    bare = _option(rationale="", min_clearance_m=None, checked_against=None, delta_m=None, moved=[])
    fix = document.fix_html(_rows(journal=_journal(_kept(check={"verified": True}, option=bare)))[0])
    for line in ("Rationale", "Measured clearance", "Checked against", "Direction", "Distance", "Moved element"):
        assert f"<dt>{line}</dt>" not in fix
    assert "Geometry-validated at keep" in fix   # what backs it is still the log's check


def test_a_proposed_fix_is_verified_when_proposed_not_kept():
    ev = {"status": "proposed", "title": "Raise the duct", "kind": "move", "edit": "move up 400 mm", "clearance": "50 mm",
          "clearance_m": 0.05, "rationale": "Clear the girder web.", "also_needs": "", "moved": [GB]}
    row = _rows(evidence={"c1": ev})[0]
    page = _page([row])
    assert document.evidence_state(row) == "proposed"
    assert "Verified when proposed, not kept" in page and "Proposed, not applied" in page
    assert "<dt>Measured clearance</dt><dd>50 mm minimum, when proposed</dd>" in page
    assert "Re-check</dt><dd>Not run: the fix was not kept" in page
    assert "verified by geometry" not in page and "Geometry-validated" not in page
    assert f"GlobalId {GB}" in page and "IfcDuctSegment &#x27;SA-MAIN-L02-5&#x27;" in page   # named from the report


def test_the_pages_word_alone_never_makes_a_fix_verified():
    ev = {"status": "accepted", "title": "Raise the duct", "kind": "move", "edit": "move up 400 mm", "clearance": "50 mm",
          "clearance_m": 0.05, "rationale": "", "also_needs": "", "moved": [GB]}
    row = _rows(evidence={"c1": ev})[0]   # no edit log: the scene was closed, or the keep never happened
    page = _page([row])
    assert document.evidence_state(row) == "unrecorded"
    assert "No geometry record in this session" in page and "Applied to the model" in page
    assert "verified by geometry" not in page and "Geometry-validated" not in page


@pytest.mark.parametrize("ev", [
    {"status": "proposed", "title": "Leave as designed", "kind": "as_designed", "edit": "", "moved": []},
    {"status": "proposed", "title": "Leave as designed", "kind": "move", "edit": "", "moved": [],
     "check": {"passed": False, "geometry": False}},
])
def test_as_designed_is_never_geometry_validated(ev):
    row = _rows(evidence={"c1": ev})[0]
    page = _page([row])
    assert document.evidence_state(row) == "unchecked" and "Not geometry-checked" in page
    assert "verified by geometry" not in page and "Geometry-validated" not in page and "Verified when proposed" not in page


def test_an_as_designed_entry_in_the_log_is_not_geometry_checked():
    row = _rows(journal=_journal(_kept(check={"passed": False, "geometry": False})))[0]
    page = _page([row])
    assert document.evidence_state(row) == "unchecked"
    assert document.check_words({"check": {"passed": False, "geometry": False}}) == "not geometry-checked"
    assert "verified by geometry" not in page and "Geometry-validated" not in page


def test_a_kept_wider_fix_without_a_check_says_so():
    entry = _kept(check={}, source="wider")
    entry.params = {"proposal": "p1", "operations": []}
    row = _rows(journal=_journal(entry))[0]
    fix = document.fix_html(row)
    assert document.evidence_state(row) == "kept_unrecorded" and "no check recorded at keep" in fix
    assert "Geometry-validated" not in fix


def test_required_clearance_is_left_out_when_the_requirements_changed_since_the_keep():
    entry = _kept()
    entry.requirements = "an-older-requirements-id"
    fix = document.fix_html(_rows(journal=_journal(entry))[0])
    assert "Required clearance" not in fix and "Measured clearance" in fix


def test_a_plan_fix_reads_its_own_option_not_the_plans_least():
    mine, theirs = _option(min_clearance_m=0.08, checked_against=40), _option(title="Lower the tray", moved=["x"],
                                                                         min_clearance_m=0.03, checked_against=9)
    entry = _kept(check={"verified": True, "min_clearance_m": 0.03})
    entry.params = {"options": [theirs, mine]}
    entry.clashes = [{"id": "c2", "pair": ["x", GA]}, {"id": "c1", "pair": [GA, GB]}]
    fix = document.fix_html(_rows(journal=_journal(entry))[0])
    assert "80 mm minimum, at keep" in fix and "40 elements, at keep" in fix and "30 mm" not in fix


# ------------------------------------------------------------------------------------------------- decisions

def test_the_proposal_history_lists_each_decision_on_its_clash():
    other_clash = _decision(clash_id="c2", clash_key="hard|x|y", reviewer="B. Other")
    by_key = _decision(clash_id="gone-after-reopen", decision="accepted", reason="", reviewer=None, at=AT * 1000 + 60_000,
                       option={"title": "Offset the duct", "kind": "offset", "moved": [GB], "delta_m": [0, 0, 0.25]})
    rows = _rows(decisions=[by_key, _decision(), other_clash])
    row = next(r for r in rows if r.clash.id == "c1")
    assert [d["decision"] for d in row.decisions] == ["rejected", "accepted"]   # oldest first; c2's is not here
    history = document.decisions_html(row)
    assert "<h4>Proposal history</h4>" in history
    for text in ("Raise the duct", "move up 400 mm", "Geometry-validated", "50 mm minimum, against 120 elements",
                 "Rejected", "A. Engineer", "2026-11-22 10:00 UTC", "Ceiling void too shallow",
                 "Offset the duct", "Accepted", "2026-11-22 10:01 UTC"):
        assert text in history, text
    assert "Proposal history" in _page(rows)
    assert document.decisions_html(_rows()[0]) == "" and "Proposal history" not in _page(_rows())


def test_a_decision_alone_gives_its_clash_a_page():
    report = _report()
    rows = document.build_rows(report, {}, {}, None, None, {}, {}, {}, decisions=[_decision(clash_id="c2")])
    assert {r.clash.id: r.section for r in rows} == {"c1": "noise", "c2": "page"}


def test_a_navisworks_clash_is_found_by_its_key():
    report = _report(source="Northbank.xml", ref="Clash39")
    assert document.clash_key(report.clashes[0], report.title) == "nw|Northbank|Clash39"
    rows = _rows(report, decisions=[_decision(clash_id="old", clash_key="nw|Northbank|Clash39")])
    assert len(rows[0].decisions) == 1 and not rows[1].decisions


def test_a_decision_never_reads_more_than_its_check():
    as_designed = _decision(option={"title": "Leave it", "kind": "as_designed", "moved": []})
    not_passed = _decision(check={"verified": False, "reason": "hits the slab"})
    assert document.decision_state(as_designed) == "unverified"
    assert document.decision_state(not_passed) == "unverified"
    assert document.decision_state(_decision(state="failed_validation", check={"verified": False})) == "failed_validation"
    history = document.decisions_html(_rows(decisions=[as_designed, not_passed])[0])
    assert "Geometry-validated" not in history and "hits the slab" in history
    # The page's proposed fix that a decision says failed is not verified either.
    ev = {"status": "proposed", "title": "Raise the duct", "kind": "move", "edit": "", "moved": []}
    row = _rows(evidence={"c1": ev}, decisions=[_decision(state="failed_validation", check={"verified": False})])[0]
    assert document.evidence_state(row) == "failed" and "Verified when proposed" not in document.fix_html(row)


def test_the_bcf_carries_the_decisions_as_dated_comments():
    ev = {"status": "proposed", "title": "Raise the duct", "kind": "move", "edit": "move up 400 mm", "moved": [GB]}
    rows = _rows(evidence={"c1": ev}, decisions=[_decision()])
    bcf = zipfile.ZipFile(io.BytesIO(document.bcf_zip(rows, None, None)))
    markup = next(bcf.read(n).decode() for n in bcf.namelist() if n.endswith("markup.bcf")
                  and "Raise the duct" in bcf.read(n).decode())
    assert "<Author>A. Engineer (decision)</Author>" in markup and "<Date>2026-11-22T10:00:00Z</Date>" in markup
    assert "Rejected &#x27;Raise the duct&#x27; (move up 400 mm): Geometry-validated" in markup
    assert "Reason: Ceiling void too shallow" in markup
    assert "(proposed; Verified when proposed, not kept)" in markup and "verified by geometry" not in markup


def test_the_model_is_told_the_decisions_and_what_backs_the_fix():
    ev = {"status": "accepted", "title": "Raise the duct", "kind": "move", "edit": "move up 400 mm", "moved": [GB]}
    facts = document._facts(_rows(evidence={"c1": ev}, decisions=[_decision()])[0])
    assert "applied to the model; No geometry record in this session" in facts and "verified" not in facts.split("Reviewers")[0]
    assert "Reviewers' decisions: Rejected 'Raise the duct'" in facts


def test_a_fix_kept_through_plans_apply_reads_back_from_the_real_edit_log(tmp_path):
    """The shape `plans.apply` really records (not a hand-made entry): the page reads its option and check."""
    from iris import agent, plans
    from iris.fixtures import build_parametric_fixture
    from iris.service import Workspace
    build_parametric_fixture(tmp_path / "param.ifc")
    ws = Workspace(samples=tmp_path)
    sid = ws.open(["param.ifc"])
    scene = ws.scene(sid)
    g = {scene.entity(x).Name: x for x in scene.bounds()}
    attempt, option = agent._try_move(scene, {"title": "Lift the beam", "delta_m": [0, 0, 0.1],
                                              "rationale": "Clear the wall head."}, g["BM2"], 0.025)
    assert option is not None, attempt.reason
    plans.apply(ws, sid, [{**agent.asdict(option), "pair": [g["BM2"], g["W1"]]}], clash_ids=["c1"])
    a = ReportElement(g["BM2"], "IfcBeam", "BM2", None, "param.ifc")
    b = ReportElement(g["W1"], "IfcWall", "W1", None, "param.ifc")
    c = ReportClash("c1", "BM2 x W1", None, "Beams vs walls", "hard", None, "new", -0.1, None, None, a, b,
                    source="iris", number=3)
    (row,) = document.build_rows(Report("r", "t", Path("."), [], [c], origin="iris"), {}, {},
                                 {"c1": {"a": g["BM2"], "b": g["W1"]}}, scene, {}, {}, {}, journal=ws.journal(sid))
    fix = document.fix_html(row)
    assert row.section == "page" and document.evidence_state(row) == "kept"
    assert "Geometry-validated at keep" in fix and f"IfcBeam &#x27;BM2&#x27; · GlobalId {g['BM2']}" in fix
    assert "<dt>Direction</dt><dd>up</dd>" in fix and "<dt>Distance</dt><dd>100 mm</dd>" in fix
    assert "<dt>Required clearance</dt><dd>25 mm</dd>" in fix and "<dt>Checked against</dt>" in fix
    assert "AI-drafted</span> Clear the wall head." in fix and "Passed again when kept (E1" in fix
    assert document.model_info(["param.ifc"], {}, scene)[0]["schema"] == scene.models[0].schema


# ------------------------------------------------------------------------------------------------- a reopened project

def _saved(entry: Entry, session: str = "0123456789ab") -> dict:
    """An entry as a project's saved state holds it (projects.save): a dict with the session that kept it."""
    return {**entry.to_dict(), "session": session}


def _hand(id: str = "E3", clash: str = "c2") -> Entry:
    return Entry(id=id, seq=int(id[1:]), at=AT + 3600, source="you", kind="push_pull", title="Push the face",
                 summary="Push the tray's face 20 mm", params={"op": {"op": "push_pull"}}, elements=[GB],
                 clashes=[{"id": clash, "pair": None}], check={"cleared": [], "new": []})


def test_a_reopened_projects_kept_fix_is_labelled_from_its_saved_check():
    j = _journal()
    j.earlier = [_saved(_kept())]
    row = _rows(journal=j)[0]
    assert row.section == "page" and document.evidence_state(row) == "kept_earlier"
    fix = document.fix_html(row)
    assert "Geometry-validated at keep (earlier session)" in fix and "Applied to the model" in fix
    assert "<dt>Measured clearance</dt><dd>50 mm minimum, at keep</dd>" in fix
    assert "<dt>Checked against</dt><dd>120 elements, at keep</dd>" in fix
    assert "Passed again when kept (E3 (earlier session), 10:00 UTC)" in fix
    assert "<b>E3 (earlier session)</b>" in document.timeline_html(row)
    assert "E3 (earlier session) (accepted fix)" in document._facts(row)
    # Saved history that is not this clash's, or was undone, is not read; the same entry saved twice is read once.
    undone = {**_saved(_kept()), "id": "E2", "state": "undone"}
    j.earlier = [_saved(_kept()), _saved(_kept()), undone, {**_saved(_kept()), "clashes": [{"id": "c9", "pair": ["x", "y"]}]}]
    assert [e["id"] for e in _rows(journal=j)[0].edits] == ["E3"]
    # A failed or missing saved check is never validated.
    j.earlier = [_saved(_kept(check={}, source="wider"))]
    assert document.evidence_state(_rows(journal=j)[0]) == "kept_unrecorded"


def test_this_sessions_keep_comes_before_the_saved_history():
    j = _journal(_kept())
    j.earlier = [_saved(_kept())]
    row = _rows(journal=j)[0]
    assert document.evidence_state(row) == "kept" and len(row.edits) == 1 and not row.edits[0].get("earlier")
    assert "(earlier session)" not in document.fix_html(row)
    # A hand edit is not a keep: the saved fix still backs the clash, older than the edit.
    j = _journal(_hand(id="E1", clash="c1"))
    j.earlier = [_saved(_kept())]
    row = _rows(journal=j)[0]
    assert [(e["id"], bool(e.get("earlier"))) for e in row.edits] == [("E3", True), ("E1", False)]
    assert document.evidence_state(row) == "kept_earlier"


def test_e_ids_from_another_session_never_collide():
    """E-ids start again in each session: this session's E3 (a hand edit on c2) is not the saved E3 (c1's fix)."""
    j = _journal(_hand(id="E3", clash="c2"))
    j.earlier = [_saved(_kept())]
    rows = _rows(journal=j)
    c1 = next(r for r in rows if r.clash.id == "c1")
    assert [e["id"] for e in c1.edits] == ["E3"] and c1.edits[0]["earlier"]
    mine = _hand(id="E3", clash="c2").to_dict()
    assert not document._concerns(mine, [c1]), "the same E-id from another session is another entry"
    assert document._concerns(mine, [next(r for r in rows if r.clash.id == "c2")])
    assert document.entry_key(c1.edits[0]) != document.entry_key(mine)
    # Two saved sessions with the same E-id are both kept apart.
    j.earlier = [_saved(_kept(), session="aaaaaaaaaaaa"), _saved(_kept(), session="bbbbbbbbbbbb")]
    assert len(_rows(journal=j)[0].edits) == 2


# ------------------------------------------------------------------------------------------------- the whole job

def test_generate_reads_the_journals_decisions_and_names_the_project(tmp_path, monkeypatch):
    from test_document import Writer
    pages: list[str] = []
    monkeypatch.setattr(document, "to_pdf", lambda html_text: pages.append(html_text) or b"%PDF-1.7")
    report = _report()
    verdicts = {c.id: {"verdict": "real_clash", "severity": "high", "responsible": "MEP"} for c in report.clashes}
    data, name, media = document.generate(
        report, verdicts, Writer(), scope="combined", model_teams={}, matches=None, scene=None, evidence={},
        reviews={}, marks={}, include_bcf=True, journal=_journal(_kept(), decisions=[_decision()]),
        project_name="Northbank tower")
    assert media == "application/zip" and len(pages) == 1
    assert "Project: Northbank tower" in pages[0] and "Proposal history" in pages[0]
    assert "Geometry-validated at keep" in pages[0] and "<h3>Models</h3>" in pages[0]
    bcf = zipfile.ZipFile(io.BytesIO(zipfile.ZipFile(io.BytesIO(data)).read("iris-issues.bcfzip")))
    assert any("A. Engineer (decision)" in bcf.read(n).decode() for n in bcf.namelist() if n.endswith("markup.bcf"))
    # A journal without decisions (before the workflow slice), and an explicit list, both work.
    pages.clear()
    document.generate(report, verdicts, Writer(), scope="combined", model_teams={}, matches=None, scene=None,
                      evidence={}, reviews={}, marks={}, include_bcf=False, journal=Journal())
    assert "Proposal history" not in pages[0] and "Project:" not in pages[0]
    pages.clear()
    document.generate(report, verdicts, Writer(), scope="combined", model_teams={}, matches=None, scene=None,
                      evidence={}, reviews={}, marks={}, include_bcf=False, decisions=[_decision()])
    assert "Proposal history" in pages[0]
