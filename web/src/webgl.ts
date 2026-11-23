/**
 * Whether this browser can draw the 3D view: a WebGL context can be made on a canvas (WebGL 2, else WebGL 1). False
 * when WebGL is turned off, blocklisted or the canvas throws; true where there is no page at all (node tests), so the
 * check never stands in the way there. The probe's context is given back at once: a browser keeps only a few alive.
 */
export function webglAvailable(): boolean {
  if (typeof document === "undefined") return true;
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement("canvas");
    gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  } catch {
    return false;
  }
  if (!gl) return false;
  try { gl.getExtension?.("WEBGL_lose_context")?.loseContext(); } catch { /* given back when the canvas goes */ }
  return true;
}

/** Thrown by the viewer when it cannot draw (no WebGL): App shows its "3D needs WebGL" note in the stage instead. */
export class NoWebGL extends Error {
  constructor(cause?: unknown) {
    super("WebGL is not available, so the 3D view can't open.");
    this.name = "NoWebGL";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}
