# Iris VisionBench: gemini-3.8-flash, 7 seeds

Items: 1183. Results: 160. Models: `gemini-3.8-flash`.

Integrity: **PASS** (see *Benchmark integrity*).

## Headline: accuracy with pictures (95% bootstrap CI)

| Model | J1 sort | J2 who moves | J3 fix | J4 opening | J5 review | J6 new clash | J7 pick valid | J8 spatial | J9 relation | All jobs |
|---|---|---|---|---|---|---|---|---|---|---|
| gemini-3.8-flash | 64% [36%, 91%] n=11 | 100% [100%, 100%] n=11 | 73% [45%, 91%] n=11 | 29% [0%, 57%] n=7 | 36% [9%, 64%] n=11 | 73% [45%, 100%] n=11 | 18% [0%, 45%] n=11 | 55% [27%, 82%] n=11 | 64% [36%, 91%] n=11 | 58% [47%, 67%] n=95 |

## Scores by category (95% bootstrap CI)

Each item is scored under its task category (one job can feed several). Mode: pictures.

| Model | Clash identification | Relationship understanding | Element selection | Spatial reasoning | Opening selection | Movement estimation | Resolution validity | New clash detection |
|---|---|---|---|---|---|---|---|---|
| gemini-3.8-flash | 64% [36%, 91%] n=11 | 64% [36%, 91%] n=11 | 100% [100%, 100%] n=11 | 55% [27%, 82%] n=11 | 29% [0%, 57%] n=7 | 73% [45%, 91%] n=11 | 27% [9%, 45%] n=22 | 73% [45%, 100%] n=11 |

### Categories by mode

**gemini-3.8-flash**

| Category | pictures | pictures_text | no_image | swapped |
|---|---|---|---|---|
| Clash identification | 64% [36%, 91%] n=11 | 100% [100%, 100%] n=3 | 33% [0%, 100%] n=3 | 0% [0%, 0%] n=3 |
| Relationship understanding | 64% [36%, 91%] n=11 | 100% [100%, 100%] n=1 | 50% [0%, 100%] n=2 | 0% [0%, 0%] n=2 |
| Element selection | 100% [100%, 100%] n=11 | 100% [100%, 100%] n=2 | 50% [0%, 100%] n=2 | 0% [0%, 0%] n=2 |
| Spatial reasoning | 55% [27%, 82%] n=11 | 100% [100%, 100%] n=3 | 33% [0%, 100%] n=3 | 33% [0%, 100%] n=3 |
| Opening selection | 29% [0%, 57%] n=7 | 100% [100%, 100%] n=3 | 0% [0%, 0%] n=3 | 0% [0%, 0%] n=3 |
| Movement estimation | 73% [45%, 91%] n=11 | 100% [100%, 100%] n=3 | 33% [0%, 100%] n=3 | 0% [0%, 0%] n=3 |
| Resolution validity | 27% [9%, 45%] n=22 | 33% [0%, 67%] n=3 | 33% [0%, 100%] n=3 | 33% [0%, 67%] n=3 |
| New clash detection | 73% [45%, 100%] n=11 | 100% [100%, 100%] n=3 | 67% [33%, 100%] n=3 | 33% [0%, 100%] n=3 |

## Sounds reasonable vs geometrically correct

A model's stated confidence and its written reason are what its answer *sounds like*; the checker's geometry verdict, measured on the scene, is what is *true*. Calibration compares the two: in a well-calibrated model, answers given at 80% confidence are right about 80% of the time (ECE = expected calibration error, the n-weighted gap between confidence and accuracy over five equal-width buckets; 0 is perfect). *Confidently wrong* = confidence of at least 0.8 and an incorrect answer. *Plausible but wrong* = an incorrect answer whose reason names the right elements or opening: it talks about the right things and still gets the geometry wrong.

### Calibration

| Model | Mode | n | With confidence | Mean confidence | Accuracy | ECE | Brier | Overconfidence |
|---|---|---|---|---|---|---|---|---|
| gemini-3.8-flash | pictures | 95 | 95 (100%) | 96% | 58% | 0.385 | 0.386 | +39 pts |
| gemini-3.8-flash | pictures_text | 21 | 21 (100%) | 98% | 90% | 0.078 | 0.094 | +8 pts |
| gemini-3.8-flash | no_image | 22 | 22 (100%) | 96% | 36% | 0.591 | 0.576 | +59 pts |
| gemini-3.8-flash | swapped | 22 | 22 (100%) | 97% | 14% | 0.829 | 0.812 | +83 pts |

### Accuracy per confidence bucket

| Model | Mode | Confidence | n | Mean confidence | Accuracy | Gap |
|---|---|---|---|---|---|---|
| gemini-3.8-flash | pictures | 0.8-1.0 | 95 | 96% | 58% | +39 pts |
| gemini-3.8-flash | pictures_text | 0.8-1.0 | 21 | 98% | 90% | +8 pts |
| gemini-3.8-flash | no_image | 0.8-1.0 | 22 | 96% | 36% | +59 pts |
| gemini-3.8-flash | swapped | 0.8-1.0 | 22 | 97% | 14% | +83 pts |

### Confidently wrong (confidence ≥ 0.8 and incorrect)

