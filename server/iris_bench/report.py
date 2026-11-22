"""Iris Bench report: Markdown plus a self-contained HTML page (inline SVG bars, no external libraries)."""
from __future__ import annotations

import html
import math
import os
from collections import defaultdict
from pathlib import Path

from iris_bench.score import COST_WEIGHTS, item_rows
from iris_bench.spec import Item, Result

JOB_NAMES = {"J1_sort": "J1 sort", "J2_who_moves": "J2 who moves", "J3_fix": "J3 fix",
             "J4_opening": "J4 opening", "J5_review": "J5 review", "ALL": "All jobs"}
FAKE_NOTE = ("**FAKE MODEL**: `{m}` is the offline stand-in (random answers at a set accuracy). "
             "Its numbers test the pipeline only; they say nothing about any real model.")


def is_fake(model: str) -> bool:
    return str(model).lower().startswith("fake")


def _pct(v) -> str:
    return "-" if v is None or (isinstance(v, float) and math.isnan(v)) else f"{100 * v:.0f}%"


def _ci(r: dict) -> str:
    return f"{_pct(r.get('accuracy'))} [{_pct(r.get('ci_lo'))}, {_pct(r.get('ci_hi'))}]"


def _signed(v) -> str:
    return "-" if v is None or (isinstance(v, float) and math.isnan(v)) else f"{100 * v:+.0f} pts"


def _rows(scores: list[dict], table: str) -> list[dict]:
    return [r for r in scores if r.get("table") == table]


def _models(scores: list[dict]) -> list[str]:
    return sorted({r["model"] for r in scores if "model" in r})


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
    rows = sorted(item_rows(items, results), key=lambda r: r["item_id"])
    picked, seen = [], defaultdict(lambda: {True: 0, False: 0})
    for r in rows:
        if r["mode"] != "pictures":
            continue
        ok = r["correct"] == 1.0
        if seen[(r["model"], r["job"])][ok] >= per_job:
            continue
        seen[(r["model"], r["job"])][ok] += 1
        res = next(x for x in results if x.item_id == r["item_id"] and x.model == r["model"])
        picked.append({**r, "item": by_id[r["item_id"]], "result": res})
    return picked


# ---------------------------------------------------------------- Markdown

