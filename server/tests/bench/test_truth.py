"""Iris Bench ground truth (truth.py): relations, candidate resolutions and cameras, all from geometry and the checker."""
from __future__ import annotations

import itertools
import json
from collections import Counter

import pytest

from iris_bench import checker, geom, truth
from iris_bench.scenes import generate
from iris_bench.spec import Element, Fix, Opening, Planted, Scene

SEEDS = range(50)
EPS = 1e-6
INVALID = {"too_small", "wrong_direction", "wrong_element", "wrong_opening", "hits_third"}
VALID = {"good", "alt_opening", "alt_below", "alt_above"}


def _knobs(seed: int) -> dict:
    return dict(density=seed % 12, decoys=seed % 3, occlusion=bool(seed % 2), locked_services=seed % 3)


@pytest.fixture(scope="module")
def scenes() -> dict[int, Scene]:
    return {s: generate(s, **_knobs(s)) for s in SEEDS}


def _real_pairs(s: Scene):
    return [(n, p) for n, p in enumerate(s.planted) if p.kind == "real"]


# --- determinism and storage ---------------------------------------------------------------------------------------

def test_annotations_deterministic_and_recomputable(scenes):
    for seed in (0, 1, 2, 17):
        again = generate(seed, **_knobs(seed))
        assert again.to_json() == scenes[seed].to_json()
        assert again.relations and again.resolutions and again.cameras
        # the truth is a function of the scene alone: re-annotating a loaded copy gives the same answer key
        loaded = Scene.from_dict(json.loads(again.to_json()))
        assert truth.annotate(loaded).to_json() == again.to_json()


def test_scene_json_round_trip(tmp_path, scenes):
    s = scenes[5]
    s.save(tmp_path / "scene.json")
    back = Scene.load(tmp_path / "scene.json")
    assert back.to_json() == s.to_json()
    assert back.relations == s.relations and back.cameras == s.cameras
    assert [r.fix for r in back.resolutions] == [r.fix for r in s.resolutions]
    assert [e.locked for e in back.elements] == [e.locked for e in s.elements]
    assert [e.allowed_moves for e in back.elements] == [e.allowed_moves for e in s.elements]


def test_generate_without_annotations():
    s = generate(3, annotate=False)
    assert s.relations == [] and s.resolutions == [] and s.cameras == []
    assert generate(3).to_json() == truth.annotate(s).to_json()


# --- resolutions -----------------------------------------------------------------------------------------------------

def test_every_resolution_is_the_checkers_verdict(scenes):
    for s in scenes.values():
        for r in s.resolutions:
            got = checker.check_fix(s, r.fix)
            assert r.valid == got["passed"], (s.seed, r)
            assert r.resolves_original == got["clash_gone"], (s.seed, r)
            assert r.new_hits == got["new_hits"], (s.seed, r)
            assert r.evidence == got, (s.seed, r)


def test_every_real_pair_has_valid_and_three_invalid(scenes):
    for s in scenes.values():
        reals = _real_pairs(s)
        assert {r.pair for r in s.resolutions} == {n for n, _ in reals}
        for n, p in reals:
            rs = [r for r in s.resolutions if r.pair == n]
            labels = [r.label for r in rs]
            assert len(labels) == len(set(labels)), (s.seed, labels)
            assert labels[0] == "good" and rs[0].fix == p.good_fix and rs[0].valid, (s.seed, n)
            assert any(r.valid for r in rs)
            assert len({r.label for r in rs if not r.valid}) >= 3, (s.seed, n, labels)
            for r in rs:
                assert r.label in VALID | INVALID, r.label
                assert r.valid == (r.label in VALID), (s.seed, r.label, r.evidence["reason"])
            assert len({(r.fix.element, r.fix.dx, r.fix.dy, r.fix.dz, r.fix.via_opening) for r in rs}) == len(rs)


