"""Projects: a named set of models with its saved edits, reviews and reports, kept on disk across restarts
(docs/engineer-workflow.md, "Projects").

A scene lives in memory and goes with a restart or an eviction; a project keeps what a scene needs to come back. One
folder per project under `IRIS_PROJECTS_DIR` (default `server/.iris-projects`, git-ignored; `/mnt/iris/projects` on
Cloud Run with a bucket):

    <id>/project.json       the Project (below)
    <id>/models/<name>      the original files, copied when a scene is attached (a STEP model as its STEP)
    <id>/saved/<n>/<name>   each model as it was when saved (`Workspace.file`; an edited STEP model as its exported
                            STEP), and state.json (written last): the edit log's entries (each with the `session`, the
                            scene id, that kept it), the decisions, and what each clash keeps (by clash id: its pair,
                            #N and title) so it comes back with the same number
    <id>/reports/           PDF / BCF reports copied from the in-memory document store
    <id>/drawings/          the scene's PDF drawings (drawings.py) on attach and save: <sha256>.pdf, and
                            <sha256>.items.json with the items of its last read; named in project.json's "drawings"
                            ({name, sha256, size, pages, items}), ingested again into the scene a project opens as

Writes are atomic per file (a temporary file, then `os.replace`) under a per-project lock, and project.json is written
last, so it never names a file not yet written. No folder is ever renamed: Cloud Storage FUSE refuses directory renames
on a flat bucket. Ids are
unguessable (`secrets.token_hex(12)`): a browser lists the ids it made; only the owner lists them all. Opening copies a
project's files into a fresh temporary folder that becomes the scene's own: project files are never one of a scene's
roots, so an eviction never deletes them.

Undo does not cross a reopen: a saved state is the new baseline, and its entries come back as read-only history
(`Journal.earlier`).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import tempfile
import threading
import time
from pathlib import Path

from . import detect, drawings, step
from .limits import env_int
from .service import MODELS, Workspace

log = logging.getLogger(__name__)
DEFAULT_DIR = Path(__file__).resolve().parents[1] / ".iris-projects"
SHA = re.compile(r"[0-9a-f]{64}")
ID = re.compile(r"[0-9a-f]{24}")
DOC_ID = re.compile(r"[0-9a-f]{32}")
STATUSES = ("open", "by_design", "author", "resolved")
REPORT_KINDS = ("pdf", "bcf")
COUNTS = ("clashes", "open", "resolved", "reviewed")
NAME_MAX = 120
KEY_MAX = 400
NOTE_MAX = 2000
BY_MAX = 120
TITLE_MAX = 300
REVIEWS_MAX = 5000      # reviews kept per project
REPORTS_MAX = 100       # reports kept per project; the oldest file goes first
CHUNK = 1 << 20


class NotFound(KeyError):
    """No project with that id (or not an id this module makes)."""


class Full(Exception):
    """The server holds IRIS_PROJECTS_MAX projects already."""


def projects_dir() -> Path:
    return Path(os.environ.get("IRIS_PROJECTS_DIR", "").strip() or DEFAULT_DIR)


def max_projects() -> int:
    """How many projects may exist (0: no limit)."""
    return env_int("IRIS_PROJECTS_MAX", 50)


def clash_key(kind: str | None, a: str, b: str) -> str:
    """A clash's key, stable across detections: its test kind and its pair, sorted. Imported Navisworks clashes use
    `nw|<report title>|<clash name>` (made by whoever holds the report)."""
    return f"{kind or 'hard'}|{'|'.join(sorted((a, b)))}"


def parse_key(key: str) -> tuple[str, str, str] | None:
    """(kind, A, B) of an Iris clash key; None for a Navisworks key or anything else."""
    parts = key.split("|")
    if len(parts) != 3 or parts[0] == "nw" or not all(parts):
        return None
    return parts[0], parts[1], parts[2]


# ---------------------------------------------------------------------------------------------------- storage

_guard = threading.Lock()
_guard_create = threading.Lock()   # the cap: one project made at a time
_locks: dict[str, threading.RLock] = {}


def _lock(folder: Path) -> threading.RLock:
    with _guard:
        return _locks.setdefault(str(folder), threading.RLock())


def _folder(pid: str) -> Path:
    if not isinstance(pid, str) or not ID.fullmatch(pid):
        raise NotFound(pid)
    return projects_dir() / pid


def _tmp_name(path: Path) -> Path:
    return path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")


def _write_bytes(path: Path, data: bytes) -> None:
    tmp = _tmp_name(path)
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def _write_json(path: Path, data) -> None:
    _write_bytes(path, json.dumps(data, indent=1, default=str).encode("utf-8"))


def _copy(src: Path, dest: Path) -> tuple[int, str]:
    """Copy a file atomically; its size and sha256."""
    tmp = _tmp_name(dest)
    h, size = hashlib.sha256(), 0
    try:
        with open(src, "rb") as fi, open(tmp, "wb") as fo:
            while chunk := fi.read(CHUNK):
                h.update(chunk)
                size += len(chunk)
                fo.write(chunk)
            fo.flush()
            os.fsync(fo.fileno())
        os.replace(tmp, dest)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    return size, h.hexdigest()


def _read(folder: Path) -> dict:
    try:
        return json.loads((folder / "project.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise NotFound(folder.name) from None


def _save(folder: Path, project: dict, touch: bool = True) -> dict:
    if touch:
        project["updated"] = time.time()
    _write_json(folder / "project.json", project)
    return project


def _ids() -> list[str]:
    root = projects_dir()
    if not root.is_dir():
        return []
    return [p.name for p in root.iterdir() if ID.fullmatch(p.name) and (p / "project.json").is_file()]


def _file_name(name: str) -> str:
    """A model file's name as it may be stored: a plain file name (ValueError otherwise)."""
    base = Path(str(name)).name
    if base != name or base in ("", ".", "..") or base.startswith(".") or "\\" in base:
        raise ValueError(f"{name!r} is not a file name a project can keep")
    return base


