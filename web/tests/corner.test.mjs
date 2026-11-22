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
