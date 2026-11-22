"""Iris Bench report: Markdown plus a self-contained HTML page (inline SVG, no external libraries).

Sections, in order: headline accuracy per job; scores by category; sounds reasonable vs geometrically correct
(calibration, ECE, confidently wrong, plausible-but-wrong answers next to the checker's geometry verdict);
cost-weighted score; controls; J3 partial credit; challenge slices; error taxonomy; benchmark integrity (from
`integrity.json`, written by `iris-bench verify`); sample items.

Every reader is defensive: rows from older runs that lack the newer tables or keys still render.
"""
from __future__ import annotations

import html
import json
import math
import os
from collections import defaultdict
from pathlib import Path

from iris_bench.score import COST_WEIGHTS, item_rows
from iris_bench.spec import CATEGORIES, Item, Result

JOB_NAMES = {"J1_sort": "J1 sort", "J2_who_moves": "J2 who moves", "J3_fix": "J3 fix",
             "J4_opening": "J4 opening", "J5_review": "J5 review", "J6_new_clash": "J6 new clash",
             "J7_pick_valid": "J7 pick valid", "J8_spatial": "J8 spatial", "J9_relation": "J9 relation",
             "ALL": "All jobs"}
CATEGORY_NAMES = {"clash_identification": "Clash identification",
                  "relationship_understanding": "Relationship understanding",
                  "element_selection": "Element selection", "spatial_reasoning": "Spatial reasoning",
                  "opening_selection": "Opening selection", "movement_estimation": "Movement estimation",
                  "resolution_validity": "Resolution validity", "new_clash_detection": "New clash detection",
                  "ALL": "All categories"}
MODE_ORDER = ("pictures", "pictures_text", "no_image", "swapped")
FAKE_NOTE = ("**FAKE MODEL**: `{m}` is the offline stand-in (random answers at a set accuracy). "
             "Its numbers test the pipeline only; they say nothing about any real model.")
REASONABLE_NOTE = ("A model's stated confidence and its written reason are what its answer *sounds like*; the "
                   "checker's geometry verdict, measured on the scene, is what is *true*. Calibration compares the "
                   "two: in a well-calibrated model, answers given at 80% confidence are right about 80% of the time "
                   "(ECE = expected calibration error, the n-weighted gap between confidence and accuracy over five "
                   "equal-width buckets; 0 is perfect). *Confidently wrong* = confidence of at least {t:g} and an "
                   "incorrect answer. *Plausible but wrong* = an incorrect answer whose reason names the right "
                   "elements or opening: it talks about the right things and still gets the geometry wrong.")
PLAUSIBLE_TOP = 15
CONFIDENT = 0.8
INTEGRITY_FILE = "integrity.json"


def is_fake(model: str) -> bool:
    return str(model).lower().startswith("fake")


def _isnan(v) -> bool:
    return v is None or (isinstance(v, float) and math.isnan(v)) or not isinstance(v, (int, float)) \
        or isinstance(v, bool)


def _pct(v) -> str:
    return "-" if _isnan(v) else f"{100 * v:.0f}%"


def _ci(r: dict) -> str:
    return f"{_pct(r.get('accuracy'))} [{_pct(r.get('ci_lo'))}, {_pct(r.get('ci_hi'))}]"


def _signed(v) -> str:
    return "-" if _isnan(v) else f"{100 * v:+.0f} pts"


def _num(v, digits: int = 3) -> str:
    return "-" if _isnan(v) else f"{v:.{digits}f}"


def _rows(scores: list[dict], table: str) -> list[dict]:
    return [r for r in scores if r.get("table") == table]


def _models(scores: list[dict]) -> list[str]:
    return sorted({r["model"] for r in scores if "model" in r})


def _mode_key(m) -> tuple:
    return (MODE_ORDER.index(m) if m in MODE_ORDER else len(MODE_ORDER), str(m))


def _modes(rows: list[dict]) -> list[str]:
    return sorted({r.get("mode") for r in rows if r.get("mode") is not None}, key=_mode_key)


def _cat_key(c) -> tuple:
    if c == "ALL":
        return (-1, "")
    return (CATEGORIES.index(c) if c in CATEGORIES else len(CATEGORIES), str(c))


def _cat(c) -> str:
    return CATEGORY_NAMES.get(c, str(c))


def _job(j) -> str:
    return JOB_NAMES.get(j, str(j))


def _conf_val(v) -> float:
    return -1.0 if _isnan(v) else float(v)


def worst_slices(scores: list[dict], top: int = 10, min_n: int = 3) -> list[dict]:
    """Challenge slices with the biggest drop below the same model x job x mode overall accuracy."""
    base = {(r["model"], r["job"], r["mode"]): r["accuracy"] for r in _rows(scores, "accuracy")}
    out = []
    for r in _rows(scores, "slice"):
        b = base.get((r["model"], r["job"], r["mode"]))
        if b is None or r["n"] < min_n or b - r["accuracy"] <= 0:
            continue
        out.append({**r, "overall": b, "drop": b - r["accuracy"]})
    return sorted(out, key=lambda r: -r["drop"])[:top]


def plausible_rows(scores: list[dict], top: int = PLAUSIBLE_TOP) -> list[dict]:
    """Plausible-but-wrong answers to show: pictures mode first (any mode when pictures has none), most confident
    first, at most `top`."""
    pw = _rows(scores, "plausible_wrong")
    pick = [r for r in pw if r.get("mode") == "pictures"] or pw
    return sorted(pick, key=lambda r: (-_conf_val(r.get("confidence")), str(r.get("model")),
                                       str(r.get("item_id"))))[:top]


