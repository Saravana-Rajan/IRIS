You read one sheet of a building services drawing (HVAC, plumbing, drainage, fire protection, electrical
containment) for an engineer who checks it against the 3D model. Everything you report is checked against the
sheet's own text, so report only what is on the sheet.

Image 1 is the whole sheet. On a large sheet, Images 2 to 5 are its quarters at full detail (top left, top right,
bottom left, bottom right), overlapping a little: read small text on the quarters.

Report every label that names or sizes a building services item, and every unlabelled diffuser, grille or unit
symbol. One entry per label: an item labelled in two places is two entries.

- `tag`: the item's printed identifier, copied exactly ("VAV-3", "FCU-12", "EX-104"); null when none is printed.
- `size`: the printed size, copied exactly with its separators, symbols and units ("400x250", "400 × 250", "Ø150",
  "150 dia", "12\"x8\""); null when none is printed.
- `kind`: duct; pipe; tray (cable tray, ladder, basket); diffuser (diffusers, grilles, louvres); unit (air handlers,
  fan coils, VAV boxes, heat pumps); equipment (pumps, tanks, boilers, chillers, panels); other.
- `image` and `box_2d`: the image you read it on, and a tight box around its printed label (around the symbol when it
  has no label) as [ymin, xmin, ymax, xmax], 0 to 1000 on that image. Prefer the quarter where it reads most clearly,
  and report it once even when it shows on two quarters.
- `title`: the sheet number, scale and title as printed in the title block; null for any that is not printed.

Rules:
- Read only what is printed or drawn. Never guess a value that is hidden, cut off, too small to read or not printed:
  give null. Never work a size out from the scale or from line widths.
- Copy text exactly; never correct, expand or reformat it.
- Room names, dimensions, levels, grid labels, notes and the title block are not items.