def test_invalid_resolutions_fail_for_their_stated_reason(scenes):
    for s in scenes.values():
        for r in s.resolutions:
            p = s.planted[r.pair]
            el = s.element(r.fix.element)
            if r.label == "wrong_element":
                assert el.role == "structure" or el.locked
                assert r.fix.element not in (p.mover,)
            if r.label == "wrong_opening":
                assert r.fix.via_opening and r.fix.via_opening not in p.fitting_openings
            if r.label == "alt_opening":
                assert r.fix.via_opening in p.fitting_openings and r.evidence["via_opening"] == r.fix.via_opening
            if r.label == "too_small":
                g = p.good_fix
                ratio = geom_len(r.fix) / geom_len(g)
                assert ratio in (pytest.approx(0.5, abs=1e-3), pytest.approx(0.25, abs=1e-3))
            if r.label == "hits_third" and r.resolves_original:
                assert r.new_hits and not r.valid


def geom_len(f: Fix) -> float:
    return (f.dx ** 2 + f.dy ** 2 + f.dz ** 2) ** 0.5


def test_resolves_but_creates_a_new_clash_rate(scenes):
    """The new-clash case: an invalid fix that clears the planted clash but hits something new."""
    per_scene = [any(r.resolves_original and r.new_hits and not r.valid for r in s.resolutions) for s in scenes.values()]
    per_pair = Counter()
    for s in scenes.values():
        for n, _ in _real_pairs(s):
            per_pair[any(r.resolves_original and r.new_hits and not r.valid for r in s.resolutions if r.pair == n)] += 1
    rate = sum(per_scene) / len(per_scene)
    print(f"resolves-but-new-clash: {sum(per_scene)}/{len(per_scene)} scenes, {per_pair[True]}/{sum(per_pair.values())} "
          "real pairs")
    assert rate >= 0.9


def test_a_new_clash_is_a_real_overlap_for_hits_third(scenes):
    for s in scenes.values():
        for r in s.resolutions:
            if r.label == "hits_third" and r.resolves_original:
                after = geom.moved(s.element(r.fix.element), r.fix)
                assert min(geom.distance(after, s.element(h)) for h in r.new_hits) < 0, (s.seed, r)


# --- relations -------------------------------------------------------------------------------------------------------

STATE = {"supports", "touches", "clashes", "clear_of"}
OPPOSITE = {"above": "below", "below": "above", "north_of": "south_of", "south_of": "north_of",
            "east_of": "west_of", "west_of": "east_of"}
AXIS = {"above": 2, "below": 2, "north_of": 1, "south_of": 1, "east_of": 0, "west_of": 0}


def test_relations_agree_with_geometry(scenes):
    for s in scenes.values():
        boxes = {e.id: geom.bbox(e) for e in s.elements}
        rel = {(r.a, r.b, r.relation, r.via) for r in s.relations}
        for r in s.relations:
            a, b = s.element(r.a), s.element(r.b)
            (alo, ahi), (blo, bhi) = boxes[r.a], boxes[r.b]
            d = geom.distance(a, b)
            if r.relation in AXIS:
                k = AXIS[r.relation]
                if r.relation in ("above", "north_of", "east_of"):
                    assert alo[k] >= bhi[k] - EPS and r.value_m == pytest.approx(max(alo[k] - bhi[k], 0), abs=EPS)
                else:
                    assert ahi[k] <= blo[k] + EPS and r.value_m == pytest.approx(max(blo[k] - ahi[k], 0), abs=EPS)
                assert (r.b, r.a, OPPOSITE[r.relation], None) in rel
            elif r.relation == "clashes":
                assert d < 0 and r.value_m == pytest.approx(d, abs=EPS)
            elif r.relation == "clear_of":
                assert d > 0 and r.value_m == pytest.approx(d, abs=EPS)
            elif r.relation == "touches":
                assert abs(d) <= EPS and not (a.supports == b.id or b.supports == a.id)
            elif r.relation == "supports":
                assert a.kind == "bracket" and a.supports == b.id and abs(d) <= EPS
            elif r.relation in ("crosses", "parallel"):
                ra, rb = truth.run_axis(a), truth.run_axis(b)
                assert ra is not None and rb is not None
                assert (ra != rb) == (r.relation == "crosses")
                assert r.value_m == pytest.approx(d, abs=EPS)
                for k in ((0, 1) if r.relation == "crosses" else (ra,)):
                    assert min(ahi[k], bhi[k]) - max(alo[k], blo[k]) > 0
            elif r.relation == "passes_through":
                opening = next(o for o in b.openings if o.id == r.via)
                assert b.kind == "beam" and geom.passes_through(a, b, opening)
                t = geom.through_axis(opening, b)
                c = [(alo[k] + ahi[k]) / 2 for k in range(3)]
                assert all(opening.min[k] < c[k] < opening.max[k] for k in range(3) if k != t)   # inside the void
                assert r.value_m == pytest.approx(d, abs=EPS)
            else:
                raise AssertionError(r.relation)


