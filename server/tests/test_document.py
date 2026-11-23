import base64
import io
import json
import zipfile
from collections import Counter

import numpy as np
import pytest
from PIL import Image

from iris import document, model_client, triage
from tests.test_triage import _report


class Writer:
    """A report model: explains every page and drafts a summary."""

    def __init__(self):
        self.asked = []

    def complete_json(self, system, text, images=None, schema=None):
        self.asked.append(schema)
        if schema == document.SUMMARY_SCHEMA:
            return {"summary": "Three real clashes.", "team_actions": [{"team": "MEP", "actions": ["Raise the duct."]}]}
        return {"explanation": "The duct runs through the beam.", "recommended_action": "Raise the duct 400 mm.",
                "review_points": [{"team": "Structure", "point": "Confirm the web opening."}]}


def _jpeg() -> str:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (200, 80, 60)).save(buf, "JPEG")
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def test_team_guess_comes_from_content_not_the_name():
    assert document.guess_team(Counter({"IfcDuctSegment": 40, "IfcBeam": 2}), "Model-02.ifc") == "MEP"
    assert document.guess_team(Counter({"IfcBeam": 30, "IfcColumn": 10, "IfcDuctSegment": 3}), "Level2.ifc") == "Structure"
    assert document.guess_team(Counter({"IfcSlab": 5}), "Northbank-Architecture.ifc") == "Architecture"


def test_who_acts_and_who_reviews():
    assert document.teams_for("Structure", "MEP", None, None) == ("MEP", ["Structure", "MEP"])
    assert document.teams_for("Structure", "MEP", "a", None) == ("Structure", ["Structure", "MEP"])  # the fix moved A
    assert document.teams_for("Structure", "Architecture", None, "Structure") == ("Structure", ["Structure", "Architecture"])
    assert document.teams_for("MEP", "MEP", None, "Structure") == ("MEP", ["MEP"])  # triage named a team not involved


def test_pdfs_per_team_and_bcf(tmp_path):
    report = _report(tmp_path)
    verdicts = triage.triage_report(report, _AllReal(), lambda e: None, workers=1, images=False)
    first = report.clashes[0]
    evidence = {first.id: {"status": "accepted", "title": "Raise the duct", "edit": "+400 mm", "clearance": "50 mm",
                           "clearance_m": 0.05, "before_img": _jpeg(), "after_img": _jpeg()}}
    reviews = {first.id: [{"team": "MEP", "name": "A. Engineer", "decision": "approve", "note": "ok", "at": "2026-10-27"}]}
    model, events = Writer(), []
    data, name, media = document.generate(
        report, verdicts, model, scope="team", model_teams={}, matches=None, scene=None, evidence=evidence,
        reviews=reviews, marks={}, include_bcf=True, emit=events.append)
    assert media == "application/zip" and name == "iris-report.zip"
    z = zipfile.ZipFile(io.BytesIO(data))
    pdfs = [n for n in z.namelist() if n.endswith(".pdf")]
    assert pdfs and all(n.startswith("iris-report-") for n in pdfs)
    assert pdfs and all(z.read(n).startswith(b"%PDF") for n in pdfs)
    bcf = zipfile.ZipFile(io.BytesIO(z.read("iris-issues.bcfzip")))
    topics = [n for n in bcf.namelist() if n.endswith("markup.bcf")]
    pages = sum(1 for c in report.clashes if verdicts[c.id]["verdict"] == "real_clash" or c.id == first.id)
    assert len(topics) == pages and "bcf.version" in bcf.namelist()
    assert any("A. Engineer" in bcf.read(t).decode() for t in topics)
    assert any(e.get("step") == "explaining" for e in events) and document.SUMMARY_SCHEMA in model.asked


def test_combined_without_bcf_is_one_pdf_and_stays_draft(tmp_path):
    report = _report(tmp_path)
    verdicts = {c.id: {"verdict": "real_clash", "severity": "high", "responsible": "MEP"} for c in report.clashes}
    rows = document.build_rows(report, verdicts, {}, None, None, {}, {}, {})
    html_text = document.render_html("t", "s", rows, {"summary": "x"}, {})
    assert "DRAFT" in html_text
    data, name, media = document.generate(report, verdicts, Writer(), scope="combined", model_teams={}, matches=None,
                                          scene=None, evidence={}, reviews={}, marks={}, include_bcf=False)
    assert media == "application/pdf" and data.startswith(b"%PDF") and name == "iris-report.pdf"


