import * as THREE from "three";
import { APERTURE_BLADES, APERTURE_PUPIL } from "./Brand";
import {
  apertureParts, aperturePose, bladeMove, GLASS_EXTENT, pupilScale, ringMesh, type GlassMesh, type GlassShape,
} from "./glassModel";

/**
 * Iris's 3D glass with three.js (HeroGlass.tsx mounts it; scripts/render-glass.mjs renders the stills): one clear,
 * iridescent glass material, a soft studio environment generated here in our holo colours (no image files), a backdrop
 * only the glass's refraction sees, and the shapes: the Aperture mark (six thick glass blades that turn on their pins to
 * slide open and close, round an ink pupil), the ring and the pill. The hero adds a white pedestal with a soft contact
 * shadow. A stage owns its renderer, scene and GPU resources; `dispose` frees them all.
 */

/** The holo palette in the light: lavender, pink, periwinkle, sky, a peach glint. */
const HOLO = { lavender: "#b07af2", pink: "#ff5cd6", periwinkle: "#8f9bff", sky: "#7dd3fc", peach: "#ffc2a8", violet: "#7a5cff" };

/** The glass: clear and thick, tinted violet where it is deep, a thin-film shimmer, a clear coat for crisp streaks. */
export function glassMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.06,
    transmission: 1, thickness: 1.5, ior: 1.5, dispersion: 4,
    attenuationColor: new THREE.Color("#efe4ff"), attenuationDistance: 2.2,
    iridescence: 1, iridescenceIOR: 1.3, iridescenceThicknessRange: [100, 420],
    clearcoat: 1, clearcoatRoughness: 0.06,
    specularIntensity: 1, specularColor: new THREE.Color("#ffffff"),
    envMapIntensity: 1.6, side: THREE.FrontSide,
  });
}

/** The environment the glass reflects: a white studio in front (the body reads clear and white face-on) that turns to
 * the holo colours round the sides and back (so rims and folds catch pink, lavender, violet, periwinkle and a peach
 * glint), with a white softbox and thin white strips for the clear coat's streaks. Pre-filtered once (PMREM). */
function holoEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const owned: { dispose(): void }[] = [];
  const R = 20;
  const sphere = new THREE.SphereGeometry(R, 128, 64);
  const lobes: [THREE.Vector3, THREE.Color, number, number][] = [
    // direction, colour, strength, tightness
    [new THREE.Vector3(-1, 0.25, -0.35), new THREE.Color(HOLO.pink), 1, 2],
    [new THREE.Vector3(1, -0.05, -0.45), new THREE.Color(HOLO.lavender), 1, 2],
    [new THREE.Vector3(0, 0.1, -1), new THREE.Color(HOLO.violet), 1, 2.2],
    [new THREE.Vector3(0.25, -1, -0.2), new THREE.Color(HOLO.periwinkle), 0.9, 2.4],
    [new THREE.Vector3(-0.7, -0.55, 0.45), new THREE.Color(HOLO.peach), 0.85, 4],
    [new THREE.Vector3(0.6, 0.8, -0.4), new THREE.Color(HOLO.sky), 0.6, 4],
  ];
  for (const l of lobes) l[0].normalize();
  const pos = sphere.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    c.setRGB(1, 1, 1);
    for (const [dir, col, k, p] of lobes) c.lerp(col, k * Math.pow(Math.max(0, d.dot(dir)), p));
    c.multiplyScalar(1.15);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  sphere.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const sphereMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  scene.add(new THREE.Mesh(sphere, sphereMat));
  owned.push(sphere, sphereMat);
  const panel = new THREE.PlaneGeometry(1, 1);
  owned.push(panel);
  const add = (hex: string, power: number, [x, y, z]: [number, number, number], [w, h]: [number, number], roll = 0) => {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(power), side: THREE.DoubleSide });
    owned.push(m);
    const p = new THREE.Mesh(panel, m);
    p.position.set(x, y, z); p.lookAt(0, 0, 0); p.rotateZ(roll); p.scale.set(w, h, 1);
    scene.add(p);
  };
  add("#ffffff", 2.4, [-5, 10, 9], [9, 5]); // the key softbox, above front left
  add("#ffffff", 7, [10, 4, 5], [0.5, 14], 0.3); // streaks
  add("#ffffff", 6, [-11, 0, 1], [0.45, 12], -0.2);
  add("#ffffff", 5, [2, -6, 11], [14, 0.4]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  for (const o of owned) o.dispose();
  return target.texture;
}