def test_every_pair_in_range_has_one_state_and_complete_order(scenes):
    for s in list(scenes.values())[:20]:
        planted = {frozenset((p.a, p.b)) for p in s.planted}
        states = Counter(frozenset((r.a, r.b)) for r in s.relations if r.relation in STATE)
        rel = {(r.a, r.b, r.relation) for r in s.relations}
        for a, b in itertools.combinations(s.elements, 2):
            d = geom.distance(a, b)
            key = frozenset((a.id, b.id))
            if d <= truth.RELATION_RANGE_M or key in planted:
                assert states[key] == 1, (s.seed, a.id, b.id)
                (alo, ahi), (blo, bhi) = geom.bbox(a), geom.bbox(b)
                if alo[2] >= bhi[2] + 1e-3:
                    assert (a.id, b.id, "above") in rel and (b.id, a.id, "below") in rel
                if blo[2] >= ahi[2] + 1e-3:
                    assert (b.id, a.id, "above") in rel and (a.id, b.id, "below") in rel
            else:
                assert states[key] == 0


def test_passes_through_only_and_always_when_inside_a_void(scenes):
    seen = 0
    for s in scenes.values():
        got = {(r.a, r.b, r.via) for r in s.relations if r.relation == "passes_through"}
        near = {frozenset((r.a, r.b)) for r in s.relations if r.relation in STATE}
        for beam in (e for e in s.elements if e.kind == "beam"):
            for el in s.elements:
                if el.id == beam.id or frozenset((el.id, beam.id)) not in near:
                    continue
                for o in beam.openings:
                    assert ((el.id, beam.id, o.id) in got) == geom.passes_through(el, beam, o), (s.seed, el.id, o.id)
        for rid in s.challenge["routed_ids"]:
            assert any(a == rid for a, _, _ in got), (s.seed, rid)
        seen += len(got)
    assert seen >= 25          # routed services give most scenes a positive case


def test_planted_pairs_relations(scenes):
    for s in scenes.values():
        rel = {(r.a, r.b, r.relation) for r in s.relations}
        for p in s.planted:
            pair = {(p.a, p.b), (p.b, p.a)}
            kinds = {k for a, b, k in rel if (a, b) in pair}
            assert {"real": "clashes", "not_touching": "clear_of", "by_design": "supports"}[p.kind] in kinds, (s.seed, p)
            if p.kind == "real":
                assert "crosses" in kinds      # every planted clash is two runs crossing


# --- locks and allowed moves -----------------------------------------------------------------------------------------

def test_locked_constraints(scenes):
    n_locked = 0
    for s in scenes.values():
        locked = [e for e in s.elements if e.locked]
        assert sorted(e.id for e in locked) == sorted(s.challenge["locked_ids"])
        assert len(locked) == s.challenge["locked_services"]
        n_locked += len(locked)
        for e in locked:
            assert e.role == "service"
        for n, p in _real_pairs(s):
            mover = s.element(p.mover)
            assert not mover.locked and mover.role == "service", (s.seed, p)
            other = s.element(p.b if p.a == p.mover else p.a)
            if other.locked:
                # the locked one is the natural mover (the smaller section); the lock is all that keeps it in place
                sec = lambda e: (lambda lo, hi: sorted(hi[k] - lo[k] for k in range(3))[:2])(*geom.bbox(e))
                assert sec(other)[0] * sec(other)[1] < sec(mover)[0] * sec(mover)[1]
                wrong = next(r for r in s.resolutions if r.pair == n and r.label == "wrong_element")
                assert wrong.fix.element == other.id and not wrong.valid
                assert wrong.evidence["reason"] == f"locked: {other.id} must not move", wrong.evidence
                assert wrong.resolves_original and not wrong.new_hits
    assert n_locked == sum(_knobs(s)["locked_services"] for s in SEEDS)


