import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { compiled } from "./app-host.mjs";

/** Per-file import rows (docs/engineer-workflow.md, step 2): the upload stream's events (api.streamUpload) reduced to
 * one row per chosen file. The sequences below are the ones the server sends (app.upload_models_stream,
 * service.open_paths, step.convert). */

const R = await import(await compiled("../src/importRows.ts"));

/** ImportPanel with its stylesheet import left out (a data: module cannot import a relative file). */
async function panelModule() {
  const source = (await readFile(new URL("../src/ImportPanel.tsx", import.meta.url), "utf8")).replace(/^import "\.\/import\.css";$/m, "");
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  const deps = { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    "lucide-react": import.meta.resolve("lucide-react"), "./importRows": await compiled("../src/importRows.ts") };
  for (const [name, target] of Object.entries(deps)) outputText = outputText.replaceAll(`from "${name}"`, `from ${JSON.stringify(target)}`);
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const { ImportPanel, FORMATS, fileSize } = await panelModule();

const run = (rows, events) => events.reduce(R.applyEvent, rows);
const pick = (rows, ...keys) => rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));

test("an IFC batch: packed, sent in order with its bytes split by file, opened and measured together, drawn", () => {
  // Small.ifc goes as it is (under 1 MiB); MEP.ifc is gzipped: 40 MB packs to about 8 MB.
  const files = [{ name: "Small.ifc", size: 300_000 }, { name: "MEP.ifc", size: 40_000_000 }];
  let rows = R.initRows(files);
  assert.deepEqual(pick(rows, "name", "kind", "stage"), [
    { name: "Small.ifc", kind: "IFC", stage: "queued" }, { name: "MEP.ifc", kind: "IFC", stage: "queued" }]);

  rows = run(rows, [{ type: "packing", done: 0, total: 2, name: "Small.ifc" }]);
  assert.equal(rows[0].stage, "packing");
  assert.equal(rows[0].note, "Adding to the upload");
  rows = run(rows, [{ type: "packing", done: 1, total: 2, name: "MEP.ifc" }]);
  assert.deepEqual(pick(rows, "stage", "note"), [{ stage: "queued", note: "Ready to send" }, { stage: "packing", note: "Compressing for the upload" }]);

  // The request is 8.3 MB: Small.ifc's 300 kB first (exact), then MEP.ifc's packed bytes.
  const total = 8_300_000;
  rows = R.applyEvent(rows, { type: "upload", loaded: 150_000, total });
  assert.deepEqual(pick(rows, "stage", "pct"), [{ stage: "uploading", pct: 50 }, { stage: "queued", pct: undefined }]);
  assert.equal(rows[1].note, "Waiting to send");
  rows = R.applyEvent(rows, { type: "upload", loaded: 4_300_000, total });
  assert.deepEqual(pick(rows, "stage", "pct"), [{ stage: "uploading", pct: 100 }, { stage: "uploading", pct: 50 }]);
  assert.equal(rows[0].note, "Sent; the rest of the batch is still going up");
  rows = R.applyEvent(rows, { type: "upload", loaded: total, total });
  assert.deepEqual(pick(rows, "pct", "note"), [{ pct: 100, note: "Sent; waiting for the server" }, { pct: 100, note: "Sent; waiting for the server" }]);

  rows = run(rows, [{ type: "received", bytes: 40_300_000 }]);
  assert.deepEqual(pick(rows, "stage", "pct", "note"), Array(2).fill({ stage: "processing", pct: undefined, note: "Received; opening" }));
  rows = run(rows, [{ type: "opening", files: 2 }]);
  assert.equal(rows[0].note, "Opening 2 models together");

  // Elements are measured over both files: the same batch figure on each row, marked shared, never a per-file number.
  rows = R.applyEvent(rows, { type: "boxes", done: 3000, total: 12000 });
  for (const r of rows) {
    assert.equal(r.pct, 25);
    assert.equal(r.shared, true);
    assert.equal(r.note, "Measuring elements: 3,000 of 12,000, all files together");
  }
  const before = rows;
  assert.equal(R.applyEvent(rows, { type: "tick" }), before, "a heartbeat changes nothing");

  // The page passes `done` on when the request resolves; then the viewer parses each file, and shows them together.
  rows = R.applyEvent(rows, { type: "done" });
  assert.deepEqual(pick(rows, "stage", "shared"), Array(2).fill({ stage: "drawing", shared: undefined }));
  rows = R.applyDraw(rows, R.drawnUpTo(["Small.ifc", "MEP.ifc"], 1), false);
  assert.deepEqual(pick(rows, "stage", "note"), [{ stage: "drawing", note: "Parsed; shown when every file is" },
    { stage: "drawing", note: "Opened on the server; drawing" }]);
  rows = R.applyDraw(rows, R.drawnUpTo(["Small.ifc", "MEP.ifc"], 2));
  assert.deepEqual(rows.map((r) => r.stage), ["ready", "ready"]);
  assert.deepEqual(R.summary(rows), { total: 2, models: 2, ready: 2, failed: 0, refused: 0, active: 0, retry: false,
    text: "2 of 2 models ready" });
});

