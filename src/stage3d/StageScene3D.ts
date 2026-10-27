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
import { fallTimes, motionAt } from '../utils/motion';
import { type Env3D, type Room, type Stage3D, type StageObject3D, parTime3D, roomOf } from './types';

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

/** Outdoor sky: the HDRI as a tone-mapped equirect JPG, already turned to three.js' convention (centre = +x). */
const skies = new Map<string, Promise<THREE.Texture>>();
const loadSky = (env: string) => {
  if (!skies.has(env))
    skies.set(
      env,
      new THREE.TextureLoader().loadAsync(assetUrl(`sky_${env}.jpg`)).then((t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      }),
    );
  return skies.get(env)!;
};

/**
 * Live light for the objects, matched by eye to each environment's bake / plates:
 * hemisphere (sky / ground colour) + key (the HDRI sun outdoors) + fill (no shadows, from behind
 * the shooter: outdoors the light the bright ground and sky throw onto the target faces, so
 * targets read as clearly as indoors whatever the sun does), reflections of the environment,
 * opacity of the floor shadows.
 */
interface Light {
  sky: string;
  ground: string;
  hemi: number;
  sun: string;
  key: number;
  fill: number;
  env: number;
  shadow: number;
  /** Overall brightness of this environment (1 = as baked); every stage can scale it further. */
  brightness?: number;
}
const INDOOR: Light = { sky: '#efede6', ground: '#3d3b37', hemi: 1.15, sun: '#fff7ec', key: 2.1, fill: 0, env: 0.5, shadow: 0.42 };
const LIGHT: Record<Env3D, Light> = {
  indoor_01: INDOOR,
  indoor_02: INDOOR,
  indoor_03: INDOOR,
  indoor_04: INDOOR,
  // white floors / walls under many lights: a little darker than baked
  indoor_05: { ...INDOOR, brightness: 0.72 },
  indoor_06: { ...INDOOR, brightness: 0.72 },
  outdoor_01: { sky: '#d6e2f2', ground: '#8a7f68', hemi: 1.3, sun: '#fff3e0', key: 3.2, fill: 4, env: 0.8, shadow: 0.55 },
  outdoor_02: { sky: '#cdd6e4', ground: '#6f6b4c', hemi: 1.1, sun: '#ffd9ab', key: 2.8, fill: 3.5, env: 0.8, shadow: 0.5 },
  outdoor_03: { sky: '#e6eaee', ground: '#6c7356', hemi: 1.9, sun: '#f4f6f8', key: 0.7, fill: 2.5, env: 0.8, shadow: 0.22 },
  outdoor_05: { sky: '#d6e2f2', ground: '#a39c8c', hemi: 1.3, sun: '#fff3e0', key: 3.2, fill: 4, env: 0.8, shadow: 0.55 },
  outdoor_04: { sky: '#c4c8d8', ground: '#5f5640', hemi: 1.0, sun: '#ffb46e', key: 2.4, fill: 6, env: 0.8, shadow: 0.45 },
};
/** A sun just above the horizon (outdoor_04) would smear the shadow map across the whole bay. */
const MIN_SUN_ELEVATION = 12;

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

/** Points every `step` m along a path (three.js floor coordinates: x, z = −d). */
const evenly = (path: { x: number; d: number }[], step: number) => {
  const raw = path.map((p) => new THREE.Vector2(p.x, -p.d));
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    const n = Math.max(1, Math.ceil(raw[i].distanceTo(raw[i + 1]) / step));
    for (let k = 0; k < n; k++) out.push(raw[i].clone().lerp(raw[i + 1], k / n));
  }
  out.push(raw[raw.length - 1].clone());
  return out;
};

