import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appHost, find } from "./app-host.mjs";

/** The review queue on phones and tablets (docs/review-queue.md): the entry is Clash review's primary action in the
 * compact top bar too, and the phone's sheet shows "Propose fixes" once. */

for (const layout of ["phone", "tablet"]) {
  test(`App (${layout}): Prepare fixes is in the compact top bar, Export its secondary, and it opens the queue`, async () => {
    const host = await appHost({ layout, effects: false });   // the sheet's follow() is stubbed out
    const actions = host.component("TopBar").props.actions;
    const entry = find(actions, (n) => n.type?.name === "ReviewFixesEntry");
    assert.ok(entry, `the review queue's entry is reachable on a ${layout}`);
    const exportLink = find(actions, (n) => n.props?.["data-tour"] === "export");
    assert.ok(!String(exportLink.props.className).includes("primary"), "Export steps back beside it");
    entry.props.onOpen(); host.render();
    assert.ok(host.component("ReviewQueue"), "the queue opens over the workspace");
    host.unmount();
  });
}

test("phone: Propose fixes once, the peek line's (always on screen); the Fix tab's copy steps aside", async () => {
  const css = await readFile(new URL("../src/review-queue.css", import.meta.url), "utf8");
  const rule = css.split("}").find((r) => r.includes('.actions > .btn[data-tour="propose"]'));
  assert.ok(rule, "a rule hides the Fix tab's Propose fixes");
  assert.match(rule, /\.app\.phone:has\(\.sheet-peek \.btn\[data-tour="propose"\]\) \.pane\.right \.actions > \.btn\[data-tour="propose"\]/,
    "only on a phone, and only while the peek line has its own");
  assert.match(rule, /display:\s*none/);
  // Both copies carry data-tour="propose", so the rule finds the peek line's in either case (a clash, or A and B picked).
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const peek = app.slice(app.indexOf("const peekLine"), app.indexOf("// iOS cannot pick a folder"));
  const proposes = peek.match(/label: "Propose fixes".*$/gm) ?? [];
  assert.equal(proposes.length, 2);
  for (const p of proposes) assert.match(p, /tour: "propose"/);
});