def load_integrity(run_dir: Path) -> dict | None:
    """`run_dir/integrity.json` when present and readable, else None."""
    p = Path(run_dir) / INTEGRITY_FILE
    try:
        return json.loads(p.read_text()) if p.exists() else None
    except (OSError, ValueError):
        return None


def _check_icon(c: dict) -> str:
    if c.get("ok") is True:
        return "✅"
    if c.get("ok") is None or c.get("severity") == "warn":
        return "⚠️"
    return "❌"


def _check(integ: dict, name: str) -> dict:
    return next((c for c in integ.get("checks") or [] if isinstance(c, dict) and c.get("name") == name), {})


def _balance_rows(integ: dict) -> list[dict]:
    jobs = (_check(integ, "answer_balance").get("details") or {}).get("jobs") or []
    return [j for j in jobs if isinstance(j, dict)]


def _rederived(integ: dict) -> tuple[dict, list[tuple]]:
    """(totals, per-job rows (job, checked, matched, mismatched, skipped)) from the truth_rederived check."""
    det = _check(integ, "truth_rederived").get("details") or {}
    pj = det.get("per_job") or {}
    pairs = sorted(pj.items()) if isinstance(pj, dict) else \
        [(v.get("job"), v) for v in pj if isinstance(v, dict)] if isinstance(pj, list) else []
    rows = []
    for job, v in pairs:
        if isinstance(v, dict):   # integrity.py writes status counts {"match": n, "mismatch": n, "skipped": n}
            m, mm, sk = (v.get(a, v.get(b, 0)) for a, b in (("matched", "match"), ("mismatched", "mismatch"),
                                                            ("skipped", "skip")))
            checked = v.get("checked", sum(x for x in (m, mm, sk) if isinstance(x, (int, float))))
            rows.append((job, checked, m, mm, sk))
        else:
            rows.append((job, v, "-", "-", "-"))
    return det, rows


def _thumb(path: str, item: Item, run_dir: Path, report_dir: Path) -> str:
    """A path to the image relative to the report, trying absolute, run-relative and scene-relative."""
    p = Path(path)
    cands = [p] if p.is_absolute() else [run_dir / p, run_dir / "scenes" / str(item.seed) / p]
    if item.meta.get("scene_dir"):
        cands.append(Path(item.meta["scene_dir"]) / p)
    for c in cands:
        if c.exists():
            return os.path.relpath(c.resolve(), report_dir.resolve())
    return os.path.relpath(cands[-1], report_dir) if not p.is_absolute() else str(p)


def sample_items(items: list[Item], results: list[Result], per_job: int = 2) -> list[dict]:
    """A few right and wrong answers per job for the picture gallery (deterministic: first by id)."""
    by_id = {it.id: it for it in items}
    by_res = {(x.item_id, x.model): x for x in results}
    rows = sorted(item_rows(items, results), key=lambda r: r["item_id"])
    picked, seen = [], defaultdict(lambda: {True: 0, False: 0})
    for r in rows:
        if r["mode"] != "pictures":
            continue
        ok = r["correct"] == 1.0
        if seen[(r["model"], r["job"])][ok] >= per_job:
            continue
        seen[(r["model"], r["job"])][ok] += 1
        res = by_res.get((r["item_id"], r["model"]))
        if res is None:
            continue
        picked.append({**r, "item": by_id[r["item_id"]], "result": res})
    return picked


def _model_says(reply) -> str:
    """The model's own confidence and reason, when its reply carries them."""
    if not isinstance(reply, dict):
        return ""
    bits = []
    c = reply.get("confidence")
    if not _isnan(c):
        bits.append(f"confidence {float(c):.2f}")
    why = reply.get("reason")
    if why:
        bits.append(f"reason: {_short(why, 300)}")
    return "; ".join(bits)


def _short(v, n: int = 200) -> str:
    s = str(v).replace("`", "'").replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"


# ---------------------------------------------------------------- Markdown

def _md_table(head: list[str], rows: list[list]) -> str:
    lines = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def _mdc(v, n: int = 220) -> str:
    """A Markdown table cell: one line, pipes escaped."""
    if v is None or v == "":
        return "-"
    return _short(v, n).replace("|", "\\|")


def _cat_cell(r: dict | None) -> str:
    return f"{_ci(r)} n={r.get('n', 0)}" if r else "-"


def _md_categories(scores: list[dict], models: list[str]) -> list[str]:
    cat = _rows(scores, "category")
    out = ["## Scores by category (95% bootstrap CI)", ""]
    if not cat:
        return out + ["_No category scores in this run._", ""]
    cats = sorted({r.get("category") for r in cat}, key=_cat_key)
    out += ["Each item is scored under its task category (one job can feed several). Mode: pictures.", ""]
    rows = []
    for m in models:
        cell = {r.get("category"): r for r in cat if r.get("model") == m and r.get("mode") == "pictures"}
        if cell:
            rows.append([m + (" (fake)" if is_fake(m) else "")] + [_cat_cell(cell.get(c)) for c in cats])
    out += [_md_table(["Model"] + [_cat(c) for c in cats], rows) if rows else "_No pictures-mode items._", ""]
    modes = _modes(cat)
    if len(modes) > 1 or "pictures" not in modes:
        out += ["### Categories by mode", ""]
        for m in models:
            mr = [r for r in cat if r.get("model") == m]
            if not mr:
                continue
            cell = {(r.get("category"), r.get("mode")): r for r in mr}
            out += [f"**{m}**", "",
                    _md_table(["Category"] + modes,
                              [[_cat(c)] + [_cat_cell(cell.get((c, md))) for md in modes]
                               for c in sorted({r.get("category") for r in mr}, key=_cat_key)]), ""]
    return out


