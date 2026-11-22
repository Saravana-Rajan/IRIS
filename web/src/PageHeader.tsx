import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { ownClick } from "./projectRoute";
import "./page.css";

/** One step of a breadcrumb: a link the page follows itself (`href` for a new tab, a plain click to `onClick`), or the
 *  page itself (neither). */
export interface Crumb { label: string; href?: string; onClick?: () => void }

/**
 * The header of a page in the app shell (docs/architecture/12-web-app.md, "The app shell"): the breadcrumb, the
 * page's title and a line under it, then its status and its actions on the right. `slim` is the workspace's: one row
 * over the 3D view, the breadcrumb and the title side by side, the one status line in the middle. Props only.
 */
export function PageHeader({ crumbs = [], title, sub, status, actions, slim = false, className = "" }: {
  crumbs?: Crumb[];
  title: ReactNode;
  sub?: ReactNode;
  /** What is happening now (the workspace's one status line). */
  status?: ReactNode;
  /** Buttons at the right end: the page's primary actions. */
  actions?: ReactNode;
  slim?: boolean;
  className?: string;
}) {
  const trail = crumbs.length > 0 && (
    <nav className="page-crumbs" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((c, i) => (
          <li key={`${c.label}:${i}`}>
            {c.href || c.onClick
              ? <a className="page-crumb" href={c.href ?? "#"} onClick={(e) => { if (!c.onClick || !ownClick(e)) return; e.preventDefault(); c.onClick(); }}>{c.label}</a>
              : <span className="page-crumb here" aria-current="page">{c.label}</span>}
            {(i < crumbs.length - 1 || slim) && <ChevronRight size={13} aria-hidden className="page-crumb-sep" />}
          </li>
        ))}
      </ol>
    </nav>
  );
  return (
    <header className={`page-head${slim ? " slim" : ""}${className ? ` ${className}` : ""}`}>
      <div className="page-head-main">
        {trail}
        <h1 className="page-title">{title}</h1>
        {sub && !slim && <p className="page-sub">{sub}</p>}
      </div>
      {status && <div className="page-status" role="status">{status}</div>}
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
