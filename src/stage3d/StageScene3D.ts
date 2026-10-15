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
import { legPath, stageBounds } from './timeline';
import type { StageObject } from '../types/stage';
import { fallTimes, motionAt } from '../utils/motion';
import { type Room, type Stage3D, type StageObject3D, parTime3D, roomOf } from './types';

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

export interface Footprint {
  /** Bounds seen from above in the object's own frame, meters (z: + = front, towards the shooter). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  height: number;
}

const footprints = new Map<string, Promise<Footprint | null>>();

/** Real outline of a model from above (for the top-view editor), from its glTF bounds. */
export const footprintOf = (type: string): Promise<Footprint | null> => {
  if (!footprints.has(type))
    footprints.set(
      type,
      loadGlb(assetUrl(`obj_${type}.glb`))
        .then((g) => {
          const b = new THREE.Box3().setFromObject(g);
          return { x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, height: b.max.y };
        })
        .catch(() => null),
    );
  return footprints.get(type)!;
};

interface Mover {
  o: StageObject3D;
  node: THREE.Object3D;
  base: THREE.Vector3;
  /** Pivots of the parts that fall (steel plates), hinged at their lower edge. */
  tips: THREE.Object3D[];
}

const REST = { dx: 0, dy: 0, visible: true, fall: 0, rot: 0 };

/**
 * A moving object. For falling steel the plate parts (everything but the baked stand,
 * "<type>_body") are re-hung on a pivot at their lower edge, so only the plate tips over.
 */
const makeMover = (o: StageObject3D, node: THREE.Object3D): Mover => {
  const tips: THREE.Object3D[] = [];
  if (o.motion?.kind === 'fall') {
    const parts = node.children.filter((c) => !c.name.endsWith('_body'));
    if (parts.length) {
      const box = new THREE.Box3();
      for (const p of parts) {
        p.updateMatrix();
        const m = p as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.computeBoundingBox();
          box.union(m.geometry.boundingBox!.clone().applyMatrix4(p.matrix));
        }
      }
      const pivot = new THREE.Group();
      pivot.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
      for (const p of parts) {
        p.position.sub(pivot.position);
        pivot.add(p);
      }
      node.add(pivot);
      tips.push(pivot);
    }
  }
  return { o, node, base: node.position.clone(), tips };
};

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

  /** Hall + stage in one go (player and video render). */
  async load(stage: Stage3D) {
    await this.loadEnvironment(stage.environment);
    await this.setStage(stage);
  }

  private envId: string | null = null;
  private envGroup = new THREE.Group();
  private room: Room = roomOf('indoor_01');
  private lightsReady = false;
  private key: THREE.DirectionalLight | null = null;
  private stageGroup = new THREE.Group();
  private generation = 0;
  private stage: Stage3D | null = null;
  private movers: Mover[] = [];

  /** The hall (baked → unlit) with its outer shell and floor shadow catcher; the light for the objects. Swaps when the environment changes. */
  async loadEnvironment(environment: Stage3D['environment']) {
    if (this.envId === environment) return;
    const env = await loadGlb(assetUrl(`env_${environment}.glb`));
    if (this.disposed || this.envId === environment) return;
    this.envId = environment;
    const room = (this.room = roomOf(environment));
    this.scene.remove(this.envGroup);
    this.envGroup.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh && m.userData.own) m.geometry.dispose();
    });
    const eg = (this.envGroup = new THREE.Group());
    this.scene.add(eg);
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
    eg.add(hall);

    // The bake only has the faces seen from inside. Thick walls with tops around it make the
    // hall a closed building from above (briefing, fly-in) instead of paper-thin panels in the void.
    const side = new THREE.MeshBasicMaterial({ color: '#1d1f1e', toneMapped: false });
    const top = new THREE.MeshBasicMaterial({ color: '#4a4d4b', toneMapped: false });
    const T = 0.45;
    const H = room.height + 0.12;
    const len = room.d1 - room.d0 + 2 * T;
    const wid = room.x1 - room.x0 + 2 * T;
    const cx = (room.x0 + room.x1) / 2;
    const cz = -(room.d0 + room.d1) / 2;
    for (const [w, d, x, z] of [
      [T, len, room.x0 - T / 2 - 0.01, cz],
      [T, len, room.x1 + T / 2 + 0.01, cz],
      [wid, T, cx, -(room.d1 + T / 2 + 0.01)],
      [wid, T, cx, -(room.d0 - T / 2)],
    ]) {
      // box faces: +x, −x, +y (top), −y, +z, −z
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), [side, side, top, side, side, side]);
      wall.position.set(x, H / 2, z);
      wall.userData.own = true;
      eg.add(wall);
    }
    // the ground around the building
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 140), new THREE.MeshBasicMaterial({ color: '#0d0e0d', toneMapped: false }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.02, cz);
    ground.userData.own = true;
    eg.add(ground);

    // shadows of the objects on the (unlit, baked) floor
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(room.x1 - room.x0, room.d1 - room.d0), new THREE.ShadowMaterial({ opacity: 0.42 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.set(cx, 0.002, cz);
    catcher.receiveShadow = true;
    catcher.userData.own = true;
    eg.add(catcher);
    this.ceilingHidden = false;
    if (this.lightsReady) return;
    this.lightsReady = true;

    // light for the objects, matched by eye to the baked high bays (warm-neutral, from above)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#efede6', '#3d3b37', 1.15));
    const key = new THREE.DirectionalLight('#fff7ec', 2.1);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    this.key = key;
    this.scene.add(key, key.target, this.stageGroup);
  }

  /** Objects, shooting boxes and path arrows of a stage — call again after every edit (the hall stays). */
  async setStage(stage: Stage3D) {
    const gen = ++this.generation;
    const objs = await Promise.all(stage.objects.map((o) => loadGlb(assetUrl(`obj_${o.type}.glb`)).catch(() => null)));
    // a newer edit arrived while the models loaded
    if (this.disposed || gen !== this.generation) return;
    const group = new THREE.Group();
    const movers: Mover[] = [];

    // ---- objects: lit live
    stage.objects.forEach((o, i) => {
      const src = objs[i];
      if (!src) return;
      const g = src.clone(true);
      g.position.set(o.x, o.elevation ?? 0, -o.d);
      g.rotation.y = -(o.yaw ?? 0) * DEG;
      const s = o.scale ?? 1;
      g.scale.set(o.flip ? -s : s, s, s);
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
        // mirrored objects turn their faces inside out
        if (o.flip) mat.side = THREE.DoubleSide;
        if (mat.map) mat.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        mat.envMapIntensity = 0.5;
      });
      g.userData.objectId = o.id;
      group.add(g);
      if (o.motion && o.motion.kind !== 'static') movers.push(makeMover(o, g));
    });

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
        strip.userData.own = true;
        box.add(strip);
      }
      box.position.set(p.x, 0, -p.d);
      box.rotation.y = -p.heading * DEG;
      group.add(box);
    }

    // ---- briefing arrows along the legs
    this.arrows = stage.legs.map((_, i) => this.makeArrow(legPath(stage, i), group));

    // ---- the key light's shadow covers the stage
    if (this.key) {
      const b = stageBounds(stage);
      const cx = (b.x0 + b.x1) / 2;
      const cd = (b.d0 + b.d1) / 2;
      this.key.position.set(cx - 2, 12, -(cd - 5));
      this.key.target.position.set(cx, 0, -cd);
      const sc = this.key.shadow.camera;
      const half = Math.max(b.x1 - b.x0, b.d1 - b.d0) / 2 + 3;
      sc.left = -half;
      sc.right = half;
      sc.top = half;
      sc.bottom = -half;
      sc.near = 1;
      sc.far = 40;
      sc.updateProjectionMatrix();
    }

    // swap in one step: no half-built frame is ever rendered
    this.scene.remove(this.stageGroup);
    this.stageGroup.traverse((n) => {
      const m = n as THREE.Mesh;
      // clones share the cached model geometry — only free what this scene built itself
      if (m.isMesh && m.userData.own) m.geometry.dispose();
    });
    this.stageGroup = group;
    this.scene.add(group);
    this.stage = stage;
    this.movers = movers;
  }

  /**
   * Flat ribbon on the floor along the walked (smoothed) path — revealed with
   * drawRange — ending in an arrow head inside the target box.
   */
  private makeArrow(path: { x: number; d: number }[], group: THREE.Group): Arrow {
    const W = 0.16;
    const HEAD = 0.5;
    // resample evenly (5 cm) in floor coordinates (three: x, z = −d)
    const raw = path.map((p) => new THREE.Vector2(p.x, -p.d));
    const dense: THREE.Vector2[] = [];
    for (let i = 0; i < raw.length - 1; i++) {
      const n = Math.max(1, Math.ceil(raw[i].distanceTo(raw[i + 1]) / 0.05));
      for (let k = 0; k < n; k++) dense.push(raw[i].clone().lerp(raw[i + 1], k / n));
    }
    dense.push(raw[raw.length - 1].clone());
    // start at the edge of the start box, stop so that the head's tip sits inside the target box
    const trim = (pts: THREE.Vector2[], len: number) => {
      let left = len;
      while (pts.length > 2 && left > 0) {
        const d = pts[pts.length - 1].distanceTo(pts[pts.length - 2]);
        if (d > left) {
          pts[pts.length - 1] = pts[pts.length - 1].clone().lerp(pts[pts.length - 2], left / d);
          break;
        }
        left -= d;
        pts.pop();
      }
      return pts;
    };
    trim(dense, 0.25 + HEAD);
    dense.reverse();
    trim(dense, 0.35);
    dense.reverse();
    const pos: number[] = [];
    const idx: number[] = [];
    dense.forEach((p, i) => {
      // averaged tangent: even width through the curves
      const q = dense[Math.min(i + 1, dense.length - 1)];
      const o = dense[Math.max(i - 1, 0)];
      const t = q.clone().sub(o).normalize();
      const nx = -t.y * (W / 2);
      const nz = t.x * (W / 2);
      pos.push(p.x + nx, 0.014, p.y + nz, p.x - nx, 0.014, p.y - nz);
      if (i > 0) {
        const a = (i - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    // drawn on the floor: pulled towards the camera in depth, so it never flickers into the floor
    const mat = new THREE.MeshBasicMaterial({ color: ACCENT, toneMapped: false, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const ribbon = new THREE.Mesh(geo, mat);
    ribbon.renderOrder = 2;
    const end = dense[dense.length - 1];
    const dir = end.clone().sub(dense[Math.max(0, dense.length - 4)]).normalize();
    // head: base on the ribbon's end, tip HEAD further along the path
    const head = new THREE.Mesh(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.24, 0, 0), new THREE.Vector3(0.24, 0, 0), new THREE.Vector3(0, 0, -HEAD)]),
      mat,
    );
    head.position.set(end.x, 0.014, end.y);
    head.rotation.y = Math.atan2(-dir.x, -dir.y);
    head.renderOrder = 2;
    ribbon.userData.own = head.userData.own = true;
    group.add(ribbon, head);
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
    c.rotation.set(p.pitch * DEG, -p.yaw * DEG, -(p.roll ?? 0) * DEG);
    if (c.fov !== p.fov) {
      c.fov = p.fov;
      c.updateProjectionMatrix();
    }
  }

  apply(f: FrameState) {
    this.applyCamera(f.camera);
    this.applyMotion(f);
    // from above (briefing), the trusses and light fixtures would hang between camera and stage
    const above = f.camera.y > this.room.height - 0.4;
    if (above !== this.ceilingHidden) {
      this.ceilingHidden = above;
      this.scene.traverse((n) => {
        if (n.userData.ceiling) n.visible = !above;
      });
    }
    this.arrows.forEach((a, i) => {
      const p = f.arrows?.[i] ?? 0;
      // briefing: the line grows towards the head; fly-in: the finished arrow only fades out
      const fading = f.segment === 'flyin';
      const drawn = fading ? 1 : p;
      a.ribbon.geometry.setDrawRange(0, Math.floor((a.total / 6) * drawn) * 6);
      a.ribbon.visible = p > 0;
      const m = a.ribbon.material as THREE.MeshBasicMaterial;
      m.opacity = fading ? 0.92 * p : 0.92;
      // the head appears when the line arrives
      a.head.visible = p > 0 && drawn >= 0.995;
    });
  }

  /**
   * Target motion (same model as the 2D player): during a rep each moving object follows
   * motionAt(); outside the reps (briefing, editor) everything shows its rest pose, so even
   * targets that are hidden until activated can be seen and placed.
   */
  private applyMotion(f: FrameState) {
    const stage = this.stage;
    if (!stage || !this.movers.length) return;
    const rep = f.segment === 'stage' ? f.rep : null;
    const par = parTime3D(stage);
    const active = !!rep && (rep.phase === 'active' || (rep.phase === 'reset' && rep.sinceStart < par + 1));
    const falls = fallTimes(stage.objects as unknown as StageObject[]);
    for (const mv of this.movers) {
      const m = rep ? motionAt(mv.o.motion, rep.sinceStart, active, falls) : REST;
      const yaw = (mv.o.yaw ?? 0) * DEG;
      // slides run along the object's own face, bobs go up
      mv.node.position.set(mv.base.x + m.dx * Math.cos(yaw), mv.base.y + m.dy, mv.base.z + m.dx * Math.sin(yaw));
      mv.node.visible = m.visible;
      // swing: tilt in the object's own plane around its foot (+ = top to the right)
      mv.node.rotation.z = -m.rot * DEG;
      // steel: the plate tips backwards (away from the shooter) around its lower edge
      for (const p of mv.tips) p.rotation.x = -m.fall * 1.45;
    }
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
      // cached models are shared with other scenes (preview, render): only free our own geometry
      if (m.isMesh && m.userData.own) m.geometry.dispose();
    });
    this.renderer.dispose();
  }
}
