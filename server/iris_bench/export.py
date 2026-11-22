"""Export a stratified, self-contained sample of a run for judges.

    iris-bench export --out runs/x --sample 50 --to datasets/sample

`export_sample(out_dir, to, sample=50, seed=0, modes=("pictures",))` picks a deterministic sample stratified by job
(and, within a job, by category), then writes one folder per item with everything needed to inspect it without the
rest of the run: the pictures the model saw, the prompt, the reply schema, the reference answer (truth) and how it
was established (evidence), the scene geometry, and a validation record (the reference answer re-derived from
scene.json by geometry, the item's digest against the build manifest, and any graded model results).

Layout of `to/`:

    README.md                 what this is, how it was sampled, a reference for every field below
    index.jsonl, index.csv    one row per exported item
    manifest.json             copy of the run's build manifest (truth digests), when present
    integrity.json            copy of the run's integrity report, when present
    items/<item_id>/
        item.json             the full Item, `images` rewritten to "images/<name>"
        prompt.txt            the exact prompt text sent to the model
        schema.json           the JSON Schema the reply must follow
        truth.json            the reference answer (never sent to the model)
        evidence.json         how the reference answer was established (geometry numbers, checks)
        scene.json            the scene the item was built from
        validation.json       re-derivation, digest check, graded results
        images/<file>         the PNGs, in the order shown to the model
"""
from __future__ import annotations

import csv
import hashlib
import json
import random
import shutil
from collections import Counter, defaultdict
from dataclasses import asdict, fields
from pathlib import Path

from iris_bench.spec import CATEGORIES, JOB_CATEGORY, Item, Scene

MANIFEST_NAME = "manifest.json"
INTEGRITY_NAME = "integrity.json"

# The engineering question each job asks (mirrors the comment block in spec.py).
JOB_QUESTIONS: dict[str, str] = {
    "J1_sort": "Is there an actual geometric clash between these elements?",
    "J2_who_moves": "Which element is movable under the given constraints?",
    "J3_fix": "What movement would resolve this clash?",
    "J4_opening": "Which opening is suitable for routing this element?",
    "J5_review": "Does the proposed movement resolve the original clash?",
    "J6_new_clash": "Does the movement introduce new clashes?",
    "J7_pick_valid": "Which of several proposed solutions is geometrically valid?",
    "J8_spatial": "Spatial reasoning across several elements (highest, between, order).",
    "J9_relation": "Relationships (passes through, crosses, parallel, supports, touches).",
}

ITEM_FILES = ("item.json", "prompt.txt", "schema.json", "truth.json", "evidence.json", "scene.json",
              "validation.json")
TOP_FILES = ("README.md", "index.jsonl", "index.csv", MANIFEST_NAME, INTEGRITY_NAME)
INDEX_FIELDS = ("id", "job", "category", "categories", "mode", "seed", "n_images", "folder", "truth", "validation",
                "digest_matches", "results")

ITEM_FIELD_DOCS: dict[str, str] = {
    "id": "unique item id, `<seed>-<job>-<n>-<mode>`",
    "seed": "the scene seed the item was built from (scene.json has the same seed)",
    "job": "which of the nine jobs (J1-J9) this item asks; see the job table below",
    "mode": "`pictures` (pictures only), `pictures_text` (pictures plus measured facts), `no_image` / `swapped` "
            "(controls)",
    "images": "the pictures shown to the model, in order (paths relative to the item folder)",
    "prompt": "the exact text sent to the model with the pictures (same as prompt.txt)",
    "schema": "the JSON Schema the reply must follow (same as schema.json)",
    "truth": "the reference answer, computed from the geometry; never sent to the model (same as truth.json)",
    "meta": "challenge settings and measurements copied from the scene, used to slice results",
    "categories": "the scored task categories this item counts towards",
    "evidence": "how the reference answer was established: geometry numbers and checker results "
                "(same as evidence.json)",
}

