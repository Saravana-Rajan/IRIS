import { DEMOS_LINE, DemoCards } from "./DemoVideo";
import { PageHeader } from "./PageHeader";

/**
 * The Demos page (`/videos`, the sidebar's Demos; `/demos/` is the folder of the video files): a page in the shell with
 * its header ("Demos" and the line Home's demos heading uses), then the same three demo cards as Home's row (DemoCards:
 * the full demo, the 3D and the 2D video), in a grid that is three across on a desktop and fewer as the panel narrows.
 * Each card opens its video in the light lightbox; nothing of a video loads before. Props none; nothing here calls the
 * server.
 */
export function DemosPage() {
  return (
    <div className="proj-page demos-page"><div className="proj-scroll"><div className="proj-body">
      <PageHeader title="Demos" sub={DEMOS_LINE} />
      <DemoCards className="demos-grid" />
    </div></div></div>);
}
