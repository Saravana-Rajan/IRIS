import json, sys
from pathlib import Path
import pdfplumber
from pdfplumber.utils.text import WordExtractor
D = Path(sys.argv[1]); PX = 150/72
def inbox(b, box, slack=1.0):
    cx, cy = (b[0]+b[2])/2, (b[1]+b[3])/2
    return box[0]-slack <= cx <= box[2]+slack and box[1]-slack <= cy <= box[3]+slack
for stem in ["Northbank-M-201", "Northbank-M-201-mismatch"]:
    t = json.loads((D/f"{stem}.truth.json").read_text())
    with pdfplumber.open(D/f"{stem}.pdf") as pdf:
        p = pdf.pages[0]
        print(stem, "chars", len(p.chars), "upright", sum(c["upright"] for c in p.chars))
        for name, kw in [("byline", dict(use_text_flow=False)), ("flow", dict(use_text_flow=True)),
                         ("byline_y1", dict(use_text_flow=False, y_tolerance=1))]:
            ws = p.extract_words(keep_blank_chars=False, **kw)
            px = [(w["text"], [w["x0"]*PX, w["top"]*PX, w["x1"]*PX, w["bottom"]*PX]) for w in ws]
            miss = [i["tag"] for i in t["items"] if i["tag"] and not any(tx == i["tag"] and inbox(b, i["label_box"]) for tx, b in px)]
            smiss = [i["size"] for i in t["items"] if i["size"] and not any(tx == i["size"] and inbox(b, i["label_box"]) for tx, b in px)]
            print("  ", name, "words", len(ws), "tags missed", len(miss), miss[:6], "sizes missed", len(smiss))