def _md_reasonable(scores: list[dict]) -> list[str]:
    summ = sorted(_rows(scores, "calibration_summary"), key=lambda r: (str(r.get("model")), _mode_key(r.get("mode"))))
    cal = sorted(_rows(scores, "calibration"),
                 key=lambda r: (str(r.get("model")), _mode_key(r.get("mode")), _conf_val(r.get("lo"))))
    cw = sorted(_rows(scores, "confidently_wrong"),
                key=lambda r: (str(r.get("model")), _mode_key(r.get("mode")), _cat_key(r.get("category"))))
    thr = next((r.get("threshold") for r in cw if not _isnan(r.get("threshold"))), CONFIDENT)
    out = ["## Sounds reasonable vs geometrically correct", "", REASONABLE_NOTE.format(t=thr), ""]

    out += ["### Calibration", ""]
    if summ:
        out += [_md_table(["Model", "Mode", "n", "With confidence", "Mean confidence", "Accuracy", "ECE", "Brier",
                           "Overconfidence"],
                          [[r.get("model"), r.get("mode"), r.get("n", "-"),
                            f"{r.get('n_conf', '-')} ({_pct(r.get('coverage'))})", _pct(r.get("mean_conf")),
                            _pct(r.get("accuracy")), _num(r.get("ece")), _num(r.get("brier")),
                            _signed(r.get("overconfidence"))] for r in summ]), ""]
    else:
        out += ["_No replies carried a confidence._", ""]
    if cal:
        out += ["### Accuracy per confidence bucket", ""]
        out += [_md_table(["Model", "Mode", "Confidence", "n", "Mean confidence", "Accuracy", "Gap"],
                          [[r.get("model"), r.get("mode"), r.get("bucket", "-"), r.get("n", "-"),
                            _pct(r.get("mean_conf")), _pct(r.get("accuracy")), _signed(r.get("gap"))]
                           for r in cal]), ""]

    out += [f"### Confidently wrong (confidence ≥ {thr:g} and incorrect)", ""]
    if cw:
        out += [_md_table(["Model", "Mode", "Category", "Rate", "Confidently wrong / with confidence",
                           "Share of confident answers"],
                          [[r.get("model"), r.get("mode"), _cat(r.get("category")), _pct(r.get("rate")),
                            f"{r.get('n_cw', 0)} / {r.get('n_conf', 0)}", _pct(r.get("share_of_confident"))]
                           for r in cw]), ""]
    else:
        out += ["_No confidence data._", ""]

    pw = plausible_rows(scores)
    out += ["### Plausible but wrong", "",
            "Incorrect answers whose reason names the right elements or opening, most confident first: what the "
            "model said next to what the geometry says.", ""]
    if pw:
        out += [_md_table(["Item", "Model", "Job", "Confidence", "Model's reason", "Geometry verdict (checker)",
                           "Answer", "Reference", "Reason names"],
                          [[f"`{r.get('item_id')}`", r.get("model"), _job(r.get("job")),
                            _num(r.get("confidence"), 2), _mdc(r.get("model_reason")), _mdc(r.get("checker_reason")),
                            _mdc(r.get("answer"), 80), _mdc(r.get("truth_answer"), 80),
                            _mdc(", ".join(str(x) for x in (r.get("mentions") or [])), 60)] for r in pw]), ""]
    else:
        out += ["_No plausible-but-wrong answers._", ""]
    return out


def _md_integrity(integ: dict | None) -> list[str]:
    out = ["## Benchmark integrity", ""]
    if not integ:
        return out + ["_Integrity not checked: run `iris-bench verify --out <run>`._", ""]
    ok = integ.get("ok")
    out += [f"**Overall: {'PASS' if ok else 'FAIL'}** · items: {integ.get('n_items', '-')} · checked "
            f"{integ.get('generated_at', '-')}", ""]
    checks = [c for c in integ.get("checks") or [] if isinstance(c, dict)]
    if checks:
        out += [_md_table(["", "Check", "Summary"],
                          [[_check_icon(c), _mdc(c.get("title") or c.get("name")), _mdc(c.get("summary"), 400)]
                           for c in checks]), ""]
    bal = _balance_rows(integ)
    if bal:
        out += ["### Answer balance and chance baselines", "",
                "Majority share = accuracy of always giving the most common reference answer; chance = accuracy "
                "of guessing uniformly among the offered options.", ""]
        out += [_md_table(["Job", "n", "Majority answer", "Majority share", "Chance level", ""],
                          [[_job(b.get("job")), b.get("n", "-"), _mdc(b.get("majority_answer"), 60),
                            _pct(b.get("majority_share")), _pct(b.get("chance")), "⚠️ imbalanced" if b.get("imbalanced")
                            else ""] for b in bal]), ""]
    det, rows = _rederived(integ)
    if det:
        out += ["### Reference answers re-derived from scene.json", "",
                f"Checked {det.get('checked', '-')}, matched {det.get('matched', '-')}, mismatched "
                f"{det.get('mismatched', '-')}, skipped {det.get('skipped', '-')}.", ""]
        if rows:
            out += [_md_table(["Job", "Checked", "Matched", "Mismatched", "Skipped"],
                              [[_job(j), *rest] for j, *rest in rows]), ""]
    return out