/** Soft colour fields behind the glass, in view space: [x, y (−1 to 1, x scaled by the aspect), radius], colour. */
type Field = [number, number, number, string];
type Look = GlassShape | "hero";
const FIELDS: Record<Look, { fields: Field[]; strength: number }> = {
  hero: { strength: 1, fields: [[-0.75, 0.55, 0.55, HOLO.pink], [0.7, 0.75, 0.5, HOLO.sky], [0.85, -0.05, 0.5, HOLO.lavender],
    [-0.8, -0.25, 0.5, HOLO.peach], [0.1, 0.05, 0.45, HOLO.periwinkle], [0.2, -0.75, 0.55, HOLO.violet]] },
  aperture: { strength: 1, fields: [[-0.75, 0.6, 0.6, HOLO.pink], [0.7, 0.7, 0.55, HOLO.sky], [0.85, -0.2, 0.55, HOLO.lavender],
    [-0.8, -0.45, 0.55, HOLO.peach], [0.05, 0.05, 0.45, HOLO.periwinkle], [0.1, -0.9, 0.5, HOLO.violet]] },
  ring: { strength: 1, fields: [[-0.8, 0.3, 0.7, HOLO.violet], [0.1, 0.9, 0.6, HOLO.lavender], [0.9, 0.1, 0.6, HOLO.pink],
    [0.4, -0.8, 0.6, "#5b4bff"], [-0.6, -0.6, 0.5, HOLO.periwinkle], [0.95, -0.6, 0.35, HOLO.sky]] },
  pill: { strength: 0.95, fields: [[-0.7, 0.4, 0.6, HOLO.pink], [0.7, 0.5, 0.6, HOLO.lavender], [0.5, -0.6, 0.6, HOLO.periwinkle],
    [-0.5, -0.6, 0.45, HOLO.peach], [0, 0.95, 0.4, HOLO.violet], [0.95, -0.1, 0.3, HOLO.sky]] },
};

/**
 * What the glass bends: a screen-filling quad of soft holo colour fields that only the transmission pass sees (in the
 * main pass it writes neither colour nor depth), so the page stays white while the glass refracts colour, the way a
 * studio glass render does. Drawn first and fixed to the view, so the colours flow through the glass as it turns.
 */
