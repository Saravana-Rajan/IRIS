import { House } from "lucide-react";
import { EmptyState } from "./Holo";

/** The page for an address the app does not know (`isAppPath`, projectRoute.ts): a light page in the shell that says
 *  so, with the way Home. The server (`app._is_page`) and Firebase Hosting answer any page address with the app. */
export function NotFound({ onHome }: { onHome: () => void }) {
  return (
    <div className="proj-page"><div className="proj-scroll"><div className="proj-body">
      <EmptyState title="This page doesn't exist" line="The address may be mistyped, or the page has moved."
        action={<button type="button" className="btn primary" onClick={onHome}><House size={15} aria-hidden /> Home</button>} />
    </div></div></div>);
}