VALIDATION_FIELD_DOCS: dict[str, str] = {
    "rederived": "the reference answer re-derived from scene.json by geometry: `status` (`match` / `mismatch` / "
                 "`skipped`), `job`, `stored` (truth as written), `derived` (re-computed), `reason`",
    "item_digest": "sha256 of the item's truth-bearing fields (id, seed, job, mode, truth, evidence, categories)",
    "manifest_digest": "the digest recorded for this item in the build manifest, before any model was called",
    "digest_matches": "true when item_digest equals manifest_digest (truth unchanged since build); null without a "
                      "manifest",
    "integrity_ok": "the run-level integrity verdict from integrity.json; null when the run was not verified",
    "missing_images": "image paths the item names that could not be found when exporting",
    "results": "graded model results for this item: `model`, `correct` (true / false / null = unparseable), "
               "`reply` (the model's JSON reply), `detail` (checker output and reason)",
}

INDEX_FIELD_DOCS: dict[str, str] = {
    "id": "item id",
    "job": "job (J1-J9)",
    "category": "primary scored category",
    "categories": "all scored categories",
    "mode": "prompt mode",
    "seed": "scene seed",
    "n_images": "number of pictures",
    "folder": "item folder, relative to this README",
    "truth": "reference answer (JSON)",
    "validation": "re-derivation status (`match` / `mismatch` / `skipped`)",
    "digest_matches": "truth digest matches the build manifest",
    "results": "graded model results, `model: correct` pairs",
}

SCENE_FIELD_DOCS: dict[str, str] = {
    "seed": "generator seed",
    "elements": "every element: `id`, `kind`, `role`, `shape`, box `min`/`max` or cylinder `start`/`end`/`radius` "
                "(metres, Z up), `openings`, `supports`, `locked`, `allowed_moves`",
    "planted": "pairs placed on purpose: `a`, `b`, `kind` (real / not_touching / by_design), `distance_m`, "
               "`mover`, `good_fix`, `fitting_openings`",
    "challenge": "difficulty settings (density, occlusion, gap_mm, decoys, view, style ...)",
    "clearance_m": "required clear gap for a fix to pass",
    "relations": "ground-truth spatial relationships computed by geometry",
    "resolutions": "candidate fixes per planted pair with the geometry verdict (`valid`) and evidence",
    "cameras": "configured viewpoints",
    "schema_version": "data contract version",
}


# ---------------------------------------------------------------- reading

def _read_jsonl(path: Path) -> list[dict]:
    path = Path(path)
    if not path.exists():
        return []
    out = []
    for line in path.read_text().splitlines():
        if line.strip():
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    return out


_ITEM_KEYS = {f.name for f in fields(Item)}


def read_items(path: Path) -> list[Item]:
    return [Item(**{k: v for k, v in d.items() if k in _ITEM_KEYS}) for d in _read_jsonl(path)]


def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def _integrity():
    try:
        from iris_bench import integrity  # type: ignore
        return integrity
    except Exception:
        return None


def category_of(item: Item) -> str:
    cats = list(item.categories or [])
    return cats[0] if cats else JOB_CATEGORY.get(item.job, "uncategorised")


def _categories(item: Item) -> list[str]:
    return list(item.categories) if item.categories else [category_of(item)]


# ---------------------------------------------------------------- sampling

def stratified_sample(items: list[Item], sample: int = 50, seed: int = 0, modes=("pictures",)) -> list[Item]:
    """A deterministic sample: round-robin across jobs, and within a job round-robin across categories, each group
    shuffled with a seeded RNG. Jobs with fewer items than their share leave their quota to the others."""
    pool = [it for it in items if not modes or it.mode in modes]
    by_job: dict[str, dict[str, list[Item]]] = defaultdict(lambda: defaultdict(list))
    for it in sorted(pool, key=lambda i: i.id):
        by_job[it.job][category_of(it)].append(it)
    queues: dict[str, list[Item]] = {}
    for job in sorted(by_job):
        groups = []
        for cat in sorted(by_job[job]):
            g = list(by_job[job][cat])
            random.Random(f"export-{seed}-{job}-{cat}").shuffle(g)
            groups.append(g)
        q: list[Item] = []
        while any(groups):
            for g in groups:
                if g:
                    q.append(g.pop(0))
        queues[job] = q
    picked: list[Item] = []
    seen: set[str] = set()
    while len(picked) < sample and any(queues.values()):
        for job in sorted(queues):
            if len(picked) >= sample:
                break
            q = queues[job]
            while q:
                it = q.pop(0)
                if it.id not in seen:
                    seen.add(it.id)
                    picked.append(it)
                    break
    return picked


# ---------------------------------------------------------------- per item

def _safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in str(name)) or "item"