def test_a_report_without_triage_keeps_an_accepted_fix_and_lists_the_rest_as_not_triaged(tmp_path):
    # Triage is optional: the fixed clash gets its page; every other clash is "not triaged", never noise or action.
    report = _report(tmp_path)
    first = report.clashes[0]
    evidence = {first.id: {"status": "accepted", "title": "Raise the duct", "edit": "+400 mm", "clearance": "50 mm",
                           "clearance_m": 0.05, "before_img": _jpeg(), "after_img": _jpeg()}}
    rows = document.build_rows(report, {}, {}, None, None, evidence, {}, {})
    assert {r.clash.id: r.section for r in rows} == {c.id: "page" if c.id == first.id else "untriaged"
                                                      for c in report.clashes}
    rest = len(report.clashes) - 1
    html_text = document.render_html("Report", "Coordination", rows, {}, {})
    assert "Raise the duct" in html_text and "With the fix (applied)" in html_text
    assert "<h2 style='margin-top:14pt'>Not triaged</h2>" in html_text
    assert f"<div class='count'><b>{rest}</b>not triaged</div>" in html_text
    assert "<div class='count'><b>1</b>need action</div>" in html_text
    assert "<div class='count'><b>0</b>noise</div>" in html_text
    assert f"{rest} of {len(rows)} results were not triaged" in html_text
    # Reviewed by every team, the page alone can't make it final: the untriaged rest might still need action.
    (page,) = [r for r in rows if r.section == "page"]
    page.reviews = [{"team": t, "name": "A. Engineer", "decision": "approve"} for t in page.reviewers]
    reviewed = document.render_html("Report", "Coordination", rows, {}, {})
    assert f"DRAFT · AI-assisted · 1 of 1 reviewed · {rest} not triaged" in reviewed and "REVIEWED ·" not in reviewed
    # Only the page is explained (one model call) and only it becomes a BCF issue.
    model = Writer()
    document.explain(model, rows, lambda e: None)
    assert model.asked == [document.EXPLAIN_SCHEMA]
    bcf = zipfile.ZipFile(io.BytesIO(document.bcf_zip(rows, None, None)))
    assert len([n for n in bcf.namelist() if n.endswith("markup.bcf")]) == 1
    # Triaged later: the same clashes sort into their sections and nothing is left "not triaged".
    verdicts = {c.id: {"verdict": "by_design"} for c in report.clashes}
    assert "untriaged" not in {r.section for r in document.build_rows(report, verdicts, {}, None, None, evidence, {}, {})}


def test_the_report_names_the_triage_model_that_ran(tmp_path, monkeypatch):
    report = _report(tmp_path)
    rows = document.build_rows(report, {}, {}, None, None, {}, {}, {})
    flash_run = {"model": "gemini-3.8-flash", "label": "Gemini Flash", "images": True}
    pro_run = {"model": "gemini-4-argon", "label": "Gemini Pro", "images": True}
    assert "the rest by Gemini Flash (Google)." in document.render_html("t", "s", rows, {}, {}, None, flash_run)
    html_text = document.render_html("t", "s", rows, {}, {}, None, pro_run)
    assert "the rest by Gemini Pro (Google)." in html_text and "the rest by Gemini Flash" not in html_text
    # Without a run (a restart), the model triage would run on now.
    monkeypatch.setattr(document, "triage_model_info", lambda: pro_run)
    assert "the rest by Gemini Pro (Google)." in document.render_html("t", "s", rows, {}, {})


@pytest.mark.parametrize("kind", ["context", "move", None])
def test_screenshot_facts_do_not_assign_pair_colours_to_coordinated_edits(tmp_path, monkeypatch, kind):
    report = _report(tmp_path)
    first = report.clashes[0]
    first.images = [("A", tmp_path / "navisworks.jpg")]
    monkeypatch.setattr(document, "_zone_crop", lambda _: _jpeg())
    fix = {"status": "accepted", "title": "Coordinated fix" if kind == "context" else "Raise the duct",
           "before_img": _jpeg(), "after_img": _jpeg()}
    if kind is not None:
        fix["kind"] = kind
    rows = document.build_rows(report, {}, {}, None, None, {first.id: fix}, {}, {})
    html_text = document.render_html("Report", "Coordination", rows, {}, {})
    if kind == "context":
        assert "<th>A</th>" in html_text and "<th>B</th>" in html_text
        assert "<th>A (red)</th>" not in html_text and "<th>B (green)</th>" not in html_text
    else:
        assert "<th>A (red)</th>" in html_text and "<th>B (green)</th>" in html_text
    assert "Navisworks view, zoomed to where they meet (red A, green B)" in html_text
    assert "The model as it is" in html_text and "With the fix (applied)" in html_text


class _AllReal:
    def complete_json(self, system, text, images=None, schema=None):
        return {"understanding": "Clash.", "verdict": "real_clash", "severity": "high", "responsible": "MEP",
                "action": "move_B", "fix_hint": "Move it.", "confidence": 0.9}


def test_a_kept_fix_page_shows_its_built_view_or_why_not(tmp_path, monkeypatch):
    from iris import built
    report = _report(tmp_path)
    first, second = report.clashes[0], report.clashes[1]
    first.images = [("A", tmp_path / "navisworks.jpg")]
    monkeypatch.setattr(document, "_zone_crop", lambda _: _jpeg())   # four pictures: the crop, before, after, built
    monkeypatch.setattr(built, "CACHE", tmp_path / "built")
    out = built._keep("a" * 32, np.full((64, 64, 3), 120, np.uint8), b"lines",
                      {"f": 0.9, "tile": 0.1, "passed": True}, [], 2, 30.0)
    fix = {"status": "accepted", "title": "Raise the duct", "before_img": _jpeg(), "after_img": _jpeg()}
    evidence = {first.id: {**fix, "built_img": out["image_url"]},
                second.id: {**fix, "built_note": "The image model couldn't keep to the model here."}}
    rows = document.build_rows(report, {}, {}, None, None, evidence, {}, {})
    html_text = document.render_html("Report", "Coordination", rows, {}, {})
    image = model_client.model_label(model_client.model_id("image"))
    assert html_text.count(f"As it could look built (illustration by {image}") == 1
    assert "class='pics four'" in html_text
    assert "No built view: The image model couldn&#x27;t keep to the model here." in html_text
