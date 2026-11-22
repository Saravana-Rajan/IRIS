"""Control conditions: does the model actually look at the pictures?

    no_image(item)            the same prompt with no pictures at all (mode "no_image")
    swapped(item, other)      the same prompt and truth, but pictures from a different scene whose truth differs
                              (mode "swapped"): a model that answers the item's truth here is not reading the images
"""
from __future__ import annotations

from dataclasses import replace

from .spec import Item


def _control_id(item: Item, mode: str) -> str:
    n = item.meta.get("n", item.id.split("-")[-2] if item.id.count("-") >= 3 else 0)
    return f"{item.seed}-{item.job}-{n}-{mode}"


def no_image(item: Item) -> Item:
    """The item with its pictures removed."""
    return replace(item, id=_control_id(item, "no_image"), mode="no_image", images=[],
                   meta={**item.meta, "control": "no_image", "base_id": item.id, "n_images": 0})


def swapped(item: Item, other_item: Item) -> Item:
    """The item shown another scene's pictures. `other_item` must be the same job from a different scene with a
    different truth; raises ValueError otherwise."""
    if other_item.job != item.job:
        raise ValueError("swapped needs the same job")
    if other_item.seed == item.seed:
        raise ValueError("swapped needs pictures from a different scene")
    if other_item.truth == item.truth:
        raise ValueError("swapped needs a different truth")
    return replace(item, id=_control_id(item, "swapped"), mode="swapped", images=list(other_item.images),
                   meta={**item.meta, "control": "swapped", "base_id": item.id, "images_from": other_item.id,
                         "images_truth": other_item.truth, "n_images": len(other_item.images)})
