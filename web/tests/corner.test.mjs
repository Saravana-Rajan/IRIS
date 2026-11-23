import assert from "node:assert/strict";
import test from "node:test";
import { appHost, option, hasText, find } from "./app-host.mjs";

/** The workspace's actions at the right of the top bar (they were the corner over the model). */
const corner = (host) => host.find((n) => n.props?.className === "work-actions");
const count = (link) => find(link, (n) => n.props?.className === "export-n");
const exportLink = (host) => host.find((n) => n.type === "a" && n.props?.["data-tour"] === "export" && String(n.props.className).includes("export"));

test("a kept fix counts on Export in the top bar, not in a chip of its own", async () => {
  const host = await appHost();
  const work = host.button("Propose fixes").props.onClick(); host.render();
  host.requests.at(-1).resolve({ understanding: "A fix", options: [option], attempts: [] }); await work; host.render();
  assert.equal(count(exportLink(host)), undefined, "nothing kept yet: no count");
  await host.component("ProposalCard").props.onAccept(); await host.settle();
  const fixed = Object.keys(host.state.fixes).length;
  assert.ok(fixed > 0, "the fix was kept");
  const link = exportLink(host);
  assert.equal(link.props["aria-label"], `Export IFC · ${fixed} ${fixed === 1 ? "fix" : "fixes"} kept`);
  assert.ok([count(link)?.props.children].flat().includes(fixed), "the count is on the button");
  assert.equal(hasText(corner(host), "fixed"), false, "no separate chip");
  host.unmount();
});

test("the owner's settings sit on their button's tip, not in a long chip in the top bar", async () => {
  const host = await appHost();
  host.component("OwnerSettingsMenu").props.onChange({ no_caps: true }); host.render();
  assert.equal(host.component("OwnerSettingsMenu").props.note, "on for you: effort default · no caps");
  assert.equal(hasText(corner(host), "owner ·"), false);
  host.component("OwnerSettingsMenu").props.onChange(null); host.render();
  assert.equal(host.component("OwnerSettingsMenu").props.note, undefined);
  host.unmount();
});

test("Settings shows only the sections that apply: nothing open has no session or layout section", async () => {
  const open = await appHost();
  const sheet = open.menu();
  assert.ok(hasText(sheet, "Your name for review decisions") && hasText(sheet, "This session") && hasText(sheet, "Panels and layout") && hasText(sheet, "Help"));
  assert.equal(hasText(sheet, "Coordinate"), false, "the workspace's actions are in the workspace, not in Settings");
  assert.equal(find(sheet, (n) => n.props?.id === "open"), undefined, "no Open models in Settings");
  assert.ok(find(sheet, (n) => n.props?.["data-tour"] === "requirements"), "Requirements stays reachable");
  assert.ok(find(sheet, (n) => n.type === "button" && hasText(n, "Connect an agent")), "and the agent");
  open.unmount();
  const empty = await appHost({ initial: { sceneId: null, a: null, b: null, stats: null, clash: null, report: null, matches: null } });
  const bare = empty.menu();
  assert.ok(hasText(bare, "Your name for review decisions") && hasText(bare, "Help"));
  assert.equal(hasText(bare, "Models") || hasText(bare, "Coordinate"), false, "no workspace actions");
  assert.equal(hasText(bare, "This session"), false, "no session to act on");
  assert.equal(hasText(bare, "Panels and layout"), false, "no panels to lay out");
  empty.unmount();
});

test("the workspace's actions moved out of Settings into the workspace: open, upload, check, import a report", async () => {
  const empty = await appHost({ initial: { sceneId: null, a: null, b: null, stats: null, clash: null, report: null, matches: null } });
  const where = empty.actions();
  assert.ok(where, "at the top of the workspace's left panel");
  assert.equal(where.props.open, true, "open while nothing is open");
  assert.ok(find(where, (n) => n.props?.id === "open"), "Open the sample models");
  assert.ok(find(where, (n) => n.type === "button" && hasText(n, "Upload models (IFC or STEP)")), "your own models");
  assert.ok(find(where, (n) => n.type === "button" && hasText(n, "Check the open models")), "the check");
  assert.ok(find(where, (n) => n.type === "button" && hasText(n, "Upload XML files")), "a Navisworks report");
  empty.unmount();
  const open = await appHost();
  assert.equal(open.actions().props.open, false, "a closed line once models are open");
  open.unmount();
});