def _md_table(head: list[str], rows: list[list]) -> str:
    lines = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def render_markdown(scores: list[dict], items: list[Item], results: list[Result], run_dir: Path,
                    report_dir: Path | None = None, title: str = "Iris Bench report") -> str:
    run_dir = Path(run_dir)
    report_dir = Path(report_dir or run_dir)
    models = _models(scores)
    out = [f"# {title}", ""]
    for m in models:
        if is_fake(m):
            out += ["> " + FAKE_NOTE.format(m=m), ""]
    out += [f"Items: {len(items)}. Results: {len(results)}. Models: {', '.join(f'`{m}`' for m in models) or '-'}.", ""]

    acc = _rows(scores, "accuracy")
    jobs = sorted({r["job"] for r in acc if r["job"] != "ALL"}) + ["ALL"]
    out += ["## Headline: accuracy with pictures (95% bootstrap CI)", ""]
    head = ["Model"] + [JOB_NAMES.get(j, j) for j in jobs]
    rows = []
    for m in models:
        cell = {r["job"]: r for r in acc if r["model"] == m and r["mode"] == "pictures"}
        rows.append([m + (" (fake)" if is_fake(m) else "")] +
                    [f"{_ci(cell[j])} n={cell[j]['n']}" if j in cell else "-" for j in jobs])
    out += [_md_table(head, rows), ""]

    cost = _rows(scores, "cost")
    if cost:
        out += ["## Cost-weighted score (pictures)", "",
                "Illustrative weights per error type, not measured costs: " +
                ", ".join(f"{k} {v:g}" for k, v in COST_WEIGHTS.items()) +
                ". Score = 1 - total cost / (items x max weight).", ""]
        out += [_md_table(["Model", "Job", "Accuracy", "Cost-weighted", "Mean cost"],
                          [[r["model"], JOB_NAMES.get(r["job"], r["job"]), _pct(r["accuracy"]),
                            _pct(r["cost_weighted_score"]), f"{r['mean_cost']:.2f}"]
                           for r in cost if r["mode"] == "pictures"]), ""]

    ctl = _rows(scores, "control")
    out += ["## Controls: does the picture matter?", "",
            "Delta = control accuracy minus pictures accuracy on the same questions (paired). "
            "A model that truly uses the picture drops on `no_image` and `swapped`.", ""]
    out += [_md_table(["Model", "Job", "Control", "n", "Pictures", "Control acc", "Delta [95% CI]"],
                      [[r["model"], JOB_NAMES.get(r["job"], r["job"]), r["mode"], r["n"], _pct(r["acc_pictures"]),
                        _pct(r["acc_control"]), f"{_signed(r['delta'])} [{_signed(r['ci_lo'])}, {_signed(r['ci_hi'])}]"]
                       for r in ctl]) if ctl else "_No control items in this run._", ""]

    part = _rows(scores, "partial")
    if part:
        out += ["## J3 partial credit", ""]
        out += [_md_table(["Model", "Mode", "n", "Direction right", "Distance in band", "Right opening"],
                          [[r["model"], r["mode"], r["n"], _pct(r["direction_right"]), _pct(r["distance_in_band"]),
                            _pct(r["right_opening"])] for r in part]), ""]

    ws = worst_slices(scores)
    out += ["## Where accuracy drops (challenge slices)", ""]
    out += [_md_table(["Model", "Job", "Mode", "Factor", "Bucket", "n", "Slice acc", "Overall", "Drop"],
                      [[r["model"], JOB_NAMES.get(r["job"], r["job"]), r["mode"], r["factor"], r["bucket"], r["n"],
                        _pct(r["accuracy"]), _pct(r["overall"]), _signed(r["drop"])] for r in ws])
            if ws else "_No slices with enough items._", ""]

    tax = _rows(scores, "taxonomy")
    out += ["## Error taxonomy", ""]
    out += [_md_table(["Model", "Job", "Mode", "Error", "Count", "Share", "Weight"],
                      [[r["model"], JOB_NAMES.get(r["job"], r["job"]), r["mode"], r["error"], r["count"],
                        _pct(r["share_of_items"]), f"{r['weight']:g}"] for r in tax]) if tax else "_No errors._", ""]

    samples = sample_items(items, results)
    if samples:
        out += ["## Sample items", ""]
        for s in samples:
            it, res = s["item"], s["result"]
            mark = "✅" if s["correct"] == 1.0 else "❌"
            imgs = " ".join(f"![{Path(p).name}]({_thumb(p, it, run_dir, report_dir)})" for p in it.images[:3])
            why = s["reason"] or (s["error"] or "")
            out += [f"### {mark} `{it.id}` ({s['model']})", "",
                    f"{imgs}" if imgs else "_no images (control)_", "",
                    f"- Reply: `{_short(res.reply)}`",
                    f"- Checker: {why or '-'}", ""]
    return "\n".join(out)


