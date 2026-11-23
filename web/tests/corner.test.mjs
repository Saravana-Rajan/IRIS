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

test("Settings is lean: your name and Help in view, the rest in one closed Advanced section", async () => {
  const open = await appHost({ layout: "desktop" });
  const sheet = open.menu();
  assert.ok(hasText(sheet, "Your name for review decisions") && hasText(sheet, "Help"));
  assert.ok(find(sheet, (n) => n.type === "button" && hasText(n, "How Iris works, and samples to try")), "Help's way in");
  assert.ok(hasText(sheet, "Projects are private to this browser by an unguessable id; there are no accounts yet."));
  const advanced = find(sheet, (n) => n.props?.["data-settings"] === "advanced");
  assert.ok(advanced && advanced.type === "details", "one Advanced disclosure");
  assert.ok(!advanced.props.open, "closed by default");
  assert.ok(find(advanced, (n) => n.props?.["data-tour"] === "requirements" && hasText(n, "Coordination requirements")), "requirements, in Advanced");
  assert.ok(find(advanced, (n) => n.type === "button" && hasText(n, "Connect an agent")), "the agent link, in Advanced");
  assert.ok(find(advanced, (n) => n.type === "button" && hasText(n, "Reset the layout")), "the layout reset, in Advanced");
  assert.ok(find(advanced, (n) => n.props?.className === "menu-section owner-section"), "owner settings, in Advanced (hidden without an owner)");
  for (const gone of ["Panels and layout", "Workings in Activity", "Classic layout", "This session", "Coordinate"]) {
    assert.equal(hasText(sheet, gone), false, `no "${gone}" in Settings`);
  }
  for (const panel of ["Filters", "Properties", "Chat", "Edits"]) {
    assert.equal(find(sheet, (n) => n.type === "button" && hasText(n, panel)), undefined, `no ${panel} panel item`);
  }
  assert.equal(find(sheet, (n) => n.props?.id === "open"), undefined, "no Open models in Settings");
  open.unmount();
  const empty = await appHost({ initial: { sceneId: null, a: null, b: null, stats: null, clash: null, report: null, matches: null } });
  const bare = empty.menu();
  assert.ok(hasText(bare, "Your name for review decisions") && hasText(bare, "Help"));
  assert.equal(hasText(bare, "Models") || hasText(bare, "Coordinate"), false, "no workspace actions");
  const quiet = find(bare, (n) => n.props?.["data-settings"] === "advanced");
  assert.equal(find(quiet, (n) => n.type === "button" && /requirements|Connect an agent|Reset the layout/.test(JSON.stringify(n.props?.children ?? ""))), undefined,
    "nothing open: no session items in Advanced");
  empty.unmount();
});

test("the workspace's actions moved out of Settings into the workspace: open, upload, check, import a report", async () => {
  const empty = await appHost({ initial: { sceneId: null, a: null, b: null, stats: null, clash: null, report: null, matches: null } });
  const where = empty.workActions();
  assert.ok(where, "at the top of the workspace's left panel");
  assert.equal(where.props.open, true, "open while nothing is open");
  assert.ok(find(where, (n) => n.props?.id === "open"), "Open the sample models");
  assert.ok(find(where, (n) => n.type === "button" && hasText(n, "Upload models (IFC or STEP)")), "your own models");
  assert.ok(find(where, (n) => n.type === "button" && hasText(n, "Check the open models")), "the check");
  assert.ok(find(where, (n) => n.type === "button" && hasText(n, "Upload XML files")), "a Navisworks report");
  empty.unmount();
  const open = await appHost();
  assert.equal(open.workActions().props.open, false, "a closed line once models are open");
  open.unmount();
});
