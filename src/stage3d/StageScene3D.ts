/**
 * three.js scene of a 3D stage. Imperative and frame-exact: apply(frame) +
 * render() draw one moment of the timeline — used for the live preview and,
 * frame by frame, for the MP4 render.
 *
 *   hall      baked in Blender (light, shadows, materials) → shown unlit, exactly as baked
 *   objects   albedo / image textures from Blender, lit live, cast soft shadows on the floor
 *   briefing  shooting boxes (tape on the floor) and the path as red arrows
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CameraPose, FrameState } from './timeline';
import { legPoints, stageBounds } from './timeline';
import type { Stage3D } from './types';

const DEG = Math.PI / 180;
const ACCENT = new THREE.Color('#ff3131');

/** One loader + cache for all scenes (preview and render share the downloads). */
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();
const loadGlb = (url: string) => {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).then((g) => g.scene));
  return cache.get(url)!;
};

export const assetUrl = (file: string) => new URL(`3d/${file}`, document.baseURI).href;

interface Arrow {
  ribbon: THREE.Mesh;
  head: THREE.Mesh;
  /** Index count per 1 % of progress. */
  total: number;
}

export class StageScene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 300);
  private arrows: Arrow[] = [];
  private disposed = false;
  private ceilingHidden = false;

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const r = new THREE.WebGLRenderer({ canvas: canvas as HTMLCanvasElement, antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    // Khronos PBR Neutral — the same view transform the Blender bakes were saved with
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.scene.background = new THREE.Color('#050605');
    this.camera.rotation.order = 'YXZ';
  }

  async load(stage: Stage3D) {
    const [env, ...objs] = await Promise.all([
      loadGlb(assetUrl(`env_${stage.environment}.glb`)),
      ...stage.objects.map((o) => loadGlb(assetUrl(`obj_${o.type}.glb`)).catch(() => null)),
    ]);
    if (this.disposed) return;

    // ---- hall: baked → unlit
    const hall = env.clone(true);
    hall.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.MeshStandardMaterial;
      // the floor is seen at grazing angles: anisotropic filtering keeps it sharp into the distance
      if (src.map) src.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      m.material = new THREE.MeshBasicMaterial({ map: src.map ?? null, color: src.map ? 0xffffff : src.color, toneMapped: false });
      m.userData.ceiling = /ceiling/.test(m.name) || /ceiling/.test(src.name);
    });
    this.scene.add(hall);

    // ---- objects: lit live
    stage.objects.forEach((o, i) => {
      const src = objs[i];
      if (!src) return;
      const g = src.clone(true);
      g.position.set(o.x, o.elevation ?? 0, -o.d);
      g.rotation.y = -(o.yaw ?? 0) * DEG;
      g.traverse((n) => {
        const m = n as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.name.startsWith('barrier_mesh') || mat.transparent) {
          // the orange barrier mesh: cut-out, see-through, both sides. Mip levels average the
          // holes away, so a hard 0.5 test loses the whole mesh at distance: low threshold +
          // alpha-to-coverage (MSAA) keeps it see-through and smooth.
          mat.transparent = false;
          // glTF BLEND materials come without depth writes: as an opaque cut-out the hall drawn
          // after it would paint over the mesh
          mat.depthWrite = true;
          mat.alphaTest = 0.35;
          mat.alphaToCoverage = true;
          mat.side = THREE.DoubleSide;
        }
        if (mat.map) mat.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        mat.envMapIntensity = 0.5;
      });
      this.scene.add(g);
    });

    // ---- light for the objects, matched by eye to the baked high bays (warm-neutral, from above)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#efede6', '#3d3b37', 1.15));
    const b = stageBounds(stage);
    const cx = (b.x0 + b.x1) / 2;
    const cd = (b.d0 + b.d1) / 2;
    const key = new THREE.DirectionalLight('#fff7ec', 2.1);
    key.position.set(cx - 2, 12, -(cd - 5));
    key.target.position.set(cx, 0, -cd);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    const sc = key.shadow.camera;
    const half = Math.max(b.x1 - b.x0, b.d1 - b.d0) / 2 + 3;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 1;
    sc.far = 40;
    this.scene.add(key, key.target);

    // shadows of the objects on the (unlit, baked) floor
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(16, 34), new THREE.ShadowMaterial({ opacity: 0.42 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.set(0, 0.002, -11);
    catcher.receiveShadow = true;
    this.scene.add(catcher);

    // ---- shooting boxes: white tape squares at every position
    const tape = new THREE.MeshBasicMaterial({ color: '#d9d6cc', toneMapped: false });
    for (const p of stage.positions) {
      const box = new THREE.Group();
      for (const [w, h, x, z] of [
        [1, 0.05, 0, -0.475],
        [1, 0.05, 0, 0.475],
        [0.05, 1, -0.475, 0],
        [0.05, 1, 0.475, 0],
      ]) {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, h), tape);
        strip.rotation.x = -Math.PI / 2;
        strip.position.set(x, 0.004, z);
        box.add(strip);
      }
      box.position.set(p.x, 0, -p.d);
      box.rotation.y = -p.heading * DEG;
      this.scene.add(box);
    }

    // ---- briefing arrows along the legs
    stage.legs.forEach((_, i) => this.arrows.push(this.makeArrow(legPoints(stage, i))));
  }

  /** Flat ribbon on the floor along the path (revealed with drawRange) + an arrow head at the end. */
  private makeArrow(pts: { x: number; d: number }[]): Arrow {
    const W = 0.16;
    const step = 0.05;
    const dense: THREE.Vector2[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = new THREE.Vector2(pts[i].x, -pts[i].d);
      const b = new THREE.Vector2(pts[i + 1].x, -pts[i + 1].d);
      const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
      for (let k = 0; k < n; k++) dense.push(a.clone().lerp(b, k / n));
    }
    const last = pts[pts.length - 1];
    const end = new THREE.Vector2(last.x, -last.d);
    // stop short of the box centre so the head sits inside the box
    const dir = end.clone().sub(dense[dense.length - 1]).normalize();
    const tip = end.clone().sub(dir.clone().multiplyScalar(0.3));
    dense.push(tip);
    const pos: number[] = [];
    const idx: number[] = [];
    dense.forEach((p, i) => {
      const q = dense[Math.min(i + 1, dense.length - 1)];
      const o = dense[Math.max(i - 1, 0)];
      const t = q.clone().sub(o).normalize();
      const nx = -t.y * (W / 2);
      const nz = t.x * (W / 2);
      pos.push(p.x + nx, 0.012, p.y + nz, p.x - nx, 0.012, p.y - nz);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const ribbon = new THREE.Mesh(geo, mat);
    ribbon.renderOrder = 2;
    const head = new THREE.Mesh(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.22, 0, 0.12), new THREE.Vector3(0.22, 0, 0.12), new THREE.Vector3(0, 0, -0.32)]),
      mat,
    );
    head.position.set(tip.x, 0.013, tip.y);
    head.rotation.y = Math.atan2(-dir.x, -dir.y);
    head.renderOrder = 2;
    this.scene.add(ribbon, head);
    return { ribbon, head, total: idx.length };
  }

  setSize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private applyCamera(p: CameraPose) {
    const c = this.camera;
    c.position.set(p.x, p.y, p.z);
    c.rotation.set(p.pitch * DEG, -p.yaw * DEG, 0);
    if (c.fov !== p.fov) {
      c.fov = p.fov;
      c.updateProjectionMatrix();
    }
  }

  apply(f: FrameState) {
    this.applyCamera(f.camera);
    // from above (briefing), the trusses and light fixtures would hang between camera and stage
    const above = f.camera.y > 5.5;
    if (above !== this.ceilingHidden) {
      this.ceilingHidden = above;
      this.scene.traverse((n) => {
        if (n.userData.ceiling) n.visible = !above;
      });
    }
    this.arrows.forEach((a, i) => {
      const p = f.arrows?.[i] ?? 0;
      const count = Math.floor((a.total / 6) * p) * 6;
      a.ribbon.geometry.setDrawRange(0, count);
      a.ribbon.visible = p > 0;
      const m = a.ribbon.material as THREE.MeshBasicMaterial;
      // during the fly-in the arrows fade out instead of un-drawing
      m.opacity = f.segment === 'flyin' ? p : 0.92;
      a.head.visible = p >= 0.98 || (f.segment === 'flyin' && p > 0);
    });
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** World point (meters: x, height, downrange) → normalised screen position (0..1), null if behind the camera. */
  project(x: number, y: number, d: number) {
    const v = new THREE.Vector3(x, y, -d).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  dispose() {
    this.disposed = true;
    this.scene.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.renderer.dispose();
  }
}