test("parsed early during the upload: a drawn count before the server is done does not jump ahead", () => {
  let rows = run(R.initRows([{ name: "A.ifc", size: 5e6 }]), [{ type: "upload", loaded: 1e6, total: 2e6 }]);
  rows = R.applyDraw(rows, { "A.ifc": true }, false);
  assert.equal(rows[0].stage, "uploading");
  assert.equal(rows[0].pct, 50, "one file: the request's own share");
});

test("a STEP conversion is reported on its own row, by file name, with no invented percentage", () => {
  const files = [{ name: "Cell.step", size: 3_000_000 }, { name: "Site.ifc", size: 500_000 }];
  let rows = run(R.initRows(files), [
    { type: "packing", done: 0, total: 2, name: "Cell.step" }, { type: "packing", done: 1, total: 2, name: "Site.ifc" },
    { type: "upload", loaded: 1_100_000, total: 1_100_000 }, { type: "received", bytes: 3_500_000 }]);
  assert.deepEqual(pick(rows, "kind", "stage", "note"), [
    { kind: "STEP", stage: "converting", note: "Received; waiting to convert" },
    { kind: "IFC", stage: "processing", note: "Received; opens after the STEP conversion" }]);

  rows = R.applyEvent(rows, { type: "reading", file: "Cell.step" });
  assert.equal(rows[0].note, "Reading the STEP file");
  rows = R.applyEvent(rows, { type: "classifying", file: "Cell.step", parts: 1412 });
  assert.equal(rows[0].note, "The AI is naming 1,412 parts");
  assert.equal(rows[0].pct, undefined, "nothing measured, nothing claimed");
  rows = R.applyEvent(rows, { type: "classify_failed", detail: "TimeoutError: deadline" });
  assert.equal(rows[0].note, "The AI could not name the parts: they convert with their STEP names");
  rows = R.applyEvent(rows, { type: "meshing", file: "Cell.step", parts: 1412 });
  assert.equal(rows[0].note, "Converting 1,412 parts to IFC");
  assert.equal(rows[1].note, "Received; opens after the STEP conversion", "the IFC row is not touched by STEP events");
  assert.equal(R.applyEvent(rows, { type: "reading", file: "Other.step" }).every((r, i) => r === rows[i]), true,
    "an event for a file not in the list changes nothing");
  rows = R.applyEvent(rows, { type: "converted", file: "Cell.step", parts: 1412, seconds: 31.4 });
  assert.deepEqual(pick(rows, "stage", "pct", "note")[0], { stage: "converting", pct: 100, note: "Converted 1,412 parts in 31.4 s" });
  assert.equal(R.applyEvent(R.initRows([files[0]]).map((r) => ({ ...r, stage: "converting" })),
    { type: "converted", file: "Cell.step", cached: true })[0].note, "Converted (the same file was converted before)");

  rows = run(rows, [{ type: "opening", files: 2 }, { type: "boxes", done: 2000, total: 2000 }, { type: "done" }]);
  assert.deepEqual(rows.map((r) => r.stage), ["drawing", "drawing"]);
  // The server's list keeps the uploaded names (a STEP under its own name), so the viewer's count maps straight on.
  rows = R.applyDraw(rows, R.drawnUpTo(["Cell.step", "Site.ifc"], 2));
  assert.equal(R.summary(rows).text, "2 of 2 models ready");
});