| Model | Mode | Category | Rate | Confidently wrong / with confidence | Share of confident answers |
|---|---|---|---|---|---|
| gemini-3.8-flash | pictures | All categories | 42% | 40 / 95 | 42% |
| gemini-3.8-flash | pictures | Clash identification | 36% | 4 / 11 | 36% |
| gemini-3.8-flash | pictures | Relationship understanding | 36% | 4 / 11 | 36% |
| gemini-3.8-flash | pictures | Element selection | 0% | 0 / 11 | 0% |
| gemini-3.8-flash | pictures | Spatial reasoning | 45% | 5 / 11 | 45% |
| gemini-3.8-flash | pictures | Opening selection | 71% | 5 / 7 | 71% |
| gemini-3.8-flash | pictures | Movement estimation | 27% | 3 / 11 | 27% |
| gemini-3.8-flash | pictures | Resolution validity | 73% | 16 / 22 | 73% |
| gemini-3.8-flash | pictures | New clash detection | 27% | 3 / 11 | 27% |
| gemini-3.8-flash | pictures_text | All categories | 10% | 2 / 21 | 10% |
| gemini-3.8-flash | pictures_text | Clash identification | 0% | 0 / 3 | 0% |
| gemini-3.8-flash | pictures_text | Relationship understanding | 0% | 0 / 1 | 0% |
| gemini-3.8-flash | pictures_text | Element selection | 0% | 0 / 2 | 0% |
| gemini-3.8-flash | pictures_text | Spatial reasoning | 0% | 0 / 3 | 0% |
| gemini-3.8-flash | pictures_text | Opening selection | 0% | 0 / 3 | 0% |
| gemini-3.8-flash | pictures_text | Movement estimation | 0% | 0 / 3 | 0% |
| gemini-3.8-flash | pictures_text | Resolution validity | 67% | 2 / 3 | 67% |
| gemini-3.8-flash | pictures_text | New clash detection | 0% | 0 / 3 | 0% |
| gemini-3.8-flash | no_image | All categories | 64% | 14 / 22 | 64% |
| gemini-3.8-flash | no_image | Clash identification | 67% | 2 / 3 | 67% |
| gemini-3.8-flash | no_image | Relationship understanding | 50% | 1 / 2 | 50% |
| gemini-3.8-flash | no_image | Element selection | 50% | 1 / 2 | 50% |
| gemini-3.8-flash | no_image | Spatial reasoning | 67% | 2 / 3 | 67% |
| gemini-3.8-flash | no_image | Opening selection | 100% | 3 / 3 | 100% |
| gemini-3.8-flash | no_image | Movement estimation | 67% | 2 / 3 | 67% |
| gemini-3.8-flash | no_image | Resolution validity | 67% | 2 / 3 | 67% |
| gemini-3.8-flash | no_image | New clash detection | 33% | 1 / 3 | 33% |
| gemini-3.8-flash | swapped | All categories | 86% | 19 / 22 | 86% |
| gemini-3.8-flash | swapped | Clash identification | 100% | 3 / 3 | 100% |
| gemini-3.8-flash | swapped | Relationship understanding | 100% | 2 / 2 | 100% |
| gemini-3.8-flash | swapped | Element selection | 100% | 2 / 2 | 100% |
| gemini-3.8-flash | swapped | Spatial reasoning | 67% | 2 / 3 | 67% |
| gemini-3.8-flash | swapped | Opening selection | 100% | 3 / 3 | 100% |
| gemini-3.8-flash | swapped | Movement estimation | 100% | 3 / 3 | 100% |
| gemini-3.8-flash | swapped | Resolution validity | 67% | 2 / 3 | 67% |
| gemini-3.8-flash | swapped | New clash detection | 67% | 2 / 3 | 67% |

### Plausible but wrong

Incorrect answers whose reason names the right elements or opening, most confident first: what the model said next to what the geometry says.

| Item | Model | Job | Confidence | Model's reason | Geometry verdict (checker) | Answer | Reference | Reason names |
|---|---|---|---|---|---|---|---|---|
| `3-J4_opening-0-pictures` | gemini-3.8-flash | J4 opening | 1.00 | Element A is wider than opening P, so it cannot pass through with a clear gap all round. | reference: [P]; source=geom.fits, clearance_m=0.025 | fitting=[] | [P] | P |
| `5-J4_opening-0-pictures` | gemini-3.8-flash | J4 opening | 0.99 | Element A is significantly wider than opening P, so it cannot pass through. | reference: [P]; source=geom.fits, clearance_m=0.025 | fitting=[] | [P] | P |
| `6-J5_review-3r4-pictures` | gemini-3.8-flash | J5 review | 0.99 | Element A has only shifted slightly along element B, leaving element B still penetrating through element A. | reference: resolves the original clash; checker: fix fails: not allowed: e10 [A] may not move up; clearance -123 mm to e3 [F] < required 25 mm; new hits: e3 [F] | resolved=False | resolved (hits_third) | A |
| `0-J1_sort-2yn-pictures` | gemini-3.8-flash | J1 sort | 0.98 | Element B passes directly through the body of slab A, causing an internal clash. | reference: by_design; source=geom.distance, distance_m=0, planted_kind=by_design, planted_distance_m=0 | clash=True | by_design | B, A |
| `0-J5_review-3r0-pictures` | gemini-3.8-flash | J5 review | 0.98 | Element B still passes directly through the upper portion of element A. | reference: resolves the original clash; checker: fix passes: ok | resolved=False | resolved (good) | A |
| `1-J3_fix-0-pictures` | gemini-3.8-flash | J3 fix | 0.98 | Moving duct A up 550 mm aligns it with sleeve opening P, clearing the clash with wall B without hitting any other elements. | clearance 4 mm to e1 [B] < required 25 mm | element=A, direction=up, distance_mm=550, via_opening=P | element=A, direction=up, distance_mm=493, via_opening=P | A, P |
| `1-J5_review-0r5-pictures` | gemini-3.8-flash | J5 review | 0.98 | Element B was lowered but still penetrates directly into the solid body of beam A beneath opening P. | reference: resolves the original clash; checker: fix fails: clearance -195 mm to e7 [S] < required 25 mm; new hits: e6 [L], e7 [S] | resolved=False | resolved (hits_third) | B |
| `1-J5_review-3r3-pictures` | gemini-3.8-flash | J5 review | 0.98 | Pipe A still cuts through the top edge and volume of box B, leaving the clash unresolved. | reference: resolves the original clash; checker: fix fails: locked: e8 [A] must not move | resolved=False | resolved (wrong_element) | A |
| `2-J5_review-3r0-pictures` | gemini-3.8-flash | J5 review | 0.98 | Element B was shifted along element A and still intersects it. | reference: resolves the original clash; checker: fix passes: ok | resolved=False | resolved (good) | B |
| `4-J1_sort-2yn-pictures` | gemini-3.8-flash | J1 sort | 0.98 | Element A intersects and cuts directly through the bottom portion of element B. | reference: by_design; source=geom.distance, distance_m=0, planted_kind=by_design, planted_distance_m=0 | clash=True | by_design | A, B |
| `0-J8_spatial-g2order-pictures` | gemini-3.8-flash | J8 spatial | 0.95 | A is the sill of opening P, B is the duct passing through P, D is the higher duct passing through opening Q, and C is the bar resting on top of D. | reference: [C, D, B, A]; source=geom.bbox, axis=z | order=[A, B, D, C] | [C, D, B, A] | C, D, B, A |
| `1-J6_new_clash-3r0-pictures` | gemini-3.8-flash | J6 new clash | 0.95 | Moving B downwards causes it to collide with the horizontal circular pipe running underneath. | reference: no new clash; checker: nothing new within 25 mm; least clearance 82 mm | new_clash=True | no new clash | B |
| `2-J3_fix-3-pictures` | gemini-3.8-flash | J3 fix | 0.95 | Moving element A down by 100 mm clears the bottom of fixed element B. | clearance 0 mm to e8 [B] < required 25 mm | element=A, direction=down, distance_mm=100, via_opening=None | element=A, direction=down, distance_mm=183, via_opening=None | A |
| `2-J4_opening-0-pictures` | gemini-3.8-flash | J4 opening | 0.95 | Opening P is sufficiently large for element A, whereas opening Q is obstructed by a fixed element on the opposite side. | reference: [P, Q]; source=geom.fits, clearance_m=0.025 | fitting=[P] | [P, Q] | P, Q |
| `3-J1_sort-2-pictures` | gemini-3.8-flash | J1 sort | 0.95 | Pipe B directly penetrates through element A, creating an unintended hard clash that needs resolving. | reference: by_design; source=geom.distance, distance_m=0, planted_kind=by_design, planted_distance_m=0 | answer=a | by_design | A, B |

