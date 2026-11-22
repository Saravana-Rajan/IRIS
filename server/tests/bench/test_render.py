"""The bench renderer draws a tiny hand-written scene: files, sizes, views.json, visible pixels, determinism."""
import hashlib
import json
import struct

import pytest

from iris_bench import render
from iris_bench.spec import Element, Fix, Opening, Scene, View

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