test("a failure fails the batch (all or nothing), stays until retried, and Retry starts the same files again", () => {
  const files = [{ name: "Structure.ifc", size: 2e6 }, { name: "MEP.ifc", size: 4e6 }, { name: "Cell.step", size: 1e6 }];
  let rows = run(R.initRows(files), [{ type: "upload", loaded: 6e5, total: 6e5 }, { type: "received", bytes: 7e6 },
    { type: "reading", file: "Cell.step" }]);

  // The reason names one file: it carries the reason, the others say why they were not opened.
  const named = R.failAll(rows, "Cell.step: no solid bodies found in the STEP file");
  assert.deepEqual(pick(named, "name", "stage", "error"), [
    { name: "Structure.ifc", stage: "failed", error: "Not opened: Cell.step failed, and the files open together or not at all" },
    { name: "MEP.ifc", stage: "failed", error: "Not opened: Cell.step failed, and the files open together or not at all" },
    { name: "Cell.step", stage: "failed", error: "Cell.step: no solid bodies found in the STEP file" }]);
  assert.equal(named.every((r) => r.pct === undefined && r.note === undefined), true);

  // The stream's own error event (status, detail) fails the batch the same way.
  rows = R.applyEvent(rows, { type: "error", status: 400, detail: "Could not open the models: RuntimeError: bad header" });
  assert.deepEqual(rows.map((r) => r.error), Array(3).fill("Could not open the models: RuntimeError: bad header"));
  const s = R.summary(rows);
  assert.equal(s.retry, true);
  assert.equal(s.text, "0 of 3 models ready · 3 failed");

  // Late events (a tick, a box count still in flight) do not revive failed rows.
  assert.deepEqual(run(rows, [{ type: "tick" }, { type: "boxes", done: 10, total: 20 }, { type: "done" }]), rows);

  // A failure in the page (the viewer could not parse a file) fails it the same way.
  assert.equal(R.failAll(R.initRows(files), "Could not read MEP.ifc")[1].error, "Could not read MEP.ifc");

  // Retry: the same files from the start, then a clean run.
  let again = R.initRows(files);
  assert.deepEqual(again.map((r) => r.stage), ["queued", "queued", "queued"]);
  again = run(again, [{ type: "upload", loaded: 1, total: 1 }, { type: "received", bytes: 7e6 },
    { type: "converted", file: "Cell.step", cached: true }, { type: "opening", files: 3 }, { type: "done" }]);
  again = R.applyDraw(again, R.drawnUpTo(files.map((f) => f.name), 3));
  assert.deepEqual(R.summary(again), { total: 3, models: 3, ready: 3, failed: 0, refused: 0, active: 0, retry: false,
    text: "3 of 3 models ready" });
});