## Cost-weighted score (pictures)

Illustrative weights per error type, not measured costs: false_clear 5, approved_bad_fix 5, missed_new_clash 5, too_small 3, hits_new_element 3, wrong_direction 2, wrong_element 2, wrong_opening 2, false_alarm 1, false_new_clash 1, rejected_good_fix 1, wrong_label 1, wrong 1, unparseable 1, ungraded 0. Score = 1 - total cost / (items x max weight).

| Model | Job | Accuracy | Cost-weighted | Mean cost |
|---|---|---|---|---|
| gemini-3.8-flash | J1 sort | 64% | 93% | 0.36 |
| gemini-3.8-flash | J2 who moves | 100% | 100% | 0.00 |
| gemini-3.8-flash | J3 fix | 73% | 84% | 0.82 |
| gemini-3.8-flash | J4 opening | 29% | 71% | 1.43 |
| gemini-3.8-flash | J5 review | 36% | 87% | 0.64 |
| gemini-3.8-flash | J6 new clash | 73% | 87% | 0.64 |
| gemini-3.8-flash | J7 pick valid | 18% | 25% | 3.73 |
| gemini-3.8-flash | J8 spatial | 55% | 91% | 0.45 |
| gemini-3.8-flash | J9 relation | 64% | 93% | 0.36 |

## Controls: does the picture matter?

Delta = control accuracy minus pictures accuracy on the same questions (paired). A model that truly uses the picture drops on `no_image` and `swapped`.

| Model | Job | Control | n | Pictures | Control acc | Delta [95% CI] |
|---|---|---|---|---|---|---|
| gemini-3.8-flash | J1 sort | no_image | 3 | 33% | 33% | +0 pts [-100 pts, +100 pts] |
| gemini-3.8-flash | J1 sort | swapped | 3 | 33% | 0% | -33 pts [-100 pts, +0 pts] |
| gemini-3.8-flash | J1 sort | pictures_text | 3 | 33% | 100% | +67 pts [+0 pts, +100 pts] |
| gemini-3.8-flash | J2 who moves | no_image | 2 | 100% | 50% | -50 pts [-100 pts, +0 pts] |
| gemini-3.8-flash | J2 who moves | swapped | 2 | 100% | 0% | -100 pts [-100 pts, -100 pts] |
| gemini-3.8-flash | J2 who moves | pictures_text | 2 | 100% | 100% | +0 pts [+0 pts, +0 pts] |
| gemini-3.8-flash | J3 fix | no_image | 3 | 100% | 33% | -67 pts [-100 pts, +0 pts] |
| gemini-3.8-flash | J3 fix | swapped | 3 | 100% | 0% | -100 pts [-100 pts, -100 pts] |
| gemini-3.8-flash | J3 fix | pictures_text | 3 | 100% | 100% | +0 pts [+0 pts, +0 pts] |
| gemini-3.8-flash | J4 opening | no_image | 3 | 0% | 0% | +0 pts [+0 pts, +0 pts] |
| gemini-3.8-flash | J4 opening | swapped | 3 | 0% | 0% | +0 pts [+0 pts, +0 pts] |
| gemini-3.8-flash | J4 opening | pictures_text | 3 | 0% | 100% | +100 pts [+100 pts, +100 pts] |
| gemini-3.8-flash | J5 review | no_image | 3 | 33% | 33% | +0 pts [-67 pts, +100 pts] |
| gemini-3.8-flash | J5 review | swapped | 3 | 33% | 33% | +0 pts [+0 pts, +0 pts] |
| gemini-3.8-flash | J5 review | pictures_text | 3 | 33% | 33% | +0 pts [+0 pts, +0 pts] |
| gemini-3.8-flash | J6 new clash | no_image | 3 | 33% | 67% | +33 pts [+0 pts, +100 pts] |
| gemini-3.8-flash | J6 new clash | swapped | 3 | 33% | 33% | +0 pts [+0 pts, +0 pts] |
| gemini-3.8-flash | J6 new clash | pictures_text | 3 | 33% | 100% | +67 pts [+0 pts, +100 pts] |
| gemini-3.8-flash | J8 spatial | no_image | 3 | 67% | 33% | -33 pts [-100 pts, +0 pts] |
| gemini-3.8-flash | J8 spatial | swapped | 3 | 67% | 33% | -33 pts [-100 pts, +0 pts] |
| gemini-3.8-flash | J8 spatial | pictures_text | 3 | 67% | 100% | +33 pts [+0 pts, +67 pts] |
| gemini-3.8-flash | J9 relation | no_image | 2 | 50% | 50% | +0 pts [+0 pts, +0 pts] |
| gemini-3.8-flash | J9 relation | swapped | 2 | 0% | 0% | +0 pts [+0 pts, +0 pts] |
| gemini-3.8-flash | J9 relation | pictures_text | 1 | 0% | 100% | +100 pts [+100 pts, +100 pts] |

## J3 partial credit

| Model | Mode | n | Direction right | Distance in band | Right opening |
|---|---|---|---|---|---|
| gemini-3.8-flash | no_image | 3 | 33% | 0% | 100% |
| gemini-3.8-flash | pictures | 11 | 100% | 73% | 100% |
| gemini-3.8-flash | pictures_text | 3 | 67% | 67% | 0% |
| gemini-3.8-flash | swapped | 3 | 33% | 0% | 0% |

## Where accuracy drops (challenge slices)