/** A lath lying on the floor along a line: top and both sides (w wide, h high). */
const stripGeometry = (line: THREE.Vector2[], w: number, h: number) => {
  const pos: number[] = [];
  const idx: number[] = [];
  line.forEach((p, i) => {
    const q = line[Math.min(i + 1, line.length - 1)];
    const o = line[Math.max(i - 1, 0)];
    const t = q.clone().sub(o).normalize();
    const nx = -t.y * (w / 2);
    const nz = t.x * (w / 2);
    // 4 vertices per point: left bottom, left top, right top, right bottom
    pos.push(p.x + nx, 0, p.y + nz, p.x + nx, h, p.y + nz, p.x - nx, h, p.y - nz, p.x - nx, 0, p.y - nz);
    if (i > 0) {
      const a = (i - 1) * 4;
      const b = i * 4;
      for (const [u, v] of [[0, 1], [1, 2], [2, 3]]) idx.push(a + u, b + u, a + v, a + v, b + u, b + v);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

/** Flat band between two lines (gravel), UVs in meters. */
const ribbonGeometry = (a: THREE.Vector2[], b: THREE.Vector2[], y: number) => {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let run = 0;
  a.forEach((p, i) => {
    if (i > 0) run += p.distanceTo(a[i - 1]);
    pos.push(p.x, y, p.y, b[i].x, y, b[i].y);
    uv.push(0, run, p.distanceTo(b[i]), run);
    if (i > 0) {
      const k = (i - 1) * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
};

let walkway: { slat: THREE.Material; gravel: THREE.Material } | null = null;
/** Red painted slats; light gravel (a small generated texture, repeats every 40 cm). */
const walkwayMaterials = () => {
  if (walkway) return walkway;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#b9b3a6';
  ctx.fillRect(0, 0, 256, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * 256;
    const y = rnd() * 256;
    const r = 1.5 + rnd() * 4.5;
    const v = 150 + rnd() * 95;
    ctx.fillStyle = `rgb(${v}, ${v - 6}, ${v - 16})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(40, 36, 30, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.35, y + r * 0.35, r * 0.9, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 0.4, 1 / 0.4);
  tex.anisotropy = 8;
  walkway = {
    slat: new THREE.MeshStandardMaterial({ color: '#b02a22', roughness: 0.75 }),
    gravel: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  return walkway;
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

  /**
   * The environment (baked → unlit) and the light for the objects. Swaps when the environment changes.
   *   indoor   the hall with its outer shell, ceiling hidden from above
   *   outdoor  ground + berms rendered from above in Blender, the HDRI sky as a panorama, the HDRI's sun
   */
  async loadEnvironment(environment: Stage3D['environment']) {
    if (this.envId === environment) return;
    const room = roomOf(environment);
    const outdoor = room.kind === 'outdoor';
    const [env, sky] = await Promise.all([loadGlb(assetUrl(`env_${environment}.glb`)), outdoor ? loadSky(environment) : null]);
    if (this.disposed || this.envId === environment) return;
    this.envId = environment;
    this.room = room;
    this.scene.remove(this.envGroup);
    this.envGroup.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh && m.userData.own) m.geometry.dispose();
    });
    const eg = (this.envGroup = new THREE.Group());
    this.scene.add(eg);
    // the previous range's textures leave the graphics memory now (a range is up to ~0.5 GB there);
    // the cached model keeps the images, so going back to it simply uploads them again
    for (const m of this.hallMats) {
      m.map?.dispose();
      m.dispose();
    }
    this.hallMats = [];
    const hall = env.clone(true);
    hall.traverse((n) => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.MeshStandardMaterial;
      // the floor is seen at grazing angles: anisotropic filtering keeps it sharp into the distance
      if (src.map) src.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      const base = src.map ? new THREE.Color(0xffffff) : src.color.clone();
      const mat = new THREE.MeshBasicMaterial({ map: src.map ?? null, color: base.clone(), toneMapped: false });
      mat.userData.base = base;
      this.hallMats.push(mat);
      m.material = mat;
      m.userData.ceiling = !outdoor && (/ceiling/.test(m.name) || /ceiling/.test(src.name));
    });
    eg.add(hall);

    const cx = (room.x0 + room.x1) / 2;
    const cz = -(room.d0 + room.d1) / 2;
    if (!outdoor) {
      // The bake only has the faces seen from inside. Thick walls with tops around it make the
      // hall a closed building from above (briefing, fly-in) instead of paper-thin panels in the void.
      const side = new THREE.MeshBasicMaterial({ color: '#1d1f1e', toneMapped: false });
      const top = new THREE.MeshBasicMaterial({ color: '#4a4d4b', toneMapped: false });
      const T = 0.45;
      const H = room.height + 0.12;
      const len = room.d1 - room.d0 + 2 * T;
      const wid = room.x1 - room.x0 + 2 * T;
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
    }

    // shadows of the objects on the (unlit, baked) floor; outdoors they may fall past the bay
    const light = LIGHT[environment];
    const margin = outdoor ? 12 : 0;
    const catcher = new THREE.Mesh(
      new THREE.PlaneGeometry(room.x1 - room.x0 + 2 * margin, room.d1 - room.d0 + 2 * margin),
      new THREE.ShadowMaterial({ opacity: light.shadow }),
    );
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.set(cx, 0.002, cz);
    catcher.receiveShadow = true;
    catcher.userData.own = true;
    eg.add(catcher);
    this.ceilingHidden = false;

    // the ground reaches the horizon (~4 km) outdoors
    this.camera.far = outdoor ? 6000 : 300;
    this.camera.updateProjectionMatrix();
    const oldSky = this.scene.background;
    if (oldSky instanceof THREE.Texture && oldSky !== sky) oldSky.dispose();
    this.scene.background = sky ?? new THREE.Color('#050605');
    this.envBrightness = light.brightness ?? 1;
    this.applyBrightness();
    if (!this.lightsReady) {
      this.lightsReady = true;
      const key = new THREE.DirectionalLight();
      key.castShadow = true;
      key.shadow.mapSize.set(4096, 4096);
      key.shadow.bias = -0.0004;
      key.shadow.normalBias = 0.02;
      key.shadow.radius = 4;
      this.key = key;
      this.hemi = new THREE.HemisphereLight();
      // fill: from behind the shooter and a little above, no shadows
      this.fill = new THREE.DirectionalLight('#ffffff', 0);
      this.fill.position.set(0, 0.45, 1);
      this.scene.add(this.hemi, this.fill, key, key.target, this.stageGroup);
    }
    // reflections / ambient: the sky outdoors, a neutral room indoors
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const old = this.scene.environment;
    this.scene.environment = (sky ? pmrem.fromEquirectangular(sky) : pmrem.fromScene(new RoomEnvironment(), 0.04)).texture;
    old?.dispose();
    pmrem.dispose();
    this.hemi!.color.set(light.sky);
    this.hemi!.groundColor.set(light.ground);
    this.hemi!.intensity = light.hemi;
    this.key!.color.set(light.sun);
    this.key!.intensity = light.key;
    this.fill!.color.set(light.sky);
    this.fill!.intensity = light.fill;
    this.envIntensity = light.env;
    this.stageGroup.traverse((n) => {
      const m = (n as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'envMapIntensity' in m) m.envMapIntensity = light.env;
    });
    // the sun's direction (towards the sun); indoors and overcast: from above, slightly from behind-left
    const s = room.sun;
    const el = Math.max(MIN_SUN_ELEVATION, s?.elevation ?? 0) * DEG;
    this.sunDir = s
      ? new THREE.Vector3(Math.cos(s.azimuth * DEG) * Math.cos(el), Math.sin(el), -Math.sin(s.azimuth * DEG) * Math.cos(el))
      : new THREE.Vector3(-2, 12, 5).normalize();
    if (this.stage) this.aimKey(this.stage);
  }

  private hemi: THREE.HemisphereLight | null = null;
  /** Baked environment materials (their base colours are scaled by the brightness). */
  private hallMats: THREE.MeshBasicMaterial[] = [];
  private envBrightness = 1;
  private stageBrightness = 1;

  /**
   * Brightness = the environment's own × the stage's (Stage3D.brightness): darkens / lightens the baked
   * environment, the sky and (via the exposure) the live-lit objects alike.
   */
  private applyBrightness() {
    const b = this.envBrightness * this.stageBrightness;
    for (const m of this.hallMats) m.color.copy(m.userData.base).multiplyScalar(b);
    this.renderer.toneMappingExposure = b;
    this.scene.backgroundIntensity = b;
  }
  private fill: THREE.DirectionalLight | null = null;
  /** Reflections / ambient of the environment map on the objects. */
  private envIntensity = 0.5;
  private sunDir = new THREE.Vector3(-2, 12, 5).normalize();

  /** The key light's shadow covers the stage. */
  private aimKey(stage: Stage3D) {
    if (!this.key) return;
    const b = stageBounds(stage);
    const cx = (b.x0 + b.x1) / 2;
    const cd = (b.d0 + b.d1) / 2;
    this.key.target.position.set(cx, 0, -cd);
    this.key.position.copy(this.key.target.position).addScaledVector(this.sunDir, 30);
    const sc = this.key.shadow.camera;
    const half = Math.max(b.x1 - b.x0, b.d1 - b.d0) / 2 + 3;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 1;
    sc.far = 30 + half * 2;
    sc.updateProjectionMatrix();
  }

  /** Objects, shooting boxes and path arrows of a stage — call again after every edit (the hall stays). */
  async setStage(stage: Stage3D) {
    const gen = ++this.generation;
    this.stageBrightness = stage.brightness ?? 1;
    this.applyBrightness();
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
      // turn around the vertical last: tilt / roll lean the object in its own frame
      g.rotation.set(-(o.tilt ?? 0) * DEG, -(o.yaw ?? 0) * DEG, -(o.roll ?? 0) * DEG, 'YXZ');
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
        mat.envMapIntensity = this.envIntensity;
      });
      g.userData.objectId = o.id;
      group.add(g);
      if ((o.motion && o.motion.kind !== 'static') || o.shown) movers.push(makeMover(o, g));
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

    // ---- walkways: red wooden slats along every move (outdoors with gravel in between)
    const outdoor = roomOf(stage.environment).kind === 'outdoor';
    stage.legs.forEach((_, i) => this.makeWalkway(legPath(stage, i), outdoor, group));

    // ---- briefing arrows along the legs
    this.arrows = stage.legs.map((_, i) => this.makeArrow(legPath(stage, i), group));

    this.aimKey(stage);

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
   * The lane a move runs in, as at matches: two red wooden slats (5 × 3 cm) 1.2 m apart along the walked
   * line, from the edge of one shooting box to the edge of the next; outdoors gravel between them.
   */
  private makeWalkway(path: { x: number; d: number }[], gravel: boolean, group: THREE.Group) {
    const HALF = 0.6;
    const pts = evenly(path, 0.1);
    // leave the shooting boxes (1 × 1 m) free
    const len = pts.length;
    const cut = Math.min(Math.floor(len / 3), 6);
    const lane = pts.slice(cut, len - cut);
    if (lane.length < 2) return;
    const side = (k: number) =>
      lane.map((p, i) => {
        const q = lane[Math.min(i + 1, lane.length - 1)];
        const o = lane[Math.max(i - 1, 0)];
        const tx = q.x - o.x;
        const tz = q.y - o.y;
        const n = Math.hypot(tx, tz) || 1;
        return new THREE.Vector2(p.x + (-tz / n) * HALF * k, p.y + (tx / n) * HALF * k);
      });
    for (const k of [-1, 1]) {
      const slat = new THREE.Mesh(stripGeometry(side(k), 0.05, 0.03), walkwayMaterials().slat);
      slat.castShadow = slat.receiveShadow = true;
      slat.userData.own = true;
      group.add(slat);
    }
    if (gravel) {
      const g = new THREE.Mesh(ribbonGeometry(side(-1), side(1), 0.006), walkwayMaterials().gravel);
      g.receiveShadow = true;
      g.userData.own = true;
      group.add(g);
    }
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
    const above = this.room.kind === 'indoor' && f.camera.y > this.room.height - 0.4;
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
    const falls = fallTimes(stage.objects);
    for (const mv of this.movers) {
      const m = rep ? motionAt(mv.o.motion, rep.sinceStart, active, falls) : REST;
      const yaw = (mv.o.yaw ?? 0) * DEG;
      // slides run along the object's own face, bobs go up
      mv.node.position.set(mv.base.x + m.dx * Math.cos(yaw), mv.base.y + m.dy, mv.base.z + m.dx * Math.sin(yaw));
      // only up during part of the run (areas of a dynamic stage): between reps the clock is 0
      const sw = mv.o.shown;
      const clock = active ? rep!.sinceStart : 0;
      const inWindow = !rep || !sw || (clock >= (sw.from ?? -Infinity) && clock < (sw.until ?? Infinity));
      mv.node.visible = m.visible && inWindow;
      // swing: tilt in the object's own plane around its foot (+ = top to the right)
      mv.node.rotation.z = -(m.rot + (mv.o.roll ?? 0)) * DEG;
      // steel: the plate tips backwards (away from the shooter) around its lower edge
      for (const p of mv.tips) p.rotation.x = -m.fall * 1.45;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen rectangle (normalised 0..1) of an object as it is drawn now, null when it is not in front of the camera. */
  screenBox(objectId: string) {
    const g = this.stageGroup.children.find((c) => c.userData.objectId === objectId);
    if (!g) return null;
    const b = new THREE.Box3().setFromObject(g);
    if (b.isEmpty()) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(this.camera);
      if (v.z > 1) return null;
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
    }
    return { x0: (x0 + 1) / 2, x1: (x1 + 1) / 2, y0: (1 - y1) / 2, y1: (1 - y0) / 2 };
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
    // the range's textures, sky and reflections leave the graphics memory with the scene (the editor
    // preview, the player and every MP4 render have their own); cached models upload them again when needed
    for (const m of this.hallMats) {
      m.map?.dispose();
      m.dispose();
    }
    this.hallMats = [];
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}