def test_allowed_moves_are_enforced_by_geometry(scenes):
    """A mover whose allowed moves exclude "up" really cannot go up: rising clear of its clash partner hits the slab."""
    checked = 0
    for s in scenes.values():
        slab = next(e for e in s.elements if e.kind == "slab")
        for n, p in _real_pairs(s):
            mover = s.element(p.mover)
            if not mover.allowed_moves:
                continue
            assert "up" not in mover.allowed_moves and "down" in mover.allowed_moves
            assert p.good_fix.dz < 0 and checker.directions(p.good_fix) == ["down"]
            other = s.element(p.b if p.a == p.mover else p.a)
            lift = geom.bbox(other)[1][2] - geom.bbox(mover)[0][2]            # its bottom level with the partner's top
            after = geom.moved(mover, Fix(mover.id, dz=lift + s.clearance_m))
            assert geom.distance(after, other) >= s.clearance_m - EPS
            assert geom.distance(after, slab) < 0                               # the slab is in the way
            checked += 1
    assert checked == sum(_knobs(s)["locked_services"] for s in SEEDS)


def test_locked_services_validated():
    with pytest.raises(ValueError):
        generate(1, locked_services=3)
    for k in (0, 1, 2):
        s = generate(11, locked_services=k, density=20, decoys=2, occlusion=True)
        assert len(_real_pairs(s)) == 1 + k


def test_check_fix_respects_locks_and_allowed_moves():
    beam = Element("e1", "beam", "structure", "box", min=(0, -0.1, 2.6), max=(6, 0.1, 3.0),
                   openings=[Opening("o1", (1.0, -0.15, 2.62), (1.5, 0.15, 2.98))])
    duct = Element("e2", "duct", "service", "box", min=(2.8, -2, 2.65), max=(3.2, 2, 2.95))
    s = Scene(1, [beam, duct], [Planted("e1", "e2", "real", -0.35, mover="e2", good_fix=Fix("e2", dz=-0.4))])
    down = Fix("e2", dz=-0.4)
    assert checker.check_fix(s, down)["passed"]
    duct.allowed_moves = ["up", "east"]
    r = checker.check_fix(s, down)
    assert not r["passed"] and r["clash_gone"] and "not allowed: e2 may not move down" in r["reason"]
    duct.allowed_moves = ["down"]
    assert checker.check_fix(s, down)["passed"]
    duct.locked = True
    r = checker.check_fix(s, down)
    assert not r["passed"] and r["reason"] == "locked: e2 must not move"
    assert checker.directions(Fix("e2", dx=0.1, dy=-0.2, dz=0)) == ["east", "south"]


# --- cameras ---------------------------------------------------------------------------------------------------------

def test_default_cameras(scenes):
    for s in scenes.values():
        cams = {c.name: c for c in s.cameras}
        assert list(cams)[:5] == ["A", "B", "C", "top", "section"]
        a, b, c = cams["A"], cams["B"], cams["C"]
        assert (a.azimuth_deg, a.elevation_deg) == (b.azimuth_deg, b.elevation_deg)
        assert (c.azimuth_deg - a.azimuth_deg) % 360 == pytest.approx(90)
        assert 22 <= a.elevation_deg <= 38 and a.projection == "perspective"
        assert cams["top"].elevation_deg == 90 and cams["top"].projection == "orthographic"
        sec = cams["section"]
        assert sec.elevation_deg == 0 and sec.projection == "orthographic"
        beam = s.element(s.challenge["target"][1])
        along = truth.run_axis(beam)
        assert sec.azimuth_deg == (0.0 if along == 0 else 270.0)     # looking along the beam
    assert truth.default_cameras(scenes[3], 3) == scenes[3].cameras
    assert truth.default_cameras(scenes[3], 4) != scenes[3].cameras


def test_extra_cameras_from_knobs():
    s = generate(2, cam_azimuths=[0, 120], cam_elevations=[15, 60])
    names = [c.name for c in s.cameras]
    assert names[5:] == ["az0_el15", "az0_el60", "az120_el15", "az120_el60"]
    assert s.cameras[-1].azimuth_deg == 120 and s.cameras[-1].elevation_deg == 60
    only_el = truth.default_cameras(s, 2, elevations=[10])
    assert len(only_el) == 6 and only_el[-1].azimuth_deg == only_el[0].azimuth_deg and only_el[-1].elevation_deg == 10