def render_markdown(scores: list[dict], items: list[Item], results: list[Result], run_dir: Path,
                    report_dir: Path | None = None, title: str = "Iris Bench report",
                    integrity: dict | None = None) -> str:
    run_dir = Path(run_dir)
    report_dir = Path(report_dir or run_dir)
    integ = integrity if integrity is not None else load_integrity(run_dir)
    models = _models(scores)
    out = [f"# {title}", ""]
    for m in models:
        if is_fake(m):
            out += ["> " + FAKE_NOTE.format(m=m), ""]
    out += [f"Items: {len(items)}. Results: {len(results)}. Models: {', '.join(f'`{m}`' for m in models) or '-'}.", ""]
    if integ:
        out += [f"Integrity: **{'PASS' if integ.get('ok') else 'FAIL'}** (see *Benchmark integrity*).", ""]

    acc = _rows(scores, "accuracy")
    jobs = sorted({r["job"] for r in acc if r["job"] != "ALL"}) + ["ALL"]
    out += ["## Headline: accuracy with pictures (95% bootstrap CI)", ""]
    head = ["Model"] + [_job(j) for j in jobs]
    rows = []
    for m in models:
        cell = {r["job"]: r for r in acc if r["model"] == m and r["mode"] == "pictures"}
        rows.append([m + (" (fake)" if is_fake(m) else "")] +
                    [f"{_ci(cell[j])} n={cell[j]['n']}" if j in cell else "-" for j in jobs])
    out += [_md_table(head, rows), ""]

    out += _md_categories(scores, models)
    out += _md_reasonable(scores)

    cost = _rows(scores, "cost")
    if cost:
        out += ["## Cost-weighted score (pictures)", "",
                "Illustrative weights per error type, not measured costs: " +
                ", ".join(f"{k} {v:g}" for k, v in COST_WEIGHTS.items()) +
                ". Score = 1 - total cost / (items x max weight).", ""]
        out += [_md_table(["Model", "Job", "Accuracy", "Cost-weighted", "Mean cost"],
                          [[r["model"], _job(r["job"]), _pct(r["accuracy"]),
                            _pct(r["cost_weighted_score"]), f"{r['mean_cost']:.2f}"]
                           for r in cost if r["mode"] == "pictures"]), ""]

    ctl = _rows(scores, "control")
    out += ["## Controls: does the picture matter?", "",
            "Delta = control accuracy minus pictures accuracy on the same questions (paired). "
            "A model that truly uses the picture drops on `no_image` and `swapped`.", ""]
    out += [_md_table(["Model", "Job", "Control", "n", "Pictures", "Control acc", "Delta [95% CI]"],
                      [[r["model"], _job(r["job"]), r["mode"], r["n"], _pct(r["acc_pictures"]),
                        _pct(r["acc_control"]), f"{_signed(r['delta'])} [{_signed(r['ci_lo'])}, {_signed(r['ci_hi'])}]"]
                       for r in ctl]) if ctl else "_No control items in this run._", ""]

    part = _rows(scores, "partial")
    if part:
        out += ["## J3 partial credit", ""]
        out += [_md_table(["Model", "Mode", "n", "Direction right", "Distance in band", "Right opening"],
                          [[r["model"], r["mode"], r["n"], _pct(r.get("direction_right")),
                            _pct(r.get("distance_in_band")), _pct(r.get("right_opening"))] for r in part]), ""]

    ws = worst_slices(scores)
    out += ["## Where accuracy drops (challenge slices)", ""]
    out += [_md_table(["Model", "Job", "Mode", "Factor", "Bucket", "n", "Slice acc", "Overall", "Drop"],
                      [[r["model"], _job(r["job"]), r["mode"], r["factor"], r["bucket"], r["n"],
                        _pct(r["accuracy"]), _pct(r["overall"]), _signed(r["drop"])] for r in ws])
            if ws else "_No slices with enough items._", ""]

    tax = _rows(scores, "taxonomy")
    out += ["## Error taxonomy", ""]
    out += [_md_table(["Model", "Job", "Mode", "Error", "Count", "Share", "Weight"],
                      [[r["model"], _job(r["job"]), r["mode"], r["error"], r["count"],
                        _pct(r["share_of_items"]), f"{r['weight']:g}"] for r in tax]) if tax else "_No errors._", ""]

    out += _md_integrity(integ)

    samples = sample_items(items, results)
    if samples:
        out += ["## Sample items", ""]
        for s in samples:
            it, res = s["item"], s["result"]
            mark = "✅" if s["correct"] == 1.0 else "❌"
            imgs = " ".join(f"![{Path(p).name}]({_thumb(p, it, run_dir, report_dir)})" for p in it.images[:3])
            why = s.get("reason") or (s.get("error") or "")
            says = _model_says(res.reply)
            out += [f"### {mark} `{it.id}` ({s['model']})", "",
                    f"{imgs}" if imgs else "_no images (control)_", "",
                    f"- Reply: `{_short(res.reply)}`"]
            if says:
                out += [f"- Model says: {says}"]
            out += [f"- Checker: {why or '-'}", ""]
    return "\n".join(out)


# ---------------------------------------------------------------- HTML