def _resolve_image(path: str, item: Item, out_dir: Path) -> Path | None:
    p = Path(path)
    cands = [p] if p.is_absolute() else [out_dir / p, out_dir / "scenes" / str(item.seed) / p]
    if item.meta.get("scene_dir"):
        cands.append(Path(item.meta["scene_dir"]) / p)
    for c in cands:
        if c.is_file():
            return c
    return None


def _local_digest(item: Item) -> str:
    d = {"id": item.id, "seed": item.seed, "job": item.job, "mode": item.mode, "truth": item.truth,
         "evidence": item.evidence, "categories": item.categories}
    return hashlib.sha256(json.dumps(d, sort_keys=True, default=str).encode()).hexdigest()


def _digest(item: Item, integ) -> str:
    fn = getattr(integ, "item_digest", None) if integ else None
    if fn is not None:
        try:
            return fn(item)
        except Exception:
            pass
    return _local_digest(item)


def _rederive(item: Item, scene: Scene | None, integ) -> dict:
    fn = getattr(integ, "rederive", None) if integ else None
    if fn is None:
        return {"status": "skipped", "job": item.job, "reason": "integrity unavailable"}
    if scene is None:
        return {"status": "skipped", "job": item.job, "reason": "scene.json not found"}
    try:
        out = fn(item, scene)
        return out if isinstance(out, dict) else {"status": "skipped", "job": item.job, "reason": "no result"}
    except Exception as e:   # a re-derivation crash is recorded, never sinks the export
        return {"status": "skipped", "job": item.job, "reason": f"rederive failed: {type(e).__name__}: {e}"}


def _dump(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2, default=str) + "\n")


def _results_summary(results: list[dict]) -> str:
    return "; ".join(f"{r.get('model')}: {r.get('correct')}" for r in results)


def _export_item(item: Item, out_dir: Path, items_dir: Path, scene_cache: dict, results: list[dict],
                 manifest: dict | None, integrity_report: dict | None, integ) -> tuple[dict, int]:
    folder = items_dir / _safe(item.id)
    img_dir = folder / "images"
    img_dir.mkdir(parents=True, exist_ok=True)

    new_images, missing, used = [], [], set()
    for k, p in enumerate(item.images):
        src = _resolve_image(p, item, out_dir)
        name = _safe(Path(p).name)
        if name in used:
            name = f"{k:02d}_{name}"
        used.add(name)
        if src is None:
            missing.append(p)
            continue
        shutil.copy2(src, img_dir / name)
        new_images.append(f"images/{name}")

    if item.seed not in scene_cache:
        sp = out_dir / "scenes" / str(item.seed) / "scene.json"
        scene_cache[item.seed] = (sp, Scene.load(sp)) if sp.exists() else (None, None)
    scene_path, scene = scene_cache[item.seed]

    d = asdict(item)
    d["images"] = new_images
    d["meta"] = {k: v for k, v in (d.get("meta") or {}).items() if k != "scene_dir"}   # no local paths
    _dump(folder / "item.json", d)
    (folder / "prompt.txt").write_text(item.prompt)
    _dump(folder / "schema.json", item.schema)
    _dump(folder / "truth.json", item.truth)
    _dump(folder / "evidence.json", item.evidence)
    if scene_path is not None:
        shutil.copy2(scene_path, folder / "scene.json")
    else:
        _dump(folder / "scene.json", {"missing": True, "reason": f"scenes/{item.seed}/scene.json not found"})

    digest = _digest(item, integ)
    man_digest = (manifest or {}).get("items", {}).get(item.id) if isinstance(manifest, dict) else None
    validation = {
        "rederived": _rederive(item, scene, integ),
        "item_digest": digest,
        "manifest_digest": man_digest,
        "digest_matches": None if man_digest is None else man_digest == digest,
        "integrity_ok": integrity_report.get("ok") if isinstance(integrity_report, dict) else None,
        "missing_images": missing,
        "results": [{"model": r.get("model"), "correct": r.get("correct"), "reply": r.get("reply"),
                     "detail": r.get("detail", {})} for r in results],
    }
    _dump(folder / "validation.json", validation)

    row = {"id": item.id, "job": item.job, "category": category_of(item), "categories": _categories(item),
           "mode": item.mode, "seed": item.seed, "n_images": len(new_images),
           "folder": folder.relative_to(items_dir.parent).as_posix(), "truth": item.truth,
           "validation": validation["rederived"].get("status", "skipped"),
           "digest_matches": validation["digest_matches"], "results": _results_summary(results)}
    return row, len(missing)