| Model | Job | Mode | Factor | Bucket | n | Slice acc | Overall | Drop |
|---|---|---|---|---|---|---|---|---|
| gemini-3.8-flash | J6 new clash | pictures | visible_px | [1000,5000) | 3 | 33% | 73% | +39 pts |
| gemini-3.8-flash | J1 sort | pictures | overlap_mm | [0,10) | 6 | 33% | 64% | +30 pts |
| gemini-3.8-flash | J1 sort | pictures | visible_px | [200,1000) | 6 | 33% | 64% | +30 pts |
| gemini-3.8-flash | J8 spatial | pictures | gap_mm | [25,50) | 3 | 33% | 55% | +21 pts |
| gemini-3.8-flash | J7 pick valid | pictures | overlap_mm | >=100 | 4 | 0% | 18% | +18 pts |
| gemini-3.8-flash | J7 pick valid | pictures | visible_px | [1000,5000) | 3 | 0% | 18% | +18 pts |
| gemini-3.8-flash | J5 review | pictures | overlap_mm | >=100 | 5 | 20% | 36% | +16 pts |
| gemini-3.8-flash | J8 spatial | pictures | visible_px | >=5000 | 5 | 40% | 55% | +15 pts |
| gemini-3.8-flash | J9 relation | pictures | visible_px | >=5000 | 8 | 50% | 64% | +14 pts |
| gemini-3.8-flash | J5 review | pictures | visible_px | >=5000 | 8 | 25% | 36% | +11 pts |

## Error taxonomy

| Model | Job | Mode | Error | Count | Share | Weight |
|---|---|---|---|---|---|---|
| gemini-3.8-flash | J1 sort | no_image | false_alarm | 1 | 33% | 1 |
| gemini-3.8-flash | J1 sort | no_image | wrong_label | 1 | 33% | 1 |
| gemini-3.8-flash | J1 sort | pictures | false_alarm | 4 | 36% | 1 |
| gemini-3.8-flash | J1 sort | swapped | false_alarm | 3 | 100% | 1 |
| gemini-3.8-flash | J2 who moves | no_image | wrong_element | 1 | 50% | 2 |
| gemini-3.8-flash | J2 who moves | swapped | wrong_element | 2 | 100% | 2 |
| gemini-3.8-flash | J3 fix | no_image | too_small | 1 | 33% | 3 |
| gemini-3.8-flash | J3 fix | no_image | wrong_element | 1 | 33% | 2 |
| gemini-3.8-flash | J3 fix | pictures | too_small | 3 | 27% | 3 |
| gemini-3.8-flash | J3 fix | swapped | hits_new_element | 2 | 67% | 3 |
| gemini-3.8-flash | J3 fix | swapped | wrong_element | 1 | 33% | 2 |
| gemini-3.8-flash | J4 opening | no_image | wrong_opening | 3 | 100% | 2 |
| gemini-3.8-flash | J4 opening | pictures | wrong_opening | 5 | 71% | 2 |
| gemini-3.8-flash | J4 opening | swapped | wrong_opening | 3 | 100% | 2 |
| gemini-3.8-flash | J5 review | no_image | approved_bad_fix | 1 | 33% | 5 |
| gemini-3.8-flash | J5 review | no_image | rejected_good_fix | 1 | 33% | 1 |
| gemini-3.8-flash | J5 review | pictures | rejected_good_fix | 7 | 64% | 1 |
| gemini-3.8-flash | J5 review | pictures_text | rejected_good_fix | 2 | 67% | 1 |
| gemini-3.8-flash | J5 review | swapped | rejected_good_fix | 2 | 67% | 1 |
| gemini-3.8-flash | J6 new clash | no_image | missed_new_clash | 1 | 33% | 5 |
| gemini-3.8-flash | J6 new clash | pictures | false_new_clash | 2 | 18% | 1 |
| gemini-3.8-flash | J6 new clash | pictures | missed_new_clash | 1 | 9% | 5 |
| gemini-3.8-flash | J6 new clash | swapped | false_new_clash | 1 | 33% | 1 |
| gemini-3.8-flash | J6 new clash | swapped | missed_new_clash | 1 | 33% | 5 |
| gemini-3.8-flash | J7 pick valid | pictures | approved_bad_fix | 8 | 73% | 5 |
| gemini-3.8-flash | J7 pick valid | pictures | rejected_good_fix | 1 | 9% | 1 |
| gemini-3.8-flash | J8 spatial | no_image | wrong | 2 | 67% | 1 |
| gemini-3.8-flash | J8 spatial | pictures | wrong | 5 | 45% | 1 |
| gemini-3.8-flash | J8 spatial | swapped | wrong | 2 | 67% | 1 |
| gemini-3.8-flash | J9 relation | no_image | wrong | 1 | 50% | 1 |
| gemini-3.8-flash | J9 relation | pictures | wrong | 4 | 36% | 1 |
| gemini-3.8-flash | J9 relation | swapped | wrong | 2 | 100% | 1 |

## Benchmark integrity

**Overall: PASS** · items: 1183 · checked 2026-11-22T09:28:53+00:00

|  | Check | Summary |
|---|---|---|
| ✅ | Truth and evidence written before any model call | 1183 items and 7 scenes match the build manifest of 2026-11-22T09:16:41+00:00; results written after it |
| ✅ | Truth code never reads model replies | 5 truth modules (checker, geom, scenes, spec, truth) import no runner, model client or scorer |
| ✅ | Pictures-mode prompts leak no kinds, ids or measurements | 885 prompts scanned, none names a kind, id or measurement |
| ✅ | Reference answers re-derived from scene.json by geometry | 298/298 sampled answers re-derived from geometry match |
| ✅ | Every answer letter is labelled in the item's own pictures | 298 pictures items: every answer letter is labelled in their pictures |
| ⚠️ | Answer balance and chance baselines | J1_sort majority 50% vs chance 42%; J2_who_moves majority 86% vs chance 50%; J3_fix majority 50% vs chance 6%; J4_opening majority 71% vs chance 38%; J5_review majority 50% vs chance 50%; J6_new_clash majority 50% vs chance 50%; J7_pick_valid majority 29%; J8_spatial majority 20% vs chance 23%; J9_relation majority 19% vs chance 18% — imbalanced: J2_who_moves, J4_opening |

### Answer balance and chance baselines

Majority share = accuracy of always giving the most common reference answer; chance = accuracy of guessing uniformly among the offered options.

