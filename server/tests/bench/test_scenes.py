"""Iris Bench scene generator: determinism, planted truth in closed form, and agreement with Iris's own engine."""
from __future__ import annotations

import itertools
import json

import pytest

from iris_bench.ifc_writer import write_ifc
from iris_bench.scenes import _aabb, box_distance, clear_of_beam, fits_through, fix_is_clear, generate, to_folder
from iris_bench.spec import Scene

SEEDS = range(40)


def _knobs(seed: int) -> dict:
    return dict(density=seed % 12, decoys=seed % 3, occlusion=bool(seed % 2))


@pytest.fixture(scope="module")
def scenes() -> dict[int, Scene]:
    return {s: generate(s, **_knobs(s)) for s in SEEDS}


def test_same_seed_same_scene():
    for seed in (0, 7, 123):
        assert generate(seed, **_knobs(seed)).to_json() == generate(seed, **_knobs(seed)).to_json()
    assert generate(1).to_json() != generate(2).to_json()


def test_round_trip(tmp_path):
    s = generate(5, density=6, decoys=2, view="iso")
    to_folder(s, tmp_path / "s5")
    again = Scene.load(tmp_path / "s5" / "scene.json")
    assert again.to_json() == s.to_json()
    assert again.challenge["view"] == "iso"


def test_contents(scenes):
    for s in scenes.values():
        kinds = [e.kind for e in s.elements]
        assert 1 <= kinds.count("beam") <= 2 and kinds.count("slab") == 1
        assert [e.id for e in s.elements] == [f"e{i + 1}" for i in range(len(s.elements))]
        ops = [o.id for e in s.elements for o in e.openings]
        assert ops == [f"o{i + 1}" for i in range(len(ops))]
        for e in s.elements:
            if e.kind == "beam":
                assert 1 <= len(e.openings) <= 3
        assert {p.kind for p in s.planted} == {"real", "not_touching", "by_design"}
        for k in ("density", "decoys", "gap_mm", "overlap_mm", "occlusion"):
            assert k in s.challenge
        assert len(s.challenge["decoy_ids"]) == s.challenge["decoys"]


def test_knobs_respected():
    s = generate(3, gap_mm=12, overlap_mm=300, density=15, decoys=2)
    real = next(p for p in s.planted if p.kind == "real")
    near = next(p for p in s.planted if p.kind == "not_touching")
    assert real.distance_m == pytest.approx(-0.300) and near.distance_m == pytest.approx(0.012)
    assert len(s.challenge["distractor_ids"]) >= 10
    mover = s.element(real.mover)
    for d in s.challenge["decoy_ids"]:
        assert s.element(d).kind == mover.kind
        assert sorted(_size(s.element(d))) == pytest.approx(sorted(_size(mover)))


def _size(el):
    lo, hi = _aabb(el)
    return [hi[i] - lo[i] for i in range(3) if (hi[i] - lo[i]) < 1.0]   # the cross-section, not the run


def test_planted_distances_closed_form(scenes):
    for s in scenes.values():
        for p in s.planted:
            d = box_distance(_aabb(s.element(p.a)), _aabb(s.element(p.b)))
            assert d == pytest.approx(p.distance_m, abs=1e-6), (s.seed, p)
            if p.kind == "real":
                assert -0.400 - 1e-9 <= p.distance_m <= -0.050 + 1e-9
            if p.kind == "not_touching":
                assert 0.005 - 1e-9 <= p.distance_m <= 0.040 + 1e-9


def test_nothing_else_touches(scenes):
    """Only planted pairs and structure on structure come closer than 50 mm (beam openings counted as empty)."""
    for s in scenes.values():
        planted = {frozenset((p.a, p.b)) for p in s.planted}
        for a, b in itertools.combinations(s.elements, 2):
            if frozenset((a.id, b.id)) in planted or (a.role == b.role == "structure"):
                continue
            beam = a if a.kind == "beam" else b if b.kind == "beam" else None
            if beam is not None:
                other = b if beam is a else a
                assert clear_of_beam(_aabb(other), beam, 0.050 - 1e-9), (s.seed, a.id, b.id)
            else:
                assert box_distance(_aabb(a), _aabb(b)) >= 0.050 - 1e-9, (s.seed, a.id, b.id)


def test_good_fix_is_clear_and_through_its_opening(scenes):
    for s in scenes.values():
        real = next(p for p in s.planted if p.kind == "real")
        fix = real.good_fix
        assert fix is not None and fix.element == real.mover and fix.via_opening
        assert fix.dx == fix.dy == 0 and fix.dz > 0
        assert fix_is_clear(s, fix), s.seed
        mover = s.element(real.mover)
        opening = next(o for e in s.elements for o in e.openings if o.id == fix.via_opening)
        assert fits_through(mover, opening, s.clearance_m)
        assert fix.via_opening in real.fitting_openings
        all_open = [o for e in s.elements for o in e.openings]
        assert real.fitting_openings == [o.id for o in all_open if fits_through(mover, o, s.clearance_m)]


def test_brackets_carry_their_service(scenes):
    for s in scenes.values():
        by = next(p for p in s.planted if p.kind == "by_design")
        br, svc = s.element(by.a), s.element(by.b)
        assert br.kind == "bracket" and br.role == "support" and br.supports == svc.id
        assert svc.kind in ("tray", "pipe")
        assert _aabb(br)[1][2] == pytest.approx(_aabb(svc)[0][2])   # touches from below


# ------------------------------------------------------------------------------------------- Iris's own engine

@pytest.mark.parametrize("seed", [0, 1, 2, 3, 7, 11])
def test_iris_engine_agrees(tmp_path, seed):
    from iris import detect, verify
    from iris.scene import IfcScene

    s = generate(seed, **_knobs(seed))
    path = write_ifc(s, tmp_path / "scene.ifc")
    ids = json.loads((tmp_path / "ids.json").read_text())
    assert set(ids) >= {e.id for e in s.elements}
    scene = IfcScene(path)
    for p in s.planted:
        got = detect.measure_pair(scene, ids[p.a], ids[p.b])
        if p.kind == "real":
            assert got is not None and got == pytest.approx(p.distance_m, abs=0.002), (p, got)
        elif p.kind == "not_touching":
            assert got is None, (p, got)

    real = next(p for p in s.planted if p.kind == "real")
    mover, fix = ids[real.mover], real.good_fix
    scene.translate([mover], (fix.dx, fix.dy, fix.dz))
    assert detect.measure_pair(scene, mover, ids[real.b]) is None
    verdict = verify.check(scene, [mover], clearance_m=s.clearance_m)
    assert verdict.passed, verdict


def test_ifc_names_and_classes(tmp_path):
    import ifcopenshell

    s = generate(4, density=4)
    write_ifc(s, tmp_path / "scene.ifc")
    ids = json.loads((tmp_path / "ids.json").read_text())
    m = ifcopenshell.open(str(tmp_path / "scene.ifc"))
    assert m.schema == "IFC4"
    for e in s.elements:
        product = m.by_guid(ids[e.id])
        assert product.Name == e.id and product.Tag == e.id
    assert len(m.by_type("IfcOpeningElement")) == sum(len(e.openings) for e in s.elements)
    assert len(m.by_type("IfcRelVoidsElement")) == len(m.by_type("IfcOpeningElement"))