# ---------------------------------------------------------------- README

def _md_table(head: list[str], rows: list[list]) -> str:
    lines = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def _readme(rows: list[dict], out_dir: Path, sample: int, seed: int, modes, n_pool: int, missing: int,
            has_manifest: bool, has_integrity: bool) -> str:
    per_job = Counter(r["job"] for r in rows)
    per_cat = Counter(r["category"] for r in rows)
    status = Counter(r["validation"] for r in rows)
    out = [
        "# Iris VisionBench sample",
        "",
        "A self-contained sample of Iris VisionBench items for judges. The principle: **the model sees the scene, "
        "Iris knows the geometry, and the geometry independently verifies the answer.** Every item is built from "
        "a generated building-services scene (`scene.json`); the reference answer (`truth.json`) is computed from "
        "that geometry before any model is called, and `validation.json` re-derives it from `scene.json` again.",
        "",
        "What the model sees: `images/` and `prompt.txt` (and must reply following `schema.json`). What it never "
        "sees: `truth.json`, `evidence.json`, `scene.json`, `validation.json`.",
        "",
        "## How this sample was drawn",
        "",
        f"- Source run: `{out_dir.name}` ({n_pool} items in the selected modes)",
        f"- Requested: {sample} items; exported: {len(rows)}",
        f"- Modes: {', '.join(f'`{m}`' for m in modes) if modes else 'all'}",
        f"- Seed: {seed} (same seed and run give the same sample)",
        "- Stratified: round-robin across jobs, and within a job across categories; each group shuffled with the "
        "seed. A job with fewer items than its share leaves the rest of its quota to the other jobs.",
        "- Re-derivation from geometry: " + (", ".join(f"{k} {v}" for k, v in sorted(status.items())) or "-"),
        f"- Missing images: {missing}",
        f"- Build manifest included: {'yes' if has_manifest else 'no'}; integrity report included: "
        f"{'yes' if has_integrity else 'no'}",
        "",
        _md_table(["Job", "Question", "Category", "Items"],
                  [[j, JOB_QUESTIONS.get(j, "-"), JOB_CATEGORY.get(j, "-"), per_job.get(j, 0)]
                   for j in sorted(set(JOB_CATEGORY) | set(per_job))]),
        "",
        _md_table(["Category", "Items"], [[c, per_cat.get(c, 0)] for c in
                                          list(CATEGORIES) + sorted(set(per_cat) - set(CATEGORIES))]),
        "",
        "## Layout",
        "",
        "```",
        "README.md                 this file",
        "index.jsonl, index.csv    one row per exported item",
        f"{MANIFEST_NAME}             build manifest: truth digests recorded before any model call (if present)",
        f"{INTEGRITY_NAME}            run integrity report (if the run was verified)",
        "items/<item_id>/",
        "    item.json             the full item (images rewritten to images/<name>)",
        "    prompt.txt            the exact prompt sent to the model",
        "    schema.json           the JSON Schema the reply must follow",
        "    truth.json            the reference answer (never sent to the model)",
        "    evidence.json         how the reference answer was established",
        "    scene.json            the scene geometry the item was built from",
        "    validation.json       re-derivation from geometry, digest check, graded model results",
        "    images/<file>         the pictures, in the order shown",
        "```",
        "",
        "## Fields: item.json",
        "",
        _md_table(["Field", "Meaning"], [[f"`{k}`", v] for k, v in ITEM_FIELD_DOCS.items()]),
        "",
        "## Fields: validation.json",
        "",
        _md_table(["Field", "Meaning"], [[f"`{k}`", v] for k, v in VALIDATION_FIELD_DOCS.items()]),
        "",
        "## Fields: index.jsonl / index.csv",
        "",
        _md_table(["Field", "Meaning"], [[f"`{k}`", v] for k, v in INDEX_FIELD_DOCS.items()]),
        "",
        "## Fields: scene.json",
        "",
        "Units are metres, Z up. Element ids (`e1`, `e2` ...) and opening ids (`o1` ...) are never shown to the "
        "model; pictures label elements with letters (A, B, ...) and openings from P onward.",
        "",
        _md_table(["Field", "Meaning"], [[f"`{k}`", v] for k, v in SCENE_FIELD_DOCS.items()]),
        "",
        "## Items",
        "",
        _md_table(["Item", "Job", "Category", "Mode", "Images", "Validation"],
                  [[f"[`{r['id']}`]({r['folder']}/item.json)", r["job"], r["category"], r["mode"], r["n_images"],
                    r["validation"]] for r in rows]),
        "",
    ]
    return "\n".join(out)