def _clean(text, most: int, what: str) -> str:
    text = str(text or "").strip()
    if not text:
        raise ValueError(f"The {what} is empty.")
    if len(text) > most:
        raise ValueError(f"The {what} is over {most} characters.")
    return text


# ---------------------------------------------------------------------------------------------------- projects

def create(name: str) -> dict:
    """A new, empty project (Full at the cap)."""
    name = _clean(name, NAME_MAX, "project name")
    root = projects_dir()
    root.mkdir(parents=True, exist_ok=True)
    with _guard_create:
        cap = max_projects()
        if cap and len(_ids()) >= cap:
            raise Full(f"This server keeps {cap} projects, and has them all.")
        pid = secrets.token_hex(12)
        folder = root / pid
        folder.mkdir()
        now = time.time()
        project = {"id": pid, "name": name, "created": now, "updated": now, "files": [], "scene_id": None,
                   "saved": [], "reviews": {}, "reports": [], "counts": None}
        with _lock(folder):
            return _save(folder, project, touch=False)


def get(pid: str) -> dict:
    folder = _folder(pid)
    with _lock(folder):
        return _read(folder)


def list_projects(ids: list[str] | None = None) -> list[dict]:
    """The projects named (unknown ids skipped), or every project (None: the owner's view), newest change first."""
    wanted = _ids() if ids is None else [i for i in dict.fromkeys(ids) if isinstance(i, str) and ID.fullmatch(i)]
    out = []
    for pid in wanted:
        try:
            out.append(get(pid))
        except NotFound:
            continue
    return sorted(out, key=lambda p: p.get("updated") or 0, reverse=True)


def patch(pid: str, name: str | None = None, counts: dict | None = None, set_counts: bool = False) -> dict:
    """Rename a project, or keep the counts the page last saw (`set_counts`: counts given, None clears them)."""
    if name is not None:
        name = _clean(name, NAME_MAX, "project name")
    if set_counts and counts is not None:
        if not isinstance(counts, dict):
            raise ValueError("counts is {clashes, open, resolved, reviewed}")
        bad = [k for k in COUNTS if not isinstance(counts.get(k), int) or isinstance(counts.get(k), bool)
               or counts[k] < 0]
        if bad:
            raise ValueError(f"counts needs whole numbers for {', '.join(bad)}")
        counts = {k: counts[k] for k in COUNTS}
    folder = _folder(pid)
    with _lock(folder):
        project = _read(folder)
        if name is not None:
            project["name"] = name
        if set_counts:
            project["counts"] = counts
        return _save(folder, project)