CSS = """
:root{--bg:#fff;--fg:#1a1d21;--muted:#5f6670;--line:#e3e6ea;--bar:#2f6fde;--bar2:#9aa3ad;--ok:#1b8a4b;--bad:#c4372f;
--warn-bg:#fff4d6;--warn-fg:#6b4d00}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#15181c;--fg:#e8eaed;--muted:#9aa3ad;
--line:#2c3138;--bar:#6c9cf0;--bar2:#5f6670;--ok:#4cc38a;--bad:#ef6a62;--warn-bg:#3a2f10;--warn-fg:#f5d77a}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:16px}
table{border-collapse:collapse;width:100%;margin:8px 0 20px;font-size:13px;display:block;overflow-x:auto}
th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;white-space:nowrap}
th{color:var(--muted);font-weight:600}.warn{background:var(--warn-bg);color:var(--warn-fg);padding:10px 14px;border-radius:6px}
.ok{color:var(--ok)}.bad{color:var(--bad)}.muted{color:var(--muted)}svg text{fill:var(--fg);font-size:12px}
.card{border:1px solid var(--line);border-radius:8px;padding:10px;margin:10px 0}.card img{height:120px;margin-right:6px;
border-radius:4px;border:1px solid var(--line)}code{font-size:12px;word-break:break-all}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px}.two>div{border-left:3px solid var(--line);
padding:2px 10px}.two .said{border-color:var(--bar2)}.two .truth{border-color:var(--bad)}.lbl{color:var(--muted);
font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}.rels{display:flex;flex-wrap:wrap;gap:12px}
.rels figure{margin:0}.rels figcaption{color:var(--muted);font-size:12px}.wrap{white-space:normal;min-width:220px}
@media (max-width:640px){.two{grid-template-columns:1fr}}
"""


def _bars(rows: list[tuple[str, float, float | None, float | None]], width: int = 640) -> str:
    """Horizontal bars (0..100%) with CI whiskers. rows: (label, value, lo, hi)."""
    if not rows:
        return ""
    lab_w, bar_w, h = 200, width - 260, 22
    parts = [f'<svg viewBox="0 0 {width} {h * len(rows) + 10}" width="100%" role="img">']
    for i, (label, v, lo, hi) in enumerate(rows):
        y = 5 + i * h
        vv = 0.0 if _isnan(v) else v
        parts.append(f'<text x="0" y="{y + 15}">{html.escape(label)}</text>')
        parts.append(f'<rect x="{lab_w}" y="{y + 3}" width="{bar_w}" height="14" fill="var(--line)"/>')
        parts.append(f'<rect x="{lab_w}" y="{y + 3}" width="{bar_w * vv:.1f}" height="14" fill="var(--bar)"/>')
        if not (_isnan(lo) or _isnan(hi)):
            parts.append(f'<line x1="{lab_w + bar_w * lo:.1f}" x2="{lab_w + bar_w * hi:.1f}" y1="{y + 10}" '
                         f'y2="{y + 10}" stroke="var(--fg)" stroke-width="1.5"/>')
        parts.append(f'<text x="{lab_w + bar_w + 8}" y="{y + 15}">{_pct(v)}</text>')
    parts.append("</svg>")
    return "".join(parts)


def _reliability(rows: list[dict], label: str = "", size: int = 240) -> str:
    """A reliability diagram: mean confidence (x) vs accuracy (y) per bucket, point area ~ n, with the diagonal."""
    pad_l, pad_t = 34, 10
    plot = size - pad_l - 10

    def x(c):
        return pad_l + c * plot

    def y(a):
        return pad_t + (1 - a) * plot

    parts = [f'<svg class="reliability" viewBox="0 0 {size} {size}" width="{size}" height="{size}" role="img" '
             f'aria-label="Reliability diagram {html.escape(label)}">',
             f'<rect x="{x(0)}" y="{y(1)}" width="{plot}" height="{plot}" fill="none" stroke="var(--line)"/>',
             f'<line x1="{x(0)}" y1="{y(0.5):.1f}" x2="{x(1)}" y2="{y(0.5):.1f}" stroke="var(--line)"/>',
             f'<line x1="{x(0.5):.1f}" y1="{y(0)}" x2="{x(0.5):.1f}" y2="{y(1)}" stroke="var(--line)"/>',
             f'<line x1="{x(0)}" y1="{y(0)}" x2="{x(1)}" y2="{y(1)}" stroke="var(--muted)" stroke-dasharray="4 3"/>']
    for t in (0, 0.5, 1):
        parts.append(f'<text x="{x(t) - 6:.1f}" y="{y(0) + 14:.1f}">{t:g}</text>')
        parts.append(f'<text x="{pad_l - 22}" y="{y(t) + 4:.1f}">{t:g}</text>')
    parts.append(f'<text x="{x(0.5) - 30:.1f}" y="{size - 4}">confidence</text>')
    parts.append(f'<text x="10" y="{y(0.5) + 26:.1f}" transform="rotate(-90 10 {y(0.5) + 26:.1f})">accuracy</text>')
    ns = [r.get("n") or 0 for r in rows if not _isnan(r.get("n"))]
    maxn = max(ns) if ns else 1
    pts = []
    for r in sorted(rows, key=lambda r: _conf_val(r.get("lo"))):
        n, a = r.get("n") or 0, r.get("accuracy")
        c = r.get("mean_conf")
        if _isnan(c) and not (_isnan(r.get("lo")) or _isnan(r.get("hi"))):
            c = (r["lo"] + r["hi"]) / 2
        if not n or _isnan(a) or _isnan(c):
            continue
        rad = 3 + 8 * math.sqrt(n / maxn)
        pts.append((x(c), y(a)))
        parts.append(f'<circle cx="{x(c):.1f}" cy="{y(a):.1f}" r="{rad:.1f}" fill="var(--bar)" fill-opacity="0.75">'
                     f'<title>{html.escape(str(r.get("bucket", "")))}: n={n}, accuracy {_pct(a)}, '
                     f'confidence {_pct(c)}</title></circle>')
    if len(pts) > 1:
        parts.insert(-len(pts), '<polyline fill="none" stroke="var(--bar)" stroke-width="1.5" points="' +
                     " ".join(f"{px:.1f},{py:.1f}" for px, py in pts) + '"/>')
    parts.append("</svg>")
    return "".join(parts)