| Job | n | Majority answer | Majority share | Chance level |  |
|---|---|---|---|---|---|
| J1 sort | 56 | real | 50% | 42% |  |
| J2 who moves | 14 | A | 86% | 50% | ⚠️ imbalanced |
| J3 fix | 14 | up | 50% | 6% |  |
| J4 opening | 7 | P | 71% | 38% | ⚠️ imbalanced |
| J5 review | 28 | true | 50% | 50% |  |
| J6 new clash | 28 | true | 50% | 50% |  |
| J7 pick valid | 14 | 4 | 29% | - |  |
| J8 spatial | 65 | D | 20% | 23% |  |
| J9 relation | 72 | clashes | 19% | 18% |  |

### Reference answers re-derived from scene.json

Checked 298, matched 298, mismatched 0, skipped 0.

| Job | Checked | Matched | Mismatched | Skipped |
|---|---|---|---|---|
| J1 sort | 56 | 56 | 0 | 0 |
| J2 who moves | 14 | 14 | 0 | 0 |
| J3 fix | 14 | 14 | 0 | 0 |
| J4 opening | 7 | 7 | 0 | 0 |
| J5 review | 28 | 28 | 0 | 0 |
| J6 new clash | 28 | 28 | 0 | 0 |
| J7 pick valid | 14 | 14 | 0 | 0 |
| J8 spatial | 65 | 65 | 0 | 0 |
| J9 relation | 72 | 72 | 0 | 0 |

## Sample items

### ✅ `0-J1_sort-2-pictures` (gemini-3.8-flash)

![e7-e6_A.png](scenes/0/render/e7-e6_A.webp) ![e7-e6_B.png](scenes/0/render/e7-e6_B.webp) ![e7-e6_C.png](scenes/0/render/e7-e6_C.webp)

- Reply: `{'answer': 'c', 'confidence': 0.95, 'reason': 'Element B is a support bracket positioned directly beneath element A, touching its bottom surface to support it by design.'}`
- Model says: confidence 0.95; reason: Element B is a support bracket positioned directly beneath element A, touching its bottom surface to support it by design.
- Checker: -

### ❌ `0-J1_sort-2yn-pictures` (gemini-3.8-flash)

![e7-e6_A.png](scenes/0/render/e7-e6_A.webp) ![e7-e6_B.png](scenes/0/render/e7-e6_B.webp) ![e7-e6_C.png](scenes/0/render/e7-e6_C.webp)

- Reply: `{'clash': True, 'confidence': 0.98, 'reason': 'Element B passes directly through the body of slab A, causing an internal clash.'}`
- Model says: confidence 0.98; reason: Element B passes directly through the body of slab A, causing an internal clash.
- Checker: false_alarm

### ✅ `0-J2_who_moves-0-pictures` (gemini-3.8-flash)

![e4-e1_A.png](scenes/0/render/e4-e1_A.webp) ![e4-e1_B.png](scenes/0/render/e4-e1_B.webp) ![e4-e1_C.png](scenes/0/render/e4-e1_C.webp)

- Reply: `{'mover_letter': 'B', 'confidence': 0.98, 'reason': 'Element B is a service run that can be raised to pass cleanly through opening V in the beam.'}`
- Model says: confidence 0.98; reason: Element B is a service run that can be raised to pass cleanly through opening V in the beam.
- Checker: -

### ✅ `0-J2_who_moves-3-pictures` (gemini-3.8-flash)

![e9-e8_A.png](scenes/0/render/e9-e8_A.webp) ![e9-e8_B.png](scenes/0/render/e9-e8_B.webp) ![e9-e8_C.png](scenes/0/render/e9-e8_C.webp)

- Reply: `{'mover_letter': 'B', 'confidence': 0.99, 'reason': 'Element A is marked with a padlock and fixed hatching, leaving element B free to move.'}`
- Model says: confidence 0.99; reason: Element A is marked with a padlock and fixed hatching, leaving element B free to move.
- Checker: -

### ✅ `0-J3_fix-0-pictures` (gemini-3.8-flash)

![e4-e1_A.png](scenes/0/render/e4-e1_A.webp) ![e4-e1_B.png](scenes/0/render/e4-e1_B.webp) ![e4-e1_C.png](scenes/0/render/e4-e1_C.webp)

- Reply: `{'element': 'B', 'direction': 'up', 'distance_mm': 450, 'via_opening': 'V', 'confidence': 0.95, 'reason': 'Moving duct B up by 450 mm routes it directly through opening V in beam A.'}`
- Model says: confidence 0.95; reason: Moving duct B up by 450 mm routes it directly through opening V in beam A.
- Checker: ok

### ✅ `0-J3_fix-3-pictures` (gemini-3.8-flash)

![e9-e8_A.png](scenes/0/render/e9-e8_A.webp) ![e9-e8_B.png](scenes/0/render/e9-e8_B.webp) ![e9-e8_C.png](scenes/0/render/e9-e8_C.webp)

- Reply: `{'element': 'B', 'direction': 'down', 'distance_mm': 100, 'via_opening': None, 'confidence': 0.95, 'reason': 'Element A is fixed and intersects the top of element B by approximately 71 mm; moving B d…`
- Model says: confidence 0.95; reason: Element A is fixed and intersects the top of element B by approximately 71 mm; moving B down by 100 mm clears the clash with an adequate gap.
- Checker: ok

### ✅ `0-J4_opening-0-pictures` (gemini-3.8-flash)

![e4-e1_A.png](scenes/0/render/e4-e1_A.webp) ![e4-e1_B.png](scenes/0/render/e4-e1_B.webp) ![e4-e1_C.png](scenes/0/render/e4-e1_C.webp)

- Reply: `{'fitting': ['V'], 'confidence': 0.95, 'reason': 'Opening V is large enough in both width and height for element B to pass through with clearance all round, whereas openings P and Q are too narrow.'}`
- Model says: confidence 0.95; reason: Opening V is large enough in both width and height for element B to pass through with clearance all round, whereas openings P and Q are too narrow.
- Checker: -

### ❌ `0-J5_review-3r0-pictures` (gemini-3.8-flash)

![e8-e9_fixc25608a8_before_A.png](scenes/0/render/e8-e9_fixc25608a8_before_A.webp) ![e8-e9_fixc25608a8_after_A.png](scenes/0/render/e8-e9_fixc25608a8_after_A.webp)

- Reply: `{'resolved': False, 'confidence': 0.98, 'reason': 'Element B still passes directly through the upper portion of element A.'}`
- Model says: confidence 0.98; reason: Element B still passes directly through the upper portion of element A.
- Checker: reference: resolves the original clash; checker: fix passes: ok

