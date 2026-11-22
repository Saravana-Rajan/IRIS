"""The bench renderer draws a tiny hand-written scene: files, sizes, views.json, visible pixels, determinism."""
import hashlib
import json
import struct
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pytest

from iris_bench import render
from iris_bench.spec import Camera, Element, Fix, Opening, Scene, View

pytestmark = pytest.mark.skipif(not render.available(), reason="node or bench/render node_modules not installed")


def _scene() -> Scene:
    beam = Element("e1", "beam", "structure", "box", min=(0, -0.15, 2.4), max=(6, 0.15, 3.0),
                   openings=[Opening("o1", (2.5, -0.15, 2.55), (3.3, 0.15, 2.85))])
    duct = Element("e2", "duct", "service", "box", min=(2.6, -2, 2.6), max=(3.2, 2, 2.8))     # through the opening
    pipe = Element("e3", "pipe", "service", "cylinder", start=(4.2, -2, 2.7), end=(4.2, 2, 2.7), radius=0.06)
    slab = Element("e4", "slab", "structure", "box", min=(-2, -4, 3.0), max=(8, 4, 3.2))
    return Scene(seed=7, elements=[beam, duct, pipe, slab], planted=[])


def _png_size(path) -> tuple[int, int]:
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", data[16:24])


def _sha(path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture(scope="module")
def scene_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("scene")
    _scene().save(d / "scene.json")
    return d


def test_views_files_and_counts(scene_dir):
    views = render.render_scene(scene_dir, ["e1", "e3"], views=("A", "B", "C"), width=512)
    assert [v.name for v in views] == ["A", "B", "C"]
    for v in views:
        assert isinstance(v, View) and v.focus == ["e1", "e3"]
        assert _png_size(scene_dir / v.image) == (512, 512)
        assert _png_size(scene_dir / v.id_image) == (512, 512)
        assert v.visible_px["e1"] > 0 and v.visible_px["e3"] > 0
        assert sorted(v.labels[e] for e in ("e1", "e3")) == ["A", "B"]
        assert v.labels["o1"] == "P"                                  # the beam's opening, lettered from P
        assert len({v.colors["e1"], v.colors["e3"]}) == 2
    assert "e2" not in views[0].visible_px                            # A: the pair only
    assert views[1].visible_px.get("e2", 0) > 0                       # B: context within 2.5 m
    listed = json.loads((scene_dir / "render" / "views.json").read_text())
    assert {v["image"] for v in listed} >= {v.image for v in views}
    assert all(View(**v) for v in listed)


def test_same_seed_same_bytes_other_seed_differs(scene_dir, tmp_path):
    a = render.render_scene(scene_dir, ["e1", "e2"], views=("A",), width=512, seed=3, out_dir=tmp_path / "a")
    b = render.render_scene(scene_dir, ["e1", "e2"], views=("A",), width=512, seed=3, out_dir=tmp_path / "b")
    c = render.render_scene(scene_dir, ["e1", "e2"], views=("A",), width=512, seed=4, out_dir=tmp_path / "c")
    assert _sha(scene_dir / a[0].image) == _sha(scene_dir / b[0].image)
    assert _sha(scene_dir / a[0].id_image) == _sha(scene_dir / b[0].id_image)
    assert a[0].visible_px == b[0].visible_px
    assert _sha(scene_dir / a[0].image) != _sha(scene_dir / c[0].image)


def test_fix_and_batch(scene_dir):
    fix = Fix("e2", dz=0.3)
    (before, after), (hl,) = render.render_many([
        dict(scene_dir=scene_dir, focus=["e1", "e2"], views=render.FIX_VIEWS, fix=fix, width=512),
        dict(scene_dir=scene_dir, focus=["e1", "e2"], views=("A",), style="hidden-line", width=512, tag="hl"),
    ])
    assert (before.name, after.name) == ("before_A", "after_A")
    assert before.labels == after.labels and before.colors == after.colors
    assert _sha(scene_dir / before.image) != _sha(scene_dir / after.image)
    assert after.visible_px["e2"] > 0
    assert hl.image.endswith("hl_A.png") and hl.visible_px["e1"] > 0


# ---- cameras, locked elements, compass, candidates (one browser for the lot) ----

TOP = Camera("top", azimuth_deg=0, elevation_deg=90, projection="orthographic")
SECTION = Camera("section_x", azimuth_deg=-90, elevation_deg=0, projection="orthographic")
FIXES = [Fix("e2", dz=0.3), Fix("e2", dz=-0.3), Fix("e2", dx=0.9)]


def _scene_in(d, *, locked=(), cameras=()):
    s = _scene()
    for e in s.elements:
        e.locked = e.id in locked
    s.cameras = list(cameras)
    d.mkdir(parents=True, exist_ok=True)
    s.save(d / "scene.json")
    return d


@pytest.fixture(scope="module")
def batch(tmp_path_factory):
    root = tmp_path_factory.mktemp("batch")
    plain, locked = _scene_in(root / "plain"), _scene_in(root / "locked", locked=("e1",))
    with_cams = _scene_in(root / "cams", cameras=(TOP, Camera("A", azimuth_deg=30, elevation_deg=25)))
    jobs = {
        "cams": dict(scene_dir=plain, focus=["e1", "e2"], cameras=[TOP, SECTION], width=512),
        "plain_A": dict(scene_dir=plain, focus=["e1", "e2"], views=("A", "B"), seed=5, width=512, tag="cmp"),
        "locked_A": dict(scene_dir=locked, focus=["e1", "e2"], views=("A", "B"), seed=5, width=512, tag="cmp"),
        "no_compass": dict(scene_dir=plain, focus=["e1", "e2"], views=("A",), seed=5, width=512, tag="nc", compass=False),
        "scene_cams": dict(scene_dir=with_cams, focus=["e1", "e2"], width=512),
        "scene_cams_named": dict(scene_dir=with_cams, focus=["e1", "e2"], views=("C",), width=512),
        "cands": dict(scene_dir=locked, focus=["e1", "e2"], fixes=FIXES, width=512),
        "cands_top": dict(scene_dir=plain, focus=["e1", "e2"], fixes=FIXES[:2], camera=TOP, grid=False, width=512),
    }
    many = _many_scene_in(root / "many")
    jobs["many"] = dict(scene_dir=many, focus=["e1", "e2", "e3", "e5", "e6", "e7"], views=("A",), width=256)
    res = dict(zip(jobs, render.render_many(list(jobs.values()))))
    return {"root": root, "plain": plain, "locked": locked, "with_cams": with_cams, "many": many, "jobs": jobs, **res}


def _many_scene_in(d):
    """Six focus elements and three openings: enough to run past the letters that are left out."""
    s = _scene()
    s.elements[0].openings = [Opening("o1", (0.8, -0.15, 2.55), (1.4, 0.15, 2.85)),
                              Opening("o2", (2.5, -0.15, 2.55), (3.3, 0.15, 2.85)),
                              Opening("o3", (4.6, -0.15, 2.55), (5.2, 0.15, 2.85))]
    s.elements += [Element(f"e{i}", "pipe", "service", "cylinder", start=(x, -2, 2.2), end=(x, 2, 2.2), radius=0.05)
                   for i, x in ((5, 0.5), (6, 2.0), (7, 5.6))]
    d.mkdir(parents=True, exist_ok=True)
    s.save(d / "scene.json")
    return d


def test_orthographic_top_and_section(batch):
    top, sec = batch["cams"]
    d = batch["plain"]
    assert (top.name, sec.name) == ("top", "section_x")
    assert _sha(d / top.image) != _sha(d / sec.image)
    for v in (top, sec):
        assert _png_size(d / v.image) == (512, 512) and _png_size(d / v.id_image) == (512, 512)
        assert v.visible_px["e1"] > 0 and v.visible_px["e2"] > 0
        assert sorted(v.labels[e] for e in ("e1", "e2")) == ["A", "B"] and v.labels["o1"] == "P"
    # orthographic: one scale everywhere, so footprints keep their true ratio (beam 6 x 0.3 m, duct 0.6 x 4 m from
    # above), give or take a pixel row on the 22 px wide beam at this size
    assert top.visible_px["e1"] / top.visible_px["e2"] == pytest.approx(1.8 / 2.4, rel=0.03)
    listed = {v["image"] for v in json.loads((d / "render" / "views.json").read_text())}
    assert {top.image, sec.image} <= listed


def test_scene_cameras_are_the_default_and_names_resolve(batch):
    d = batch["with_cams"]
    top, a = batch["scene_cams"]
    assert (top.name, a.name) == ("top", "A")                       # no views given: one per scene camera
    (c,) = batch["scene_cams_named"]                                # "C" is not a scene camera: the seeded one
    assert c.name == "C" and c.visible_px["e1"] > 0
    assert _sha(d / a.image) != _sha(batch["plain"] / batch["plain_A"][0].image)   # scene's A, not the seeded A


def test_locked_element_badge_changes_picture_not_id_pass(batch):
    pd, ld = batch["plain"], batch["locked"]
    for plain, locked in zip(batch["plain_A"], batch["locked_A"]):
        assert plain.name == locked.name
        assert _sha(pd / plain.image) != _sha(ld / locked.image)          # hatch, padlock, legend
        assert _sha(pd / plain.id_image) == _sha(ld / locked.id_image)    # geometry and ids untouched
        assert plain.visible_px == locked.visible_px and plain.labels == locked.labels


def test_compass_is_drawn_and_can_be_turned_off(batch):
    d = batch["plain"]
    with_c, no_c = batch["plain_A"][0], batch["no_compass"][0]
    assert _sha(d / with_c.image) != _sha(d / no_c.image)
    assert _sha(d / with_c.id_image) == _sha(d / no_c.id_image)
    assert with_c.visible_px == no_c.visible_px


def test_candidates_and_grid(batch):
    d = batch["locked"]
    views = batch["cands"]
    assert [v.name for v in views] == ["before", "cand_1", "cand_2", "cand_3", "cand_grid"]
    for v in views:
        assert v.labels == views[0].labels and v.colors == views[0].colors and v.focus == ["e1", "e2"]
        assert v.visible_px["e1"] > 0 and v.visible_px["e2"] > 0
    shas = {_sha(d / v.image) for v in views}
    assert len(shas) == len(views)                                    # every candidate draws differently
    for v in views[:-1]:
        assert _png_size(d / v.image) == (512, 512)
    gw, gh = _png_size(d / views[-1].image)
    assert gw == 512 and 400 < gh <= 512 and _png_size(d / views[-1].id_image) == (gw, gh)
    top_views = batch["cands_top"]
    assert [v.name for v in top_views] == ["before", "cand_1", "cand_2"]     # grid=False, a given camera
    listed = {v["image"] for v in json.loads((d / "render" / "views.json").read_text())}
    assert {v.image for v in views} <= listed


def test_new_views_are_deterministic(batch, tmp_path):
    jobs = batch["jobs"]
    again = render.render_many([{**jobs["cands"], "out_dir": tmp_path / "c"}, {**jobs["cams"], "out_dir": tmp_path / "o"}])
    for first, second, d in ((batch["cands"], again[0], batch["locked"]), (batch["cams"], again[1], batch["plain"])):
        for a, b in zip(first, second):
            assert a.name == b.name and a.visible_px == b.visible_px
            assert _sha(d / a.image) == _sha(d / b.image) and _sha(d / a.id_image) == _sha(d / b.id_image)


def test_render_candidates_and_render_fix_wrappers(scene_dir, tmp_path):
    views = render.render_candidates(scene_dir, ["e1", "e2"], FIXES[:1], width=256, out_dir=tmp_path)
    assert [v.name for v in views] == ["before", "cand_1", "cand_grid"]
    fx = render.render_fix(scene_dir, ["e1", "e2"], FIXES[0], cameras=[TOP], width=256)
    assert [v.name for v in fx] == ["before_top", "after_top"]
    assert _sha(scene_dir / fx[0].image) != _sha(scene_dir / fx[1].image)


def test_letters_skip_compass_and_lookalike_letters(batch):
    (v,) = batch["many"]
    els = ["e1", "e2", "e3", "e5", "e6", "e7"]
    assert sorted(v.labels[e] for e in els) == sorted(render.ELEMENT_LETTERS[:6])     # A B C D F G
    assert sorted(v.labels[o] for o in ("o1", "o2", "o3")) == sorted(render.OPENING_LETTERS[:3])   # P Q V
    assert not set("ENUIO") & set(v.labels.values())
    assert not set(render.ELEMENT_LETTERS) & set(render.OPENING_LETTERS)
    for e in els:
        assert v.visible_px[e] > 0


def test_concurrent_render_scene_calls_keep_both_entries(tmp_path):
    d = tmp_path / "scene"
    d.mkdir()
    _scene().save(d / "scene.json")
    with ThreadPoolExecutor(2) as pool:
        a, b = pool.map(lambda f: render.render_scene(d, f, views=("A",), width=256), (["e1", "e2"], ["e1", "e3"]))
    listed = {v["image"] for v in json.loads((d / "render" / "views.json").read_text())}
    assert {a[0].image, b[0].image} <= listed


def test_views_json_merge_is_safe_across_processes(tmp_path):
    """Eight processes each merge 25 entries one at a time into one views.json: none may be lost."""
    code = ("import sys; from iris_bench.render import merge_views_json\n"
            "d, p = sys.argv[1], sys.argv[2]\n"
            "for i in range(25):\n"
            "    merge_views_json(d, [dict(name='A', image=f'render/p{p}_{i}.png', id_image='x', labels={}, colors={},"
            " visible_px={}, focus=[])])\n")
    procs = [subprocess.Popen([sys.executable, "-c", code, str(tmp_path), str(p)]) for p in range(8)]
    assert all(pr.wait(timeout=120) == 0 for pr in procs)
    rows = json.loads((tmp_path / "views.json").read_text())
    assert len(rows) == 200 and len({r["image"] for r in rows}) == 200
    assert not list(tmp_path.glob(".views.*.tmp"))                    # no temporary files left behind