def _html_table(head: list[str], rows: list[list]) -> str:
    th = "".join(f"<th>{html.escape(str(h))}</th>" for h in head)
    trs = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f"<table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>"


def _html_categories(scores: list[dict], models: list[str]) -> list[str]:
    e = html.escape
    cat = _rows(scores, "category")
    body = ["<h2>Scores by category (95% bootstrap CI)</h2>"]
    if not cat:
        return body + ["<p class='muted'>No category scores in this run.</p>"]
    body.append("<p class='muted'>Each item is scored under its task category (one job can feed several). "
                "Bars: pictures mode, whiskers = 95% CI.</p>")
    cats = sorted({r.get("category") for r in cat}, key=_cat_key)
    rows = []
    for m in models:
        pics = sorted((r for r in cat if r.get("model") == m and r.get("mode") == "pictures"),
                      key=lambda r: _cat_key(r.get("category")))
        if not pics:
            continue
        body.append(f"<h3>{e(m)}{' (fake)' if is_fake(m) else ''}</h3>")
        body.append(_bars([(f"{_cat(r.get('category'))} (n={r.get('n', 0)})", r.get("accuracy"), r.get("ci_lo"),
                            r.get("ci_hi")) for r in pics]))
        cell = {r.get("category"): r for r in pics}
        rows.append([e(m)] + [e(_cat_cell(cell.get(c))) for c in cats])
    if rows:
        body.append(_html_table(["Model"] + [_cat(c) for c in cats], rows))
    modes = _modes(cat)
    if len(modes) > 1 or "pictures" not in modes:
        body.append("<h3>Categories by mode</h3>")
        for m in models:
            mr = [r for r in cat if r.get("model") == m]
            if not mr:
                continue
            cell = {(r.get("category"), r.get("mode")): r for r in mr}
            body.append(f"<p><b>{e(m)}</b></p>")
            body.append(_html_table(["Category"] + modes,
                                    [[e(_cat(c))] + [e(_cat_cell(cell.get((c, md)))) for md in modes]
                                     for c in sorted({r.get("category") for r in mr}, key=_cat_key)]))
    return body


def _html_reasonable(scores: list[dict], items: list[Item], run_dir: Path, report_dir: Path) -> list[str]:
    e = html.escape
    summ = sorted(_rows(scores, "calibration_summary"), key=lambda r: (str(r.get("model")), _mode_key(r.get("mode"))))
    cal = _rows(scores, "calibration")
    cw = sorted(_rows(scores, "confidently_wrong"),
                key=lambda r: (str(r.get("model")), _mode_key(r.get("mode")), _cat_key(r.get("category"))))
    thr = next((r.get("threshold") for r in cw if not _isnan(r.get("threshold"))), CONFIDENT)
    note = e(REASONABLE_NOTE.format(t=thr)).replace("*", "")
    body = ["<h2>Sounds reasonable vs geometrically correct</h2>", f"<p class='muted'>{note}</p>", "<h3>Calibration</h3>"]
    if summ:
        body.append(_html_table(["Model", "Mode", "n", "With confidence", "Mean confidence", "Accuracy", "ECE",
                                 "Brier", "Overconfidence"],
                                [[e(str(r.get("model"))), e(str(r.get("mode"))), r.get("n", "-"),
                                  f"{e(str(r.get('n_conf', '-')))} ({_pct(r.get('coverage'))})",
                                  _pct(r.get("mean_conf")), _pct(r.get("accuracy")), _num(r.get("ece")),
                                  _num(r.get("brier")), _signed(r.get("overconfidence"))] for r in summ]))
    else:
        body.append("<p class='muted'>No replies carried a confidence.</p>")
    if cal:
        groups: dict[tuple, list[dict]] = defaultdict(list)
        for r in cal:
            groups[(str(r.get("model")), r.get("mode"))].append(r)
        figs = []
        for (m, md), rs in sorted(groups.items(), key=lambda kv: (kv[0][0], _mode_key(kv[0][1]))):
            figs.append(f"<figure>{_reliability(rs, f'{m} {md}')}<figcaption>{e(m)} · {e(str(md))}"
                        f"</figcaption></figure>")
        body.append("<p class='muted'>Reliability: each point is a confidence bucket (area ~ answers); points on "
                    "the dashed diagonal are well calibrated, points below it are overconfident.</p>")
        body.append(f"<div class='rels'>{''.join(figs)}</div>")
        body.append(_html_table(["Model", "Mode", "Confidence", "n", "Mean confidence", "Accuracy", "Gap"],
                                [[e(str(r.get("model"))), e(str(r.get("mode"))), e(str(r.get("bucket", "-"))),
                                  r.get("n", "-"), _pct(r.get("mean_conf")), _pct(r.get("accuracy")),
                                  _signed(r.get("gap"))]
                                 for r in sorted(cal, key=lambda r: (str(r.get("model")), _mode_key(r.get("mode")),
                                                                     _conf_val(r.get("lo"))))]))
    body.append(f"<h3>Confidently wrong (confidence ≥ {thr:g} and incorrect)</h3>")
    if cw:
        body.append(_html_table(["Model", "Mode", "Category", "Rate", "Confidently wrong / with confidence",
                                 "Share of confident answers"],
                                [[e(str(r.get("model"))), e(str(r.get("mode"))), e(_cat(r.get("category"))),
                                  _pct(r.get("rate")), f"{r.get('n_cw', 0)} / {r.get('n_conf', 0)}",
                                  _pct(r.get("share_of_confident"))] for r in cw]))
    else:
        body.append("<p class='muted'>No confidence data.</p>")

    body.append("<h3>Plausible but wrong</h3><p class='muted'>Incorrect answers whose reason names the right "
                "elements or opening, most confident first.</p>")
    pw = plausible_rows(scores)
    if not pw:
        body.append("<p class='muted'>No plausible-but-wrong answers.</p>")
    by_id = {it.id: it for it in items}
    for r in pw:
        it = by_id.get(r.get("item_id"))
        imgs = "".join(f'<img src="{e(_thumb(p, it, run_dir, report_dir))}" alt="{e(Path(p).name)}">'
                       for p in it.images[:3]) if it else ""
        names = ", ".join(str(x) for x in (r.get("mentions") or []))
        body.append(
            f'<div class="card"><b class="bad">❌</b> <code>{e(str(r.get("item_id")))}</code> '
            f"<span class='muted'>{e(str(r.get('model')))} · {e(_job(r.get('job')))} · "
            f"{e(_cat(r.get('category')))} · confidence {_num(r.get('confidence'), 2)}</span>"
            + (f"<div>{imgs}</div>" if imgs else "") +
            f"<div class='two'><div class='said'><div class='lbl'>Model's reason (sounds reasonable)</div>"
            f"<div>{e(str(r.get('model_reason') or '-'))}</div>"
            f"<div class='muted'>Answer: <code>{e(_short(r.get('answer', '-'), 120))}</code>"
            + (f" · names {e(names)}" if names else "") + "</div></div>"
            f"<div class='truth'><div class='lbl'>Geometry verdict (checker)</div>"
            f"<div>{e(str(r.get('checker_reason') or '-'))}</div>"
            f"<div class='muted'>Reference: <code>{e(_short(r.get('truth_answer', '-'), 120))}</code></div>"
            f"</div></div></div>")
    return body