### ❌ `0-J6_new_clash-0r4-pictures` (gemini-3.8-flash)

![e1-e4-e5_fixe9ada363_before_A.png](scenes/0/render/e1-e4-e5_fixe9ada363_before_A.webp) ![e1-e4-e5_fixe9ada363_after_A.png](scenes/0/render/e1-e4-e5_fixe9ada363_after_A.webp)

- Reply: `{'new_clash': False, 'confidence': 0.95, 'reason': 'The moved duct passes cleanly through opening P with ample clearance from the beam and all other elements, introducing no new clashes.'}`
- Model says: confidence 0.95; reason: The moved duct passes cleanly through opening P with ample clearance from the beam and all other elements, introducing no new clashes.
- Checker: reference: new clash; checker: move hits e10 [R], e5 [A], e6 [F] (new, within 25 mm)

### ✅ `0-J6_new_clash-3r0-pictures` (gemini-3.8-flash)

![e8-e9_fixc25608a8_before_A.png](scenes/0/render/e8-e9_fixc25608a8_before_A.webp) ![e8-e9_fixc25608a8_after_A.png](scenes/0/render/e8-e9_fixc25608a8_after_A.webp)

- Reply: `{'new_clash': False, 'confidence': 0.95, 'reason': 'Element A moves into open space and does not contact or intersect any surrounding elements.'}`
- Model says: confidence 0.95; reason: Element A moves into open space and does not contact or intersect any surrounding elements.
- Checker: reference: no new clash; checker: nothing new within 25 mm; least clearance 59 mm

### ❌ `0-J7_pick_valid-3-pictures` (gemini-3.8-flash)

![e8-e9_candseccb955e_before.png](scenes/0/render/e8-e9_candseccb955e_before.webp) ![e8-e9_candseccb955e_cand_1.png](scenes/0/render/e8-e9_candseccb955e_cand_1.webp) ![e8-e9_candseccb955e_cand_2.png](scenes/0/render/e8-e9_candseccb955e_cand_2.webp)

- Reply: `{'valid': [2], 'confidence': 0.95, 'reason': 'In solution 2, element A is shifted downwards sufficiently to provide a clear gap beneath fixed element B without clashing with any obstacles below.'}`
- Model says: confidence 0.95; reason: In solution 2, element A is shifted downwards sufficiently to provide a clear gap beneath fixed element B without clashing with any obstacles below.
- Checker: missed 1, valid (least clearance 59 mm); picked 2, invalid: locked: e8 [B] must not move

### ❌ `0-J8_spatial-g0highest-pictures` (gemini-3.8-flash)

![e4-e1-e2-e3_A.png](scenes/0/render/e4-e1-e2-e3_A.webp) ![e4-e1-e2-e3_C.png](scenes/0/render/e4-e1-e2-e3_C.webp)

- Reply: `{'answer': 'D', 'confidence': 0.9, 'reason': 'The green beam (D) projects above the top surface of the purple slab (A), making it the highest element.'}`
- Model says: confidence 0.90; reason: The green beam (D) projects above the top surface of the purple slab (A), making it the highest element.
- Checker: wrong

### ✅ `0-J8_spatial-g1between-pictures` (gemini-3.8-flash)

![e5-e1-e4-e2_A.png](scenes/0/render/e5-e1-e4-e2_A.webp) ![e5-e1-e4-e2_C.png](scenes/0/render/e5-e1-e4-e2_C.webp)

- Reply: `{'answer': 'none', 'confidence': 0.95, 'reason': 'Both B and D are located at a higher elevation than both C and A, meaning neither A nor C lies between them.'}`
- Model says: confidence 0.95; reason: Both B and D are located at a higher elevation than both C and A, meaning neither A nor C lies between them.
- Checker: -

### ❌ `0-J8_spatial-g2order-pictures` (gemini-3.8-flash)

![e7-e6-e1-e5_A.png](scenes/0/render/e7-e6-e1-e5_A.webp) ![e7-e6-e1-e5_C.png](scenes/0/render/e7-e6-e1-e5_C.webp)

- Reply: `{'order': ['A', 'B', 'D', 'C'], 'confidence': 0.95, 'reason': 'A is the sill of opening P, B is the duct passing through P, D is the higher duct passing through opening Q, and C is the bar resting on…`
- Model says: confidence 0.95; reason: A is the sill of opening P, B is the duct passing through P, D is the higher duct passing through opening Q, and C is the bar resting on top of D.
- Checker: wrong

### ❌ `0-J9_relation-r4-pictures` (gemini-3.8-flash)

![e4-e1-e2-e3_A.png](scenes/0/render/e4-e1-e2-e3_A.webp) ![e4-e1-e2-e3_C.png](scenes/0/render/e4-e1-e2-e3_C.webp)

- Reply: `{'relation': 'clashes', 'confidence': 0.95, 'reason': "The purple slab A and the green beam D geometrically overlap and cut into each other's volume without a void or boolean cut."}`
- Model says: confidence 0.95; reason: The purple slab A and the green beam D geometrically overlap and cut into each other's volume without a void or boolean cut.
- Checker: wrong

### ✅ `0-J9_relation-r7-pictures` (gemini-3.8-flash)

![e5-e1-e4-e2_A.png](scenes/0/render/e5-e1-e4-e2_A.webp) ![e5-e1-e4-e2_C.png](scenes/0/render/e5-e1-e4-e2_C.webp)

- Reply: `{'relation': 'parallel', 'confidence': 0.95, 'reason': 'Elements C and A are rectangular ducts that run side by side in the same direction with clear space between them.'}`
- Model says: confidence 0.95; reason: Elements C and A are rectangular ducts that run side by side in the same direction with clear space between them.
- Checker: -

### ✅ `0-J9_relation-r9-pictures` (gemini-3.8-flash)

![e7-e6-e1-e5_A.png](scenes/0/render/e7-e6-e1-e5_A.webp) ![e7-e6-e1-e5_C.png](scenes/0/render/e7-e6-e1-e5_C.webp)

- Reply: `{'relation': 'clear_of', 'confidence': 0.95, 'reason': 'Element C is located on duct D at a distance from wall A, with no contact, intersection, or functional interaction between them.'}`
- Model says: confidence 0.95; reason: Element C is located on duct D at a distance from wall A, with no contact, intersection, or functional interaction between them.
- Checker: -

