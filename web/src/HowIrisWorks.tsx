import { Crosshair, FileText, Layers, Radar, ShieldCheck, Sparkles, Upload, UserCheck, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ApertureMark } from "./Brand";
import { useReducedMotion } from "./Holo";
import { PROJECT_FLOW } from "./ProjectsHome";
import type { ProjectStep } from "./projectRoute";
import "./howIrisWorks.css";

/** The four phases the eight steps fall into; each label sits above the first card of its phase. */
export const HIW_PHASES = [
  { label: "Bring in", from: 0 },
  { label: "Find", from: 2 },
  { label: "Fix", from: 4 },
  { label: "Share", from: 7 },
] as const;

/** What each of PROJECT_FLOW's steps shows on its card (same order): its icon, its measured proof chip (these values and
 *  no others) and the project step a click opens on the sample building. */
export const HIW_CARDS: readonly { icon: LucideIcon; proof: string; step: ProjectStep }[] = [
  { icon: Upload, proof: "IFC · STEP", step: "models" },
  { icon: Layers, proof: "4 models · 1,732 elements", step: "models" },
  { icon: Radar, proof: "464 clashes in 11 s", step: "coordination" },
  { icon: Crosshair, proof: "#1 · −300 mm", step: "clash" },
  { icon: Sparkles, proof: "Gemini 3.8 Flash", step: "clash" },
  { icon: ShieldCheck, proof: "Clash gone · 50 mm clear · nothing new hit", step: "clash" },
  { icon: UserCheck, proof: "8 of 8 fixes ready to review", step: "clash" },
  { icon: FileText, proof: "PDF + BCF", step: "reports" },
];

export const HIW_BRIDGE = "AI proposes → geometry proves";
const PROPOSE = 4, VALIDATE = 5;

/** Before paint in a browser (so a card never flashes before it hides for its reveal); a plain effect elsewhere. */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Home's "How Iris works": PROJECT_FLOW's eight steps as cards in four phases (Bring in, Find, Fix, Share), joined by a
 * thin dashed line, each with its icon, step number, one line and a measured proof chip. Propose wears the AI's holo
 * edge, Validate the geometry's green check, with "AI proposes → geometry proves" between them. With `onStep` each card
 * is a button that opens its step on the sample building; without it the cards are static. The cards fade up one after
 * another as the section scrolls into view; still under reduced motion and where there is no window (a static render
 * shows everything). `glass`: an optional decorative 3D glass image (e.g. "/glass/prism.webp", once web/public/glass/
 * has one); nothing is drawn without it.
 */
export function HowIrisWorks({ onStep, glass }: { onStep?: (step: ProjectStep) => void; glass?: string }) {
  const still = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const [armed, setArmed] = useState(false);   // hidden, waiting to reveal (only in a browser with motion)
  const [shown, setShown] = useState(false);
  useBeforePaint(() => {
    const el = root.current;
    if (still || !el || typeof IntersectionObserver === "undefined") { setArmed(false); return; }
    setArmed(true);
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [still]);
  return (
    <section ref={root} className={`hiw${armed ? " hiw-armed" : ""}${shown ? " hiw-shown" : ""}`} aria-labelledby="hiw-title">
      <header className="hiw-head">
        <p className="hiw-kicker"><ApertureMark size={14} /> How Iris works</p>
        <h2 className="hiw-title" id="hiw-title">From tangled models to verified fixes</h2>
        <p className="hiw-line">Eight steps, from the models you bring to the report you share.</p>
        {glass && <img className="hiw-glass" src={glass} alt="" aria-hidden />}
      </header>
      <HiwCards onStep={onStep} />
    </section>
  );
}

/** The eight cards (no hooks, so a test can call it and walk the tree). */
export function HiwCards({ onStep }: { onStep?: (step: ProjectStep) => void }) {
  const phaseAt = (i: number) => HIW_PHASES.find((p) => p.from === i)?.label;
  return (
    <ol className="hiw-grid">
      {PROJECT_FLOW.map((s, i) => {
        const card = HIW_CARDS[i];
        const Icon = card.icon;
        const phase = phaseAt(i);
        const n = String(i + 1).padStart(2, "0");
        const kind = i === PROPOSE ? " hiw-ai holo-edge" : i === VALIDATE ? " hiw-proof-step" : "";
        const body = (
          <>
            <span className="hiw-top">
              <span className="hiw-icon" aria-hidden><Icon size={22} strokeWidth={1.75} /></span>
              {i === PROPOSE && <span className="hiw-badge hiw-badge-ai">AI</span>}
              {i === VALIDATE && <span className="hiw-badge hiw-badge-ok">✓ Geometry</span>}
              <span className="hiw-n mono">{n}</span>
            </span>
            <span className="hiw-name">{s.name}</span>
            <span className="hiw-text">{s.text}</span>
            <span className="hiw-chip mono">{card.proof}</span>
          </>
        );
        return (
          <li key={s.name} className="hiw-item" data-name={s.name} style={{ "--i": i } as CSSProperties}>
            <span className={`hiw-phase${phase || i === VALIDATE ? "" : " hiw-phase-none"}`}>
              {phase && <span className="hiw-phase-label">{phase}</span>}
              {i === VALIDATE && <span className="hiw-bridge">{HIW_BRIDGE}</span>}
            </span>
            {onStep
              ? <button type="button" className={`hiw-card hiw-open${kind}`} data-step={card.step}
                  title={`Open ${s.name} on the sample building`} onClick={() => onStep(card.step)}>{body}</button>
              : <div className={`hiw-card${kind}`} data-step={card.step}>{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}