def _html_integrity(integ: dict | None) -> list[str]:
    e = html.escape
    body = ["<h2>Benchmark integrity</h2>"]
    if not integ:
        return body + ["<p class='muted'>Integrity not checked: run <code>iris-bench verify --out &lt;run&gt;</code>."
                       "</p>"]
    ok = integ.get("ok")
    body.append(f"<p class='{'ok' if ok else 'bad'}'><b>Overall: {'PASS' if ok else 'FAIL'}</b> "
                f"<span class='muted'>· items {e(str(integ.get('n_items', '-')))} · checked "
                f"{e(str(integ.get('generated_at', '-')))}</span></p>")
    checks = [c for c in integ.get("checks") or [] if isinstance(c, dict)]
    if checks:
        body.append(_html_table(["", "Check", "Summary"],
                                [[_check_icon(c), e(str(c.get("title") or c.get("name"))),
                                  f"<span class='wrap'>{e(str(c.get('summary') or '-'))}</span>"] for c in checks]))
    bal = _balance_rows(integ)
    if bal:
        body.append("<h3>Answer balance and chance baselines</h3><p class='muted'>Majority share = accuracy of always "
                    "giving the most common reference answer; chance = guessing uniformly among the options.</p>")
        body.append(_html_table(["Job", "n", "Majority answer", "Majority share", "Chance level", ""],
                                [[e(_job(b.get("job"))), b.get("n", "-"), e(_short(b.get("majority_answer", "-"), 60)),
                                  _pct(b.get("majority_share")), _pct(b.get("chance")),
                                  "⚠️ imbalanced" if b.get("imbalanced") else ""] for b in bal]))
    det, rows = _rederived(integ)
    if det:
        body.append(f"<h3>Reference answers re-derived from scene.json</h3><p>Checked {e(str(det.get('checked', '-')))}"
                    f", matched {e(str(det.get('matched', '-')))}, mismatched {e(str(det.get('mismatched', '-')))}, "
                    f"skipped {e(str(det.get('skipped', '-')))}.</p>")
        if rows:
            body.append(_html_table(["Job", "Checked", "Matched", "Mismatched", "Skipped"],
                                    [[e(_job(j)), *(e(str(x)) for x in rest)] for j, *rest in rows]))
    return body