function backdrop(look: Look): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
  const { fields, strength } = FIELDS[look];
  const material = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: {
      uAspect: { value: 1 }, uK: { value: strength },
      uP: { value: fields.map(([x, y, r]) => new THREE.Vector3(x, y, r)) },
      uC: { value: fields.map(([, , , c]) => new THREE.Color(c)) },
    },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `uniform float uAspect; uniform float uK; uniform vec3 uP[6]; uniform vec3 uC[6]; varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0 * vec2(uAspect, 1.0);
        vec3 col = vec3(1.0);
        for (int i = 0; i < 6; i++) {
          float d = length(p - uP[i].xy) / uP[i].z;
          col = mix(col, uC[i], uK * exp(-d * d));
        }
        float band = 0.5 + 0.5 * sin((p.x * 0.7 + p.y * 1.5) * 6.0);
        col = mix(col, vec3(1.0), 0.22 * band * band);
        // a soft light streak for the glass to bend
        float s1 = smoothstep(0.8, 1.0, sin((p.x * 1.1 - p.y * 0.6) * 4.0 + 0.6));
        col = mix(col, vec3(1.3), 0.35 * s1);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.onBeforeRender = (renderer) => { material.colorWrite = renderer.getRenderTarget() !== null; };
  return mesh;
}

function fromMesh(m: GlassMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return g;
}

/** Blade thickness: the slab and its rounded bevel (outer radius 1; a blade is about 0.45 wide). */
const SLAB = 0.045, BEVEL = 0.024, BEVEL_IN = 0.016;
/** The ink pupil's size in the opening: smaller than the logo's, so the glass reads airy and the pupil like an eye's. */
const PUPIL = 0.56;

/** The Aperture mark in glass: six thick blades, each in a pin group that slides out and turns a little to open, round
 * an ink hexagonal pupil that grows with the opening. `setOpen(o)` poses it (0 the logo, 1 open). */
function apertureModel(material: THREE.Material, owned: { dispose(): void }[]) {
  const { blades, hexagon } = apertureParts(APERTURE_BLADES, APERTURE_PUPIL, 40);
  const group = new THREE.Group();
  const extrude = (pts: [number, number][], [ox, oy]: [number, number], slab: number, bevel: number, inset: number) => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x - ox, y - oy))), {
      depth: slab, bevelEnabled: true, bevelThickness: bevel, bevelSize: inset, bevelOffset: -inset, bevelSegments: 6,
      curveSegments: 1 });
    g.translate(0, 0, -slab / 2);
    g.computeVertexNormals();
    owned.push(g);
    return g;
  };
  const pins = blades.map((b, i) => {
    const pin = new THREE.Group();
    pin.position.set(b.pivot[0], b.pivot[1], (i - 2.5) * 0.0015);
    pin.add(new THREE.Mesh(extrude(b.outline, b.pivot, SLAB, BEVEL, BEVEL_IN), material));
    group.add(pin);
    return pin;
  });
  const ink = new THREE.MeshStandardMaterial({ color: "#000000", roughness: 0.32, metalness: 0, envMapIntensity: 0.06 });
  owned.push(ink);
  const eye = new THREE.Mesh(extrude(hexagon, [0, 0], 0.03, 0.014, 0.012), ink);
  group.add(eye);
  return {
    group,
    setOpen(o: number) {
      blades.forEach((b, i) => {
        const { pin, turn } = bladeMove(b, o);
        pins[i].position.x = pin[0]; pins[i].position.y = pin[1]; pins[i].rotation.z = turn;
      });
      eye.scale.setScalar(PUPIL * pupilScale(blades[0], o));
    },
  };
}

/** A soft round shadow: a radial fade from the centre, as an alpha map. */
function shadowTexture(): THREE.DataTexture {
  const n = 64, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1);
    const a = Math.max(0, 1 - d) ** 2.2;
    const v = Math.round(255 * a); // an alpha map reads green
    data.set([v, v, v, 255], (y * n + x) * 4);
  }
  const t = new THREE.DataTexture(data, n, n);
  t.needsUpdate = true;
  return t;
}

/** The hero's white pedestal: a round plinth with softened edges, a contact shadow on its top that tightens as the
 * aperture comes down, and a faint shadow on the page under it. `setLift(h)` follows the float. */
function pedestal(owned: { dispose(): void }[], top: number) {
  const R = 0.92, H = 0.16, e = 0.035;
  const profile = [new THREE.Vector2(0, top)];
  for (let k = 0; k <= 8; k++) { const a = (k / 8) * (Math.PI / 2); profile.push(new THREE.Vector2(R - e + e * Math.sin(a), top - e + e * Math.cos(a))); }
  profile.push(new THREE.Vector2(R, top - H + 0.01), new THREE.Vector2(R - 0.01, top - H), new THREE.Vector2(0, top - H));
  const geo = new THREE.LatheGeometry(profile, 128);
  const mat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.7, metalness: 0, envMapIntensity: 0.28 });
  const tex = shadowTexture();
  const plane = new THREE.PlaneGeometry(1, 1);
  const contactMat = new THREE.MeshBasicMaterial({ color: "#4b3d78", alphaMap: tex, transparent: true, opacity: 0.3, depthWrite: false });
  const floorMat = new THREE.MeshBasicMaterial({ color: "#4b3d78", alphaMap: tex, transparent: true, opacity: 0.1, depthWrite: false });
  owned.push(geo, mat, tex, plane, contactMat, floorMat);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));
  // its own soft light: bright from above, a lavender-grey from below, so the top reads white and the side shaded
  const sky = new THREE.HemisphereLight(0xffffff, 0xb9b2cc, 1.5);
  group.add(sky);
  const contact = new THREE.Mesh(plane, contactMat);
  contact.rotation.x = -Math.PI / 2; contact.position.y = top + 0.002;
  const floor = new THREE.Mesh(plane, floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = top - H - 0.002; floor.scale.set(2.5, 2.5, 1);
  group.add(contact, floor);
  return {
    group,
    setLift(h: number) {
      const k = 1 + h * 4;
      contact.scale.set(1.5 * k, 1.5 * k, 1);
      contactMat.opacity = 0.3 / (k * k);
    },
  };
}

export type GlassStage = {
  /** Draw the pose at `t` seconds, leaning by `aim` (the pointer's tilt in radians, and attention 0 to 1). */
  render(t: number, aim?: { tiltX: number; tiltY: number; attention: number }): void;
  /** Fit the drawing buffer to `w` × `h` CSS pixels at `dpr`. */
  resize(w: number, h: number, dpr: number): void;
  /** The canvas as an image (call right after `render`). */
  snapshot(type?: string, quality?: number): string;
  dispose(): void;
};

/** Where the aperture floats over the pedestal's top in the hero (its centre's height; outer radius 1). */
const HERO_Y = 0.24, PEDESTAL_TOP = -1.08;

/**
 * A glass stage on `canvas`: `shape` alone (a still of the family), or with `hero` the aperture floating over its
 * pedestal. Opaque white, which the hero sits on and the stills take out to transparency. Throws when WebGL is not
 * available (the caller shows the still).
 */
export function createGlassStage(canvas: HTMLCanvasElement, { shape = "aperture", hero = false }:
  { shape?: GlassShape; hero?: boolean } = {}): GlassStage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: false,
    powerPreference: "high-performance" });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.4;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xffffff, 1);
  const look: Look = hero ? "hero" : shape;
  const scene = new THREE.Scene();
  const env = holoEnvironment(renderer);
  scene.environment = env;
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  const owned: { dispose(): void }[] = [env];
  const material = glassMaterial();
  owned.push(material);
  const back = backdrop(look);
  owned.push(back.geometry, back.material);
  scene.add(back);
  const pivot = new THREE.Group(); // lean and float
  const spinner = new THREE.Group(); // turn in the shape's own plane
  pivot.add(spinner);
  scene.add(pivot);
  let setOpen = (_: number) => {};
  if (shape === "ring") {
    const g = fromMesh(ringMesh());
    owned.push(g);
    spinner.add(new THREE.Mesh(g, material));
  } else if (shape === "pill") {
    const g = new THREE.CapsuleGeometry(0.42, 0.9, 16, 64);
    owned.push(g);
    spinner.add(new THREE.Mesh(g, material));
  } else {
    const model = apertureModel(material, owned);
    spinner.add(model.group);
    setOpen = model.setOpen;
  }
  const stand = hero ? pedestal(owned, PEDESTAL_TOP) : null;
  if (stand) scene.add(stand.group);
  // a soft key light for a crisp glint on top of the environment, and for the pedestal's shading
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(-3, 5, 4);
  scene.add(key);
  let aspect = 1;
  const [ew, eh] = GLASS_EXTENT[hero ? "hero" : shape];
  const lookY = hero ? -0.12 : 0;
  const elevation = hero ? 0.2 : 0;
  // "contain": the shape's extent box fits the view whatever its aspect, as the still (rendered at ew:eh) does in CSS
  const frame = () => {
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = Math.max(eh / tan, ew / (tan * aspect));
    camera.position.set(0, lookY + d * Math.sin(elevation), d * Math.cos(elevation));
    camera.lookAt(0, lookY, 0);
    camera.updateProjectionMatrix();
  };
  frame();
  const still = { tiltX: 0, tiltY: 0, attention: 0 };
  const pose = (t: number, aim = still) => {
    if (shape === "aperture") {
      const p = aperturePose(t);
      pivot.position.y = hero ? HERO_Y + p.lift : 0;
      pivot.rotation.set(-0.1 - elevation * 0.6 + p.tiltX + aim.tiltX, -0.42 + p.tiltY + aim.tiltY, 0.04);
      spinner.rotation.z = p.spin;
      setOpen(Math.min(1.3, p.open + 0.35 * aim.attention));
      stand?.setLift(p.lift);
    } else if (shape === "ring") {
      pivot.rotation.set(-0.55, 0.35, 0.25 + t * 0.12);
    } else {
      pivot.rotation.set(0.5, 0.2, -0.75 + 0.1 * Math.sin(t * 0.5));
    }
  };
  return {
    render(t, aim) { pose(t, aim); renderer.render(scene, camera); },
    resize(w, h, dpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(Math.max(1, w), Math.max(1, h), false);
      aspect = Math.max(1, w) / Math.max(1, h);
      camera.aspect = aspect;
      back.material.uniforms.uAspect.value = aspect;
      frame();
    },
    snapshot(type = "image/webp", quality = 0.86) { return canvas.toDataURL(type, quality); },
    dispose() {
      scene.clear();
      for (const o of owned) o.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