def attach(ws: Workspace, pid: str, scene_id: str) -> dict:
    """Make an open scene's models the project's: its original files (a STEP model's STEP, an IFC as it was opened;
    edits are kept by `save`) copied into models/, with their sizes and hashes. KeyError: the scene is not open."""
    paths = ws.original_paths(scene_id)
    names = [_file_name(n) for n in ws.names[scene_id]]
    folder = _folder(pid)
    with _lock(folder):
        project = _read(folder)
        models = folder / "models"
        models.mkdir(exist_ok=True)
        files = []
        for name, src in zip(names, paths):
            size, sha = _copy(src, models / name)
            files.append({"name": name, "kind": "STEP" if Path(name).suffix.lower() in step.SUFFIXES else "IFC",
                          "size": size, "sha256": sha})
        project["files"] = files
        project["scene_id"] = scene_id
        stale = _keep_drawings(folder, project, scene_id)
        _save(folder, project)
        _drop(stale)
        for p in models.iterdir():   # files of an earlier set, once project.json no longer names them
            if p.name in names:
                continue
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
            else:
                p.unlink(missing_ok=True)
        return project


def _latest_state(folder: Path, project: dict) -> tuple[Path | None, dict]:
    """The newest saved state of the project's current files: its folder and state.json (None, {}: none)."""
    names = [f["name"] for f in project.get("files", [])]
    for s in reversed(project.get("saved", [])):
        where = folder / "saved" / str(s.get("n"))
        if s.get("files") == names and where.is_dir():
            try:
                return where, json.loads((where / "state.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
    return None, {}


def saved_decisions(pid: str) -> list[dict]:
    """The reviewers' decisions of the project's newest saved state of its current files (`saved/<n>/state.json`):
    what its report reads when no scene of it has a live edit log. [] when nothing is saved."""
    folder = _folder(pid)
    with _lock(folder):
        _, state = _latest_state(folder, _read(folder))
    return [d for d in state.get("decisions") or [] if isinstance(d, dict)]


def open_project(ws: Workspace, pid: str, classify_with=None, on_event=lambda e: None) -> tuple[str, dict]:
    """Open a project as a new scene: its newest saved state of the current files, else the originals, copied into a
    fresh temporary folder the scene owns. Its clashes keep their ids, numbers and titles (the saved state's, then the
    reviews'), its decisions and earlier entries come back to the edit log. ValueError: nothing is attached."""
    folder = _folder(pid)
    with _lock(folder):
        project = _read(folder)
        names = [f["name"] for f in project.get("files", [])]
        if not names:
            raise ValueError("No models are attached to this project yet.")
        where, state = _latest_state(folder, project)
        src = where or folder / "models"
        MODELS.mkdir(parents=True, exist_ok=True)
        root = Path(tempfile.mkdtemp(dir=MODELS, prefix="project-"))
        try:
            for name in names:
                shutil.copyfile(src / _file_name(name), root / name)
        except BaseException:
            shutil.rmtree(root, ignore_errors=True)
            raise
        reviews = dict(project.get("reviews", {}))
        kept_drawings = [dict(d) for d in project.get("drawings") or [] if isinstance(d, dict)]
    sid = ws.open_paths([root / n for n in names], root=root, classify_with=classify_with, on_event=on_event)
    seed: dict[str, dict] = {}
    seen: set[str] = set()
    for cid, c in (state.get("clashes") or {}).items():
        if isinstance(c, dict) and c.get("a") and c.get("b"):
            seed[cid] = c
            seen.add(clash_key(c.get("kind"), c["a"], c["b"]))
    for key, r in reviews.items():
        parsed = parse_key(key)
        if parsed is None or key in seen or not (r.get("number") or r.get("title")):
            continue
        kind, a, b = parsed
        seed[detect.clash_id(f"project|{kind}", a, b)] = {"kind": kind, "a": a, "b": b, "number": r.get("number"),
                                                          "title": r.get("title")}
    ws.seed_clashes(sid, seed)
    log = ws.journal(sid)
    with log.lock:
        log.decisions = [d for d in state.get("decisions") or [] if isinstance(d, dict)]
        log.earlier = [e for e in state.get("entries") or [] if isinstance(e, dict)]
    _restore_drawings(ws, folder, kept_drawings, sid)
    with _lock(folder):
        project = _read(folder)
        project["scene_id"] = sid
        return sid, _save(folder, project)


def save(ws: Workspace, pid: str, scene_id: str) -> dict:
    """Keep an open scene's models as they are now as the project's next saved state (saved/<n>/), with its edit
    log, its decisions and what its clashes keep. KeyError: the scene is not open.

    Each file is written atomically into saved/<n>/ and state.json goes last, then project.json: a state is only read
    once project.json names it. No folder is renamed (Cloud Storage FUSE refuses directory renames on a flat bucket);
    the models are written out in a local scratch folder first and copied in."""
    ws.scene(scene_id)
    folder = _folder(pid)
    with _lock(folder):
        project = _read(folder)
        saved = folder / "saved"
        saved.mkdir(exist_ok=True)
        # The next number: past every state recorded and every folder there (one a failed write left unrecorded).
        n = max([s.get("n", 0) for s in project.get("saved", [])]
                + [int(d.name) for d in saved.iterdir() if d.name.isdigit()], default=0) + 1
        target = saved / str(n)
        target.mkdir()
        MODELS.mkdir(parents=True, exist_ok=True)
        scratch = Path(tempfile.mkdtemp(dir=MODELS, prefix="project-save-"))
        try:
            with ws.lock:   # one moment of the scene: no fix kept between one file and the next
                s = ws.scene(scene_id)
                names = [_file_name(x) for x in ws.names[scene_id]]
                sources = ws.sources.get(scene_id, {})
                steps = _edited_steps(ws, scene_id, scratch) if any(i in s._edited for i in sources) else {}
                for i, name in enumerate(names):
                    if i in steps:
                        _copy(steps[i], target / name)
                    elif i in sources:
                        _copy(Path(sources[i]["step"]), target / name)
                    else:
                        _copy(ws.file(scene_id, i, scratch), target / name)
                log = ws.journals.get(scene_id)
                with (log.lock if log is not None else threading.Lock()):
                    # This session's entries carry its scene id: E-ids start again in every session, so saved
                    # history is told apart by session and E-id (document.entry_key), never by E-id alone.
                    entries = [*(log.earlier if log else []),
                               *({**e.to_dict(), "session": scene_id} for e in (log.entries if log else []))]
                    decisions = [dict(d) for d in (log.decisions if log else [])]
                clashes = {cid: {**c, "key": clash_key(c.get("kind"), c["a"], c["b"])}
                           for cid, c in ws.clash_memory(scene_id).items() if c.get("a") and c.get("b")}
            now = time.time()
            _write_json(target / "state.json", {"n": n, "at": now, "files": names, "entries": entries,
                                                "decisions": decisions, "clashes": clashes})
        except BaseException:
            shutil.rmtree(target, ignore_errors=True)
            raise
        finally:
            shutil.rmtree(scratch, ignore_errors=True)
        project["saved"] = [*project.get("saved", []), {"n": n, "at": now, "files": names,
                                                         "edits": sum(1 for e in entries if e.get("state") == "kept")}]
        project["scene_id"] = scene_id
        stale = _keep_drawings(folder, project, scene_id)
        _save(folder, project)
        _drop(stale)
        return project


def _keep_drawings(folder: Path, project: dict, scene_id: str) -> list[Path]:
    """The scene's drawings copied into drawings/ (`<sha256>.pdf`, and `<sha256>.items.json` with the items of its
    last read) and named in project["drawings"]; a scene holding none leaves the project's as they are. Called under
    the project's lock before project.json is written; returns the files no longer named, to delete after it."""
    held = drawings.STORE.list(scene_id)
    if not held:
        return []
    where = folder / "drawings"
    where.mkdir(exist_ok=True)
    rows, keep = [], set()
    for d in held:
        if f"{d.sha256}.pdf" in keep:   # the same PDF twice: kept once
            continue
        try:
            items = drawings.STORE.items_of(d.id)
            source = drawings.STORE.pdf(d.id)
        except KeyError:   # its scene went meanwhile
            continue
        pdf = where / f"{d.sha256}.pdf"
        size = pdf.stat().st_size if pdf.is_file() else _copy(source, pdf)[0]
        keep.add(pdf.name)
        if items:
            _write_json(where / f"{d.sha256}.items.json", drawings.plain(items))
            keep.add(f"{d.sha256}.items.json")
        rows.append({"name": d.name, "sha256": d.sha256, "size": size, "pages": len(d.pages), "items": len(items)})
    project["drawings"] = rows
    return [p for p in where.iterdir() if p.name not in keep and not p.name.startswith(".")]


def _drop(paths: list[Path]) -> None:
    for p in paths:
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        else:
            p.unlink(missing_ok=True)


def _restore_drawings(ws: Workspace, folder: Path, rows: list[dict], scene_id: str) -> None:
    """A project's drawings ingested again (drawings.ingest) into the scene it opened as, with their last read items.
    A drawing whose file is missing or no longer passes the caps is left out (logged): the models still open."""
    if not rows:
        return
    store = drawings.STORE
    store.watch(scene_id, ws.scene(scene_id))
    root = store.root(scene_id)
    for row in rows[:drawings.MAX_PER_SCENE]:
        sha = str(row.get("sha256") or "")
        if not SHA.fullmatch(sha):
            continue
        try:
            d = drawings.ingest((folder / "drawings" / f"{sha}.pdf").read_bytes(), row.get("name") or f"{sha[:12]}.pdf",
                                root)
        except (OSError, drawings.DrawingError) as e:
            log.warning("project %s: drawing %s not restored (%s)", folder.name, sha[:12], e)
            continue
        store.add(scene_id, d)
        try:
            items = json.loads((folder / "drawings" / f"{sha}.items.json").read_text(encoding="utf-8"))
        except FileNotFoundError:
            items = []
        except (OSError, ValueError) as e:
            log.warning("project %s: items of drawing %s not restored (%s)", folder.name, sha[:12], e)
            items = []
        if isinstance(items, list) and items:
            store.set_items(d.id, items)


def _edited_steps(ws: Workspace, scene_id: str, scratch: Path) -> dict[int, Path]:
    """The edited models that came from STEP, written back as STEP (`Workspace.export`) into `scratch`: file index →
    the file."""
    written = {p.name: p for p in ws.export(scene_id, scratch)}
    out: dict[int, Path] = {}
    for i, src in ws.sources.get(scene_id, {}).items():
        p = written.get(f"{Path(src['step']).stem}.iris.step")
        if p is not None:
            out[i] = p
    return out


def set_review(pid: str, key: str, status: str, note: str | None = None, by: str | None = None,
               number: int | None = None, title: str | None = None) -> dict:
    """Where a clash stands for the project (open, by design, sent to its author, resolved), by its clash key."""
    key = _clean(key, KEY_MAX, "clash key")
    if status not in STATUSES:
        raise ValueError(f"status is one of {', '.join(STATUSES)}")
    if number is not None and (not isinstance(number, int) or isinstance(number, bool) or number < 1):
        raise ValueError("number is a whole number from 1")
    review: dict = {"status": status, "at": time.time()}
    for field, value, most in (("note", note, NOTE_MAX), ("by", by, BY_MAX), ("title", title, TITLE_MAX)):
        if value is not None and str(value).strip():
            review[field] = _clean(value, most, field)
    if number is not None:
        review["number"] = number
    folder = _folder(pid)
    with _lock(folder):
        project = _read(folder)
        reviews = project.setdefault("reviews", {})
        if key not in reviews and len(reviews) >= REVIEWS_MAX:
            raise ValueError(f"A project keeps at most {REVIEWS_MAX} reviews.")
        reviews[key] = review
        return _save(folder, project)


def _report_name(name: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._ -]+", "-", str(name or "")).strip(" .-")[:NAME_MAX]
    return safe or "iris-report"


def add_report(pid: str, doc_id: str, name: str, kind: str, data: bytes) -> dict:
    """Keep a built report (PDF, or the BCF / zip it came with) with the project."""
    if not isinstance(doc_id, str) or not DOC_ID.fullmatch(doc_id):
        raise ValueError("doc_id is a report's id")
    if kind not in REPORT_KINDS:
        raise ValueError(f"kind is one of {', '.join(REPORT_KINDS)}")
    name = _report_name(name)
    folder = _folder(pid)
    with _lock(folder):
        project = _read(folder)
        reports = folder / "reports"
        reports.mkdir(exist_ok=True)
        _write_bytes(reports / f"{doc_id}-{name}", data)
        kept = [r for r in project.get("reports", []) if r.get("doc_id") != doc_id]
        kept.append({"doc_id": doc_id, "name": name, "at": time.time(), "kind": kind})
        dropped, kept = kept[:-REPORTS_MAX], kept[-REPORTS_MAX:]
        project["reports"] = kept
        _save(folder, project)
        for r in dropped:
            (reports / f"{r['doc_id']}-{r['name']}").unlink(missing_ok=True)
        return project


def report_file(pid: str, doc_id: str) -> tuple[Path, str]:
    """A kept report's file and download name (NotFound: no such report in the project)."""
    folder = _folder(pid)
    with _lock(folder):
        project = _read(folder)
        r = next((r for r in project.get("reports", []) if r.get("doc_id") == doc_id), None)
        path = folder / "reports" / f"{doc_id}-{r['name']}" if r else None
        if path is None or not path.is_file():
            raise NotFound(doc_id)
        return path, r["name"]