### ❌ `1-J3_fix-0-pictures` (gemini-3.8-flash)

![e4-e1_A.png](scenes/1/render/e4-e1_A.webp) ![e4-e1_B.png](scenes/1/render/e4-e1_B.webp) ![e4-e1_C.png](scenes/1/render/e4-e1_C.webp)

- Reply: `{'element': 'A', 'direction': 'up', 'distance_mm': 550, 'via_opening': 'P', 'confidence': 0.98, 'reason': 'Moving duct A up 550 mm aligns it with sleeve opening P, clearing the clash with wall B with…`
- Model says: confidence 0.98; reason: Moving duct A up 550 mm aligns it with sleeve opening P, clearing the clash with wall B without hitting any other elements.
- Checker: clearance 4 mm to e1 [B] < required 25 mm

### ✅ `1-J4_opening-0-pictures` (gemini-3.8-flash)

![e4-e1_A.png](scenes/1/render/e4-e1_A.webp) ![e4-e1_B.png](scenes/1/render/e4-e1_B.webp) ![e4-e1_C.png](scenes/1/render/e4-e1_C.webp)

- Reply: `{'fitting': ['P'], 'confidence': 1, 'reason': 'Opening P is sufficiently wide and tall to accommodate duct A with a clear gap, whereas opening Q is narrower than the width of duct A.'}`
- Model says: confidence 1.00; reason: Opening P is sufficiently wide and tall to accommodate duct A with a clear gap, whereas opening Q is narrower than the width of duct A.
- Checker: -

### ❌ `1-J5_review-0r5-pictures` (gemini-3.8-flash)

![e1-e4_fixa76b938c_before_A.png](scenes/1/render/e1-e4_fixa76b938c_before_A.webp) ![e1-e4_fixa76b938c_after_A.png](scenes/1/render/e1-e4_fixa76b938c_after_A.webp)

- Reply: `{'resolved': False, 'confidence': 0.98, 'reason': 'Element B was lowered but still penetrates directly into the solid body of beam A beneath opening P.'}`
- Model says: confidence 0.98; reason: Element B was lowered but still penetrates directly into the solid body of beam A beneath opening P.
- Checker: reference: resolves the original clash; checker: fix fails: clearance -195 mm to e7 [S] < required 25 mm; new hits: e6 [L], e7 [S]

### ✅ `1-J6_new_clash-0r5-pictures` (gemini-3.8-flash)

![e1-e4_fixa76b938c_before_A.png](scenes/1/render/e1-e4_fixa76b938c_before_A.webp) ![e1-e4_fixa76b938c_after_A.png](scenes/1/render/e1-e4_fixa76b938c_after_A.webp)

- Reply: `{'new_clash': True, 'confidence': 0.95, 'reason': 'Moving element B downward causes it to clash with the grey horizontal service/structure directly beneath it.'}`
- Model says: confidence 0.95; reason: Moving element B downward causes it to clash with the grey horizontal service/structure directly beneath it.
- Checker: reference: new clash; checker: move hits e6 [L], e7 [S] (new, within 25 mm)

### ❌ `1-J6_new_clash-3r0-pictures` (gemini-3.8-flash)

![e8-e9_fixe43e13dc_before_A.png](scenes/1/render/e8-e9_fixe43e13dc_before_A.webp) ![e8-e9_fixe43e13dc_after_A.png](scenes/1/render/e8-e9_fixe43e13dc_after_A.webp)

- Reply: `{'new_clash': True, 'confidence': 0.95, 'reason': 'Moving B downwards causes it to collide with the horizontal circular pipe running underneath.'}`
- Model says: confidence 0.95; reason: Moving B downwards causes it to collide with the horizontal circular pipe running underneath.
- Checker: reference: no new clash; checker: nothing new within 25 mm; least clearance 82 mm

### ❌ `1-J7_pick_valid-0-pictures` (gemini-3.8-flash)

![e1-e4_cands5414434a_before.png](scenes/1/render/e1-e4_cands5414434a_before.webp) ![e1-e4_cands5414434a_cand_1.png](scenes/1/render/e1-e4_cands5414434a_cand_1.webp) ![e1-e4_cands5414434a_cand_2.png](scenes/1/render/e1-e4_cands5414434a_cand_2.webp)

- Reply: `{'valid': [3], 'confidence': 0.95, 'reason': 'Solution 3 moves element B horizontally into opening P, completely resolving the clash with beam A while keeping clear of all other elements.'}`
- Model says: confidence 0.95; reason: Solution 3 moves element B horizontally into opening P, completely resolving the clash with beam A while keeping clear of all other elements.
- Checker: missed 2, valid (least clearance 42 mm); picked 3, invalid: clash not gone: still -185 mm into the clash partner; clearance -185 mm to e1 [A] < required 25 mm

### ✅ `1-J8_spatial-g0order-pictures` (gemini-3.8-flash)

![e4-e1-e2-e3_A.png](scenes/1/render/e4-e1-e2-e3_A.webp) ![e4-e1-e2-e3_C.png](scenes/1/render/e4-e1-e2-e3_C.webp)

- Reply: `{'order': ['A', 'C', 'B', 'D'], 'confidence': 0.95, 'reason': 'A is on the column below the structure, C is on the duct under the slab, B is located within the beam below the slab top, and D is on th…`
- Model says: confidence 0.95; reason: A is on the column below the structure, C is on the duct under the slab, B is located within the beam below the slab top, and D is on the top surface of the slab.
- Checker: -

### ✅ `2-J1_sort-3-pictures` (gemini-3.8-flash)

![e9-e8_A.png](scenes/2/render/e9-e8_A.webp) ![e9-e8_B.png](scenes/2/render/e9-e8_B.webp) ![e9-e8_C.png](scenes/2/render/e9-e8_C.webp)

- Reply: `{'answer': 'a', 'confidence': 0.98, 'reason': 'Element B passes directly through the body of element A, creating a severe physical intersection.'}`
- Model says: confidence 0.98; reason: Element B passes directly through the body of element A, creating a severe physical intersection.
- Checker: -

### ❌ `2-J3_fix-3-pictures` (gemini-3.8-flash)

![e9-e8_A.png](scenes/2/render/e9-e8_A.webp) ![e9-e8_B.png](scenes/2/render/e9-e8_B.webp) ![e9-e8_C.png](scenes/2/render/e9-e8_C.webp)