test("a PDF drawing (or anything that is not a model) is refused on its own row and never sent", () => {
  const files = [{ name: "MEP.ifc", size: 4e6 }, { name: "A-101 Plans.pdf", size: 2e6 }, { name: "Coord.nwd", size: 9e6 },
    { name: "Plan.DWG", size: 1e6 }, { name: "Model.ifczip", size: 1e6 }, { name: "notes.txt", size: 10 }];
  let rows = R.initRows(files);
  assert.deepEqual(pick(rows, "kind", "stage"), [{ kind: "IFC", stage: "queued" }, { kind: "Unsupported", stage: "failed" },
    { kind: "Navisworks", stage: "failed" }, { kind: "Unsupported", stage: "failed" }, { kind: "Unsupported", stage: "failed" },
    { kind: "Unsupported", stage: "failed" }]);
  assert.equal(rows[1].error, "A PDF drawing is not a model: add it on the Drawings step, where Iris reads it against the models");
  assert.equal(rows[1].error, R.PDF_REFUSAL);
  assert.match(rows[2].error, /^Navisworks files \(\.nwd, \.nwc, \.nwf\) aren't opened as models/);
  assert.equal(rows[3].error, "2D drawings (DWG) aren't supported yet — import IFC or STEP models");
  assert.equal(rows[4].error, "Zipped IFC (.ifczip) isn't read yet — unzip it and import the .ifc");
  assert.equal(rows[5].error, ".txt files aren't a model Iris can open — import IFC (.ifc) or STEP (.step, .stp)");

  // Only the model goes to the server, and the upload's bytes are all its own.
  assert.deepEqual(R.sendableFiles(files).map((f) => f.name), ["MEP.ifc"]);
  assert.equal(R.sendableFiles(files)[0], files[0], "the caller's own objects (File), in order");
  rows = run(rows, [{ type: "upload", loaded: 500, total: 1000 }, { type: "received", bytes: 4e6 }]);
  assert.equal(rows[0].stage, "processing");
  assert.deepEqual(rows.slice(1), R.initRows(files).slice(1), "the refused rows never move");

  // A failure of the batch keeps each refusal's own reason; refused files alone are not something Retry can fix.
  const failed = R.failAll(rows, "Could not open the models: x");
  assert.equal(failed[1].error, R.PDF_REFUSAL);
  assert.equal(R.summary(R.initRows([files[1]])).retry, false);
  assert.equal(R.summary(R.initRows([files[1]])).text, "1 file not supported");
  assert.equal(R.summary(rows).text, "0 of 1 model ready · 1 in progress · 5 files not supported");

  // Dismissed one by one.
  assert.deepEqual(R.removeRow(rows, "A-101 Plans.pdf").map((r) => r.name), ["MEP.ifc", "Coord.nwd", "Plan.DWG", "Model.ifczip", "notes.txt"]);
  assert.equal(R.removeRow(rows, "missing.pdf"), rows);
});

test("an upload with no length shows the stage without a number", () => {
  const rows = R.applyEvent(R.initRows([{ name: "A.ifc", size: 10 }]), { type: "upload", loaded: 5, total: 0 });
  assert.deepEqual(pick(rows, "stage", "pct"), [{ stage: "uploading", pct: undefined }]);
});

const html = (props) => renderToStaticMarkup(createElement(ImportPanel, { onRetry() {}, onPick() {}, busy: false, ...props }));

test("the panel: a row per file with type, size, stage and bar; Retry for the whole batch; the formats line", () => {
  const files = [{ name: "MEP.ifc", size: 41_200_000 }, { name: "Cell.step", size: 3_000_000 }, { name: "Plans.pdf", size: 820_000 }];
  const failed = R.applyEvent(R.initRows(files), { type: "error", status: 400, detail: "Could not open the models: bad header" });
  const out = html({ rows: failed, onRemove() {} });
  assert.match(out, /<span class="imp-type k-ifc"[^>]*>IFC<\/span>/);
  assert.match(out, /<span class="imp-type k-step"[^>]*>STEP<\/span>/);
  assert.match(out, /<span class="imp-type k-other"[^>]*>PDF<\/span>/);
  assert.ok(out.includes(">41 MB<") && out.includes(">3.0 MB<") && out.includes(">820 kB<"));
  assert.match(out, /chip small imp-stage st-failed">Failed</);
  assert.match(out, /chip small imp-stage st-failed">Not supported</);
  assert.ok(out.includes(R.PDF_REFUSAL.replace("'", "&#x27;")), "the PDF's own reason on its row (HTML-escaped)");
  // One reason for the whole batch: said once, beside Retry, not on every row.
  assert.equal(out.split("Could not open the models: bad header").length - 1, 1);
  assert.match(out, /<div class="imp-retry" role="alert">.*Retry import<\/button><span class="hint">Retry sends every model file again: the server opens them together, all or none\.<\/span>/);
  assert.ok(out.includes(FORMATS));
  assert.equal(FORMATS, "IFC (IFC4, IFC2X3), STEP (AP203/214/242). PDF drawings go to the Drawings step.");
  assert.ok(out.includes('aria-label="Remove Plans.pdf"'));
  assert.ok(out.includes("0 of 2 models ready · 2 failed · 1 file not supported"));
});

test("the panel while busy: a batch-wide figure is labelled as such, the chooser and Retry wait", () => {
  const rows = run(R.initRows([{ name: "A.ifc", size: 2e6 }, { name: "B.ifc", size: 3e6 }, { name: "x.pdf", size: 1 }]),
    [{ type: "received", bytes: 5e6 }, { type: "opening", files: 2 }, { type: "boxes", done: 500, total: 2000 }]);
  const out = html({ rows, busy: true, onRemove() {}, onDrop() {} });
  assert.match(out, /class="imp-bar shared" role="progressbar" aria-label="A.ifc: Processing" aria-valuemin="0" aria-valuemax="100" aria-valuenow="25"/);
  assert.ok(out.includes("25% batch"));
  assert.ok(!out.includes("imp-retry"), "no Retry while it runs");
  assert.ok(!out.includes('aria-label="Remove A.ifc"') && out.includes('aria-label="Remove x.pdf"'),
    "a file in the request stays while it runs; a refused one can go");
  assert.match(out, /Choose files<\/button>/);
  assert.match(out, /<button type="button" class="btn small" disabled=""><svg/);
  assert.ok(out.includes("Importing…"));

  const converting = R.applyEvent(R.initRows([{ name: "C.step", size: 1 }]), { type: "reading", file: "C.step" });
  assert.equal(converting[0].stage, "converting");
  assert.match(html({ rows: converting }), /class="imp-bar busy" role="progressbar" aria-label="C.step: Converting"><i><\/i>/,
    "moving, with no number, when nothing is measured");
});

test("sizes read as people write them", () => {
  assert.equal(fileSize(0), "0 kB");
  assert.equal(fileSize(10), "1 kB");
  assert.equal(fileSize(820_000), "820 kB");
  assert.equal(fileSize(3_000_000), "3.0 MB");
  assert.equal(fileSize(150_400_000), "150 MB");
});
