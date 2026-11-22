"""Control conditions: does the model actually look at the pictures?

    no_image(item)                  the same prompt with no pictures at all (mode "no_image")
    swapped(item, other)            the same prompt and truth, but pictures from a different scene whose answer differs
                                    (mode "swapped"): a model that answers the item's truth here is not reading them
    counterfactual(item_a, item_b)  item_b tagged as the counterfactual of item_a: the same question on pictures that
                                    differ by one geometric change, with a different answer (mode "pictures",
                                    meta {"control": "counterfactual", "counterfactual_of": item_a.id}). A model that
                                    reads the pictures flips its answer between the two.
    counterfactuals(items)          every such pair found in a run: J5/J6 items on the same planted pair whose shown
                                    moves differ (same before pictures, one move changed), and J1 items whose scenes
                                    share a `cf_group` in scene.challenge (a scene generated as a one-change variant)

All of them work for every job: the item keeps its own truth; the control's meta says what was changed.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import replace

from .spec import Item


def _base(item: Item) -> str:
    """The item id without its mode suffix ("<seed>-<job>-<n>")."""
    return item.id.removesuffix(f"-{item.mode}")


def _control_id(item: Item, mode: str) -> str:
    return f"{_base(item)}-{mode}"


def _n(item: Item) -> str:
    n = item.meta.get("n")
    if n is not None:
        return str(n)
    parts = _base(item).split("-")
    return parts[-1] if len(parts) >= 3 else "0"


def _question(item: Item):
    return item.meta.get("question", item.truth.get("question"))


def answer_of(item: Item):
    """The item's reference answer (what a control must differ in)."""
    t = item.truth
    if "answer" in t:
        return t["answer"]
    if t.get("expected") is not None:
        return t["expected"]
    return t


def no_image(item: Item) -> Item:
    """The item with its pictures removed."""
    return replace(item, id=_control_id(item, "no_image"), mode="no_image", images=[],
                   meta={**item.meta, "control": "no_image", "base_id": item.id, "n_images": 0})


def swapped(item: Item, other_item: Item) -> Item:
    """The item shown another scene's pictures. `other_item` must be the same job and question from a different
    scene with a different answer (J7: the same number of pictures); raises ValueError otherwise."""
    if other_item.job != item.job:
        raise ValueError("swapped needs the same job")
    if _question(other_item) != _question(item):
        raise ValueError("swapped needs the same question")
    if other_item.seed == item.seed:
        raise ValueError("swapped needs pictures from a different scene")
    if other_item.truth == item.truth or answer_of(other_item) == answer_of(item):
        raise ValueError("swapped needs a different truth")
    if item.job == "J7_pick_valid" and len(other_item.images) != len(item.images):
        raise ValueError("swapped J7 needs the same number of candidate pictures")
    return replace(item, id=_control_id(item, "swapped"), mode="swapped", images=list(other_item.images),
                   meta={**item.meta, "control": "swapped", "base_id": item.id, "images_from": other_item.id,
                         "images_truth": other_item.truth, "n_images": len(other_item.images)})


def _change(a: Item, b: Item) -> dict:
    ta, tb = a.truth, b.truth
    if "fix" in ta and "fix" in tb:
        return {"what": "proposed move", "fix_a": ta["fix"], "fix_b": tb["fix"]}
    return {"what": "scene variant", "seed_a": a.seed, "seed_b": b.seed, "cf_group": b.meta.get("cf_group")}


def counterfactual(item_a: Item, item_b: Item, change: dict | None = None) -> Item:
    """`item_b` as the counterfactual of `item_a`: same job and question, pictures one geometric change apart
    (`change` says which; by default the two shown moves, or the two scene seeds), different answers. Raises
    ValueError otherwise. The copy keeps mode "pictures" and item_b's own truth; meta carries
    {"control": "counterfactual", "counterfactual_of": item_a.id, "base_id": item_b.id, "counterfactual_answer",
    "change"}."""
    if item_a.job != item_b.job:
        raise ValueError("counterfactual needs the same job")
    if _question(item_a) != _question(item_b):
        raise ValueError("counterfactual needs the same question")
    if _base(item_a) == _base(item_b):
        raise ValueError("counterfactual needs two different items")
    if answer_of(item_a) == answer_of(item_b):
        raise ValueError("counterfactual needs truths that differ")
    cid = f"{item_b.seed}-{item_b.job}-{_n(item_b)}cf{item_a.seed}x{_n(item_a)}-pictures"
    return replace(item_b, id=cid, mode="pictures",
                   meta={**item_b.meta, "control": "counterfactual", "counterfactual_of": item_a.id,
                         "base_id": item_b.id, "counterfactual_answer": answer_of(item_a),
                         "change": change or _change(item_a, item_b)})


def counterfactuals(items: list[Item]) -> list[Item]:
    """Counterfactual copies for every pair found among the `pictures` items (each item used at most once):
    J5/J6 on the same scene and planted pair (the shown move is the one change), J1 across scenes sharing a
    `cf_group` (same planted pair index)."""
    groups: dict[tuple, list[Item]] = defaultdict(list)
    for it in items:
        if it.mode != "pictures" or it.meta.get("control"):
            continue
        if it.job in ("J5_review", "J6_new_clash") and "pair_index" in it.meta:
            groups[("fix", it.seed, it.job, it.meta["pair_index"])].append(it)
        elif it.job == "J1_sort" and it.meta.get("cf_group") is not None:
            groups[("scene", it.meta["cf_group"], it.job, _question(it), it.meta.get("pair_index"))].append(it)
    out: list[Item] = []
    for key in sorted(groups, key=str):
        lst = sorted(groups[key], key=lambda i: i.id)
        used: set[str] = set()
        for i, a in enumerate(lst):
            if a.id in used:
                continue
            for b in lst[i + 1:]:
                if b.id in used or answer_of(a) == answer_of(b) or _question(a) != _question(b):
                    continue
                if key[0] == "scene" and a.seed == b.seed:
                    continue
                out.append(counterfactual(a, b))
                used |= {a.id, b.id}
                break
    return out