- Reply: `{'element': 'A', 'direction': 'down', 'distance_mm': 100, 'via_opening': None, 'confidence': 0.95, 'reason': 'Moving element A down by 100 mm clears the bottom of fixed element B.'}`
- Model says: confidence 0.95; reason: Moving element A down by 100 mm clears the bottom of fixed element B.
- Checker: clearance 0 mm to e8 [B] < required 25 mm

### ❌ `2-J4_opening-0-pictures` (gemini-3.8-flash)

![e4-e1_A.png](scenes/2/render/e4-e1_A.webp) ![e4-e1_B.png](scenes/2/render/e4-e1_B.webp) ![e4-e1_C.png](scenes/2/render/e4-e1_C.webp)

- Reply: `{'fitting': ['P'], 'confidence': 0.95, 'reason': 'Opening P is sufficiently large for element A, whereas opening Q is obstructed by a fixed element on the opposite side.'}`
- Model says: confidence 0.95; reason: Opening P is sufficiently large for element A, whereas opening Q is obstructed by a fixed element on the opposite side.
- Checker: wrong_opening

### ✅ `2-J5_review-0r3-pictures` (gemini-3.8-flash)

![e1-e4_fix819a50ec_before_A.png](scenes/2/render/e1-e4_fix819a50ec_before_A.webp) ![e1-e4_fix819a50ec_after_A.png](scenes/2/render/e1-e4_fix819a50ec_after_A.webp)

- Reply: `{'resolved': False, 'confidence': 1, 'reason': 'Element B still passes directly through the solid body of beam A instead of passing through an opening, so the clash remains unresolved.'}`
- Model says: confidence 1.00; reason: Element B still passes directly through the solid body of beam A instead of passing through an opening, so the clash remains unresolved.
- Checker: reference: does not resolve the original clash; checker: fix fails: clash not gone: still -96 mm into the clash partner; clearance -96 mm to e1 [A] < required 25 mm

### ✅ `2-J5_review-3r2-pictures` (gemini-3.8-flash)

![e8-e9_fix7c484a59_before_A.png](scenes/2/render/e8-e9_fix7c484a59_before_A.webp) ![e8-e9_fix7c484a59_after_A.png](scenes/2/render/e8-e9_fix7c484a59_after_A.webp)

- Reply: `{'resolved': False, 'confidence': 0.95, 'reason': 'Element B has moved downwards or along the duct but still clearly intersects the volume of element A.'}`
- Model says: confidence 0.95; reason: Element B has moved downwards or along the duct but still clearly intersects the volume of element A.
- Checker: reference: does not resolve the original clash; checker: fix fails: not allowed: e9 [B] may not move up; clash not gone: still -91 mm into the clash partner; clearance -91 mm to e8 [A] < required 25 mm; new hits: e2 [J]

### ❌ `3-J1_sort-2-pictures` (gemini-3.8-flash)

![e7-e6_A.png](scenes/3/render/e7-e6_A.webp) ![e7-e6_B.png](scenes/3/render/e7-e6_B.webp) ![e7-e6_C.png](scenes/3/render/e7-e6_C.webp)

- Reply: `{'answer': 'a', 'confidence': 0.95, 'reason': 'Pipe B directly penetrates through element A, creating an unintended hard clash that needs resolving.'}`
- Model says: confidence 0.95; reason: Pipe B directly penetrates through element A, creating an unintended hard clash that needs resolving.
- Checker: false_alarm

### ❌ `3-J4_opening-0-pictures` (gemini-3.8-flash)

![e4-e1_A.png](scenes/3/render/e4-e1_A.webp) ![e4-e1_B.png](scenes/3/render/e4-e1_B.webp) ![e4-e1_C.png](scenes/3/render/e4-e1_C.webp)

- Reply: `{'fitting': [], 'confidence': 1, 'reason': 'Element A is wider than opening P, so it cannot pass through with a clear gap all round.'}`
- Model says: confidence 1.00; reason: Element A is wider than opening P, so it cannot pass through with a clear gap all round.
- Checker: wrong_opening

### ✅ `5-J7_pick_valid-3-pictures` (gemini-3.8-flash)

![e7-e8_cands1d7b0edd_before.png](scenes/5/render/e7-e8_cands1d7b0edd_before.webp) ![e7-e8_cands1d7b0edd_cand_1.png](scenes/5/render/e7-e8_cands1d7b0edd_cand_1.webp) ![e7-e8_cands1d7b0edd_cand_2.png](scenes/5/render/e7-e8_cands1d7b0edd_cand_2.webp)

- Reply: `{'valid': [4], 'confidence': 0.95, 'reason': 'Element A is fixed with a padlock and cannot move; in solution 4, element B is moved downwards, successfully resolving the clash with a clear gap.'}`
- Model says: confidence 0.95; reason: Element A is fixed with a padlock and cannot move; in solution 4, element B is moved downwards, successfully resolving the clash with a clear gap.
- Checker: valid [4]: all picked right

### ❌ `5-J9_relation-r3-pictures` (gemini-3.8-flash)

![e3-e1-e2-e4_A.png](scenes/5/render/e3-e1-e2-e4_A.webp) ![e3-e1-e2-e4_C.png](scenes/5/render/e3-e1-e2-e4_C.webp)

- Reply: `{'relation': 'clashes', 'confidence': 0.95, 'reason': 'The purple rectangular element A penetrates and overlaps the solid volume of the teal slab D without an opening.'}`
- Model says: confidence 0.95; reason: The purple rectangular element A penetrates and overlaps the solid volume of the teal slab D without an opening.
- Checker: wrong

### ✅ `6-J7_pick_valid-3-pictures` (gemini-3.8-flash)

![e10-e9_cands0a8cd6e4_before.png](scenes/6/render/e10-e9_cands0a8cd6e4_before.webp) ![e10-e9_cands0a8cd6e4_cand_1.png](scenes/6/render/e10-e9_cands0a8cd6e4_cand_1.webp) ![e10-e9_cands0a8cd6e4_cand_2.png](scenes/6/render/e10-e9_cands0a8cd6e4_cand_2.webp)

- Reply: `{'valid': [4], 'confidence': 0.95, 'reason': 'B is fixed and cannot move (eliminating 2). In 1 and 3, A still clashes with B. In 4, A is lowered sufficiently to provide clear separation without colli…`
- Model says: confidence 0.95; reason: B is fixed and cannot move (eliminating 2). In 1 and 3, A still clashes with B. In 4, A is lowered sufficiently to provide clear separation without colliding with surrounding elements.
- Checker: valid [4]: all picked right