def _short(v, n: int = 200) -> str:
    s = str(v).replace("`", "'").replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"


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
"""


def _bars(rows: list[tuple[str, float, float | None, float | None]], width: int = 640) -> str:
    """Horizontal bars (0..100%) with CI whiskers. rows: (label, value, lo, hi)."""
    if not rows:
        return ""
    lab_w, bar_w, h = 200, width - 260, 22
    parts = [f'<svg viewBox="0 0 {width} {h * len(rows) + 10}" width="100%" role="img">']
    for i, (label, v, lo, hi) in enumerate(rows):
        y = 5 + i * h
        vv = 0.0 if v is None or math.isnan(v) else v
        parts.append(f'<text x="0" y="{y + 15}">{html.escape(label)}</text>')
        parts.append(f'<rect x="{lab_w}" y="{y + 3}" width="{bar_w}" height="14" fill="var(--line)"/>')
        parts.append(f'<rect x="{lab_w}" y="{y + 3}" width="{bar_w * vv:.1f}" height="14" fill="var(--bar)"/>')
        if lo is not None and hi is not None and not (math.isnan(lo) or math.isnan(hi)):
            parts.append(f'<line x1="{lab_w + bar_w * lo:.1f}" x2="{lab_w + bar_w * hi:.1f}" y1="{y + 10}" '
                         f'y2="{y + 10}" stroke="var(--fg)" stroke-width="1.5"/>')
        parts.append(f'<text x="{lab_w + bar_w + 8}" y="{y + 15}">{_pct(v)}</text>')
    parts.append("</svg>")
    return "".join(parts)


def _html_table(head: list[str], rows: list[list]) -> str:
    th = "".join(f"<th>{html.escape(str(h))}</th>" for h in head)
    trs = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f"<table><thead><tr>{th}</tr></thead><tbody>{trs}</tbody></table>"


def render_html(scores: list[dict], items: list[Item], results: list[Result], run_dir: Path,
                report_dir: Path | None = None, title: str = "Iris Bench report") -> str:
    run_dir = Path(run_dir)
    report_dir = Path(report_dir or run_dir)
    e = html.escape
    models = _models(scores)
    body = [f"<h1>{e(title)}</h1>"]
    for m in models:
        if is_fake(m):
            body.append(f'<p class="warn"><b>FAKE MODEL</b>: <code>{e(m)}</code> is the offline stand-in. '
                        "Its numbers test the pipeline only; they say nothing about any real model.</p>")
    body.append(f'<p class="muted">Items: {len(items)} · Results: {len(results)} · Models: '
                f'{", ".join(e(m) for m in models) or "-"}</p>')

    acc = _rows(scores, "accuracy")
    body.append("<h2>Accuracy with pictures (95% bootstrap CI)</h2>")
    for m in models:
        rs = sorted((r for r in acc if r["model"] == m and r["mode"] == "pictures"), key=lambda r: r["job"] == "ALL")
        body.append(f"<h3>{e(m)}{' (fake)' if is_fake(m) else ''}</h3>")
        body.append(_bars([(f"{JOB_NAMES.get(r['job'], r['job'])} (n={r['n']})", r["accuracy"], r["ci_lo"],
                            r["ci_hi"]) for r in rs]))

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
                                [[e(r["model"]), JOB_NAMES.get(r["job"], r["job"]), r["mode"], r["n"],
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
                                [[e(r["model"]), JOB_NAMES.get(r["job"], r["job"]), _pct(r["accuracy"]),
                                  _pct(r["cost_weighted_score"]), f"{r['mean_cost']:.2f}"] for r in cost]))

    part = _rows(scores, "partial")
    if part:
        body.append("<h2>J3 partial credit</h2>")
        body.append(_html_table(["Model", "Mode", "n", "Direction right", "Distance in band", "Right opening"],
                                [[e(r["model"]), r["mode"], r["n"], _pct(r["direction_right"]),
                                  _pct(r["distance_in_band"]), _pct(r["right_opening"])] for r in part]))

    ws = worst_slices(scores)
    body.append("<h2>Where accuracy drops</h2>")
    body.append(_bars([(f"{r['factor']} {r['bucket']} · {JOB_NAMES.get(r['job'], r['job'])}", r["accuracy"],
                        r["ci_lo"], r["ci_hi"]) for r in ws]) if ws else "<p class='muted'>No slices.</p>")

    tax = _rows(scores, "taxonomy")
    body.append("<h2>Error taxonomy</h2>")
    body.append(_html_table(["Model", "Job", "Mode", "Error", "Count", "Share", "Weight"],
                            [[e(r["model"]), JOB_NAMES.get(r["job"], r["job"]), r["mode"], e(r["error"]), r["count"],
                              _pct(r["share_of_items"]), f"{r['weight']:g}"] for r in tax])
                if tax else "<p class='muted'>No errors.</p>")

    samples = sample_items(items, results)
    if samples:
        body.append("<h2>Sample items</h2>")
        for s in samples:
            it, res = s["item"], s["result"]
            ok = s["correct"] == 1.0
            imgs = "".join(f'<img src="{e(_thumb(p, it, run_dir, report_dir))}" alt="{e(Path(p).name)}">'
                           for p in it.images[:3])
            body.append(f'<div class="card"><b class="{"ok" if ok else "bad"}">{"✅" if ok else "❌"}</b> '
                        f"<code>{e(it.id)}</code> <span class='muted'>{e(s['model'])}</span><div>{imgs}</div>"
                        f"<div>Reply: <code>{e(_short(res.reply))}</code></div>"
                        f"<div>Checker: {e(str(s['reason'] or s['error'] or '-'))}</div></div>")

    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
            f'<meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(title)}</title>'
            f"<style>{CSS}</style></head><body>{''.join(body)}</body></html>")


def write_report(scores: list[dict], items: list[Item], results: list[Result], run_dir: Path,
                 title: str = "Iris Bench report") -> tuple[Path, Path]:
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    md, ht = run_dir / "report.md", run_dir / "report.html"
    md.write_text(render_markdown(scores, items, results, run_dir, run_dir, title))
    ht.write_text(render_html(scores, items, results, run_dir, run_dir, title))
    return md, ht