def render_html(scores: list[dict], items: list[Item], results: list[Result], run_dir: Path,
                report_dir: Path | None = None, title: str = "Iris Bench report",
                integrity: dict | None = None) -> str:
    run_dir = Path(run_dir)
    report_dir = Path(report_dir or run_dir)
    integ = integrity if integrity is not None else load_integrity(run_dir)
    e = html.escape
    models = _models(scores)
    body = [f"<h1>{e(title)}</h1>"]
    for m in models:
        if is_fake(m):
            body.append(f'<p class="warn"><b>FAKE MODEL</b>: <code>{e(m)}</code> is the offline stand-in. '
                        "Its numbers test the pipeline only; they say nothing about any real model.</p>")
    body.append(f'<p class="muted">Items: {len(items)} · Results: {len(results)} · Models: '
                f'{", ".join(e(m) for m in models) or "-"}'
                + (f" · Integrity: <b class='{'ok' if integ.get('ok') else 'bad'}'>"
                   f"{'PASS' if integ.get('ok') else 'FAIL'}</b>" if integ else "") + "</p>")

    acc = _rows(scores, "accuracy")
    body.append("<h2>Accuracy with pictures (95% bootstrap CI)</h2>")
    for m in models:
        rs = sorted((r for r in acc if r["model"] == m and r["mode"] == "pictures"), key=lambda r: r["job"] == "ALL")
        body.append(f"<h3>{e(m)}{' (fake)' if is_fake(m) else ''}</h3>")
        body.append(_bars([(f"{_job(r['job'])} (n={r['n']})", r["accuracy"], r["ci_lo"], r["ci_hi"]) for r in rs]))

    body += _html_categories(scores, models)
    body += _html_reasonable(scores, items, run_dir, report_dir)

    ctl = _rows(scores, "control")
    body.append("<h2>Controls: does the picture matter?</h2>")
    body.append('<p class="muted">Delta = control minus pictures, same questions. A model that uses the picture '
                "drops on no_image and swapped.</p>")
    if ctl:
        bars = []
        for m in models:
            mr = [r for r in acc if r["model"] == m and r["job"] == "ALL"]
            bars += [(f"{m} · {r['mode']}", r["accuracy"], r["ci_lo"], r["ci_hi"]) for r in mr]
        body.append(_bars(bars))
        body.append(_html_table(["Model", "Job", "Control", "n", "Pictures", "Control", "Delta [95% CI]"],
                                [[e(r["model"]), e(_job(r["job"])), e(str(r["mode"])), r["n"],
                                  _pct(r["acc_pictures"]), _pct(r["acc_control"]),
                                  f"{_signed(r['delta'])} [{_signed(r['ci_lo'])}, {_signed(r['ci_hi'])}]"]
                                 for r in ctl]))
    else:
        body.append("<p class='muted'>No control items in this run.</p>")

    cost = [r for r in _rows(scores, "cost") if r["mode"] == "pictures"]
    if cost:
        body.append("<h2>Cost-weighted score</h2><p class='muted'>Illustrative weights, not measured costs: " +
                    ", ".join(f"{e(k)} {v:g}" for k, v in COST_WEIGHTS.items()) + ".</p>")
        body.append(_html_table(["Model", "Job", "Accuracy", "Cost-weighted", "Mean cost"],
                                [[e(r["model"]), e(_job(r["job"])), _pct(r["accuracy"]),
                                  _pct(r["cost_weighted_score"]), f"{r['mean_cost']:.2f}"] for r in cost]))

    part = _rows(scores, "partial")
    if part:
        body.append("<h2>J3 partial credit</h2>")
        body.append(_html_table(["Model", "Mode", "n", "Direction right", "Distance in band", "Right opening"],
                                [[e(r["model"]), e(str(r["mode"])), r["n"], _pct(r.get("direction_right")),
                                  _pct(r.get("distance_in_band")), _pct(r.get("right_opening"))] for r in part]))

    ws = worst_slices(scores)
    body.append("<h2>Where accuracy drops</h2>")
    body.append(_bars([(f"{r['factor']} {r['bucket']} · {_job(r['job'])}", r["accuracy"],
                        r["ci_lo"], r["ci_hi"]) for r in ws]) if ws else "<p class='muted'>No slices.</p>")

    tax = _rows(scores, "taxonomy")
    body.append("<h2>Error taxonomy</h2>")
    body.append(_html_table(["Model", "Job", "Mode", "Error", "Count", "Share", "Weight"],
                            [[e(r["model"]), e(_job(r["job"])), e(str(r["mode"])), e(str(r["error"])), r["count"],
                              _pct(r["share_of_items"]), f"{r['weight']:g}"] for r in tax])
                if tax else "<p class='muted'>No errors.</p>")

    body += _html_integrity(integ)

    samples = sample_items(items, results)
    if samples:
        body.append("<h2>Sample items</h2>")
        for s in samples:
            it, res = s["item"], s["result"]
            ok = s["correct"] == 1.0
            imgs = "".join(f'<img src="{e(_thumb(p, it, run_dir, report_dir))}" alt="{e(Path(p).name)}">'
                           for p in it.images[:3])
            says = _model_says(res.reply)
            body.append(f'<div class="card"><b class="{"ok" if ok else "bad"}">{"✅" if ok else "❌"}</b> '
                        f"<code>{e(it.id)}</code> <span class='muted'>{e(s['model'])}</span><div>{imgs}</div>"
                        f"<div>Reply: <code>{e(_short(res.reply))}</code></div>"
                        + (f"<div>Model says: {e(says)}</div>" if says else "") +
                        f"<div>Checker: {e(str(s.get('reason') or s.get('error') or '-'))}</div></div>")

    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(title)}</title>'
            f"<style>{CSS}</style></head><body>{''.join(body)}</body></html>")


def write_report(scores: list[dict], items: list[Item], results: list[Result], run_dir: Path,
                 title: str = "Iris Bench report", integrity: dict | None = None) -> tuple[Path, Path]:
    """Write report.md and report.html into `run_dir`. `integrity` defaults to `run_dir/integrity.json`."""
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    integ = integrity if integrity is not None else load_integrity(run_dir)
    md, ht = run_dir / "report.md", run_dir / "report.html"
    md.write_text(render_markdown(scores, items, results, run_dir, run_dir, title, integrity=integ))
    ht.write_text(render_html(scores, items, results, run_dir, run_dir, title, integrity=integ))
    return md, ht