# ---------------------------------------------------------------- export

def _clean(to: Path) -> None:
    """Remove only what a previous export wrote."""
    items_dir = to / "items"
    if items_dir.exists():
        shutil.rmtree(items_dir)
    for name in TOP_FILES:
        p = to / name
        if p.is_file():
            p.unlink()


def export_sample(out_dir, to, sample: int = 50, seed: int = 0, modes=("pictures",)) -> dict:
    """Copy a stratified sample of the run in `out_dir` into the self-contained folder `to` (see module doc)."""
    out_dir, to = Path(out_dir), Path(to)
    if to.resolve() == out_dir.resolve():
        raise ValueError("export target must not be the run folder itself")
    if (to / "items").resolve() in [out_dir.resolve(), *out_dir.resolve().parents]:
        raise ValueError("export target would overwrite the run folder")
    items_p = out_dir / "items.jsonl"
    if not items_p.exists():
        raise FileNotFoundError(f"{items_p} not found (run `iris-bench build` first)")
    if isinstance(modes, str):
        modes = tuple(m.strip() for m in modes.split(",") if m.strip())
    modes = tuple(modes or ())

    items = read_items(items_p)
    pool = [it for it in items if not modes or it.mode in modes]
    picked = stratified_sample(items, sample=sample, seed=seed, modes=modes)

    graded = _read_jsonl(out_dir / "graded.jsonl") or _read_jsonl(out_dir / "results.jsonl")
    by_item: dict[str, list[dict]] = defaultdict(list)
    for r in graded:
        if "item_id" in r:
            by_item[r["item_id"]].append(r)

    integ = _integrity()
    man_name = getattr(integ, "MANIFEST_NAME", MANIFEST_NAME) if integ else MANIFEST_NAME
    int_name = getattr(integ, "INTEGRITY_NAME", INTEGRITY_NAME) if integ else INTEGRITY_NAME
    manifest = _read_json(out_dir / man_name)
    integrity_report = _read_json(out_dir / int_name)

    to.mkdir(parents=True, exist_ok=True)
    _clean(to)
    items_dir = to / "items"
    items_dir.mkdir(parents=True, exist_ok=True)

    scene_cache: dict = {}
    rows: list[dict] = []
    missing = 0
    for it in picked:
        row, m = _export_item(it, out_dir, items_dir, scene_cache, by_item.get(it.id, []), manifest,
                              integrity_report, integ)
        rows.append(row)
        missing += m

    with (to / "index.jsonl").open("w") as f:
        for r in rows:
            f.write(json.dumps(r, default=str) + "\n")
    with (to / "index.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(INDEX_FIELDS))
        w.writeheader()
        for r in rows:
            w.writerow({k: json.dumps(r[k], default=str) if isinstance(r[k], (dict, list)) else r[k]
                        for k in INDEX_FIELDS})
    for name, src in ((MANIFEST_NAME, out_dir / man_name), (INTEGRITY_NAME, out_dir / int_name)):
        if src.is_file():
            shutil.copy2(src, to / name)
    (to / "README.md").write_text(_readme(rows, out_dir, sample, seed, modes, len(pool), missing,
                                          manifest is not None, integrity_report is not None))

    per_job = dict(sorted(Counter(r["job"] for r in rows).items()))
    per_cat = dict(sorted(Counter(r["category"] for r in rows).items()))
    jobs_txt = ", ".join(f"{j.split('_')[0]} {n}" for j, n in per_job.items())
    return {"to": str(to), "n": len(rows), "per_job": per_job, "per_category": per_cat, "missing_images": missing,
            "ids": [r["id"] for r in rows],
            "summary": f"exported {len(rows)} items ({jobs_txt or 'none'}) -> {to}"
                       + (f"; {missing} image(s) missing" if missing else "")}
